/**
 * Shared validation context for expression validation handlers.
 *
 * Provides the ValidationContext interface and factory function
 * used by all classification-specific validators.
 */

import {
  ALLOWED_BUILTINS,
  BLOCKED_BUILTIN_NAMES,
  FIELD_ALLOWED_BUILTINS,
} from '../python-builtins'
import { FIELD_BLOCKED_CONSTRUCTORS } from '@/features/workbench/lib/expression-sandbox'

// ============================================
// Shared context for validation handlers
// ============================================

export interface ValidationContext {
  availableVariableNames: Set<string>
  variableTypes?: Map<string, string>
  isFieldExpression?: boolean
  allowedBuiltinNames: Set<string>
  blockedBuiltinNames: Set<string>
  fieldBlockedBuiltinNames: Set<string>
}

/**
 * Build the validation context from parameters.
 */
export function buildValidationContext(
  availableVariableNames: Set<string>,
  variableTypes?: Map<string, string>,
  isFieldExpression?: boolean,
): ValidationContext {
  const builtins = isFieldExpression ? FIELD_ALLOWED_BUILTINS : ALLOWED_BUILTINS
  const allowedBuiltinNames = new Set(builtins.map((b) => b.name))
  const blockedBuiltinNames = new Set(BLOCKED_BUILTIN_NAMES)
  const fieldBlockedBuiltinNames = isFieldExpression
    ? new Set(FIELD_BLOCKED_CONSTRUCTORS)
    : new Set<string>()

  return {
    availableVariableNames,
    variableTypes,
    isFieldExpression,
    allowedBuiltinNames,
    blockedBuiltinNames,
    fieldBlockedBuiltinNames,
  }
}
