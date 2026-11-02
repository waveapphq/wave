/**
 * Type Inference Module
 *
 * Shared type inference functions used by both the inline expression editor
 * (CodeMirror) and the modal expression editor for autocomplete support.
 *
 * This module provides:
 * - Signature parsing for smart cursor placement
 * - WAVE-to-Python type mappings
 * - Expression type inference (literals, variables, function calls)
 * - Method chain type tracing
 *
 * It has no dependencies on CodeMirror - it is pure TypeScript logic.
 */

import { getBuiltinReturnType, getMethodReturnType, type PythonType } from '@/features/workbench/lib/python-builtins'

// ============================================
// Types
// ============================================

/**
 * Represents a variable available in the expression context.
 * Used for type inference and autocomplete.
 */
export interface AvailableVariable {
  name: string
  type: string
  description?: string
  /** Where the variable comes from - an element name for an output binding,
   *  otherwise a scope label such as "System Variables" or "Profile: staging" */
  source?: string
  /** A node output writes this variable. The only thing the picker's OUT badge
   *  means; a `source` alone is just a label. */
  isOutputBinding?: boolean
  /** The variable is secret-flagged (drives the credential-field status icon) */
  isSecret?: boolean
}

// ============================================
// Signature Parsing
// ============================================

/**
 * Parse a function/method signature to determine if it has required parameters.
 * Used for smart cursor placement: if required params exist, cursor goes inside
 * parens; otherwise cursor goes after closing paren.
 *
 * Examples:
 * - "abs(x)" -> true (x is required)
 * - ".upper()" -> false (no params)
 * - ".strip(chars=None)" -> false (all optional)
 * - "round(number, ndigits=None)" -> true (number is required)
 * - "print(*args, **kwargs)" -> false (*args are variadic, not required)
 * - "abs()" -> false (empty parens)
 * - "no_parens" -> false (no match)
 */
export function hasRequiredParams(signature: string): boolean {
  // Extract content between parens
  const openIdx = signature.indexOf('(')
  if (openIdx === -1) return false
  const closeIdx = signature.indexOf(')', openIdx + 1)
  /* v8 ignore next - COV-DEF-107 */
  if (closeIdx === -1) return false

  const paramsStr = signature.slice(openIdx + 1, closeIdx).trim()
  if (!paramsStr) return false // empty parens

  // Split by comma and check each param
  const params = paramsStr.split(',').map((p) => p.trim())

  for (const param of params) {
    // Skip *args and **kwargs
    if (param.startsWith('*')) continue
    // If param has no default (no '='), it's required
    if (!param.includes('=')) return true
  }

  return false
}

// ============================================
// Type Mappings
// ============================================

/**
 * Map WAVE variable types to Python types.
 * Used for type-aware autocomplete and method suggestions.
 */
export const WAVE_TO_PYTHON: Record<string, PythonType> = {
  string: 'str',
  integer: 'int',
  float: 'float',
  boolean: 'bool',
  array: 'list',
  map: 'dict',
  table: 'table',
}

/**
 * Map WAVE/general types to Python type hint strings for display.
 * Returns 'Any' for unrecognized types.
 */
export function mapTypeToPython(type: string): string {
  const typeMap: Record<string, string> = {
    string: 'str',
    integer: 'int',
    float: 'float',
    number: 'int | float',
    boolean: 'bool',
    object: 'dict',
    array: 'list',
    list: 'list',
    dict: 'dict',
    map: 'dict',
    table: 'list[dict]',
  }
  return typeMap[type] || 'Any'
}

// ============================================
// Expression Type Inference
// ============================================

/**
 * Infer the Python type of an expression.
 * Handles: string/number literals, list/dict literals, function calls, and variable references.
 * Returns undefined if the type cannot be determined.
 */
export function inferExpressionType(
  expr: string,
  variables: AvailableVariable[]
): PythonType | undefined {
  const trimmed = expr.trim()

  // String literal: 'text' or "text"
  if (/^(['"]).*\1$/.test(trimmed)) return 'str'

  // Integer literal
  if (/^\d+$/.test(trimmed)) return 'int'

  // Float literal
  if (/^\d+\.\d+$/.test(trimmed)) return 'float'

  // List literal: [...]
  if (/^\[.*\]$/.test(trimmed)) return 'list'

  // Dict literal: {...}
  if (/^\{.*\}$/.test(trimmed)) return 'dict'

  // Function call: func(...)
  const funcMatch = /^(\w+)\(.*\)$/.exec(trimmed)
  if (funcMatch) return getBuiltinReturnType(funcMatch[1])

  // Variable reference
  const variable = variables.find((v) => v.name === trimmed)
  if (variable) return WAVE_TO_PYTHON[variable.type] || (variable.type as PythonType)

  return undefined
}

// ============================================
// Method Chain Type Tracing
// ============================================

/** Infer the type of a literal or function call expression (no dots) */
function inferSimpleType(trimmed: string): PythonType | undefined {
  if (/^(['"]).*\1$/.test(trimmed)) return 'str'
  if (/^\d+(\.\d+)?$/.test(trimmed)) return undefined // Numbers - no useful methods
  if (/^\[.*\]$/.test(trimmed)) return 'list'
  if (/^\{.*\}$/.test(trimmed)) return 'dict'
  const funcMatch = /^(\w+)\(.*\)$/.exec(trimmed)
  if (funcMatch) return getBuiltinReturnType(funcMatch[1])
  return undefined
}

/** Trace a method chain (a.b().c()) to determine the final type */
function traceMethodChain(
  parts: string[],
  variables: AvailableVariable[],
): PythonType | undefined {
  const base = parts[0].trim()
  const baseFuncMatch = /^(\w+)\(.*\)$/.exec(base)
  let currentType: PythonType | undefined = baseFuncMatch
    ? getBuiltinReturnType(baseFuncMatch[1])
    : inferExpressionType(base, variables)

  for (let i = 1; i < parts.length && currentType; i++) {
    const part = parts[i].trim()
    const methodMatch = /^(\w+)\(.*\)$/.exec(part)
    currentType = methodMatch
      ? getMethodReturnType(methodMatch[1], currentType)
      : undefined // Property access without () - can't determine type
  }

  return currentType
}

/** Bare Python type name lookup (e.g. str., list., dict.) */
const BARE_TYPE_MAP: Record<string, PythonType> = {
  str: 'str',
  list: 'list',
  dict: 'dict',
  set: 'set',
}

/**
 * Determine the type of the expression before a dot for method completion.
 * Handles: variables, literals, function calls, method chains, and bare type names.
 * Returns undefined for things that have no methods (numbers, None, unknown).
 */
export function getTypeBeforeDot(
  beforeDot: string,
  variables: AvailableVariable[]
): PythonType | undefined {
  const trimmed = beforeDot.trim()

  // Literal or function call
  const simpleType = inferSimpleType(trimmed)
  if (simpleType !== undefined) return simpleType

  // Method chain: something.method().method()
  if (trimmed.includes('.')) {
    return traceMethodChain(trimmed.split('.'), variables)
  }

  // Simple variable
  const variable = variables.find((v) => v.name === trimmed)
  if (variable) return WAVE_TO_PYTHON[variable.type] || (variable.type as PythonType)

  // Bare Python type name
  return BARE_TYPE_MAP[trimmed]
}
