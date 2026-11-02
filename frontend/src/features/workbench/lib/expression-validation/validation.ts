/**
 * Expression Validation Utility
 *
 * Validates Python expressions for variable/function correctness to detect:
 * - Unknown variables (not in the available variables list)
 * - Invalid or blocked functions (not in ALLOWED_BUILTINS or in blocked list)
 */

import {
  isInitialized,
  getParser,
} from '../tree-sitter-init'

import type { ValidationIssue } from './types'
import { PYTHON_STATEMENT_KEYWORDS, isBlocked } from './security'
import { classifyExpression, findInvalidSyntax, isInvalidNumericMethodCall, findInvalidStringOperation } from './syntax-checks'
import { buildValidationContext } from './validation-context'
import { validateSimpleVariable, validateMethodCall } from './validate-identifiers'
import { validateFunctionCall } from './validate-function-call'
import { validateComplexExpression } from './validate-complex'

/**
 * Validate a raw Python expression
 *
 * @param value - The raw Python expression string
 * @param availableVariableNames - Set of available variable names for O(1) lookup
 * @param variableTypes - Optional Map of variable names to their types for type-aware validation
 * @param isFieldExpression - If true, block mutating methods and constructors (read-only field context)
 * @returns Array of validation issues with positions
 */
/** Run pre-classification checks and return an issue if one is found, or null to continue */
function runPreChecks(
  trimmed: string,
  from: number,
  to: number,
): ValidationIssue | null {
  const syntaxError = findInvalidSyntax(trimmed)
  if (syntaxError) {
    return { type: 'invalid_function', from, to, message: syntaxError, identifier: 'syntax' }
  }

  if (isInvalidNumericMethodCall(trimmed)) {
    return {
      type: 'invalid_function', from, to,
      message: 'Numbers cannot have methods - use a variable instead',
      identifier: trimmed.split('.')[0],
    }
  }

  const stringOpError = findInvalidStringOperation(trimmed)
  if (stringOpError) {
    return { type: 'invalid_function', from, to, message: stringOpError, identifier: 'string' }
  }

  const blockedPattern = isBlocked(trimmed)
  if (blockedPattern) {
    return {
      type: 'blocked_function', from, to,
      message: `Function '${blockedPattern}' is not supported in expression context`,
      identifier: blockedPattern,
    }
  }

  const firstWord = trimmed.split(/[.\s([\]]/)[0]
  if (PYTHON_STATEMENT_KEYWORDS.has(firstWord)) {
    return {
      type: 'invalid_function', from, to,
      message: `'${firstWord}' is a Python keyword and cannot be used as a variable`,
      identifier: firstWord,
    }
  }

  const parser = getParser()
  if (parser) {
    const tree = parser.parse(trimmed)
    if (tree.rootNode.hasError) {
      return { type: 'invalid_function', from, to, message: 'Invalid Python syntax', identifier: 'syntax' }
    }
  }

  return null
}

/** Validate a classified expression and return issues */
function validateClassified(
  trimmed: string,
  from: number,
  to: number,
  ctx: ReturnType<typeof buildValidationContext>,
): ValidationIssue[] {
  const classification = classifyExpression(trimmed)

  switch (classification.type) {
    case 'simple_variable':
      return validateSimpleVariable(classification, from, to, ctx)
    case 'method_call':
      return validateMethodCall(classification, trimmed, from, to, ctx)
    case 'function_call':
      return validateFunctionCall(classification, trimmed, from, to, ctx)
    case 'complex':
      return validateComplexExpression(trimmed, from, to, ctx)
  }
}

export function validateExpressions(
  value: string,
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>,
  isFieldExpression?: boolean,
): ValidationIssue[] {
  if (!isInitialized()) return []
  if (!value.trim()) return []

  const issues: ValidationIssue[] = []
  const expressions = [{ content: value, from: 0, to: value.length, contentFrom: 0, contentTo: value.length }]
  const ctx = buildValidationContext(availableVariableNames, variableTypes, isFieldExpression)

  for (const expr of expressions) {
    const { content, from, to } = expr
    const trimmed = content.trim()

    const preCheckIssue = runPreChecks(trimmed, from, to)
    if (preCheckIssue) {
      issues.push(preCheckIssue)
      continue
    }

    issues.push(...validateClassified(trimmed, from, to, ctx))
  }

  return issues
}

/**
 * Check if a value has any validation issues
 */
export function hasValidationIssues(
  value: string,
  availableVariableNames: Set<string>
): boolean {
  return validateExpressions(value, availableVariableNames).length > 0
}
