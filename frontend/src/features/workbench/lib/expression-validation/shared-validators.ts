/**
 * Shared Validators for Expression Validation
 *
 * Common validation logic for method calls and identifiers, used by both
 * validate-complex.ts and validate-function-call.ts to avoid duplication.
 */

import {
  ALLOWED_METHOD_NAMES,
  FIELD_ALLOWED_METHOD_NAMES,
  validateMethodArgCount,
} from '../python-builtins'

import {
  extractIdentifiers,
  extractMethodCalls,
} from '../ast-visitor'

import type { ValidationIssue } from './types'
import type { ValidationContext } from './validation-context'
import { findSimilarVariable } from './similarity'
import {
  invalidMethodMessage,
  methodArgCountMessage,
  unknownVariableMessage,
} from './messages'
import { isKnownIdentifier, collectLocalNames } from './validation-helpers'

/**
 * Validate method calls in an expression against allowed method names.
 *
 * @param options.checkArgCount - If true, validate method argument counts (used by complex expressions)
 */
export function validateMethodCalls(
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
  options?: { checkArgCount?: boolean },
): ValidationIssue | null {
  const astMethodCalls = extractMethodCalls(trimmed)
  for (const method of astMethodCalls) {
    if (!ALLOWED_METHOD_NAMES.has(method.methodName)) {
      return {
        type: 'invalid_function',
        from,
        to,
        message: invalidMethodMessage(method.methodName),
        identifier: method.methodName,
      }
    }
    if (ctx.isFieldExpression && !FIELD_ALLOWED_METHOD_NAMES.has(method.methodName)) {
      return {
        type: 'blocked_function',
        from,
        to,
        message: `Method '${method.methodName}' modifies data and is not allowed in field expressions`,
        identifier: method.methodName,
      }
    }
    if (options?.checkArgCount) {
      const argValidation = validateMethodArgCount(method.methodName, method.argumentCount)
      if (!argValidation.valid) {
        return {
          type: 'invalid_function',
          from,
          to,
          message: methodArgCountMessage(method.methodName, argValidation.expected, method.argumentCount),
          identifier: method.methodName,
        }
      }
    }
  }
  return null
}

/**
 * Validate identifiers in an expression against known variables and builtins.
 *
 * @param options.identifierLabel - Label used in error messages (default: 'Identifier')
 */
export function validateIdentifiers(
  trimmed: string,
  from: number,
  to: number,
  ctx: ValidationContext,
  options?: { identifierLabel?: string },
): ValidationIssue[] {
  const label = options?.identifierLabel ?? 'Identifier'
  const issues: ValidationIssue[] = []
  const astIdentifiers = extractIdentifiers(trimmed)
  const seenIdentifiers = new Set<string>()
  const { localVariables, kwargNames } = collectLocalNames(trimmed)

  for (const idInfo of astIdentifiers) {
    const identifier = idInfo.name

    if (seenIdentifiers.has(identifier)) continue
    seenIdentifiers.add(identifier)

    if (localVariables.has(identifier)) continue
    if (kwargNames.has(identifier)) continue

    if (!isKnownIdentifier(identifier, ctx)) {
      const suggestion = findSimilarVariable(identifier, ctx.availableVariableNames)
      issues.push({
        type: 'unknown_variable',
        from,
        to,
        message: unknownVariableMessage(identifier, suggestion, label),
        identifier,
        suggestion,
      })
    }
  }

  return issues
}
