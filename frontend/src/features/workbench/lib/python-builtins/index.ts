/**
 * Python Builtins
 *
 * Contains Python builtin functions, methods, keywords, and utility functions
 * for use in expression autocomplete and validation.
 *
 * Descriptions are derived from Python official documentation.
 */

// Re-export types and data arrays
export type { PythonBuiltin, PythonMethod, PythonType } from './types'
export { PYTHON_BUILTINS } from './functions'
export { STRING_METHODS } from './string-methods'
export { LIST_METHODS } from './list-methods'
export { DICT_METHODS } from './dict-methods'
export { SET_METHODS } from './set-methods'
export { TABLE_METHODS } from './table-methods'
export { TABLE_FILTER_METHODS } from './table-filter-methods'
export { TABLE_TYPE_BUILTINS } from './table-types'

// Local imports for computed values and functions below
import type { PythonBuiltin, PythonMethod, PythonType } from './types'
import { PYTHON_BUILTINS } from './functions'
import { STRING_METHODS } from './string-methods'
import { LIST_METHODS } from './list-methods'
import { DICT_METHODS } from './dict-methods'
import { SET_METHODS } from './set-methods'
import { TABLE_METHODS } from './table-methods'
import { TABLE_FILTER_METHODS } from './table-filter-methods'
import { TABLE_TYPE_BUILTINS } from './table-types'
import {
  EXPRESSION_SAFE_NAMES,
  FIELD_BLOCKED_CONSTRUCTORS,
  MUTATING_METHOD_NAMES,
} from '../expression-sandbox'
import { expectedArgCount } from '../expression-validation/messages'

/**
 * All methods combined for easy lookup
 */
export const ALL_METHODS: PythonMethod[] = [
  ...STRING_METHODS,
  ...LIST_METHODS,
  ...DICT_METHODS,
  ...SET_METHODS,
  ...TABLE_METHODS,
  ...TABLE_FILTER_METHODS,
]

/**
 * Get methods applicable to a specific type
 */
export function getMethodsForType(
  typeName: string
): PythonMethod[] {
  // Map our type names to Python types
  const typeMapping: Record<string, PythonMethod['appliesTo'][number][]> = {
    string: ['str'],
    number: ['int', 'float'],
    boolean: [],
    object: ['dict'],
    array: ['list'],
    list: ['list'],
    dict: ['dict'],
    set: ['set'],
    str: ['str'],
    int: ['int'],
    float: ['float'],
    // WAVE specific types
    table: ['table'],  // Table has its own methods (row_count, col_count, cell, etc.)
    column: ['column'],  // The column step table.filter(column) returns
    map: ['dict'],     // Map is a dict
    integer: ['int'],
  }

  const pythonTypes = typeMapping[typeName] || []
  if (pythonTypes.length === 0) return []

  return ALL_METHODS.filter((method) => method.appliesTo.some((t) => pythonTypes.includes(t)))
}

/**
 * Python keywords that should be recognized but not suggested as functions
 */
export const PYTHON_KEYWORDS = [
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'True',
  'False',
  'None',
] as const

/**
 * Set for fast lookup
 */
export const PYTHON_KEYWORD_SET: Set<string> = new Set(PYTHON_KEYWORDS)
export const PYTHON_BUILTIN_NAMES = new Set(PYTHON_BUILTINS.map((b) => b.name))

/** The builtins an expression may call: exactly the sandbox's names (EXPRESSION_SAFE_NAMES). */
export const ALLOWED_BUILTINS = [...PYTHON_BUILTINS, ...TABLE_TYPE_BUILTINS].filter((b) =>
  EXPRESSION_SAFE_NAMES.has(b.name),
)

/** The Python builtins the sandbox leaves out: an expression that calls one is refused. */
export const BLOCKED_BUILTIN_NAMES: ReadonlySet<string> = new Set(
  PYTHON_BUILTINS.filter((b) => !EXPRESSION_SAFE_NAMES.has(b.name)).map((b) => b.name),
)

/**
 * Set of all known method names (for validation)
 */
export const ALLOWED_METHOD_NAMES = new Set(ALL_METHODS.map((m) => m.name))

/**
 * Get set of method names valid for a specific type (for fast validation lookup)
 */
export function getMethodNamesForType(typeName: string): Set<string> {
  const methods = getMethodsForType(typeName)
  return new Set(methods.map((m) => m.name))
}

/**
 * Get a method definition by name, optionally filtered by type
 */
