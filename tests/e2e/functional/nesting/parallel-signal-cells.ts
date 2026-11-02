/** Matrix B5 cells: a Parallel lane failure and a Parallel time limit inside each loop body and each Try/Catch path. */

import type { Page } from '../../helpers/playwright-fixtures'
import {
  SLOT_CONTAINER,
  buildNestingGraph,
  container,
  delayBlock,
  failBlock,
  marker,
  type ContainerOptions,
  type NestingGraphSpec,
  type NestStep,
  type SlotKind,
} from '../../helpers/nesting-graph'
import { openCell, runCell } from './nesting-harness'
import {
  applyExpectations,
  NO_NODE_RUNNING,
  paintsOnCanvas,
  ranBefore,
  runsTimes,
  untakenNeverRun,
  verdictIs,
  type Expectation,
} from './signal-expectations'
import { SLOT_TEXT } from './signal-steps'

export const CELL_TIMEOUT_MS = 240_000
const SECTION_LIMIT_MS = 1_000
const LANE_LIMIT_MS = 1_000
const LANE_HOLD_MS = 5_000

export const PARALLEL_SIGNAL_SLOTS = ['for-body', 'for-each-body', 'while-body', 'try', 'catch', 'finally'] as const
export type ParallelSignalSlot = (typeof PARALLEL_SIGNAL_SLOTS)[number]

export const PARALLEL_SIGNALS = ['lane-failure', 'time-limit'] as const
export type ParallelSignal = (typeof PARALLEL_SIGNALS)[number]

/** The first lane's own time limit expires (REQ-3.2.3.7 per-branch limit); no section limit is set. */
export const LANE_TIME_LIMIT_SIGNAL = 'lane-time-limit'
export type ParallelPlanSignal = ParallelSignal | typeof LANE_TIME_LIMIT_SIGNAL

export type ParallelSignalPlan = {
  cellId: string
  title: string
  spec: Omit<NestingGraphSpec, 'name'>
  expectations: Expectation[]
}

export function parallelSignalCellId(slot: ParallelSignalSlot, signal: ParallelPlanSignal): string {
  return `B5.${slot}.${signal}`
}

function slotChains(slot: ParallelSignalSlot): Partial<Record<SlotKind, NestStep[]>> | undefined {
  if (slot === 'try') return { catch: [marker('outer-catch')] }
  if (slot === 'catch') return { finally: [marker('outer-finally')] }
  return undefined
}

function limitOptions(signal: ParallelPlanSignal): { options?: ContainerOptions } {
  if (signal === 'lane-failure') return {}
  if (signal === LANE_TIME_LIMIT_SIGNAL) return { options: { laneTimeLimitMs: LANE_LIMIT_MS } }
  return { options: { timeLimitMs: SECTION_LIMIT_MS } }
}

const ENDED: Readonly<Record<ParallelPlanSignal, string>> = {
  'lane-failure': 'a failed lane',
  'time-limit': 'an expired section time limit',
  'lane-time-limit': 'an expired lane time limit',
}

const WHAT: Readonly<Record<ParallelPlanSignal, string>> = {
  'lane-failure': 'a Parallel whose lane fails',
  'time-limit': 'a Parallel whose section time limit expires',
  'lane-time-limit': 'a Parallel whose lane time limit expires',
}

export function parallelSignalPlan(slot: ParallelSignalSlot, signal: ParallelPlanSignal): ParallelSignalPlan {
  const cellId = parallelSignalCellId(slot, signal)
  const failure = signal === 'lane-failure'
  const lane: NestStep[] = [
    marker('lane-before'),
    failure ? failBlock('lane-fail') : delayBlock('lane-hold', LANE_HOLD_MS),
    marker('lane-after'),
  ]
  const par = container('parallel', 'par', lane, limitOptions(signal))
  const outer = container(SLOT_CONTAINER[slot], 'outer', [par, marker('par-then')], { slot, slots: slotChains(slot) })
  const spec: Omit<NestingGraphSpec, 'name'> = { chain: [outer, marker('outer-then')] }

  const graph = buildNestingGraph({ ...spec, name: cellId })
  const bookend = graph.bookendId
  const ended = ENDED[signal]
  const expectations: Expectation[] = [
    ...untakenNeverRun(graph, ['outer']),
    ...(graph.containers.outer?.siblings ?? []).map((id) => runsTimes(id, 1, 'a sibling path of the Try/Catch runs once')),
    runsTimes('lane-before', 1, 'the lane starts once: the section failure ends the slot on its first entry'),
    runsTimes('lane-after', 0, `the lane never passes ${ended}`),
    runsTimes('par-then', 0, "the Parallel's then successor never runs after the section fails"),
    ...paintsOnCanvas(graph, 'par', 'failed', `the Parallel paints failed after ${ended}`),
    ...(failure ? paintsOnCanvas(graph, 'lane-fail', 'failed', 'the failing Block paints failed') : []),
    NO_NODE_RUNNING,
  ]

  if (slot === 'try') {
    expectations.push(
      verdictIs('passed'),
      runsTimes('outer-catch', 1, 'the catch path runs once for the failed section'),
      runsTimes('outer-then', 1, "the Try/Catch's then successor runs once"),
      runsTimes(bookend, 1, 'the bookend runs once'),
      ranBefore('lane-before', 'outer-catch', 'the catch runs after the section failed'),
      ranBefore('outer-catch', 'outer-then', 'the catch runs before the then successor'),
      ranBefore('outer-then', bookend, 'the then successor runs before the bookend'),
    )
  } else if (slot === 'catch') {
    expectations.push(
      verdictIs('failed'),
      runsTimes('outer-finally', 1, 'the finally path still runs after the catch path failed'),
      ranBefore('lane-before', 'outer-finally', 'the finally path runs after the catch path failed'),
      runsTimes('outer-then', 0, "the Try/Catch's then successor never runs"),
      runsTimes(bookend, 0, 'nothing after the failure runs (the bookend)'),
    )
  } else {
    expectations.push(
      verdictIs('failed'),
      runsTimes('outer-then', 0, "the container's then successor never runs"),
      runsTimes(bookend, 0, 'nothing after the failure runs (the bookend)'),
    )
    if (slot === 'finally') {
      expectations.push(ranBefore('outer-try', 'lane-before', 'the finally path runs after the try path'))
    }
  }

  return { cellId, title: `${cellId}: ${WHAT[signal]} inside ${SLOT_TEXT[slot]}`, spec, expectations }
}

export function parallelSignalPlans(): ParallelSignalPlan[] {
  return PARALLEL_SIGNAL_SLOTS.flatMap((slot) => PARALLEL_SIGNALS.map((signal) => parallelSignalPlan(slot, signal)))
}

/** The per-lane time limit cells, one per loop body and Try/Catch path. */
export function laneTimeLimitPlans(): ParallelSignalPlan[] {
  return PARALLEL_SIGNAL_SLOTS.map((slot) => parallelSignalPlan(slot, LANE_TIME_LIMIT_SIGNAL))
}

export async function runParallelSignalCell(page: Page, plan: ParallelSignalPlan): Promise<void> {
  const cell = await openCell(page, plan.cellId, plan.spec)
  const run = await runCell(page, cell)
  applyExpectations(cell, run, plan.expectations)
}

export const PARALLEL_SIGNAL_DESCRIBE = 'Matrix B5: a Parallel lane failure and time limit inside loop bodies and Try/Catch paths'

export const LANE_TIME_LIMIT_DESCRIBE = 'Matrix B5: a Parallel lane time limit inside loop bodies and Try/Catch paths'
