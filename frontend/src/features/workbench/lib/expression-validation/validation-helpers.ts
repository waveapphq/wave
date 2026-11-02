/**
 * Shared helper functions for expression validation handlers.
 *
 * These utilities are used by validate-complex.ts, validate-function-call.ts,
 * and validate-identifiers.ts to avoid code duplication.
 */

import {
  extractLocalScopes,
  extractKeywordArguments,
} from '../ast-visitor'

import type { ValidationContext } from './validation-context'

/** Check if an identifier is recognized by the validation context (variable, builtin, or blocked) */
export function isKnownIdentifier(identifier: string, ctx: ValidationContext): boolean {
  return ctx.availableVariableNames.has(identifier)
    || ctx.allowedBuiltinNames.has(identifier)
    || ctx.blockedBuiltinNames.has(identifier)
}

/** Collect local variable and keyword argument names from an expression for scope exclusion */
export function collectLocalNames(trimmed: string): { localVariables: Set<string>; kwargNames: Set<string> } {
  const astScopes = extractLocalScopes(trimmed)
  const localVariables = new Set<string>()
  for (const scope of astScopes) {
    for (const v of scope.variables) {
      localVariables.add(v)
    }
  }
  const astKwargs = extractKeywordArguments(trimmed)
  const kwargNames = new Set(astKwargs.map(k => k.name))
  return { localVariables, kwargNames }
}
