/**
 * V-NESTING-SKIPPED-LANE-PAINT-FUNCTIONAL: every lane a container did not run paints skipped
 * Wireframe: N/A (no visual surface)
 * Design Decisions: none
 * REQ: REQ-3.5.1.1, REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17, REQ-3.5.1.20, REQ-3.5.4.3, REQ-3.1.3.25, REQ-4.3.2
 *
 * Seeds (API, nesting graph builder): per cell one Test and, where it calls one, one library Function.
 * Matrix U: the Test chains one container per sub-flow slot - For, For Each and While bodies, the Wait
 * Until retry lane, a Parallel lane, the Try/Catch try / catch / finally paths, a Switch case and
 * default, a Remote Execution body (SSH Session Open added at the head) - then a Function call; each
 * slot and the Function body hold an If/Else (cell U.if-else) or a split Assert (cell U.assert-split)
 * whose taken branch logs `b-<slot>`, whose untaken branch holds a generated marker, and whose branches
 * rejoin on `r-<slot>`.
 * Matrix Z: a For with count 0, a For Each over a null variable, over an empty list and over an empty
 * table, a While false at its first check and a Wait Until met at its first check (Retry), each with a
 * two-Log lane; on the Test flow (Z.test-flow), in a Try/Catch try path (Z.in-container) and in a
 * Function body (Z.function-body).
 * Matrix C: a failing Log, a Break, a Continue (both in a For body) or a Halt (ending a try path) cuts
 * a lane short ahead of a For with a body and a Log; on the Test flow, in a Try/Catch try path and in
 * a Function body (C.<failure|break|continue|halt>.<placement>).
 * Every cell runs on the canvas, then once more as a tracked execution reopened from history.
 *
 * Pass Criteria:
 * 1. The graph imports with zero validation errors and the run passes; no Block of a lane that did not
 *    run prints anything.
 * 2. Matrix U: the untaken branch marker paints skipped, the taken branch and the rejoin success.
 * 3. Matrix Z: every Block of the lane that ran zero times paints skipped (the While and Wait Until
 *    counters included); the loop or wait itself paints success.
 * 4. Matrix C: the For after the cut, its body and the Log after it paint skipped and print nothing;
 *    the run passes, or fails for a failure no Try/Catch catches.
 * 5. The same paint during the run, in the session's stored states, after a page reload and on the
 *    history canvas of a tracked run (with its stored states); a Function body is read on the drilled
 *    canvas each time.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { openTest } from '../../helpers/fn-seed'
import { clearSettledWorkbenchSession, getNodeStatuses, openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import {
  breakBlock,
  container,
  continueBlock,
  failBlock,
  halt,
  marker,
  setter,
  type ContainerKind,
  type NestStep,
  type SlotKind,
  type VarFlow,
} from '../../helpers/nesting-graph'
import { expectMarkerCount, expectVerdict, runCell, type CellRun, type NestCell } from './nesting-harness'
import { deleteSignalCellEntities, openSignalCell } from './signal-cell-open'

const CELL_TIMEOUT_MS = 300_000
const RUN_TIMEOUT_MS = 180_000
const PAINT_TIMEOUT_MS = 30_000

type Paint = 'success' | 'skipped'
type Expected = Record<string, Paint>
const STORED: Readonly<Record<Paint, string>> = { success: 'passed', skipped: 'skipped' }

/** The canvas paint of `ids` once every one carries a status (or the timeout passes). */
async function readPaint(page: Page, ids: readonly string[]): Promise<Record<string, string | null>> {
  let paint: Record<string, string | null> = {}
  await expect
    .poll(
      async () => {
        const statuses = await getNodeStatuses(page)
        paint = Object.fromEntries(ids.map((id) => [id, statuses.find((s) => s.testId === `workflow-node-${id}`)?.status ?? null]))
        return ids.every((id) => paint[id] !== null)
      },
      { timeout: PAINT_TIMEOUT_MS },
    )
    .toBe(true)
    .catch(() => undefined)
  return paint
}

async function drillInto(page: Page, cell: NestCell, functionNode: string, shows: string): Promise<void> {
  // The Function can sit low on a tall canvas; a dispatched click needs no scroll into view.
  await page.locator(`[data-testid="workflow-node-${functionNode}"] [data-testid="node-dig-in"]`).dispatchEvent('click')
  await expect(
    page.locator(`[data-testid="workflow-node-${shows}"]`),
    `${cell.cellId}: the drilled Function body shows its blocks`,
  ).toBeVisible({ timeout: PAINT_TIMEOUT_MS })
}

