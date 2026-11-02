/**
 * Variable Name Validation
 *
 * Pure validation function and React hook for validating variable names.
 * Used across array, map, table, scalar, create, and rename editors.
 */

import { useCallback } from 'react'
import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { VARIABLE_NAME_PATTERN, MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'

/** Variable names reserved for namespace access in expressions. */
const RESERVED_NAMESPACE_NAMES = new Set(['suite', 'system', 'regression'])

/** Function inputs and outputs start with a letter (REQ-3.1.2.4). */
const PARAMETER_NAME_PATTERN = /^[a-zA-Z]\w*$/

const PARAMETER_NAME_RULE_MESSAGE =
  'Parameter name must start with a letter, contain only letters, numbers, underscores'

/** Options for variable name validation. */
export interface ValidateVariableNameOptions {
  /** Current variable name (to skip duplicate check for the same variable). */
  variableName?: string
  /** Variable ID (required for nameExists check). */
  variableId?: string
  /** Callback that returns true if a variable with the given name already exists. */
  nameExists?: (name: string, excludeId: string) => boolean
  /**
   * Map of alias name -> origin label (e.g., "Profile: staging") for any
   * profile alias visible at this scope. When the candidate name matches a
   * key, validation fails with a cross-namespace conflict error so the
   * collision surfaces inline rather than only at save time.
   */
  conflictingAliases?: ReadonlyMap<string, string>
  /** True for a Function input or output, whose name must start with a letter. */
  parameter?: boolean
}

/**
 * Validate a variable name and return an error message, or null if valid.
 *
 * Checks: empty, max length, pattern, Python keyword, duplicate name,
 * cross-namespace conflict against profile aliases.
 */
export function validateVariableName(
  value: string,
  opts: ValidateVariableNameOptions = {},
): string | null {
  if (!value.trim()) {
    return 'Name is required'
  }
  if (value !== value.trim()) {
    return 'Name cannot have leading or trailing whitespace'
  }
  if (value.length > MAX_VARIABLE_NAME_LENGTH) {
    return `Name must be ${MAX_VARIABLE_NAME_LENGTH} characters or fewer`
  }
  if (opts.parameter && !PARAMETER_NAME_PATTERN.test(value)) {
    return PARAMETER_NAME_RULE_MESSAGE
  }
  if (!VARIABLE_NAME_PATTERN.test(value)) {
    return 'Variable name must start with letter/underscore, contain only letters, numbers, underscores'
  }
  if (PYTHON_KEYWORD_SET.has(value)) {
    return `"${value}" is a Python keyword`
  }
  if (RESERVED_NAMESPACE_NAMES.has(value)) {
    return `"${value}" is reserved for namespace access. Use ${value}.field_name in expressions.`
  }
  if (opts.nameExists && opts.variableId && value !== opts.variableName && opts.nameExists(value, opts.variableId)) {
    return 'A variable with this name already exists'
  }
  const aliasSource = opts.conflictingAliases?.get(value)
  if (aliasSource && value !== opts.variableName) {
    return `'${value}' conflicts with profile alias from ${aliasSource}`
  }
  return null
}

/**
 * React hook that returns a memoized variable name validation callback.
 */
export function useVariableNameValidation(opts: ValidateVariableNameOptions = {}) {
  const { variableName, variableId, nameExists } = opts

  const validateName = useCallback(
    (value: string): string | null => validateVariableName(value, { variableName, variableId, nameExists }),
    [variableName, variableId, nameExists],
  )

  return { validateName }
}
