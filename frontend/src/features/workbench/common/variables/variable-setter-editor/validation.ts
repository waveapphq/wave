/**
 * Variable Setter Editor - Validation
 *
 * Name and value checks for variable setter rows.
 * Design decision: VARSET-8
 * REQ-3.4.3.8: Set variables during execution
 */

import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { NAMESPACE_ROOTS } from '@/features/workbench/lib/namespace-roots'
import { blankEntryMessage } from '@/features/workbench/lib/node-parameters/field-modes'
import { literalNumberProblem } from '@/features/workbench/lib/validation/number-bounds'
import {
  VARIABLE_NAME_PATTERN,
  VARIABLE_NAME_REQUIRED_MESSAGE,
  VARIABLE_NAME_RULE_MESSAGE,
} from '@/lib/field-constraints'
import { expressionIsHeld } from '@/lib/value-loss'
import type { AvailableVariable, RowProblems, VariableRow } from './types'

type FieldCheck = { error: string | null }

const VALID: FieldCheck = { error: null }
const VALUE_REQUIRED_MESSAGE = 'Value is required'

export function validateName(
  name: string,
  allNames: string[],
  currentIndex: number,
  availableVariables: AvailableVariable[],
): FieldCheck {
  if (!name.trim()) {
    return { error: VARIABLE_NAME_REQUIRED_MESSAGE }
  }
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    return { error: VARIABLE_NAME_RULE_MESSAGE }
  }
  if (PYTHON_KEYWORD_SET.has(name)) {
    return { error: `'${name}' is a Python keyword and cannot be used as a variable name` }
  }
  // Duplicate within this setter
  const isDuplicate = allNames.some((n, i) => i !== currentIndex && n === name)
  if (isDuplicate) {
    return { error: 'Duplicate variable name in this setter' }
  }
  // Reject namespace keywords as targets (dotted names like system.x
  // are already rejected by VARIABLE_NAME_PATTERN above)
  if (NAMESPACE_ROOTS.has(name)) {
    return { error: `Cannot modify namespace variable '${name}'` }
  }
  // Cross-namespace conflict: profile aliases bound to enclosing elements
  // share the global expression namespace with variables.
  const aliasConflict = availableVariables.find(
    (v) => v.name === name && v.source?.startsWith('Profile:'),
  )
  if (aliasConflict) {
    return { error: `'${name}' conflicts with profile alias from ${aliasConflict.source}` }
  }
  // A Function's inputs are read-only inside its body; its outputs are writable targets (REQ-3.4.3.8).
  const inputConflict = availableVariables.find(
    (v) => v.name === name && v.source === 'Function input',
  )
  if (inputConflict) {
    return { error: `Writes to declared input '${name}'; inputs are read-only` }
  }
  return VALID
}

/** The first blank {x} entry of a list or map row, named by its row (FIELD-13). */
function blankEntryProblem(row: VariableRow): string | null {
  const held = row.value
  if (held === null || typeof held !== 'object') return null
  for (const key of row.entryExpressions ?? []) {
    const entry = Array.isArray(held) ? held[Number(key)] : (held as Record<string, unknown>)[key]
    if (!expressionIsHeld(entry)) return blankEntryMessage(row.name, held, key)
  }
  return null
}

/** A row value's problem: a blank {x}, a literal with no value, the number rule, then a blank {x} entry. */
export function setterValueProblem(row: VariableRow): string | null {
  if (row.isExpression) return expressionIsHeld(row.value) ? null : VALUE_REQUIRED_MESSAGE
  if (row.value === undefined) return VALUE_REQUIRED_MESSAGE
  // A Template is text, kept as written on a variable retyped since (FNCFG-9).
  if (row.isTemplate === true) return null
  return literalNumberProblem(row.type, row.value, false) ?? blankEntryProblem(row)
}

/** A row's name and value messages. */
export function rowProblems(
  row: VariableRow,
  allNames: string[],
  currentIndex: number,
  availableVariables: AvailableVariable[],
): RowProblems {
  return {
    name: validateName(row.name, allNames, currentIndex, availableVariables).error,
    value: setterValueProblem(row),
  }
}