export function getMethodByName(methodName: string, typeName?: string): PythonMethod | undefined {
  if (typeName) {
    const methods = getMethodsForType(typeName)
    return methods.find((m) => m.name === methodName)
  }
  return ALL_METHODS.find((m) => m.name === methodName)
}

/**
 * Get the return type of a method called on a given type.
 * Returns undefined if method not found or return type unknown.
 */
export function getMethodReturnType(methodName: string, calledOnType: string): PythonType | undefined {
  const method = getMethodByName(methodName, calledOnType)
  /* v8 ignore next - COV-DEF-052 */
  if (!method) return undefined
  // If explicit return type, use it; otherwise default to the first appliesTo type
  return method.returns ?? method.appliesTo[0]
}

/**
 * Get the argument count bounds for a method, optionally filtered by type.
 * Returns { min, max } where max is -1 for unlimited (*args).
 * Returns undefined if method not found.
 */
export function getMethodArgCounts(
  methodName: string,
  typeName?: string
): { min: number; max: number } | undefined {
  const method = getMethodByName(methodName, typeName)
  if (!method) return undefined
  return { min: method.minArgs, max: method.maxArgs }
}

/**
 * Validate the argument count for a method call.
 * Returns { valid: true } if the count is valid.
 * Returns { valid: false, expected: string } with a human-readable expected string if invalid.
 */
export function validateMethodArgCount(
  methodName: string,
  argCount: number,
  typeName?: string
): { valid: true } | { valid: false; expected: string } {
  const bounds = getMethodArgCounts(methodName, typeName)

  // Method not found - assume valid (can't validate what we don't know)
  if (!bounds) return { valid: true }

  const { min, max } = bounds

  // Unlimited args (-1)
  if (max === -1) {
    if (argCount >= min) {
      return { valid: true }
    /* v8 ignore start - COV-DEF-097: Currently no methods have minArgs > 0 with maxArgs = -1,
       so this else branch is unreachable with real data. Kept for completeness/future methods. */
    }
    return { valid: false, expected: expectedArgCount(min, max) }
  }
  /* v8 ignore stop */

  // Exact match required
  if (min === max) {
    if (argCount === min) {
      return { valid: true }
    }
    return { valid: false, expected: expectedArgCount(min, max) }
  }

  // Range
  if (argCount >= min && argCount <= max) {
    return { valid: true }
  }

  return { valid: false, expected: expectedArgCount(min, max) }
}

/**
 * Get the return type of a builtin function.
 * Returns undefined if function not found or return type unknown.
 */
export function getBuiltinReturnType(funcName: string): PythonType | undefined {
  const builtin = ALLOWED_BUILTINS.find((b) => b.name === funcName)
  return builtin?.returns
}

/**
 * Check if a name is a known Python identifier
 */
export function isPythonIdentifier(name: string): boolean {
  return PYTHON_KEYWORD_SET.has(name as (typeof PYTHON_KEYWORDS)[number]) || PYTHON_BUILTIN_NAMES.has(name)
}

/**
 * Get builtin by name
 */
export function getBuiltinByName(name: string): PythonBuiltin | undefined {
  return PYTHON_BUILTINS.find((b) => b.name === name)
}

// =============================================================================
// Field Expression Helpers (read-only context)
// =============================================================================

/** The builtins a field expression may call: the allowed ones less the field-blocked constructors. */
export const FIELD_ALLOWED_BUILTINS = ALLOWED_BUILTINS.filter((b) => !FIELD_BLOCKED_CONSTRUCTORS.has(b.name))

/**
 * Get methods allowed for a specific type in field expressions (read-only context).
 * Excludes mutating methods like append, pop, clear, etc.
 */
export function getFieldMethodsForType(typeName: string): PythonMethod[] {
  const methods = getMethodsForType(typeName)
  return methods.filter((m) => !MUTATING_METHOD_NAMES.has(m.name))
}

/**
 * Get set of method names valid for a specific type in field expressions.
 */
export function getFieldMethodNamesForType(typeName: string): Set<string> {
  const methods = getFieldMethodsForType(typeName)
  return new Set(methods.map((m) => m.name))
}

/**
 * All methods that are NOT blocked in field expressions
 */
export const FIELD_ALLOWED_METHODS = ALL_METHODS.filter((m) => !MUTATING_METHOD_NAMES.has(m.name))

/**
 * Set of all method names allowed in field expressions
 */
export const FIELD_ALLOWED_METHOD_NAMES = new Set(FIELD_ALLOWED_METHODS.map((m) => m.name))
