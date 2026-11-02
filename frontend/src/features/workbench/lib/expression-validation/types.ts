/**
 * Types for expression validation.
 */

/** `not_validated` means the parser never loaded, so nothing was checked. */
export type ValidationIssueType =
  | 'unknown_variable'
  | 'invalid_function'
  | 'blocked_function'
  | 'not_validated'

export interface ValidationIssue {
  type: ValidationIssueType
  from: number
  to: number
  message: string
  identifier: string
  suggestion?: string // Suggested fix (e.g., similar variable name)
}
