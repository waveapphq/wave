/** Stop probes for nesting cells: a Shell Script process tree and this run's own Remote Execution workers, each polled to a bound. */

import { test, expect, type APIRequestContext, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import {
  BACKEND_URL,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import { getSessionVariables, importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  edge,
  markerNode,
  pluginNode,
  sshSessionExecNode,
  sshSessionOpenNode,
} from '../../helpers/k8s-nodes'
import { startRun } from '../../helpers/k8s-run'
import { clearConsoleLogs } from '../../helpers/log-reader'
import { leaf, TOKEN_PLACEHOLDER, type NestLeaf } from '../../helpers/nesting-graph'
import { selectEnvironment } from '../../helpers/workbench'
import { deleteTest } from '../file-picker/picker'
import { stripOneNewline, treeProbeCommand, withToken } from '../shell-blocks/shell-helpers'
import type { CellRun, NestCell } from './nesting-harness'

/** The pid folder is `sh-<n>-<token>` (the shared tree probe's layout); the token keeps it per run. */
const TREE_FOLDER_NUMBER = 6
const TREE_PID_FILE = 'bg.pid'
const HOLD_SECONDS = 300
const PROBE_BOUND_MS = 30_000
const PROBE_STEP_TIMEOUT_MS = 15_000
const PID_LIST = /^\d+( \d+)*$/
const CHECKER_SESSION_VARIABLE = 'checker_sid'
const CHECKER_VARIABLE = 'host_probe'
const CHECKER_SEED = 'seed'

// Finds this exec channel's own sshd process, then walks every worker process on the host.
const WORKER_SCAN =
  `s=$$; while [ "$s" -gt 1 ] && [ "$(cat /proc/$s/comm)" != sshd ]; do s=$(cut -d' ' -f4 /proc/$s/stat); done; ` +
  `o=; for d in /proc/[0-9]*; do tr '\\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q "wave[-]worker" || continue; `
const KEEP_PID = `o="$o\${o:+ }\${d#/proc/}"`

// Pids of the worker processes whose parent is this exec channel's own sshd process.
const OWN_WORKER_PIDS_COMMAND =
  WORKER_SCAN + `[ "$(cut -d' ' -f4 "$d/stat" 2>/dev/null)" = "$s" ] && ${KEEP_PID}; done; printf '%s' "$o"`

// The same, plus the request processes those workers started (their parent is one of the workers).
const OWN_WORKER_AND_REQUEST_PIDS_COMMAND =
  WORKER_SCAN +
  `p=$(cut -d' ' -f4 "$d/stat" 2>/dev/null); [ -n "$p" ] || continue; ` +
  `if [ "$p" = "$s" ] || [ "$(cut -d' ' -f4 /proc/$p/stat 2>/dev/null)" = "$s" ]; then ${KEEP_PID}; fi; done; printf '%s' "$o"`

// Keyed on Playwright's per-test id, so a worker restart never mixes two tests' entities.
const checkerTests = new Map<string, string[]>()

/** Per-test teardown for an afterEach hook: the worker checker Tests this module imports. */
export async function deleteStopProbeTests(request: APIRequestContext, testInfo: TestInfo): Promise<void> {
  const ids = checkerTests.get(testInfo.testId) ?? []
  checkerTests.delete(testInfo.testId)
  for (const id of ids) await deleteTest(request, id)
}

/** The line the tree Shell Script prints once its background job is up. */
export function readyText(token: string): string {
  return `ready-${token}`
}

/** A Shell Script that starts a background job, records its pid, prints its ready line and holds. */
export function treeHoldScript(id: string): NestLeaf {
  const folder = `"$WAVE_ARTIFACTS_DIR/sh-${TREE_FOLDER_NUMBER}-${TOKEN_PLACEHOLDER}"`
  const script =
    `d=${folder}; mkdir -p "$d"; sleep ${HOLD_SECONDS} & echo $! > "$d/${TREE_PID_FILE}"; ` +
    `P=rea; echo "\${P}dy-${TOKEN_PLACEHOLDER}"; sleep ${HOLD_SECONDS}`
  return leaf(
    pluginNode({
      id,
      label: 'Shell Script',
      elementType: 'shell-script',
      category: 'system',
      description: id,
      values: { script_type: 'source', script, stream_output: true },
    }),
  )
}

/** A Shell Exec printing alive, gone or missing for the tree Shell Script's background job into `variable`. */
export function treeProbe(id: string, variable: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'Shell Exec',
      elementType: 'shell-exec',
      category: 'system',
      description: id,
      values: { command: treeProbeCommand(TREE_FOLDER_NUMBER, TREE_PID_FILE) },
      outputBindings: { stdout: variable },
    }),
    { vars: [{ name: variable, type: 'string', seed: '', flow: 'export' }] },
  )
}