function expectPaint(cell: NestCell, when: string, paint: Record<string, string | null>, expected: Expected): void {
  const got = Object.fromEntries(Object.keys(expected).map((id) => [id, paint[id] ?? null]))
  expect.soft(got, `${cell.cellId}: paint ${when}`).toEqual(expected)
}

function expectStored(cell: NestCell, when: string, stored: Record<string, string>, expected: Expected): void {
  const got = Object.fromEntries(Object.keys(expected).map((id) => [id, stored[id] ?? null]))
  const want = Object.fromEntries(Object.entries(expected).map(([id, paint]) => [id, STORED[paint]]))
  expect.soft(got, `${cell.cellId}: stored states ${when}`).toEqual(want)
}

async function sessionStates(page: Page): Promise<Record<string, string>> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = (await response.json().catch(() => null)) as { data?: { block_states?: Record<string, string> } } | null
  return body?.data?.block_states ?? {}
}

async function historyStates(page: Page, executionId: string): Promise<Record<string, string>> {
  const response = await page.request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(response.ok(), `GET /executions/history/${executionId}: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { data?: { block_states?: Record<string, string> } }
  return body.data?.block_states ?? {}
}

/** Where the expected paint lives: the Test canvas, and the body of one Function call. */
type Places = { root: Expected; fn?: { node: string; expected: Expected } }

async function readPlaces(page: Page, cell: NestCell, when: string, places: Places): Promise<void> {
  expectPaint(cell, when, await readPaint(page, Object.keys(places.root)), places.root)
  if (!places.fn) return
  const ids = Object.keys(places.fn.expected)
  await drillInto(page, cell, places.fn.node, ids[0])
  expectPaint(cell, `${when} (drilled)`, await readPaint(page, ids), places.fn.expected)
}

/** Run on the canvas, then read the paint live, stored, after a reload and on a tracked run's history canvas. */
async function runAndReadEverywhere(
  page: Page,
  cell: NestCell,
  places: Places,
  verdict: 'passed' | 'failed' = 'passed',
): Promise<CellRun> {
  const all: Expected = { ...places.root, ...(places.fn?.expected ?? {}) }
  await test.step(`${cell.cellId}: open the Test on the canvas`, () => openTest(page, cell.testId))
  const run = await runCell(page, cell, { timeoutMs: RUN_TIMEOUT_MS })
  expectVerdict(cell, run, verdict)

  await test.step('during the run', () => readPlaces(page, cell, 'during the run', places))
  await test.step('the session stores the same', async () => expectStored(cell, 'in the session', await sessionStates(page), all))
  await test.step('after a reload', async () => {
    if (places.fn) {
      await page.locator('[data-testid="canvas-breadcrumb"] a').first().click()
      await expect(page.locator(`[data-testid="workflow-node-${places.fn.node}"]`)).toBeVisible({ timeout: PAINT_TIMEOUT_MS })
    }
    await page.reload()
    await waitForCanvasLoad(page)
    await readPlaces(page, cell, 'after a reload', places)
  })
  await test.step('on the history canvas of a tracked run', async () => {
    await clearSettledWorkbenchSession(page.request)
    const tracked = await runTrackedTest(page.request, cell.testId, RUN_TIMEOUT_MS)
    expect(tracked.verdict, `${cell.cellId}: the tracked run ends ${verdict}`).toBe(verdict)
    expectStored(cell, 'in the tracked run', await historyStates(page, tracked.executionId), all)
    await openRunHistory(page, tracked.executionId)
    await readPlaces(page, cell, 'on the history canvas', places)
  })
  return run
}

// ---------------------------------------------------------------------------
// Matrix U: the untaken branch of an If/Else or split Assert in a sub-flow
// ---------------------------------------------------------------------------

type Inner = Extract<ContainerKind, 'if-else' | 'assert-split'>
type Outer = { key: string; kind: ContainerKind; slot: SlotKind }

const U_FUNCTION_KEY = 'fn'

const OUTERS: readonly Outer[] = [
  { key: 'for', kind: 'for', slot: 'for-body' },
  { key: 'foreach', kind: 'for-each', slot: 'for-each-body' },
  { key: 'while', kind: 'while', slot: 'while-body' },
  { key: 'wait', kind: 'wait-until', slot: 'wait-until-body' },
  { key: 'lane', kind: 'parallel', slot: 'parallel-lane' },
  { key: 'try', kind: 'try-catch', slot: 'try' },
  { key: 'catch', kind: 'try-catch', slot: 'catch' },
  { key: 'finally', kind: 'try-catch', slot: 'finally' },
  { key: 'case', kind: 'switch-case', slot: 'case' },
  { key: 'default', kind: 'switch-case', slot: 'default' },
  { key: 'remote', kind: 'remote-exec', slot: 'remote-body' },
]

const INNERS: readonly Inner[] = ['if-else', 'assert-split']

/** The If/Else or split Assert of one slot, its taken branch logging `b-<key>`, rejoining on `r-<key>`. */
function branchingSubFlow(inner: Inner, key: string): NestStep[] {
  return [container(inner, `i-${key}`, [marker(`b-${key}`)]), marker(`r-${key}`)]
}

function uChain(inner: Inner): NestStep[] {
  return [
    ...OUTERS.map((outer) => container(outer.kind, `o-${outer.key}`, branchingSubFlow(inner, outer.key), { slot: outer.slot })),
    container('function', `o-${U_FUNCTION_KEY}`, branchingSubFlow(inner, U_FUNCTION_KEY)),
  ]
}

/** Taken and rejoin markers paint success, the untaken branch marker skipped. */
function branchPaint(cell: NestCell, key: string): Expected {
  const untaken = cell.graph.containers[`i-${key}`]?.untaken ?? []
  expect(untaken, `${cell.cellId}: the ${key} slot has one untaken branch marker`).toHaveLength(1)
  return { [`b-${key}`]: 'success', [untaken[0]]: 'skipped', [`r-${key}`]: 'success' }
}

test.describe('Matrix U: the untaken branch of an If/Else or split Assert in a sub-flow paints skipped', () => {
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))

  for (const inner of INNERS) {
    const cellId = `U.${inner}`
    test(`${cellId}: in every sub-flow slot and a Function body, live, stored, after a reload and in history`, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      const opened = await openSignalCell(page, cellId, { chain: uChain(inner) }, { requireValid: true })
      if (!opened.cell) return
      const cell: NestCell = { ...opened.cell, surface: 'canvas' }
      const root = Object.assign({}, ...OUTERS.map((outer) => branchPaint(cell, outer.key))) as Expected
      const fn = branchPaint(cell, U_FUNCTION_KEY)
      const run = await runAndReadEverywhere(page, cell, { root, fn: { node: `o-${U_FUNCTION_KEY}`, expected: fn } })
      for (const [id, paint] of Object.entries({ ...root, ...fn })) {
        if (paint === 'skipped') expectMarkerCount(cell, run, id, 0, 'an untaken branch prints nothing')
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Matrix Z: a lane a loop or a wait ran zero times
// ---------------------------------------------------------------------------

const NULL_LIST = 'z_null'
const EMPTY_TABLE = 'z_table'
const NO_ROWS = { columns: [{ name: 'host', type: 'string' }], rows: [] }

// Inside a Function the table comes in as an input, bound from the Test variable of the same name.
type ZeroKind = { key: string; build: (id: string, lane: NestStep[], flow: VarFlow) => NestStep[] }

const ZERO_KINDS: readonly ZeroKind[] = [
  { key: 'for-count-0', build: (id, lane) => [container('for', id, lane, { options: { iterations: 0 } })] },
  {
    key: 'for-each-null',
    build: (id, lane) => [
      setter(`${id}-seed`, { [NULL_LIST]: { value: 'None', expression: true, type: 'array', seed: null } }),
      container('for-each', id, lane, { options: { collection: NULL_LIST } }),
    ],
  },
  { key: 'for-each-empty-list', build: (id, lane) => [container('for-each', id, lane, { options: { collection: '[]' } })] },
  {
    key: 'for-each-empty-table',
    build: (id, lane, flow) => [
      { ...marker(`${id}-seed`), vars: [{ name: EMPTY_TABLE, type: 'table', seed: NO_ROWS, flow }] },
      container('for-each', id, lane, { options: { collection: EMPTY_TABLE } }),
    ],
  },
  { key: 'while-false', build: (id, lane) => [container('while', id, lane, { options: { iterations: 0 } })] },
  { key: 'wait-met', build: (id, lane) => [container('wait-until', id, lane, { options: { iterations: 0 } })] },
]

type Placement = 'test-flow' | 'in-container' | 'function-body'
const PLACEMENTS: readonly Placement[] = ['test-flow', 'in-container', 'function-body']
const Z_FUNCTION = 'z-fn'

function zSteps(flow: VarFlow): NestStep[] {
  return ZERO_KINDS.flatMap((kind) =>
    kind.build(`z-${kind.key}`, [marker(`z-${kind.key}-body`), marker(`z-${kind.key}-tail`)], flow),
  )
}

function zChain(placement: Placement): NestStep[] {
  if (placement === 'test-flow') return zSteps('local')
  if (placement === 'in-container') return [container('try-catch', 'z-try', zSteps('local'))]
  return [container('function', Z_FUNCTION, zSteps('import'))]
}

/** Every Block of each zero-run lane paints skipped (a generated While / Wait Until counter too); the loop success. */
function zeroRunPaint(cell: NestCell): Expected {
  const expected: Expected = {}
  for (const kind of ZERO_KINDS) {
    const id = `z-${kind.key}`
    expected[id] = 'success'
    expected[`${id}-body`] = 'skipped'
    expected[`${id}-tail`] = 'skipped'
    const counter = cell.graph.containers[id]?.counter
    if (counter) expected[counter] = 'skipped'
  }
  return expected
}

test.describe('Matrix Z: a lane a loop or a wait ran zero times paints skipped', () => {
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))

  for (const placement of PLACEMENTS) {
    const cellId = `Z.${placement}`
    test(`${cellId}: For count 0, For Each over null / [] / an empty table, While false, Wait Until met at once`, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      const opened = await openSignalCell(page, cellId, { chain: zChain(placement) }, { requireValid: true })
      if (!opened.cell) return
      const cell: NestCell = { ...opened.cell, surface: 'canvas' }
      const expected = zeroRunPaint(cell)
      const places: Places =
        placement === 'function-body' ? { root: { [Z_FUNCTION]: 'success' }, fn: { node: Z_FUNCTION, expected } } : { root: expected }
      const run = await runAndReadEverywhere(page, cell, places)
      for (const [id, paint] of Object.entries(expected)) {
        if (paint === 'skipped' && id.endsWith('-body')) expectMarkerCount(cell, run, id, 0, 'a lane that ran zero times prints nothing')
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Matrix C: the rest of a lane a failure, a Break, a Continue or a Halt cut off
// ---------------------------------------------------------------------------

type CutKind = 'failure' | 'break' | 'continue' | 'halt'
const CUT_KINDS: readonly CutKind[] = ['failure', 'break', 'continue', 'halt']
const C_FUNCTION = 'c-fn'

/** What the cut leaves: a For with a body, then a Log. */
function cutTail(): NestStep[] {
  return [container('for', 'c-loop', [marker('c-body')], { options: { iterations: 1 } }), marker('c-after')]
}

const TAIL_PAINT: Expected = { 'c-loop': 'skipped', 'c-body': 'skipped', 'c-after': 'skipped' }

/** The cut and its tail; a Break or Continue sits in a For body, a Halt ends a try path ahead of the tail. */
function cutLane(kind: CutKind, placement: Placement): NestStep[] {
  if (kind === 'failure') return [failBlock('cut'), ...cutTail()]
  if (kind === 'halt') {
    const scope = placement === 'function-body' ? 'function' : 'test'
    return [container('try-catch', 'c-try', [halt('cut', { scope, status: 'passed' })]), ...cutTail()]
  }
  const signal = kind === 'break' ? breakBlock('cut', 'c-outer') : continueBlock('cut', 'c-outer')
  return [container('for', 'c-outer', [signal, ...cutTail()], { options: { iterations: 1 } })]
}

function cutChain(kind: CutKind, placement: Placement): NestStep[] {
  const lane = cutLane(kind, placement)
  if (placement === 'test-flow') return lane
  if (placement === 'in-container') return [container('try-catch', 'c-wrap', lane)]
  return [container('function', C_FUNCTION, lane)]
}

/** A failure fails the run unless a Try/Catch around it catches it. */
function cutVerdict(kind: CutKind, placement: Placement): 'passed' | 'failed' {
  return kind === 'failure' && placement !== 'in-container' ? 'failed' : 'passed'
}

test.describe('Matrix C: the rest of a lane a failure, Break, Continue or Halt cut off paints skipped', () => {
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))

  for (const kind of CUT_KINDS) {
    for (const placement of PLACEMENTS) {
      const cellId = `C.${kind}.${placement}`
      test(`${cellId}: the For after the cut, its body and the Log after it paint skipped`, async ({ page }) => {
        test.setTimeout(CELL_TIMEOUT_MS)
        const opened = await openSignalCell(page, cellId, { chain: cutChain(kind, placement) }, { requireValid: true })
        if (!opened.cell) return
        const cell: NestCell = { ...opened.cell, surface: 'canvas' }
        const places: Places =
          placement === 'function-body'
            ? { root: {}, fn: { node: C_FUNCTION, expected: TAIL_PAINT } }
            : { root: TAIL_PAINT }
        const run = await runAndReadEverywhere(page, cell, places, cutVerdict(kind, placement))
        for (const id of ['c-body', 'c-after']) expectMarkerCount(cell, run, id, 0, 'the cut-off tail prints nothing')
      })
    }
  }
})
