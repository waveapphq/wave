/**
 * Validation handler for function call expressions.
 *
 * Handles expressions like "len(my_var)", "sorted(data, key=lambda x: x)".
 */

import {
  extractFunctionCalls,
} from '../ast-visitor'

import type { ValidationIssue } from './types'
import type { ExpressionType } from './syntax-checks'
import type { ValidationContext } from './validation-context'
import { validateBinaryOperations } from './type-inference'
import { validateMethodCalls, validateIdentifiers } from './shared-validators'
import { unknownFunctionMessage } from './messages'

/**
 * Check if the top-level function name is blocked or unrecognized.
 * Returns a validation issue if the function is not allowed, or null if OK.
 */
function checkTopLevelFunction(
  funcName: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  if (ctx.blockedBuiltinNames.has(funcName)) {
    return {
      type: 'blocked_function',
      from,
      to,
      message: `Function '${funcName}' is not supported in expression context`,
      identifier: funcName,
    }
  }

  if (ctx.fieldBlockedBuiltinNames.has(funcName)) {
    return {
      type: 'blocked_function',
      from,
      to,
      message: `Function '${funcName}' creates mutable data and is not allowed in field expressions`,
      identifier: funcName,
    }
  }

  if (!ctx.allowedBuiltinNames.has(funcName)) {
    return {
      type: 'invalid_function',
      from,
      to,
      message: unknownFunctionMessage(funcName),
      identifier: funcName,
    }
  }

  return null
}

/**
 * Validate nested function calls inside the expression (excluding the outer call).
 * Returns a validation issue if a blocked or unrecognized nested function is found.
 */
function validateNestedFunctionCalls(
  trimmed: string,
  funcName: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  const astFunctionCalls = extractFunctionCalls(trimmed)
  for (const call of astFunctionCalls) {
    if (call.name === funcName && call.startIndex === 0) continue

    if (ctx.blockedBuiltinNames.has(call.name)) {
      return {
        type: 'blocked_function',
        from,
        to,
        message: `Function '${call.name}' is not supported in expression context`,
        identifier: call.name,
      }
    }
    /* v8 ignore next 10 - COV-CTRL-018: Invalid nested function in simple case */
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
 * Validate a function call expression (e.g., "len(my_var)").
 */
export function validateFunctionCall(
  classification: Extract<ExpressionType, { type: 'function_call' }>,
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue[] {
  const funcName = classification.name

  // Check if the top-level function is allowed
  const topLevelIssue = checkTopLevelFunction(funcName, from, to, ctx)
  if (topLevelIssue) return [topLevelIssue]

  // Validate nested function calls
  const nestedIssue = validateNestedFunctionCalls(trimmed, funcName, from, to, ctx)
  if (nestedIssue) return [nestedIssue]

  // Validate method calls (no arg count checking for function call expressions)
  /* v8 ignore next 2 - COV-CTRL-006: Invalid method handling in simple case */
  const methodIssue = validateMethodCalls(trimmed, from, to, ctx)
  if (methodIssue) return [methodIssue]

  // Type check binary operations if we have type information
  /* v8 ignore next 13 - COV-CTRL-008: Type validation block in simple case */
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

  // Validate identifiers (using 'Variable' label for function call expressions)
  return validateIdentifiers(trimmed, from, to, ctx, { identifierLabel: 'Variable' })
}
