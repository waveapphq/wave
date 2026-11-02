/** Probes, openers and readers for Functions combined with Remote Execution at more than one level (see README.md). */

import { test, expect, type APIRequestContext, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment, HTTP_TARGET_SERVICE } from '../../helpers/config'
import { openTest, publishLibraryFunction } from '../../helpers/fn-seed'
import { pluginNode } from '../../helpers/k8s-nodes'
import { getLogRows, type LogRow } from '../../helpers/log-reader'
import {
  buildNestingGraph,
  leaf,
  setter,
  shellScript,
  TOKEN_PLACEHOLDER,
  type NestingGraph,
  type NestingGraphSpec,
  type NestLeaf,
  type PublishedFunctions,
} from '../../helpers/nesting-graph'
import { newToken, withToken } from '../shell-blocks/shell-helpers'
import { openCell, type CellRun, type NestCell } from './nesting-harness'

const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped'])
const AD_HOC_TIMEOUT_MS = 120_000
const SEPARATOR = '|'
// After the command name in parentheses: the state, then the parent pid.
const PROC_STAT_PARENT = /\) \S+ (\d+) /

// Keyed on Playwright's per-test id, so a worker restart never mixes two tests' entities.
const libraryOnly = new Map<string, string[]>()

/** Open a cell through the harness, then on the Workbench page whatever surface the harness rule picked for its id. */
export async function openCanvasCell(page: Page, cellId: string, spec: Omit<NestingGraphSpec, 'name'>): Promise<NestCell> {
  const cell = await openCell(page, cellId, spec)
  if (cell.surface !== 'canvas') {
    await test.step(`${cellId}: open the Test on the canvas`, () => openTest(page, cell.testId))
  }
  return { ...cell, surface: 'canvas' }
}

/** The URL a remote echo probe requests: http-target resolves only on the Execution Host's network. */
export function echoUrl(id: string, token: string = TOKEN_PLACEHOLDER): string {
  return `https://${HTTP_TARGET_SERVICE}:9443/echo?probe=${id}-${token}`
}

/** A remotable HTTP GET to http-target; it passes only where that service name resolves (the Execution Host). */
export function remoteEcho(id: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'HTTP',
      elementType: 'http-client',
      category: 'network',
      description: id,
      values: { method: 'GET', url: echoUrl(id), timeout: 30, retry_count: 0, verify_ssl: false },
    }),
  )
}

// The replayed response line reads `HTTP <status> <url>`; the DEBUG Inputs line also names the URL and is skipped.
const ECHO_RESPONSE = /^HTTP \d{3} /

function echoRequests(rows: readonly LogRow[], cell: NestCell, id: string): number {
  const url = echoUrl(id, cell.token)
  return rows.filter((row) => row.level !== 'DEBUG' && ECHO_RESPONSE.test(row.message) && row.message.endsWith(url)).length
}

/** How many responses the echo probe received, read from the live console. */
export async function liveEchoCount(page: Page, cell: NestCell, id: string): Promise<number> {
  return echoRequests(await getLogRows(page), cell, id)
}

/** A Shell Script on WAVE writing a file into this run's artifacts folder and printing its absolute path into `variable`. */
export function waveOnlyFile(id: string, variable: string): NestLeaf {
  const script =
    `d="$WAVE_ARTIFACTS_DIR"; mkdir -p "$d"; f="$d/wave-only-${TOKEN_PLACEHOLDER}.txt"; ` + `printf x > "$f"; printf %s "$f"`
  return shellScript(id, script, {
    outputBindings: { stdout: variable },
    vars: [{ name: variable, type: 'string', seed: '', flow: 'export' }],
  })
}

/** A remotable File I/O read of the path `pathVariable` holds; meant to fail (the path exists on WAVE only). */
export function readPathFrom(id: string, pathVariable: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: id,
      values: { operation: 'read', path: pathVariable },
      expressionFields: ['path'],
    }),
    { vars: [{ name: pathVariable, type: 'string', seed: '', flow: 'import' }], trigger: true },
  )
}

/** A remotable File I/O read of a literal path, bound to `variable`; a trigger (it is meant to fail). */
export function literalRead(id: string, path: string, variable: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: id,
      values: { operation: 'read', path },
      outputBindings: { content: variable },
    }),
    { vars: [{ name: variable, type: 'string', seed: 'seed', flow: 'export' }], trigger: true },
  )
}

