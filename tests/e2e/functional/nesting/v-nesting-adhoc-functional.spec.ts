/**
 * V-NESTING-ADHOC-FUNCTIONAL: Run Current, Run from Here and disabled nodes at depth 2 in every slot kind
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SWITCH-11, WAIT-9, REMEX-5, REMEX-6
 * REQ: REQ-3.2.1.5, REQ-3.5.1.20, REQ-3.2.3.2, REQ-3.5.4.3, REQ-3.4.1.3
 *
 * Every cell's Test runs pre -> a Try/Catch whose try path holds the inner container
 * (inner -> inner-then) -> outer-then -> bookend; the inner container's <slot> holds the cell's Blocks.
 *
 * C.run-current.<slot> (slot holds target -> next): Run Current on target.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; target runs once; nothing else runs; no node is left
 *      running; no console ERROR line
 *   Remote Execution body: Run Current on the SSH Session Open first leaves the Execution Host session open.
 *   Function body (pre-set writes fn_in, then the body holds fn-set -> target -> fn-bump -> next; target prints
 *   fn_note, which fn-set derives from the fn_in input and fn-bump extends): a full run first, then Run Current
 *   on target in the opened Function body.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The ad-hoc run ends passed; target prints the input and local the full run left (fn-bump's suffix
 *      included) once; next does not run again; no node is left running; no console ERROR line
 * C.run-from-here.<slot> (slot holds target -> next): Run from Here on target.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; target and next run once, in that order; pre and every untaken branch
 *      never run; no node is left running; no console ERROR line. Whether the run continues past the
 *      slot is an open design question and is not asserted.
 *   Remote Execution body: Run Current on the SSH Session Open first leaves the Execution Host session open.
 *   Function body (the Run Current shape): a full run first, then Run from Here on target in the opened body.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The ad-hoc run ends passed; target prints the state the full run left once (so fn-set did not run
 *      again), then next runs once more; no Block outside the Function body runs again; no node is left
 *      running; no console ERROR line
 * C.run-scope.function-body.nested (a Function in the inner Function's body holds target -> fn-bump -> next): a
 * full run, then Run Scope opened into the nested Function.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The Run Scope ends passed; target prints the local the full run left once; the nested Function's
 *      result reads fn_note extended once more; next runs once more; nothing outside the nested Function runs
 *      again; no console ERROR line
 * C.<run-current|run-from-here|debug-current|debug-from-here>.function-body.reset (the Run Current shape): a
 * full run, Reset, then that ad-hoc run on target in the opened Function body; after Reset the Required input
 * fn_in has no value.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The ad-hoc run ends failed before target (FNCFG-8): the console carries
 *      `Block '<Function>' failed: 'fn_in' is null` as Run Scope prints it (Run Current's completion
 *      toast names it too), the run carries the advisory that prior-run state is unavailable, target never
 *      prints, and no console ERROR line other than the one naming fn_in
 * C.disabled.block.<slot> (slot holds a disabled marker -> next): a full run.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; the disabled Block never runs; next runs once per slot run; inner-then,
 *      outer-then and the bookend run once; no node is left running; no console ERROR line
 * C.disabled.container.<slot> (a disabled inner container whose slot holds a marker): a full run.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; pre, outer-then and the bookend run once; no node is left running; no
 *      console ERROR line
 *   3. Switch/Case, loops, Wait Until, Parallel, Try/Catch: nothing inside the container runs (no
 *      marker, no trigger ERROR) and inner-then runs once. If/Else, split Assert, Remote Execution
 *      and Function: what the sub-flow does is an open design question and is not asserted.
 * C.run-current.remote-body.container (the body holds a For Loop (a WAVE host probe, a host probe, two worker
 * pid probes) -> next): Run Current on the SSH Session Open, then Run Current on the For Loop.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; the host probe reads the Execution Host name, not the WAVE host name; both
 *      worker pid probes read one worker; nothing outside the For Loop runs; no node is left running;
 *      no console ERROR line
 * C.run-from-here.remote-body.block (the body holds a worker pid probe (the start) -> a WAVE host probe ->
 * a host probe -> a worker pid probe -> next): Run Current on the SSH Session Open, then Run from Here on the start.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; the host probe reads the Execution Host name, not the WAVE host name; both
 *      worker pid probes read one worker; next runs once; pre never runs; no node is left running; no
 *      console ERROR line
 * C.run-current.remote-body.closed-session (the body holds a host probe -> next): Run Current on the host
 * probe, a Block that runs on the remote host, with no Execution Host session open.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends failed; the only console ERROR line names the probe and the closed session; the
 *      probe never writes its variable and paints failed; next never runs; no node is left running
 * C.run-current.remote-body.closed-session.wave-block (the body holds a WAVE host probe -> next): Run Current
 * on the WAVE host probe, a Block that runs on WAVE, with no Execution Host session open.
 *   1. The graph imports with zero validation errors and run-context validation reports none
 *   2. The run ends passed; the probe prints a host name other than the Execution Host name and paints
 *      success; next never runs; no node is left running; no console ERROR line
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { getActiveSessionId } from '../../helpers/fixture-import'
import { markerNode } from '../../helpers/k8s-nodes'
import { escapeRegExp, getLogRows } from '../../helpers/log-reader'
import {
  SLOT_KINDS,
  TOKEN_PLACEHOLDER,
  container,
  disable,
  hostProbe,
  leaf,
  marker,
  markerText,
  named,
  setter,
  type NestStep,
  type SlotKind,
} from '../../helpers/nesting-graph'
import { clickNodeContextMenuItem, digIn, selectEnvironment } from '../../helpers/workbench'
import { adHocRunToEnd, openExecutionHostSession, startCellAdHoc, type AdHocItem } from './debug-adhoc-drive'
import { runAdHoc } from './functions-remote-probes'
import {
  EXECUTION_HOST_NAME,
  WAVE_HOST_VARIABLE,
  expectReadOnExecutionHost,
  expectSameWorker,
  probeText,
  waveHostProbe,
  workerPidProbe,
} from './execution-host-probes'
import {
  cellText,
  deleteCellEntities,
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVariable,
  expectVerdict,
  finishCell,
  openCell,
  runCell,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import {
  INNER,
  INNER_THEN,
  OUTER,
  OUTER_THEN,
  PRE,
  SLOT_TITLE,
  slotDepthChain,
  slotRuns,
} from './slot-depth-graph'

const CELL_TIMEOUT_MS = 240_000
const TARGET = 'target'
const NEXT = 'next'
const DISABLED = 'disabled-block'
const DISABLED_BODY = 'disabled-body'
const LOOP = 'loop'
const WAVE_HOST = 'wave-host'
const START = 'pid-start'
const TARGET_HOST = 'target-host'
const EXECUTION_HOST_SESSION_VAR = 'nest_sid'
const PRE_SET = 'pre-set'
const FN_SET = 'fn-set'
const FN_BUMP = 'fn-bump'
const DEEP = 'deep'
const DEEP_THEN = 'deep-then'
const FN_IN = 'fn_in'
const FN_NOTE = 'fn_note'
const NOTE_SEED = 'note-seed'
const IN_RUN_NOTE = 'in-run-note'
const ADVISORY_TYPE = 'SCOPED_RUN_ADVISORY'
const CLOSED_SESSION_LINE =
  `Block '${TARGET_HOST}' failed: This block runs on a remote host, but its SSH session '${EXECUTION_HOST_SESSION_VAR}' ` +
  'is closed or not connected. Open it first (Run Current on the SSH Session Open block), then run this block.'

/** Disabled container kinds whose run the design leaves open: If/Else, split Assert, Remote Execution and Function. */
const OPEN_DISABLED_SLOTS: readonly SlotKind[] = [
  'if-branch',
  'else-branch',
  'assert-pass',
  'assert-fail',
  'remote-body',
  'function-body',
]

