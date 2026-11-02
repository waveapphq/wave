/**
 * Validation handler for complex expressions.
 *
 * Handles operators, comprehensions, nested expressions, and other
 * compound Python expressions that don't fit simple classification.
 */

import {
  extractFunctionCalls,
} from '../ast-visitor'

import type { ValidationIssue } from './types'
import type { ValidationContext } from './validation-context'
import { validateBinaryOperations } from './type-inference'
import { validateMethodCalls, validateIdentifiers } from './shared-validators'
import { unknownFunctionMessage } from './messages'

/**
 * Validate function calls in a complex expression.
 * Returns a validation issue if a blocked or unrecognized function is found.
 */
function validateComplexFunctionCalls(
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  const astFunctionCalls = extractFunctionCalls(trimmed)
  for (const call of astFunctionCalls) {
    /* v8 ignore next 10 - COV-CTRL-005: Blocked function handling in complex case (comprehensions with eval/exec) */
    if (ctx.blockedBuiltinNames.has(call.name)) {
      return {
        type: 'blocked_function',
        from,
        to,
        message: `Function '${call.name}' is not supported in expression context`,
        identifier: call.name,
      }
    }
    if (ctx.fieldBlockedBuiltinNames.has(call.name)) {
      return {
        type: 'blocked_function',
        from,
        to,
        message: `Function '${call.name}' creates mutable data and is not allowed in field expressions`,
        identifier: call.name,
      }
    }
    if (!ctx.allowedBuiltinNames.has(call.name)) {
      return {
        type: 'invalid_function',
        from,
        to,
        message: unknownFunctionMessage(call.name),
        identifier: call.name,
      }
    }
  }
  return null
}

/**
 * Validate a complex expression (operators, comprehensions, nested expressions).
 */
export function validateComplexExpression(
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue[] {
  // Validate function calls
  const funcIssue = validateComplexFunctionCalls(trimmed, from, to, ctx)
  if (funcIssue) return [funcIssue]

  // Validate method calls (with arg count checking for complex expressions)
  /* v8 ignore next 2 - COV-CTRL-001: Invalid method handling in complex case */
  const methodIssue = validateMethodCalls(trimmed, from, to, ctx, { checkArgCount: true })
  if (methodIssue) return [methodIssue]

  // Type check binary operations if we have type information
  if (ctx.variableTypes && ctx.variableTypes.size > 0) {
    const typeError = validateBinaryOperations(trimmed, ctx.availableVariableNames, ctx.variableTypes)
    if (typeError) {
      return [{
        type: 'invalid_function',
        from,
        to,
        message: typeError,
        identifier: 'type',
      }]
    }
  }

  // Validate identifiers (using 'Identifier' label for complex expressions)
  return validateIdentifiers(trimmed, from, to, ctx, { identifierLabel: 'Identifier' })
}
