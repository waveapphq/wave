/**
 * Variable Setter Editor - Validation
 *
 * Name and value checks for variable setter rows.
 * Design decision: VARSET-8
 * REQ-3.4.3.8: Set variables during execution
 */

import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { NAMESPACE_ROOTS } from '@/features/workbench/lib/namespace-roots'
import type { AvailableVariable, RowValidation, VariableRow } from './types'
import { VARIABLE_NAME_PATTERN } from './types'
import { VARIABLE_NAME_REQUIRED_MESSAGE, VARIABLE_NAME_RULE_MESSAGE } from '@/lib/field-constraints'
import { isStoredSecretValue } from '@/lib/secret-envelope'
import { plainNumberText } from '@/lib/number-rule'
import { unfinishedNumberError, validateAndParseScalarValue } from '@/lib/variable-validation'

type FieldCheck = { error: string | null }

const VALID: FieldCheck = { error: null }
const EXPRESSION_REQUIRED_MESSAGE = 'Expression is required'

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
  // Function inputs are read-only - the caller binds them, the body cannot
  // overwrite them via Variable Setter. Function outputs ARE writable
  // targets (the setter assigns the body-side value the Function returns
  // to the caller); they pass validation and are simply assigned rather
  // than created on save (see `createVariableSetterVariables`).
  const inputConflict = availableVariables.find(
    (v) => v.name === name && v.source === 'Function input',
  )
  if (inputConflict) {
    return { error: `'${name}' is a Function input and is read-only inside the body` }
  }
  return VALID
}

/** An expression row needs an expression; one that gives null at run time is still one. */
export function validateExpression(value: unknown): FieldCheck {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: EXPRESSION_REQUIRED_MESSAGE }
  }
  return VALID
}

/** A literal number row's text or number must keep the number rule; a stored null or a sealed secret is valid. */
function literalNumberError(row: VariableRow): string | undefined {
  if (row.type !== 'integer' && row.type !== 'float') return undefined
  if (typeof row.value === 'number') return validateAndParseScalarValue(row.type, '', plainNumberText(row.value), false).error
  if (typeof row.value !== 'string' || isStoredSecretValue(row.value)) return undefined
  const parsed = validateAndParseScalarValue(row.type, '', row.value, false)
  if (!parsed.valid) return unfinishedNumberError(row.value, row.type) ?? parsed.error
  // The number is the text as written: a space around the digits is no number.
  if (parsed.value === row.value) return undefined
  return row.type === 'integer' ? 'Must be a valid integer' : 'Must be a valid number'
}

/** A row's first problem, its name before its value. */
export function validateRow(
  row: VariableRow,
  allNames: string[],
  currentIndex: number,
  availableVariables: AvailableVariable[],
): RowValidation {
  const name = validateName(row.name, allNames, currentIndex, availableVariables)
  if (name.error) return { ...name, field: 'name' }
  const valueError = row.isExpression ? validateExpression(row.value).error : literalNumberError(row)
  if (!valueError) return { error: null, field: null }
  return { error: valueError, field: 'value' }
}