function note(cellId: string, description: string): void {
  test.info().annotations.push({ type: 'unsettled', description: `${cellId}: ${description}` })
}

async function openTargetCell(page: Page, cellId: string, slot: SlotKind) {
  return openCell(page, cellId, { chain: slotDepthChain(slot, [marker(TARGET), marker(NEXT)], { iterations: 1 }) })
}

/** target: a Log printing its marker text, a colon and fn_note. */
function noteProbe(): NestStep {
  const text = markerText(TARGET, TOKEN_PLACEHOLDER)
  return leaf(markerNode({ id: TARGET, description: TARGET, expression: `'${text}:' + ${FN_NOTE}` }), {
    vars: [{ name: FN_NOTE, type: 'string', seed: NOTE_SEED }],
  })
}

function bumpNote(): NestStep {
  return setter(FN_BUMP, { [FN_NOTE]: { value: `${FN_NOTE} + '+'`, expression: true, type: 'string', seed: NOTE_SEED } })
}

/** pre-set (fn_in = 'in-run') -> the depth-2 chain whose Function body holds fn-set -> target -> fn-bump -> next. */
function functionBodyChain(): NestStep[] {
  const preSet = setter(PRE_SET, { [FN_IN]: { value: "'in-run'", expression: true, type: 'string', seed: 'in-seed' } })
  const fnSet = setter(FN_SET, { [FN_NOTE]: { value: `${FN_IN} + '-note'`, expression: true, type: 'string', seed: NOTE_SEED } })
  const readsInput = { ...fnSet, vars: [...fnSet.vars, { name: FN_IN, type: 'string' as const, seed: 'in-seed', flow: 'import' as const }] }
  return [preSet, ...slotDepthChain('function-body', [readsInput, noteProbe(), bumpNote(), marker(NEXT)])]
}

