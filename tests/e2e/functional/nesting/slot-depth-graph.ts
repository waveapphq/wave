/** The depth-2 slot shape the debug and ad-hoc cells share: pre, a Try/Catch whose try path holds the inner container, the outer then successor. */

import {
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_WAIT_ROUNDS,
  LOOP_SLOTS,
  SLOT_CONTAINER,
  container,
  marker,
  type ContainerOptions,
  type NestStep,
  type SlotKind,
} from '../../helpers/nesting-graph'

export const PRE = 'pre'
export const OUTER = 'outer'
export const INNER = 'inner'
export const INNER_THEN = 'inner-then'
export const OUTER_THEN = 'outer-then'

/** Keeps a Wait Until retry body far from its time limit while a run is paused in it. */
export const PAUSE_SAFE_WAIT_TIMEOUT_MS = 600_000

export const SLOT_TITLE: Readonly<Record<SlotKind, string>> = {
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

/** pre -> outer Try/Catch (try: inner container with `slotSteps` in `slot` -> inner-then) -> outer-then. */
export function slotDepthChain(slot: SlotKind, slotSteps: NestStep[], innerOptions: ContainerOptions = {}): NestStep[] {
  const inner = container(SLOT_CONTAINER[slot], INNER, slotSteps, { slot, options: innerOptions })
  const outer = container('try-catch', OUTER, [inner, marker(INNER_THEN)])
  return [marker(PRE), outer, marker(OUTER_THEN)]
}

/** How many times a slot's chain runs for one entry of its container (LOOP:11, LOOP:41, LOOP:73, WU:53). */
export function slotRuns(slot: SlotKind, iterations?: number): number {
  if (LOOP_SLOTS.includes(slot)) return iterations ?? DEFAULT_LOOP_ITERATIONS
  if (slot === 'wait-until-body') return iterations ?? DEFAULT_WAIT_ROUNDS
  return 1
}
