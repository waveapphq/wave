/** Matrix A placement cells: each container kind inside each slot kind, one test per cell (see README.md). */

import { test, type Page } from '../../helpers/playwright-fixtures'
import {
  BRANCHING_KINDS,
  CONTAINER_KINDS,
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_WAIT_ROUNDS,
  LOOP_SLOTS,
  SLOT_CONTAINER,
  TOKEN_PLACEHOLDER,
  container,
  marker,
  setter,
  type ContainerKind,
  type SlotKind,
} from '../../helpers/nesting-graph'
import {
  cellText,
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectNodePaint,
  expectRanBefore,
  expectVariable,
  expectVerdict,
  openCell,
  runCell,
} from './nesting-harness'

export const CELL_TIMEOUT_MS = 240_000

export const INNER_VARIABLE = 'nest_inner'

const KIND_LABEL: Readonly<Record<ContainerKind, string>> = {
  'if-else': 'an If/Else',
  'switch-case': 'a Switch/Case',
  'assert-split': 'a split Assert',
  for: 'a For Loop',
  'for-each': 'a For Each',
  while: 'a While',
  'wait-until': 'a Wait Until',
  parallel: 'a Parallel',
  'try-catch': 'a Try/Catch',
  'remote-exec': 'a Remote Execution',
  function: 'a Function',
}

const SLOT_LABEL: Readonly<Record<SlotKind, string>> = {
  'if-branch': 'an If/Else if branch',
  'else-branch': 'an If/Else else branch',
  case: 'a Switch/Case case',
  default: 'a Switch/Case default',
  'assert-pass': 'a split Assert pass leg',
  'assert-fail': 'a split Assert fail leg',
  'for-body': 'a For Loop body',
  'for-each-body': 'a For Each body',
  'while-body': 'a While body',
  'wait-until-body': 'a Wait Until retry body',
  'parallel-lane': 'a Parallel lane',
  try: 'a Try/Catch try path',
  catch: 'a Try/Catch catch path',
  finally: 'a Try/Catch finally path',
  'remote-body': 'a Remote Execution body',
  'function-body': 'a Function body',
}

export function placementCellId(slot: SlotKind, inner: ContainerKind): string {
  return `A.${slot}.${inner}`
}

export function placementTitle(slot: SlotKind, inner: ContainerKind): string {
  return `${placementCellId(slot, inner)}: ${KIND_LABEL[inner]} inside ${SLOT_LABEL[slot]} runs as on the main flow`
}

/** How many times the outer slot's content runs (LOOP:11, LOOP:41, LOOP:73, WU:53). */
function outerSlotRuns(slot: SlotKind): number {
  if (LOOP_SLOTS.includes(slot)) return DEFAULT_LOOP_ITERATIONS
  if (slot === 'wait-until-body') return DEFAULT_WAIT_ROUNDS
  return 1
}

/** Total inner sub-flow runs; a While or Wait Until keeps its counter, so a re-entry runs its body zero times (LOOP:73, WU:53). */
function innerBodyRuns(inner: ContainerKind, outerRuns: number): number {
  if (inner === 'for' || inner === 'for-each') return DEFAULT_LOOP_ITERATIONS * outerRuns
  if (inner === 'while') return DEFAULT_LOOP_ITERATIONS
  if (inner === 'wait-until') return DEFAULT_WAIT_ROUNDS
  return outerRuns
}

export type PlacementCellPlan = { slot: SlotKind; inner: ContainerKind; title: string }

export function placementDescribeTitle(outer: ContainerKind): string {
  return `Matrix A: every container inside ${KIND_LABEL[outer]}`
}

/** One cell per inner container kind for every slot of `outer`, in registration order. */
export function placementCellPlans(outer: ContainerKind): PlacementCellPlan[] {
  const slots = (Object.keys(SLOT_CONTAINER) as SlotKind[]).filter((slot) => SLOT_CONTAINER[slot] === outer)
  return slots.flatMap((slot) => CONTAINER_KINDS.map((inner) => ({ slot, inner, title: placementTitle(slot, inner) })))
}

export async function runPlacementCell(page: Page, { slot, inner }: PlacementCellPlan): Promise<void> {
  const cellId = placementCellId(slot, inner)
  const innerStep = container(inner, 'inner', [
    marker('inner-body'),
    setter('inner-set', {
      [INNER_VARIABLE]: { value: `inner-${TOKEN_PLACEHOLDER}`, type: 'string', seed: '', flow: 'export' },
    }),
  ])
  const outerStep = container(SLOT_CONTAINER[slot], 'outer', [innerStep, marker('inner-then')], { slot })
  const cell = await openCell(page, cellId, { chain: [outerStep, marker('outer-then')] })
  const run = await runCell(page, cell)

  const outerRuns = outerSlotRuns(slot)
  const innerInfo = cell.graph.containers.inner
  const outerInfo = cell.graph.containers.outer

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, 'inner-body', innerBodyRuns(inner, outerRuns), 'the inner sub-flow runs the expected number of times')
  for (const id of innerInfo.untaken) {
    expectMarkerCount(cell, run, id, 0, 'an untaken inner branch never runs')
  }
  for (const id of innerInfo.siblings) {
    expectMarkerCount(cell, run, id, outerRuns, 'the inner sibling lane runs on every entry')
  }
  expectMarkerCount(cell, run, 'inner-then', outerRuns, 'the inner then successor (or rejoin) runs once per entry')
  for (const id of outerInfo.untaken) {
    expectMarkerCount(cell, run, id, 0, 'an untaken outer branch never runs')
  }
  for (const id of outerInfo.siblings) {
    expectMarkerCount(cell, run, id, 1, 'the outer sibling path runs once')
  }
  expectMarkerCount(cell, run, 'outer-then', 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'the bookend runs once')
  expectRanBefore(cell, run, 'inner-body', 'outer-then', 'the inner sub-flow runs inside the outer slot')
  expectRanBefore(cell, run, 'inner-then', 'outer-then', 'the inner then successor runs inside the outer slot')
  expectRanBefore(cell, run, 'outer-then', cell.graph.bookendId, 'the outer then successor runs before the bookend')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
  expectVariable(cell, run, INNER_VARIABLE, `inner-${cell.token}`, 'the variable written at the innermost depth reads at the top')

  // LOOP:120 "The branches not taken paint skipped" holds for a branching control in a loop body.
  if (LOOP_SLOTS.includes(slot) && BRANCHING_KINDS.includes(inner)) {
    for (const id of innerInfo.untaken) {
      expectNodePaint(cell, run, id, 'skipped', 'an untaken branch inside a loop body paints skipped')
    }
  }
  test.info().annotations.push({ type: 'cell', description: `${cellId} ${cellText(cell, 'inner-body')}` })
}
