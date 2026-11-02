/** Shared cell runner for the nesting specs; each describe's afterEach calls deleteCellEntities (see README.md). */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importFixtureTest,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { publishLibraryFunction, validateTest, VALIDATION } from '../../helpers/fn-seed'
import { getNodeStatuses, type NodeStatus } from '../../helpers/k8s-run'
import {
  getLogCopyTexts,
  getLogRows,
  getLogTexts,
  type LogEntry,
  type LogRow,
} from '../../helpers/log-reader'
import {
  buildNestingGraph,
  markerText,
  TOKEN_PLACEHOLDER,
  type NestingGraph,
  type NestingGraphSpec,
  type PublishedFunctions,
} from '../../helpers/nesting-graph'
import { pollRunStatus, selectEnvironment } from '../../helpers/workbench'
import { deleteTest } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import { closeApiSockets, finishApiRun, startApiRun, type ApiRun } from './api-run'

const TERMINAL = /^(passed|failed|stopped|skipped)$/
const RUN_TIMEOUT_MS = 120_000
const CONSOLE_SETTLE_MS = 30_000
const BOOKEND_POLL_MS = 100
const QUIET_POLL_MS = 250
const CONSOLE_QUIET_MS = 1_000

type Created = { token: string; testId?: string; functionIds: string[] }

// Keyed on Playwright's per-test id, so a worker restart never mixes two tests' entities.
const created = new Map<string, Created>()

/** Where a cell runs: the Workbench page, or the API with the canvas paint rule applied to the events. */
export type CellSurface = 'canvas' | 'api'

export type NestCell = {
  cellId: string
  token: string
  graph: NestingGraph
  testId: string
  functions: PublishedFunctions
  surface: CellSurface
}

// Debug, ad-hoc, depth and Stop cells drive page controls; the placement cells in a For body and the bare failure cells in a For prove the canvas paints what the events say.
const CANVAS_CELLS: readonly RegExp[] = [/^C\./, /^D\./, /^B6\./, /^A\.for-body\./, /^B3\.for\.[^.]+\.bare\.then$/]

export function cellSurface(cellId: string): CellSurface {
  return CANVAS_CELLS.some((pattern) => pattern.test(cellId)) ? 'canvas' : 'api'
}

const apiRuns = new WeakMap<NestCell, ApiRun>()

export type CellRun = {
  verdict: string | null
  /** Console rows in display order (the source cell is cut to its column). */
  rows: LogRow[]
  /** Console entries read from the copy text, with full sources. */
  entries: LogEntry[]
  statuses: NodeStatus[]
  variables: Record<string, { value: unknown; type: string }>
}

