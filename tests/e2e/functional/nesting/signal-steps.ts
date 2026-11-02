/** Step factories and cell wording shared by the Matrix B signal and variable cells (see README.md). */

import {
  setter,
  varName,
  type ContainerKind,
  type NestLeaf,
  type SlotKind,
} from '../../helpers/nesting-graph'

export const KIND_TEXT: Readonly<Record<ContainerKind, string>> = {
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

export const SLOT_TEXT: Readonly<Record<SlotKind, string>> = {
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

/** Containers whose generated body tail is a counter (the builder appends it after the body chain). */
export const COUNTED_KINDS: readonly ContainerKind[] = ['while', 'wait-until']

/** A While body head that counts the iteration, so a Break or Continue that skips the tail cannot spin the loop. */
export function whileHeadCount(loopId: string): NestLeaf {
  const counter = varName('n', loopId)
  return setter(`${loopId}-head-count`, {
    [counter]: { value: `${counter} + 1`, expression: true, type: 'integer', seed: 0 },
  })
}

/** Zero a While or Wait Until counter, so the container runs its body again when re-entered. */
export function counterReset(containerId: string): NestLeaf {
  const counter = varName('n', containerId)
  return setter(`${containerId}-reset`, {
    [counter]: { value: '0', expression: true, type: 'integer', seed: 0 },
  })
}