/** An SSH Session Exec on `sessionVariable` printing this connection's own worker pids (and, when asked, their request process pids) into `variable`. */
export function workerPidRecorder(
  id: string,
  sessionVariable: string,
  variable: string,
  scope: 'workers' | 'workers-and-requests' = 'workers',
): NestLeaf {
  const command = scope === 'workers' ? OWN_WORKER_PIDS_COMMAND : OWN_WORKER_AND_REQUEST_PIDS_COMMAND
  return leaf(
    sshSessionExecNode({
      id,
      description: id,
      values: { session_id: sessionVariable, command, timeout: 30 },
      expressionFields: ['session_id'],
      outputBindings: { stdout: variable },
    }),
    { vars: [{ name: variable, type: 'string', seed: '', flow: 'export' }] },
  )
}

async function currentSessionId(page: Page): Promise<string> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as { data?: { session_id?: string } } | null
  return body?.data?.session_id ?? ''
}

async function clearConsoleIfFilled(page: Page): Promise<void> {
  const clear = page.locator('[data-testid="console-panel-header"] button[aria-label="Clear console"]').first()
  if ((await clear.count()) > 0 && (await clear.isEnabled())) await clearConsoleLogs(page)
}

async function newSessionAfter(page: Page, oldSid: string): Promise<string> {
  let sid = oldSid
  await expect
    .poll(
      async () => {
        sid = await currentSessionId(page)
        return sid
      },
      { timeout: PROBE_STEP_TIMEOUT_MS, message: 'the probe run never opened a new session' },
    )
    .not.toBe(oldSid)
  return sid
}

/** The trimmed value a run wrote into `variable`, waiting until it differs from `seed`. */
async function writtenValue(page: Page, sid: string, variable: string, seed: string): Promise<string> {
  let value = seed
  await expect
    .poll(
      async () => {
        const vars = await getSessionVariables(page, sid)
        value = stripOneNewline(String(vars[variable]?.value ?? seed))
        return value
      },
      { timeout: PROBE_STEP_TIMEOUT_MS, message: `the probe run never wrote ${variable}` },
    )
    .not.toBe(seed)
  return value
}

/** Read again until the value is `want` or the bound passes; a failed read is kept as the last value. */
async function pollUntil(page: Page, read: () => Promise<string>, want: string, boundMs: number): Promise<string> {
  const deadline = Date.now() + boundMs
  for (;;) {
    let last: string
    try {
      last = await read()
    } catch (error) {
      last = `read failed: ${String((error as Error).message ?? error).split('\n')[0]}`
    }
    if (last === want || Date.now() >= deadline) return last
    await page.waitForTimeout(1_000)
  }
}

async function runCurrentRead(page: Page, nodeId: string, variable: string): Promise<string> {
  const oldSid = await currentSessionId(page)
  await clearConsoleIfFilled(page)
  await selectEnvironment(page)
  await clickNodeKebabItem(page, nodeId, 'Run Current')
  const sid = await newSessionAfter(page, oldSid)
  return writtenValue(page, sid, variable, '')
}

/** Run Current on the tree probe (same artifacts folder) until it reads gone, bounded. */
export async function expectTreeGone(page: Page, cell: NestCell, probeNodeId: string, variable: string): Promise<void> {
  const last = await test.step(`${cell.cellId}: Run Current on the tree probe until it reads gone`, () =>
    pollUntil(page, () => runCurrentRead(page, probeNodeId, variable), 'gone', PROBE_BOUND_MS),
  )
  expect
    .soft(last, `${cell.cellId}: the Shell Script's background job is gone after the Stop (polled for ${PROBE_BOUND_MS} ms)`)
    .toBe('gone')
}