/** Per-test teardown for an afterEach hook: the Test, then every Function it published, outermost first. */
export async function deleteCellEntities(request: APIRequestContext, testInfo: TestInfo): Promise<void> {
  closeApiSockets()
  const entry = created.get(testInfo.testId)
  created.delete(testInfo.testId)
  if (!entry) return
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  if (entry.testId) await deleteTest(request, entry.testId)
  for (const functionId of [...entry.functionIds].reverse()) {
    const response = await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`)
    expect(
      response.ok(),
      `teardown (${entry.token}) DELETE /functions/${functionId}?cascade=true answered ${response.status()}`,
    ).toBeTruthy()
  }
}

/** The full text of a generated marker in this cell's run. */
export function cellText(cell: NestCell, id: string): string {
  return markerText(id, cell.token)
}

/** Publish the Functions, import the Test (zero validation errors), open it, and check run-context validation. */
export async function openCell(
  page: Page,
  cellId: string,
  spec: Omit<NestingGraphSpec, 'name'>,
): Promise<NestCell> {
  const token = newToken()
  const entry: Created = { token, functionIds: [] }
  created.set(test.info().testId, entry)
  const graph = buildNestingGraph({ ...spec, name: `${cellId} ${TOKEN_PLACEHOLDER}` })
  await ensureEnvironment(page.request)

  const functions: PublishedFunctions = {}
  await test.step(`${cellId}: publish ${graph.functions.length} Function(s)`, async () => {
    for (const plan of graph.functions) {
      const payload = withToken(plan.build(functions), token)
      const published = await publishLibraryFunction(page.request, payload)
      entry.functionIds.push(published.functionId)
      functions[plan.key] = published
    }
  })

  const surface = cellSurface(cellId)
  const importOptions = { injectSsh: graph.sshOpenIds.length > 0, rejectRepairs: true }
  const document = withToken(graph.fixture(functions), token)
  const testId = await test.step(`${cellId}: the graph imports with zero validation errors`, async () => {
    if (surface === 'canvas') return importValidateAndNavigate(page, document, importOptions)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    return importFixtureTest(page, document, importOptions)
  })
  entry.testId = testId

  await test.step(`${cellId}: run-context validation reports no errors`, async () => {
    const result = await validateTest(page.request, testId, 'run')
    expect(result.errors, `${cellId}: run-context validation errors`).toEqual([])
    expect(result.status, `${cellId}: run-context validation status`).toBe(200)
  })

  return { cellId, token, graph, testId, functions, surface }
}

async function startFrom(page: Page, cell: NestCell, button: Locator): Promise<void> {
  await selectEnvironment(page)
  await button.click()
  const status = page.locator('[data-testid="workflow-status"]')
  const dialog = page.locator(VALIDATION.dialog)
  await expect
    .poll(
      async () => {
        if (await dialog.isVisible().catch(() => false)) return 'dialog'
        return (await status.getAttribute('data-status')) === 'idle' ? '' : 'started'
      },
      { timeout: 15_000, intervals: [50, 100, 250], message: `${cell.cellId}: the run leaves idle` },
    )
    .toBeTruthy()
  if (await dialog.isVisible().catch(() => false)) {
    const text = await dialog.innerText()
    expect(text, `${cell.cellId}: the pre-run check reports no errors`).toBe('')
  }
}

/** Start the run: Run on the page (fails if the pre-run check opens its dialog), or the run API for an api cell. */
export async function startCellRun(page: Page, cell: NestCell): Promise<void> {
  if (cell.surface === 'api') {
    apiRuns.set(cell, await startApiRun(page, cell.cellId, cell.testId))
    return
  }
  await startFrom(page, cell, page.locator('[data-testid="run-button"]'))
}

/** Select the environment and click Debug; breakpoints are set beforehand. */
export async function startCellDebug(page: Page, cell: NestCell): Promise<void> {
  expect(cell.surface, `${cell.cellId}: a debug cell runs on the canvas`).toBe('canvas')
  await startFrom(page, cell, page.locator('[data-testid="debug-button"]'))
}

/** Return once the bookend renders, or once a console with no bookend to wait for keeps one line count for 1 s; never throws. */
async function settleConsole(page: Page, bookend: string | null): Promise<void> {
  let previous = -1
  let countSince = 0
  const deadline = Date.now() + CONSOLE_SETTLE_MS
  while (Date.now() < deadline) {
    const readAt = Date.now()
    const texts = await getLogTexts(page)
    if (bookend !== null && texts.some((text) => text.includes(bookend))) return
    if (bookend === null && texts.length > 0 && texts.length === previous && readAt - countSince >= CONSOLE_QUIET_MS) return
    if (texts.length !== previous) {
      previous = texts.length
      // The quiet second counts from the end of the read that first saw this count.
      countSince = Date.now()
    }
    if (bookend !== null) await page.waitForTimeout(BOOKEND_POLL_MS)
    else if (texts.length === 0) await page.waitForTimeout(QUIET_POLL_MS)
    else await page.waitForTimeout(Math.max(0, Math.min(QUIET_POLL_MS, countSince + CONSOLE_QUIET_MS - Date.now())))
  }
}

export type FinishOptions = {
  timeoutMs?: number
  /** Wait for the bookend before reading the console (default: only when the verdict is passed). */
  awaitBookend?: boolean
}

/** Wait for a terminal verdict (any), then read console, canvas paint and session variables. */
export async function finishCell(page: Page, cell: NestCell, opts: FinishOptions = {}): Promise<CellRun> {
  const apiRun = apiRuns.get(cell)
  if (apiRun) {
    apiRuns.delete(cell)
    return attachRun(cell, await finishApiCell(page, cell, apiRun, opts))
  }
  const status = page.locator('[data-testid="workflow-status"]')
  await pollRunStatus(
    status,
    (value) => TERMINAL.test(value ?? ''),
    opts.timeoutMs ?? RUN_TIMEOUT_MS,
    `${cell.cellId}: the run reaches a terminal state`,
  )
  await expect(status, `${cell.cellId}: the run reaches a terminal state`).toHaveAttribute(
    'data-status',
    TERMINAL,
    { timeout: opts.timeoutMs ?? RUN_TIMEOUT_MS },
  )
  const verdict = await status.getAttribute('data-status')
  const awaitBookend = opts.awaitBookend ?? verdict === 'passed'
  await settleConsole(page, awaitBookend ? cellText(cell, cell.graph.bookendId) : null)

  const rows = await getLogRows(page)
  const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
  const statuses = await getNodeStatuses(page)
  const variables = await getSessionVariables(page, await getActiveSessionId(page))
  return attachRun(cell, { verdict, rows, entries, statuses, variables })
}

async function finishApiCell(page: Page, cell: NestCell, apiRun: ApiRun, opts: FinishOptions): Promise<CellRun> {
  const result = await finishApiRun(cell.cellId, apiRun, {
    timeoutMs: opts.timeoutMs ?? RUN_TIMEOUT_MS,
    bookend: cellText(cell, cell.graph.bookendId),
    awaitBookend: opts.awaitBookend,
    nodeIds: cell.graph.testNodeIds,
  })
  const variables = await getSessionVariables(page, apiRun.sessionId)
  return { ...result, variables }
}

async function attachRun(cell: NestCell, run: CellRun): Promise<CellRun> {
  const paint = Object.fromEntries(
    cell.graph.testNodeIds.map((id) => [id, nodePaint(run, id) ?? null]),
  )
  await test.info().attach(`${cell.cellId}-run.json`, {
    body: JSON.stringify(
      {
        surface: cell.surface,
        verdict: run.verdict,
        paint,
        variables: run.variables,
        console: run.entries.map((e) => `${e.level} [${e.source}] ${e.message}`),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  return run
}

/** Click Run and finish the cell. */
export async function runCell(page: Page, cell: NestCell, opts: FinishOptions = {}): Promise<CellRun> {
  await startCellRun(page, cell)
  return finishCell(page, cell, opts)
}

function consoleDump(run: CellRun): string {
  return run.rows.map((row) => `${row.level} ${row.message}`).join('\n')
}

/** Row indexes of a marker's non-DEBUG console lines. */
export function markerPositions(cell: NestCell, run: CellRun, id: string): number[] {
  const text = cellText(cell, id)
  const positions: number[] = []
  run.rows.forEach((row, index) => {
    if (row.level !== 'DEBUG' && row.message === text) positions.push(index)
  })
  return positions
}

export function expectVerdict(cell: NestCell, run: CellRun, verdict: string): void {
  expect.soft(run.verdict, `${cell.cellId}: run verdict is ${verdict}\n${consoleDump(run)}`).toBe(verdict)
}

export function expectMarkerCount(cell: NestCell, run: CellRun, id: string, count: number, criterion: string): void {
  expect
    .soft(markerPositions(cell, run, id).length, `${cell.cellId}: ${criterion} (expected ${id} to run ${count} time(s))`)
    .toBe(count)
}

/** Every line of `earlier` precedes the first line of `later` (both must be present to prove the order). */
export function expectRanBefore(cell: NestCell, run: CellRun, earlier: string, later: string, criterion: string): void {
  const before = markerPositions(cell, run, earlier)
  const after = markerPositions(cell, run, later)
  const ordered = before.length > 0 && after.length > 0 && Math.max(...before) < Math.min(...after)
  expect
    .soft(
      { ordered, [earlier]: before, [later]: after },
      `${cell.cellId}: ${criterion} (${earlier} before ${later})`,
    )
    .toEqual({ ordered: true, [earlier]: before, [later]: after })
}

export function expectNoNodeRunning(cell: NestCell, run: CellRun): void {
  const running = run.statuses.filter((s) => s.status === 'running').map((s) => s.testId)
  expect.soft(running, `${cell.cellId}: no node is left running`).toEqual([])
}

/** True when an ERROR line names one of the trigger Blocks by source or by quoted name. */
function namesTrigger(entry: LogEntry, triggers: readonly string[]): boolean {
  const source = entry.source.split(' : ').pop() ?? entry.source
  return triggers.some((id) => source === id || entry.message.includes(`'${id}'`))
}

/** No ERROR or FATAL line, except the lines that name a Block the graph marks as a trigger. */
export function expectNoErrorLines(cell: NestCell, run: CellRun, triggers: readonly string[] = cell.graph.triggers): void {
  const errors = run.entries
    .filter((e) => (e.level === 'ERROR' || e.level === 'FATAL') && !namesTrigger(e, triggers))
    .map((e) => `${e.level} [${e.source}] ${e.message}`)
  expect.soft(errors, `${cell.cellId}: no console ERROR line (triggers excluded: ${triggers.join(', ') || 'none'})`).toEqual([])
}

/** The ERROR lines the trigger exclusion removed, for the ledger. */
export function triggerErrorLines(cell: NestCell, run: CellRun): string[] {
  return run.entries
    .filter((e) => (e.level === 'ERROR' || e.level === 'FATAL') && namesTrigger(e, cell.graph.triggers))
    .map((e) => `${e.level} [${e.source}] ${e.message}`)
}

export function expectVariable(cell: NestCell, run: CellRun, name: string, value: unknown, criterion: string): void {
  expect.soft(run.variables[name]?.value, `${cell.cellId}: ${criterion} (${name} after the run)`).toEqual(value)
}

/** The canvas paint of a node on the root canvas after the run (`data-execution-status`). */
export function nodePaint(run: CellRun, nodeId: string): string | null | undefined {
  return run.statuses.find((s) => s.testId === `workflow-node-${nodeId}`)?.status
}

export function expectNodePaint(cell: NestCell, run: CellRun, nodeId: string, status: string | null, criterion: string): void {
  expect.soft(nodePaint(run, nodeId), `${cell.cellId}: ${criterion} (expected ${nodeId} to paint ${status})`).toBe(status)
}
