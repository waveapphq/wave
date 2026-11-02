/**
 * Security checks for expression validation.
 *
 * The blocked patterns are the backend sandbox's own lists (expression-sandbox.ts).
 */

import { BLOCKED_FUNCTION_NAMES, BLOCKED_SUBSTRINGS } from '@/features/workbench/lib/expression-sandbox'

/**
 * Python statement keywords that cannot be used as expressions.
 * Note: True, False, None are valid expressions so not included here.
 */
export const PYTHON_STATEMENT_KEYWORDS = new Set([
  'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'nonlocal',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

/**
 * Python literals that are valid as standalone expressions.
 */
export const PYTHON_LITERALS = new Set(['True', 'False', 'None'])

/**
 * Check if an expression contains blocked patterns.
 *
 * Uses two types of matching:
 * 1. Substring matching for patterns dangerous in any context (e.g., "__")
 * 2. Function call matching for function names - allows variable names
 *    like 'file_path', 'exit_code', 'open_connection'
 */
export function isBlocked(expression: string): string | null {
  const lowerExpr = expression.toLowerCase()

  // Check substring patterns (dangerous in any context)
  for (const pattern of BLOCKED_SUBSTRINGS) {
    if (lowerExpr.includes(pattern)) {
      return pattern
    }
  }

  // Check function names - only block actual function calls
  // Match: word boundary + name + optional whitespace + opening paren
  for (const name of BLOCKED_FUNCTION_NAMES) {
    const regex = new RegExp(String.raw`\b${name}\s*\(`, 'i')
    if (regex.test(lowerExpr)) {
      return name
    }
  }

  return null
}