function checkerCommand(pids: readonly string[]): string {
  return (
    `s=; for p in ${pids.join(' ')}; do set -- $(cat /proc/$p/stat 2>/dev/null); ` +
    'if [ -n "$3" ] && [ "$3" != Z ]; then r=alive; else r=gone; fi; ' +
    'printf %s%s "$s" $r; s=" "; done'
  )
}

function checkerFixture(cellId: string, pids: readonly string[]): Record<string, unknown> {
  const open = sshSessionOpenNode({
    id: 'checker-open',
    description: 'checker-open',
    values: {
      host: SSH_FIXTURE_HOST_SENTINEL,
      port: Number(SSH_MAIN_PORT),
      username: SSH_STACK_USER,
      password: SSH_STACK_PASSWORD,
      host_key_verification: 'disabled',
      connect_timeout: 30,
    },
    outputBindings: { session_id: CHECKER_SESSION_VARIABLE },
    position: { x: 200, y: 100 },
  })
  const exec = sshSessionExecNode({
    id: 'checker-exec',
    description: 'checker-exec',
    values: { session_id: CHECKER_SESSION_VARIABLE, command: checkerCommand(pids), timeout: 30 },
    expressionFields: ['session_id'],
    outputBindings: { stdout: CHECKER_VARIABLE },
    position: { x: 200, y: 200 },
  })
  const done = markerNode({ id: 'checker-done', description: 'checker-done', text: `checker-done-${TOKEN_PLACEHOLDER}`, position: { x: 200, y: 300 } })
  return {
    name: `${cellId} worker checker ${TOKEN_PLACEHOLDER}`,
    version: '1.0.0',
    description: 'Reports gone or alive for each worker pid a stopped nesting cell recorded',
    workflow: {
      nodes: [open, exec, done],
      edges: [
        { id: 'edge-start-checker-open', source: 'start-node', target: 'checker-open' },
        edge('checker-open', 'checker-exec'),
        edge('checker-exec', 'checker-done'),
      ],
    },
    variables: {
      [CHECKER_SESSION_VARIABLE]: { value: '', type: 'string', scope: 'test' },
      [CHECKER_VARIABLE]: { value: CHECKER_SEED, type: 'string', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

async function runCheckerRead(page: Page): Promise<string> {
  const oldSid = await currentSessionId(page)
  await clearConsoleIfFilled(page)
  await startRun(page)
  const sid = await newSessionAfter(page, oldSid)
  return writtenValue(page, sid, CHECKER_VARIABLE, CHECKER_SEED)
}

/** The pids `variable` recorded are this run's own workers; a checker Test reads gone for every one within the bound. */
export async function expectWorkersGone(
  page: Page,
  cell: NestCell,
  run: CellRun,
  variable: string,
  after = 'the Stop',
): Promise<void> {
  const recorded = stripOneNewline(String(run.variables[variable]?.value ?? ''))
  expect
    .soft(recorded, `${cell.cellId}: the body recorded at least one worker pid of this run's own connection`)
    .toMatch(PID_LIST)
  if (!PID_LIST.test(recorded)) return
  const pids = recorded.split(' ')
  const checkerId = await test.step(`${cell.cellId}: import the worker checker Test`, () =>
    importValidateAndNavigate(page, withToken(checkerFixture(cell.cellId, pids), cell.token), { injectSsh: true }),
  )
  const owned = checkerTests.get(test.info().testId) ?? []
  owned.push(checkerId)
  checkerTests.set(test.info().testId, owned)

  const want = pids.map(() => 'gone').join(' ')
  const last = await test.step(`${cell.cellId}: run the worker checker until every pid reads gone`, () =>
    pollUntil(page, () => runCheckerRead(page), want, PROBE_BOUND_MS),
  )
  expect
    .soft(last, `${cell.cellId}: every worker this run started is gone after ${after} (pids ${recorded}, polled for ${PROBE_BOUND_MS} ms)`)
    .toBe(want)
}