/** A Variable Setter appending each source variable to its target with a separator (targets use the given flow). */
export function appendTo(id: string, targets: Record<string, string>, flow: 'local' | 'export' = 'local'): NestLeaf {
  return setter(
    id,
    Object.fromEntries(
      Object.entries(targets).map(([into, from]) => [
        into,
        { value: `${into} + '${SEPARATOR}' + ${from}`, expression: true, type: 'string' as const, seed: '', flow },
      ]),
    ),
  )
}

/** The trimmed non-empty entries an `appendTo` variable collected. */
export function appended(run: CellRun, variable: string): string[] {
  const value = run.variables[variable]?.value
  return String(typeof value === 'string' ? value : '')
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** The worker pid of one /proc/self/stat line (its request process's parent), or null. */
export function parentPid(statLine: string): number | null {
  const match = PROC_STAT_PARENT.exec(statLine)
  return match ? Number(match[1]) : null
}

/** Every pid a space-separated recorder variable holds. */
export function recordedPids(run: CellRun, variable: string): number[] {
  const value = run.variables[variable]?.value
  return String(typeof value === 'string' ? value : '')
    .split(/[\s|]+/)
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
}

/** The same run with one more variable, for readers that take a variable name. */
export function withVariable(run: CellRun, name: string, value: string): CellRun {
  return { ...run, variables: { ...run.variables, [name]: { value, type: 'string' } } }
}

/** The locus badge a node shows right now: R, L, or none. */
export async function locusBadgeOf(page: Page, nodeId: string): Promise<string> {
  const badge = page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-remote-locus-badge"]`)
  if ((await badge.count()) === 0) return 'none'
  return (await badge.first().getAttribute('data-locus')) ?? 'none'
}

/** Record, without asserting, what the product shows for an outcome the design leaves open. */
export function recordUnsettled(cellId: string, description: string): void {
  test.info().annotations.push({ type: 'unsettled', description: `${cellId}: ${description}` })
}

async function currentSessionId(page: Page): Promise<string> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as { data?: { session_id?: string } } | null
  return body?.data?.session_id ?? ''
}

export type AdHocOutcome = {
  sessionId: string
  status: string
  scopedResult: { status?: string; outputs?: Record<string, unknown> } | null
}

/** Start an ad-hoc run with `start`, then wait for its new session to reach a terminal status. */
export async function runAdHoc(page: Page, cell: NestCell, what: string, start: () => Promise<void>): Promise<AdHocOutcome> {
  const before = await currentSessionId(page)
  await start()
  let sessionId = before
  await expect
    .poll(
      async () => {
        sessionId = await currentSessionId(page)
        return sessionId
      },
      { timeout: 15_000, message: `${cell.cellId}: ${what} opens a new session` },
    )
    .not.toBe(before)
  let outcome: AdHocOutcome = { sessionId, status: '', scopedResult: null }
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BACKEND_URL}/workbench/${sessionId}/status`)
        const body = (await response.json().catch(() => null)) as {
          data?: { status?: string; scoped_result?: AdHocOutcome['scopedResult'] }
        } | null
        outcome = { sessionId, status: body?.data?.status ?? '', scopedResult: body?.data?.scoped_result ?? null }
        return TERMINAL.has(outcome.status)
      },
      { timeout: AD_HOC_TIMEOUT_MS, message: `${cell.cellId}: ${what} reaches a terminal status` },
    )
    .toBe(true)
  return outcome
}

/** Per-test teardown for an afterEach hook: the library Functions a library-only cell published, outermost first. */
export async function deleteLibraryOnlyFunctions(request: APIRequestContext, testInfo: TestInfo): Promise<void> {
  const ids = libraryOnly.get(testInfo.testId) ?? []
  libraryOnly.delete(testInfo.testId)
  for (const functionId of [...ids].reverse()) {
    const response = await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`)
    expect(response.ok(), `teardown DELETE /functions/${functionId}?cascade=true answered ${response.status()}`).toBeTruthy()
  }
}

/** Publish only the Functions a graph defines (no Test is created). */
export async function publishFunctionsOnly(
  page: Page,
  cellId: string,
  spec: Omit<NestingGraphSpec, 'name'>,
): Promise<{ token: string; graph: NestingGraph; functions: PublishedFunctions }> {
  const token = newToken()
  const ids: string[] = []
  libraryOnly.set(test.info().testId, ids)
  const graph = buildNestingGraph({ ...spec, name: `${cellId} ${TOKEN_PLACEHOLDER}` })
  await ensureEnvironment(page.request)
  const functions: PublishedFunctions = {}
  for (const plan of graph.functions) {
    const published = await publishLibraryFunction(page.request, withToken(plan.build(functions), token))
    ids.push(published.functionId)
    functions[plan.key] = published
  }
  return { token, graph, functions }
}