/** The line target prints when fn_note holds `note`. */
function noteLine(cell: NestCell, note: string): string {
  return `${cellText(cell, TARGET)}:${note}`
}

function expectLineCount(cell: NestCell, run: CellRun, text: string, count: number, criterion: string): void {
  const seen = run.rows.filter((row) => row.level !== 'DEBUG' && row.message === text).length
  expect.soft(seen, `${cell.cellId}: ${criterion} (expected "${text}" ${count} time(s))`).toBe(count)
}

async function waitForLine(page: Page, cell: NestCell, text: string): Promise<void> {
  await expect
    .poll(async () => (await getLogRows(page)).some((row) => row.message === text), {
      timeout: 30_000,
      message: `${cell.cellId}: the console shows "${text}"`,
    })
    .toBe(true)
}

async function openInnerBody(page: Page, cell: NestCell, functionId: string, shows: string): Promise<void> {
  await digIn(page, functionId)
  await expect(
    page.locator(`[data-testid="workflow-node-${shows}"]`),
    `${cell.cellId}: the opened ${functionId} body shows ${shows}`,
  ).toBeVisible({ timeout: 15_000 })
}

/** A full run of the Function body chain, checked, before the ad-hoc run under test. */
async function fullRunThenOpenBody(page: Page, cellId: string): Promise<NestCell> {
  const cell = await openCell(page, cellId, { chain: functionBodyChain() })
  const full = await runCell(page, cell)
  expectVerdict(cell, full, 'passed')
  expectLineCount(cell, full, noteLine(cell, IN_RUN_NOTE), 1, 'the full run prints the note fn-set derives from the input')
  await openInnerBody(page, cell, INNER, TARGET)
  return cell
}

