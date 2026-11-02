/** Matrix B1 cells: Break and Continue inside each non-loop container inside each loop kind (see README.md). */

import { test, type Page } from '../../helpers/playwright-fixtures'
import {
  DEFAULT_LOOP_ITERATIONS,
  SLOT_CONTAINER,
  breakBlock,
  container,
  continueBlock,
  marker,
  type NestStep,
  type SlotKind,
} from '../../helpers/nesting-graph'
import {
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVerdict,
  openCell,
  runCell,
  type CellRun,
  type NestCell,
} from './nesting-harness'
import { openSignalCell, recordRefusal } from './signal-cell-open'
import { KIND_TEXT, SLOT_TEXT, whileHeadCount } from './signal-steps'

export const CELL_TIMEOUT_MS = 240_000

export type LoopKind = 'for' | 'for-each' | 'while'
export type LoopSignal = 'break' | 'continue'
export type LoopTarget = 'nearest' | 'outer'

/** The non-loop container slots a Break or Continue sits in. */
export const SIGNAL_SLOTS: readonly SlotKind[] = [
  'if-branch',
  'case',
  'assert-pass',
  'wait-until-body',
  'parallel-lane',
  'try',
  'catch',
  'finally',
  'remote-body',
  'function-body',
]

/** The other branch slots of the same containers: the If/Else else branch, the Switch/Case default, the split Assert fail leg. */
export const BRANCH_SIGNAL_SLOTS: readonly SlotKind[] = ['else-branch', 'default', 'assert-fail']

/** Slots the design lets a Break or Continue cross (LOOP:120, BR:10, PB:9, PB:23, REQ-3.2.2.10); every other slot's outcome is open. */
const SETTLED_SLOTS: readonly SlotKind[] = [
  'if-branch',
  'else-branch',
  'assert-pass',
  'assert-fail',
  'parallel-lane',
  'try',
  'catch',
  'finally',
]

/** Try/Catch paths: a signal there leaves through the finally path, which the cell enables for every one of them. */
const TRY_SLOTS: readonly SlotKind[] = ['try', 'catch', 'finally']

/** Branching containers in a loop body: their untaken branch paints skipped (LOOP:120). */
const PAINTED_SLOTS: readonly SlotKind[] = ['if-branch', 'else-branch', 'assert-pass', 'assert-fail']

const LOOP_NAME: Readonly<Record<LoopKind, string>> = { for: 'For Loop', 'for-each': 'For Each', while: 'While' }

const SIGNALS: readonly LoopSignal[] = ['break', 'continue']
const TARGETS: readonly LoopTarget[] = ['nearest', 'outer']

export function breakContinueCellId(loop: LoopKind, slot: SlotKind, signal: LoopSignal, target: LoopTarget): string {
  return `B1.${loop}.${slot}.${signal}.${target}`
}

function title(loop: LoopKind, slot: SlotKind, signal: LoopSignal, target: LoopTarget): string {
  const word = signal === 'break' ? 'Break' : 'Continue'
  const aim =
    target === 'nearest'
      ? `targeting the ${LOOP_NAME[loop]} around it`
      : `targeting the outer ${LOOP_NAME[loop]} of two nested ones`
  return `${breakContinueCellId(loop, slot, signal, target)}: a ${word} in ${SLOT_TEXT[slot]} ${aim}`
}

function loopBody(loop: LoopKind, id: string, steps: NestStep[]): NestStep[] {
  return loop === 'while' ? [whileHeadCount(id), ...steps] : steps
}

/** loop[head, mid(slot)[signal, after-signal], body-after] then loop-then; the outer variant wraps it in a second loop. */
export function breakContinueChain(loop: LoopKind, slot: SlotKind, signal: LoopSignal, target: LoopTarget): NestStep[] {
  const targetId = target === 'nearest' ? 'loop' : 'outer'
  const signalStep = signal === 'break' ? breakBlock('signal', targetId) : continueBlock('signal', targetId)
  const options = TRY_SLOTS.includes(slot) ? { enableFinally: true } : {}
  const mid = container(SLOT_CONTAINER[slot], 'mid', [signalStep, marker('after-signal')], { slot, options })
  const inner = container(loop, 'loop', loopBody(loop, 'loop', [marker('body-head'), mid, marker('body-after')]))
  if (target === 'nearest') return [inner, marker('loop-then')]
  const outer = container(loop, 'outer', loopBody(loop, 'outer', [marker('outer-head'), inner, marker('loop-then')]))
  return [outer, marker('outer-then')]
}

