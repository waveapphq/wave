/**
 * Validation handlers for identifier-based expression types.
 *
 * Handles:
 * - simple_variable: bare identifier (e.g., "my_var")
 * - method_call: variable with method chain (e.g., "my_var.upper()")
 */

import {
  ALLOWED_METHOD_NAMES,
  FIELD_ALLOWED_METHOD_NAMES,
  getMethodNamesForType,
  getFieldMethodNamesForType,
  getMethodReturnType,
  validateMethodArgCount,
} from '../python-builtins'

import {
  extractIdentifiers,
  extractMethodCalls,
} from '../ast-visitor'

import type { ValidationIssue } from './types'
import type { ExpressionType } from './syntax-checks'
import type { ValidationContext } from './validation-context'
import { PYTHON_STATEMENT_KEYWORDS, PYTHON_LITERALS } from './security'
import { findSimilarVariable } from './similarity'
import {
  invalidMethodMessage,
  methodArgCountMessage,
  unknownVariableMessage,
} from './messages'
import { validateBinaryOperations } from './type-inference'
import { isKnownIdentifier, collectLocalNames } from './validation-helpers'

// ============================================
// Simple variable validation
// ============================================

/**
 * Validate a simple variable expression (bare identifier).
 */
export function validateSimpleVariable(
  classification: Extract<ExpressionType, { type: 'simple_variable' }>,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check if it's a Python statement keyword (e.g., pass is invalid)
  // Note: True/False/None are valid expressions, so not flagged
  /* v8 ignore next 9 - COV-CTRL-019: Python keyword as variable name check */
  if (PYTHON_STATEMENT_KEYWORDS.has(classification.name)) {
    issues.push({
      type: 'invalid_function',
      from,
      to,
      message: `'${classification.name}' is a Python keyword and cannot be used as a variable`,
      identifier: classification.name,
    })
  } else if (
    !ctx.availableVariableNames.has(classification.name) &&
    !PYTHON_LITERALS.has(classification.name)
  ) {
    // Check if variable exists (skip Python literals like True/False/None)
    const suggestion = findSimilarVariable(classification.name, ctx.availableVariableNames)
    issues.push({
      type: 'unknown_variable',
      from,
      to,
      message: unknownVariableMessage(classification.name, suggestion),
      identifier: classification.name,
      suggestion,
    })
  }

  return issues
}

// ============================================
// Method call validation
// ============================================

/**
 * Check if the base variable of a method call is valid.
 * Returns an issue if the base is a keyword or unknown, or null if OK.
 */
function checkMethodCallBase(
  classification: Extract<ExpressionType, { type: 'method_call' }>,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  /* v8 ignore next 9 - COV-CTRL-020: Python keyword as method base check */
  if (PYTHON_STATEMENT_KEYWORDS.has(classification.base)) {
    return {
      type: 'invalid_function',
      from,
      to,
      message: `'${classification.base}' is a Python keyword and cannot be used as a variable`,
      identifier: classification.base,
    }
  }

  if (!ctx.availableVariableNames.has(classification.base)) {
    const suggestion = findSimilarVariable(classification.base, ctx.availableVariableNames)
    return {
      type: 'unknown_variable',
      from,
      to,
      message: unknownVariableMessage(classification.base, suggestion),
      identifier: classification.base,
      suggestion,
    }
  }

  return null
}

/**
 * Validate a single method call in the chain for validity, field-expression restrictions, and argument count.
 * Returns an issue if the method is invalid, or null if OK.
 */
function validateSingleMethodCall(
  methodName: string,
  argumentCount: number,
  currentType: string | undefined,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  const allowedMethods = currentType
    ? getMethodNamesForType(currentType)
    : ALLOWED_METHOD_NAMES

  if (!allowedMethods.has(methodName)) {
    return {
      type: 'invalid_function',
      from,
      to,
      message: invalidMethodMessage(methodName, currentType),
      identifier: methodName,
    }
  }

  if (ctx.isFieldExpression) {
    const fieldAllowed = currentType
      ? getFieldMethodNamesForType(currentType)
      : FIELD_ALLOWED_METHOD_NAMES
    if (!fieldAllowed.has(methodName)) {
      return {
        type: 'blocked_function',
        from,
        to,
        message: `Method '${methodName}' modifies data and is not allowed in field expressions`,
        identifier: methodName,
      }
    }
  }

  if (currentType) {
    const argValidation = validateMethodArgCount(methodName, argumentCount, currentType)
    if (!argValidation.valid) {
      return {
        type: 'invalid_function',
        from,
        to,
        message: methodArgCountMessage(methodName, argValidation.expected, argumentCount),
        identifier: methodName,
      }
    }
  }

  return null
}

/**
 * Validate the method chain on a method call expression.
 * Returns an issue if any method in the chain is invalid, or null if all are OK.
 */
function validateMethodChain(
  classification: Extract<ExpressionType, { type: 'method_call' }>,
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue | null {
  const astMethodCalls = extractMethodCalls(trimmed)

  const sortedMethodCalls = astMethodCalls
    /* v8 ignore next - COV-CTRL-014: Filter predicate branches for method chain processing */
    .filter(m => m.objectName === classification.base || m.chainDepth > 0)
    .sort((a, b) => a.chainDepth - b.chainDepth)

  let currentType = ctx.variableTypes?.get(classification.base)

  for (const methodCall of sortedMethodCalls) {
    const issue = validateSingleMethodCall(
      methodCall.methodName,
      methodCall.argumentCount,
      currentType,
      from,
      to,
      ctx,
    )
    if (issue) return issue

    if (currentType) {
      const returnType = getMethodReturnType(methodCall.methodName, currentType)
      currentType = returnType
    }
  }

  return null
}

/**
 * Validate identifiers in a method call expression against known variables and builtins.
 * Returns issues for any unknown identifiers (skipping the base variable).
 */
function validateMethodIdentifiers(
  classification: Extract<ExpressionType, { type: 'method_call' }>,
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const astIdentifiers = extractIdentifiers(trimmed)
  const { localVariables, kwargNames } = collectLocalNames(trimmed)
  const seenIdentifiers = new Set<string>()

  for (const idInfo of astIdentifiers) {
    const identifier = idInfo.name
    if (seenIdentifiers.has(identifier)) continue
    seenIdentifiers.add(identifier)

    if (identifier === classification.base) continue

    /* v8 ignore next - COV-CTRL-015: Local variable skip branch in interpolation validation */
    if (localVariables.has(identifier)) continue
    if (kwargNames.has(identifier)) continue

    if (!isKnownIdentifier(identifier, ctx)) {
      const suggestion = findSimilarVariable(identifier, ctx.availableVariableNames)
      issues.push({
        type: 'unknown_variable',
        from,
        to,
        message: unknownVariableMessage(identifier, suggestion),
        identifier,
        suggestion,
      })
    }
  }

  return issues
}

/**
 * Validate a method call expression (e.g., "my_var.upper().strip()").
 */
export function validateMethodCall(
  classification: Extract<ExpressionType, { type: 'method_call' }>,
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
): ValidationIssue[] {
  // Check base variable validity
  const baseIssue = checkMethodCallBase(classification, from, to, ctx)
  if (baseIssue) return [baseIssue]

  // Validate the method chain
  const chainIssue = validateMethodChain(classification, trimmed, from, to, ctx)
  if (chainIssue) return [chainIssue]

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

  // Validate identifiers
  return validateMethodIdentifiers(classification, trimmed, from, to, ctx)
}