async function runCurrentInFunctionBodyCell(page: Page, cellId: string): Promise<void> {
  const cell = await fullRunThenOpenBody(page, cellId)
  expect(await adHocRunToEnd(page, cell, TARGET, 'Run Current'), `${cellId}: Run Current in the Function body passes`).toBe('passed')
  await waitForLine(page, cell, noteLine(cell, `${IN_RUN_NOTE}+`))
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectVerdict(cell, run, 'passed')
  expectLineCount(cell, run, noteLine(cell, `${IN_RUN_NOTE}+`), 1, 'Run Current reads the input and the local the full run left')
  expectLineCount(cell, run, noteLine(cell, IN_RUN_NOTE), 1, 'only the full run printed the note before fn-bump')
  expectMarkerCount(cell, run, NEXT, 1, 'Run Current runs the Block itself only')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function runFromHereInFunctionBodyCell(page: Page, cellId: string): Promise<void> {
  const cell = await fullRunThenOpenBody(page, cellId)
  expect(await adHocRunToEnd(page, cell, TARGET, 'Run from Here'), `${cellId}: Run from Here in the Function body passes`).toBe('passed')
  await waitForLine(page, cell, noteLine(cell, `${IN_RUN_NOTE}+`))
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectVerdict(cell, run, 'passed')
  expectLineCount(cell, run, noteLine(cell, `${IN_RUN_NOTE}+`), 1, 'Run from Here starts from the state the full run left')
  expectLineCount(cell, run, noteLine(cell, IN_RUN_NOTE), 1, 'fn-set, upstream of the start, does not run again')
  expectMarkerCount(cell, run, NEXT, 2, 'Run from Here runs the rest of the Function body')
  for (const id of [PRE, INNER_THEN, OUTER_THEN, cell.graph.bookendId]) {
    expectMarkerCount(cell, run, id, 1, 'Run from Here stays inside the Function body')
  }
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function runScopeNestedFunctionCell(page: Page): Promise<void> {
  const cellId = 'C.run-scope.function-body.nested'
  const deep = container('function', DEEP, [noteProbe(), bumpNote(), marker(NEXT)])
  const cell = await openCell(page, cellId, { chain: slotDepthChain('function-body', [deep, marker(DEEP_THEN)]) })
  const full = await runCell(page, cell)
  expectVerdict(cell, full, 'passed')

  await openInnerBody(page, cell, INNER, DEEP)
  await openInnerBody(page, cell, DEEP, TARGET)
  await selectEnvironment(page)
  const scoped = await runAdHoc(page, cell, 'Run Scope opened into the nested Function', async () => {
    await page.locator('[data-testid="run-button-dropdown"]').click()
    await page.locator('[data-testid="run-current-option"]').click()
  })
  expect.soft(scoped.status, `${cellId}: Run Scope on a Function nested in a Function body passes`).toBe('passed')
  expect
    .soft(scoped.scopedResult?.outputs?.[FN_NOTE], `${cellId}: the nested Function starts from the local its last run left`)
    .toBe(`${NOTE_SEED}++`)
  await waitForLine(page, cell, noteLine(cell, `${NOTE_SEED}+`))
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectLineCount(cell, run, noteLine(cell, `${NOTE_SEED}+`), 1, 'Run Scope reads the local the full run left')
  expectLineCount(cell, run, noteLine(cell, NOTE_SEED), 1, 'only the full run printed the declared default')
  expectMarkerCount(cell, run, NEXT, 2, 'Run Scope runs the nested Function body')
  for (const id of [PRE, DEEP_THEN, INNER_THEN, OUTER_THEN, cell.graph.bookendId]) {
    expectMarkerCount(cell, run, id, 1, 'Run Scope runs only the nested Function')
  }
  expectNoErrorLines(cell, run, [])
}

/** The ad-hoc runs a Block inside a Function body offers, by the cell id part each names. */
const BODY_ADHOC_RUNS = [
  { item: 'Run Current', id: 'run-current' },
  { item: 'Run from Here', id: 'run-from-here' },
  { item: 'Debug Current', id: 'debug-current' },
  { item: 'Debug from Here', id: 'debug-from-here' },
] as const

type BodyAdHocItem = (typeof BODY_ADHOC_RUNS)[number]['item']

async function resetThenAdHocCell(page: Page, item: BodyAdHocItem, cellId: string): Promise<void> {
  const cell = await openCell(page, cellId, { chain: functionBodyChain() })
  expectVerdict(cell, await runCell(page, cell), 'passed')
  await page.locator('[data-testid="breadcrumb-reset-link"]').click()
  await expect(page.locator('[data-testid="workflow-status"]'), `${cellId}: Reset returns the page to idle`).toHaveAttribute(
    'data-status',
    'idle',
    { timeout: 15_000 },
  )

  await openInnerBody(page, cell, INNER, TARGET)
  await selectEnvironment(page)
  const nullInput = `'${FN_IN}' is null`
  const adHoc = await runAdHoc(page, cell, `${item} after Reset`, () => clickNodeContextMenuItem(page, TARGET, item))
  // Per FNCFG-8: after Reset the Required input fn_in has no value, so the run stops before target and names it.
  expect.soft(adHoc.status, `${cellId}: ${item} after Reset with no value on ${FN_IN} fails`).toBe('failed')
  if (item === 'Run Current') {
    await expect
      .soft(page.locator('[data-toast]', { hasText: `failed: ${nullInput}` }).first(), `${cellId}: the run names the input`)
      .toBeVisible({ timeout: 10_000 })
  }
  // The console names the Function Block and the input, as Run Scope does.
  const refusal = new RegExp(`^Block '.+' failed: ${escapeRegExp(nullInput)}$`)
  let named = false
  for (const deadline = Date.now() + 15_000; !named && Date.now() < deadline; ) {
    named = (await getLogRows(page)).some((row) => row.level === 'ERROR' && refusal.test(row.message))
    if (!named) await page.waitForTimeout(500)
  }
  expect.soft(named, `${cellId}: the console carries "Block '<Function>' failed: ${nullInput}"`).toBe(true)
  const status = await page.request.get(`${BACKEND_URL}/workbench/${adHoc.sessionId}/status`)
  const warnings = ((await status.json()) as { data?: { warnings?: Array<{ type?: string }> } }).data?.warnings ?? []
  expect.soft(warnings.map((w) => w.type), `${cellId}: the run carries the advisory that prior-run state is unavailable`).toContain(ADVISORY_TYPE)
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectLineCount(cell, run, noteLine(cell, NOTE_SEED), 0, 'target never runs')
  expectLineCount(cell, run, noteLine(cell, `${IN_RUN_NOTE}+`), 0, 'nothing the full run left carries past Reset')
  expectNoErrorLines(cell, run, [FN_IN])
}

/** Start the ad-hoc run on target; inside a Remote Execution body the Execution Host session is opened first. */
async function startTargetAdHoc(page: Page, cell: NestCell, slot: SlotKind, item: AdHocItem): Promise<void> {
  if (slot !== 'remote-body') {
    await startCellAdHoc(page, cell, TARGET, item)
    return
  }
  await openExecutionHostSession(page, cell)
  await adHocRunToEnd(page, cell, TARGET, item)
}

async function runCurrentCell(page: Page, slot: SlotKind): Promise<void> {
  const cellId = `C.run-current.${slot}`
  if (slot === 'function-body') {
    await runCurrentInFunctionBodyCell(page, cellId)
    return
  }
  const cell = await openTargetCell(page, cellId, slot)
  await startTargetAdHoc(page, cell, slot, 'Run Current')
  const run = await finishCell(page, cell, { awaitBookend: false })
  const inner = cell.graph.containers[INNER]
  const outer = cell.graph.containers[OUTER]

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, TARGET, 1, 'Run Current runs the Block itself')
  for (const id of [PRE, NEXT, INNER_THEN, OUTER_THEN, cell.graph.bookendId]) {
    expectMarkerCount(cell, run, id, 0, 'Run Current runs the node itself only')
  }
  for (const id of [...inner.untaken, ...inner.siblings, ...outer.untaken, ...outer.siblings]) {
    expectMarkerCount(cell, run, id, 0, 'Run Current runs the node itself only')
  }
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function runFromHereCell(page: Page, slot: SlotKind): Promise<void> {
  const cellId = `C.run-from-here.${slot}`
  if (slot === 'function-body') {
    await runFromHereInFunctionBodyCell(page, cellId)
    return
  }
  const cell = await openTargetCell(page, cellId, slot)
  note(cellId, 'Q15 whether Run from Here continues past the end of the slot')
  await startTargetAdHoc(page, cell, slot, 'Run from Here')
  const run = await finishCell(page, cell, { awaitBookend: false })
  const inner = cell.graph.containers[INNER]

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, TARGET, 1, 'Run from Here runs the start node')
  expectMarkerCount(cell, run, NEXT, 1, 'Run from Here runs the downstream Block in the slot')
  expectRanBefore(cell, run, TARGET, NEXT, 'traversal starts at the chosen node')
  expectMarkerCount(cell, run, PRE, 0, 'a node upstream of the start never runs')
  for (const id of inner.untaken) {
    expectMarkerCount(cell, run, id, 0, 'an untaken branch never runs')
  }
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function disabledBlockCell(page: Page, slot: SlotKind): Promise<void> {
  const cellId = `C.disabled.block.${slot}`
  const cell = await openCell(page, cellId, { chain: slotDepthChain(slot, [disable(marker(DISABLED)), marker(NEXT)]) })
  const run = await runCell(page, cell)
  const inner = cell.graph.containers[INNER]
  const outer = cell.graph.containers[OUTER]

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, PRE, 1, 'the Block before the containers runs once')
  expectMarkerCount(cell, run, DISABLED, 0, 'a disabled Block is excluded from execution')
  expectMarkerCount(cell, run, NEXT, slotRuns(slot), 'the Block after the disabled one runs on every slot run')
  for (const id of [...inner.untaken, ...outer.untaken]) {
    expectMarkerCount(cell, run, id, 0, 'an untaken branch never runs')
  }
  for (const id of [...inner.siblings, ...outer.siblings]) {
    expectMarkerCount(cell, run, id, 1, 'a sibling path runs once')
  }
  expectMarkerCount(cell, run, INNER_THEN, 1, 'the inner then successor runs once')
  expectMarkerCount(cell, run, OUTER_THEN, 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, NEXT, INNER_THEN, 'the slot runs before the inner then successor')
  expectRanBefore(cell, run, INNER_THEN, OUTER_THEN, 'the inner then successor runs inside the outer slot')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
}

async function disabledContainerCell(page: Page, slot: SlotKind): Promise<void> {
  const cellId = `C.disabled.container.${slot}`
  const cell = await openCell(page, cellId, {
    chain: slotDepthChain(slot, [marker(DISABLED_BODY)], { disabled: true }),
  })
  const run = await runCell(page, cell)
  const inner = cell.graph.containers[INNER]
  const outer = cell.graph.containers[OUTER]

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, PRE, 1, 'the Block before the containers runs once')
  for (const id of outer.untaken) {
    expectMarkerCount(cell, run, id, 0, 'an untaken outer branch never runs')
  }
  expectMarkerCount(cell, run, OUTER_THEN, 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectNoNodeRunning(cell, run)

  if (OPEN_DISABLED_SLOTS.includes(slot)) {
    note(cellId, `Open: what a disabled ${inner.kind} does with its sub-flow and successor`)
    expectNoErrorLines(cell, run)
    return
  }
  expectMarkerCount(cell, run, DISABLED_BODY, 0, 'the disabled container skips its sub-flow')
  for (const id of [...inner.untaken, ...inner.siblings]) {
    expectMarkerCount(cell, run, id, 0, 'every other slot of the disabled container is skipped')
  }
  expectMarkerCount(cell, run, INNER_THEN, 1, 'the flow resumes at the disabled container then successor')
  expectRanBefore(cell, run, INNER_THEN, OUTER_THEN, 'the inner then successor runs inside the outer slot')
  expectNoErrorLines(cell, run, [])
}

async function runCurrentContainerInBodyCell(page: Page): Promise<void> {
  const cellId = 'C.run-current.remote-body.container'
  const loop = container(
    'for',
    LOOP,
    [
      waveHostProbe(WAVE_HOST),
      hostProbe('loop-host', 'host_loop'),
      workerPidProbe('loop-pid-a', 'pid_loop_a'),
      workerPidProbe('loop-pid-b', 'pid_loop_b'),
    ],
    { options: { iterations: 1 } },
  )
  const cell = await openCell(page, cellId, { chain: slotDepthChain('remote-body', [loop, marker(NEXT)]) })
  await openExecutionHostSession(page, cell)
  await adHocRunToEnd(page, cell, LOOP, 'Run Current')
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectVerdict(cell, run, 'passed')
  expectReadOnExecutionHost(cell, run, 'host_loop', 'a remotable Block in the container runs on the remote host of the body')
  expectSameWorker(cell, run, 'pid_loop_a', 'pid_loop_b', 'one worker on the remote host serves the whole run')
  for (const id of [PRE, NEXT, INNER_THEN, OUTER_THEN, cell.graph.bookendId]) {
    expectMarkerCount(cell, run, id, 0, 'Run Current runs the container itself only')
  }
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function runFromHereBlockInBodyCell(page: Page): Promise<void> {
  const cellId = 'C.run-from-here.remote-body.block'
  const steps = [
    workerPidProbe(START, 'pid_start'),
    waveHostProbe(WAVE_HOST),
    hostProbe('host-after', 'host_after'),
    workerPidProbe('pid-after', 'pid_after'),
    marker(NEXT),
  ]
  const cell = await openCell(page, cellId, { chain: slotDepthChain('remote-body', steps) })
  await openExecutionHostSession(page, cell)
  await adHocRunToEnd(page, cell, START, 'Run from Here')
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectVerdict(cell, run, 'passed')
  expectReadOnExecutionHost(cell, run, 'host_after', 'a remotable Block after the start runs on the remote host of the body')
  expectSameWorker(cell, run, 'pid_start', 'pid_after', 'one worker on the remote host serves the whole run')
  expectMarkerCount(cell, run, NEXT, 1, 'Run from Here runs the body Blocks after the start')
  expectMarkerCount(cell, run, PRE, 0, 'a node upstream of the start never runs')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

async function closedSessionCell(page: Page): Promise<void> {
  const cellId = 'C.run-current.remote-body.closed-session'
  const steps = [named(hostProbe(TARGET_HOST, 'host_target')), marker(NEXT)]
  const cell = await openCell(page, cellId, { chain: slotDepthChain('remote-body', steps) })
  await adHocRunToEnd(page, cell, TARGET_HOST, 'Run Current')
  const run = await finishCell(page, cell, { awaitBookend: false })

  expectVerdict(cell, run, 'failed')
  const errors = run.entries.filter((e) => e.level === 'ERROR' || e.level === 'FATAL').map((e) => e.message)
  expect.soft(errors, `${cellId}: the run fails with the closed session reason`).toEqual([CLOSED_SESSION_LINE])
  expectVariable(cell, run, 'host_target', 'seed', 'a Block that runs on the remote host never runs on WAVE')
  expectNodePaint(cell, run, TARGET_HOST, 'failed', 'the remote-host Block the run started on paints failed')
  expectMarkerCount(cell, run, NEXT, 0, 'Run Current runs nothing else')
  expectNoNodeRunning(cell, run)
}

async function closedSessionWaveBlockCell(page: Page): Promise<void> {
  const cellId = 'C.run-current.remote-body.closed-session.wave-block'
  const cell = await openCell(page, cellId, { chain: slotDepthChain('remote-body', [waveHostProbe(WAVE_HOST), marker(NEXT)]) })
  await adHocRunToEnd(page, cell, WAVE_HOST, 'Run Current')
  const run = await finishCell(page, cell, { awaitBookend: false })
  const waveHost = probeText(run, WAVE_HOST_VARIABLE)

  expectVerdict(cell, run, 'passed')
  expect.soft(waveHost, `${cellId}: a Block that runs on WAVE needs no session (the probe printed a host name)`).not.toBe('')
  expect.soft(waveHost, `${cellId}: a Block that runs on WAVE runs on WAVE (not the Execution Host)`).not.toBe(EXECUTION_HOST_NAME)
  expectNodePaint(cell, run, WAVE_HOST, 'success', 'the WAVE Block the run started on paints success')
  expectMarkerCount(cell, run, NEXT, 0, 'Run Current runs nothing else')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run, [])
}

test.describe('Matrix C: Run Current at depth 2 in every slot kind', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const slot of SLOT_KINDS) {
    test(`C.run-current.${slot}: Run Current on a depth-2 Block in ${SLOT_TITLE[slot]} runs that Block only`, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runCurrentCell(page, slot)
    })
  }
})