function expectSettledOutcome(
  cell: NestCell,
  run: CellRun,
  slot: SlotKind,
  signal: LoopSignal,
  target: LoopTarget,
): void {
  const bookend = cell.graph.bookendId
  const passes = signal === 'continue' ? DEFAULT_LOOP_ITERATIONS : 1
  const how = signal === 'break' ? 'Break ends the target loop in its first iteration' : 'Continue advances the target loop through every iteration'

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'after-signal', 0, 'the rest of the slot after the signal never runs')
  expectMarkerCount(cell, run, 'body-after', 0, 'the rest of the loop body after the container never runs')
  for (const id of cell.graph.containers.mid.untaken) {
    expectMarkerCount(cell, run, id, 0, 'an untaken branch never runs')
  }
  const targetThen = target === 'nearest' ? 'loop-then' : 'outer-then'
  if (TRY_SLOTS.includes(slot)) {
    for (const id of cell.graph.containers.mid.siblings) {
      expectMarkerCount(cell, run, id, passes, 'the other Try/Catch path runs once each time the signal leaves the Try/Catch')
      expectRanBefore(cell, run, id, targetThen, 'it runs before the target loop moves on')
    }
  }
  if (target === 'nearest') {
    expectMarkerCount(cell, run, 'body-head', passes, how)
    expectMarkerCount(cell, run, 'loop-then', 1, "the target loop's then successor runs once")
    expectRanBefore(cell, run, 'body-head', 'loop-then', 'the loop body runs before the then successor')
    expectRanBefore(cell, run, 'loop-then', bookend, 'the then successor runs before the bookend')
  } else {
    expectMarkerCount(cell, run, 'outer-head', passes, how)
    expectMarkerCount(cell, run, 'body-head', passes, 'the intermediate loop body is entered once per outer iteration')
    expectMarkerCount(cell, run, 'loop-then', 0, "the intermediate loop's then successor never runs")
    expectMarkerCount(cell, run, 'outer-then', 1, "the target loop's then successor runs once")
    expectRanBefore(cell, run, 'body-head', 'outer-then', 'the loop bodies run before the target then successor')
    expectRanBefore(cell, run, 'outer-then', bookend, 'the target then successor runs before the bookend')
  }
  expectMarkerCount(cell, run, bookend, 1, 'the bookend runs once')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  if (PAINTED_SLOTS.includes(slot)) {
    for (const id of cell.graph.containers.mid.untaken) {
      expectNodePaint(cell, run, id, 'skipped', 'an untaken branch inside a loop body paints skipped')
    }
  }
}

export type BreakContinueCellPlan = { loop: LoopKind; slot: SlotKind; signal: LoopSignal; target: LoopTarget; title: string }

export function breakContinueDescribeTitle(loop: LoopKind): string {
  return `Matrix B1: Break and Continue across containers inside ${KIND_TEXT[loop]}`
}

/** One cell per container slot, signal and target inside `loop`, in registration order. */
export function breakContinueCellPlans(loop: LoopKind, slots: readonly SlotKind[] = SIGNAL_SLOTS): BreakContinueCellPlan[] {
  return slots.flatMap((slot) =>
    SIGNALS.flatMap((signal) =>
      TARGETS.map((target) => ({ loop, slot, signal, target, title: title(loop, slot, signal, target) })),
    ),
  )
}

export async function runBreakContinueCell(page: Page, { loop, slot, signal, target }: BreakContinueCellPlan): Promise<void> {
  const cellId = breakContinueCellId(loop, slot, signal, target)
  const chain = breakContinueChain(loop, slot, signal, target)

  if (SETTLED_SLOTS.includes(slot)) {
    const cell = await openCell(page, cellId, { chain })
    const run = await runCell(page, cell)
    expectSettledOutcome(cell, run, slot, signal, target)
    return
  }

  // The design leaves this crossing open: record whether it is refused and what the run did, assert no outcome.
  test.info().annotations.push({ type: 'unsettled', description: `${cellId} outcome is not settled by the design` })
  const opened = await openSignalCell(page, cellId, { chain }, { requireValid: false })
  if (opened.refusal !== null) {
    await recordRefusal(cellId, opened.refusal)
    return
  }
  const run = await runCell(page, opened.cell, { awaitBookend: false })
  expectNoNodeRunning(opened.cell, run)
}

/** For Loop body > Try/Catch (try: a marker, then an If/Else whose if branch holds a Break; finally: a Log) > Log after the loop. */
export const BREAK_THROUGH_FINALLY_CELL_ID = 'B1.for.try-finally.if-else-break'

export const BREAK_THROUGH_FINALLY_TITLE = `${BREAK_THROUGH_FINALLY_CELL_ID}: a Break in an If/Else in a try path runs the finally path once, then the For Loop ends`

export async function runBreakThroughFinallyCell(page: Page): Promise<void> {
  const branch = container('if-else', 'branch', [breakBlock('signal', 'loop')], { slot: 'if-branch' })
  const guard = container('try-catch', 'guard', [marker('try-head'), branch], {
    slot: 'try',
    slots: { finally: [marker('finally-log')] },
  })
  const cell = await openCell(page, BREAK_THROUGH_FINALLY_CELL_ID, { chain: [container('for', 'loop', [guard]), marker('loop-then')] })
  const run = await runCell(page, cell)
  const bookend = cell.graph.bookendId

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'try-head', 1, 'the Break ends the For Loop in its first iteration')
  expectMarkerCount(cell, run, 'finally-log', 1, 'the finally path runs once for each iteration the loop enters')
  for (const id of [...cell.graph.containers.guard.untaken, ...cell.graph.containers.branch.untaken]) {
    expectMarkerCount(cell, run, id, 0, 'the catch path and the else branch never run')
  }
  expectMarkerCount(cell, run, 'loop-then', 1, 'the Log after the For Loop runs once')
  expectRanBefore(cell, run, 'finally-log', 'loop-then', 'the finally path runs before the Log after the loop')
  expectMarkerCount(cell, run, bookend, 1, 'the bookend runs once')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
}
