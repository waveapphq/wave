/** Runs a nesting cell without the Workbench page: REST start, WebSocket events, and the canvas paint rule applied to them (see README.md). */

import { randomUUID } from 'node:crypto'
import { expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import type { NodeStatus } from '../../helpers/k8s-run'
import type { LogEntry, LogRow } from '../../helpers/log-reader'

type Frame = Record<string, unknown>

export type ApiRun = {
  sessionId: string
  socket: WebSocket
  workbench: Frame[]
  logs: Frame[]
  /** Callbacks the next event frame runs, so a pending wait re-checks at once. */
  wake: Set<() => void>
}

const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped'])
const SUBSCRIBE_TIMEOUT_MS = 8_000
const POLL_MS = 100
const BOOKEND_TIMEOUT_MS = 30_000
const QUIET_MS = 300
const QUIET_LIMIT_MS = 5_000

// The canvas maps these workbench statuses before painting (use-workbench-run hook); every other status paints as sent.
const PAINT_STATUS: Readonly<Record<string, string>> = { passed: 'success' }

const openSockets = new Set<WebSocket>()
let environmentId: string | null = null

/** Close every socket this worker opened and did not finish; called from each spec's afterEach teardown. */
export function closeApiSockets(): void {
  for (const socket of openSockets) socket.close()
  openSockets.clear()
}

async function e2eEnvironmentId(page: Page): Promise<string> {
  if (environmentId) return environmentId
  const response = await page.request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  const envs = (Array.isArray(body) ? body : (body.data ?? [])) as { id: string; name: string }[]
  const found = envs.find((env) => env.name === E2E_ENV_NAME)
  expect(found, `the ${E2E_ENV_NAME} environment exists`).toBeTruthy()
  environmentId = found!.id
  return environmentId
}

function subscribe(run: ApiRun, topics: readonly string[]): Promise<void> {
  const pending = new Set(topics)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`subscription timeout: ${[...pending].join(', ')}`)), SUBSCRIBE_TIMEOUT_MS)
    run.socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('websocket error'))
    })
    run.socket.addEventListener('message', (event: MessageEvent) => {
      let frame: Frame
      try {
        frame = JSON.parse(String(event.data)) as Frame
      } catch {
        return
      }
      const topic = String(frame.topic ?? '')
      if (frame.type === 'subscribed') {
        pending.delete(topic)
        if (pending.size === 0) {
          clearTimeout(timer)
          resolve()
        }
      } else if (frame.type === 'event' && frame.payload) {
        const target = topic.startsWith('log:') ? run.logs : run.workbench
        target.push(frame.payload as Frame)
        for (const wake of [...run.wake]) wake()
      }
    })
    run.socket.addEventListener('open', () => {
      for (const topic of topics) {
        run.socket.send(JSON.stringify({ type: 'subscribe', topic, ...(topic.startsWith('log:') ? { level: 'DEBUG' } : {}) }))
      }
    })
  })
}

/** Subscribe to the session's workbench and log topics, then start the run with that session id. */
export async function startApiRun(page: Page, cellId: string, testId: string): Promise<ApiRun> {
  const sessionId = randomUUID()
  const socket = new WebSocket(`ws://localhost:${BACKEND_PORT}/ws`)
  openSockets.add(socket)
  const run: ApiRun = { sessionId, socket, workbench: [], logs: [], wake: new Set() }
  await subscribe(run, [`workbench:${sessionId}`, `log:${sessionId}`])
  const response = await page.request.post(`${BACKEND_URL}/workbench/run`, {
    data: { test_id: testId, environment_id: await e2eEnvironmentId(page), session_id: sessionId },
  })
  const body = await response.json().catch(() => null)
  expect(response.ok(), `${cellId}: the run starts (${response.status()} ${JSON.stringify(body)})`).toBeTruthy()
  return run
}

/** Resolves on the run's next event frame, or after POLL_MS when none arrives. */
function nextFrame(run: ApiRun): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      run.wake.delete(done)
      resolve()
    }
    const timer = setTimeout(done, POLL_MS)
    run.wake.add(done)
  })
}

async function until(run: ApiRun, predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await nextFrame(run)
  }
  return predicate()
}

/** Settle on the logs: the bookend line when one is awaited, otherwise a short quiet period. */
async function settleLogs(run: ApiRun, bookend: string | null): Promise<void> {
  if (bookend !== null) {
    await until(run, () => run.logs.some((entry) => String(entry.message ?? '').includes(bookend)), BOOKEND_TIMEOUT_MS)
    return
  }
  let seen = -1
  const deadline = Date.now() + QUIET_LIMIT_MS
  while (Date.now() < deadline && run.logs.length !== seen) {
    seen = run.logs.length
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
  }
}

/** The canvas paint of each root node, derived from the workbench events the canvas paints from. */
export function paintFromEvents(events: readonly Frame[], nodeIds: readonly string[]): NodeStatus[] {
  const paint = new Map<string, string>()
  let current: string | null = null
  let paused: string | null = null
  for (const event of events) {
    if (event.type === 'block_status_changed') {
      const status = String(event.status)
      paint.set(String(event.block_id), PAINT_STATUS[status] ?? status)
      current = String(event.block_id)
    } else if (event.type === 'debug_breakpoint_hit') {
      current = String(event.node_id)
      paused = current
    } else if (event.type === 'execution_completed' && event.status === 'stopped' && (paused ?? current)) {
      paint.set((paused ?? current)!, 'stopped')
    }
  }
  return nodeIds.map((id) => ({ testId: `workflow-node-${id}`, status: paint.get(id) ?? null }))
}

export type ApiRunResult = { verdict: string | null; rows: LogRow[]; entries: LogEntry[]; statuses: NodeStatus[] }

/** Wait for a terminal status and the completion event, settle the logs, and read what the canvas and console would show. */
export async function finishApiRun(
  cellId: string,
  run: ApiRun,
  opts: { timeoutMs: number; bookend: string; awaitBookend?: boolean; nodeIds: readonly string[] },
): Promise<ApiRunResult> {
  // The verdict is the completion event's, as on the canvas: the session status can read failed or skipped mid-run while a Try/Catch or a Function boundary absorbs it.
  const completed = () => run.workbench.find((event) => event.type === 'execution_completed')
  await until(run, () => completed() !== undefined, opts.timeoutMs)
  const verdict = completed() ? String(completed()!.status) : null
  expect(verdict !== null && TERMINAL.has(verdict), `${cellId}: the run reaches a terminal state (completion event status ${verdict})`).toBeTruthy()
  await settleLogs(run, (opts.awaitBookend ?? verdict === 'passed') ? opts.bookend : null)
  run.socket.close()
  openSockets.delete(run.socket)

  // Receipt order, the order the console receives and shows.
  const ordered = run.logs
  const entries: LogEntry[] = ordered.map((entry) => ({
    level: String(entry.level ?? ''),
    // The console shows the source as the backend sends it (EXEC-25).
    source: String(entry.source ?? ''),
    message: String(entry.message ?? '').trim(),
  }))
  const rows: LogRow[] = entries.map((entry, index) => ({ ...entry, timestamp: String(ordered[index].timestamp ?? '') }))
  return { verdict, rows, entries, statuses: paintFromEvents(run.workbench, opts.nodeIds) }
}