test.describe('Matrix C: Run from Here at depth 2 in every slot kind', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const slot of SLOT_KINDS) {
    test(`C.run-from-here.${slot}: Run from Here on a depth-2 Block in ${SLOT_TITLE[slot]} runs it and its downstream Block`, async ({
      page,
    }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runFromHereCell(page, slot)
    })
  }
})

test.describe('Matrix C: a disabled Block at depth 2 in every slot kind', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const slot of SLOT_KINDS) {
    test(`C.disabled.block.${slot}: a disabled depth-2 Block in ${SLOT_TITLE[slot]} is bypassed`, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await disabledBlockCell(page, slot)
    })
  }
})

test.describe('Matrix C: a disabled inner container owning every slot kind', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const slot of SLOT_KINDS) {
    const outcome = OPEN_DISABLED_SLOTS.includes(slot)
      ? 'leaves the outer flow to finish'
      : 'skips its sub-flow and resumes at then'
    test(`C.disabled.container.${slot}: a disabled inner container owning ${SLOT_TITLE[slot]} ${outcome}`, async ({
      page,
    }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await disabledContainerCell(page, slot)
    })
  }
})

test.describe('Matrix C: ad-hoc runs inside a Function body start from the session state', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test('C.run-scope.function-body.nested: Run Scope on a Function nested in another Function body runs it from its last state', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await runScopeNestedFunctionCell(page)
  })
  for (const { item, id } of BODY_ADHOC_RUNS) {
    test(`C.${id}.function-body.reset: after Reset, ${item} in a Function body stops on a Required input with no value`, async ({
      page,
    }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await resetThenAdHocCell(page, item, `C.${id}.function-body.reset`)
    })
  }
})

test.describe('Matrix C: ad-hoc runs inside a Remote Execution body', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test('C.run-current.remote-body.container: Run Current on a For Loop in a Remote Execution body runs its remotable Blocks on the remote host', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await runCurrentContainerInBodyCell(page)
  })
  test('C.run-from-here.remote-body.block: Run from Here on a Block in a Remote Execution body runs the Blocks after it on the remote host', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await runFromHereBlockInBodyCell(page)
  })
  test('C.run-current.remote-body.closed-session: Run Current on a remote-host Block in a Remote Execution body with the session closed fails and runs nothing', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await closedSessionCell(page)
  })
  test('C.run-current.remote-body.closed-session.wave-block: Run Current on a WAVE Block in a Remote Execution body with the session closed passes', async ({
    page,
  }) => {
    test.setTimeout(CELL_TIMEOUT_MS)
    await closedSessionWaveBlockCell(page)
  })
})
