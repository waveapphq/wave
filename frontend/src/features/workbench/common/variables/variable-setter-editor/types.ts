/**
 * Variable Setter Editor - Types and Constants
 *
 * Shared type definitions and constants for the variable setter editor.
 * Design decisions: VARSET-1 through VARSET-11
 */

import type { ElementTypes } from '@/lib/variable-validation'

export const VARIABLE_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
  { value: 'map', label: 'Map' },
  { value: 'table', label: 'Table' },
] as const

/** One Setter row as the editor holds it; its flags are written to the `variables.<row>` places. */
export interface VariableRow {
  key: string // stable key for React rendering
  name: string
  /** `undefined` only for a literal dropped at open because it no longer fit its variable (FNCFG-9). */
  value: unknown
  /** The declared variable's type, else the type picked for a new target (never stored on the Block). */
  type: string
  isExpression: boolean
  /** A text row held as a Template (never with isExpression). */
  isTemplate?: boolean
  /** A secret-flagged target: the value is sealed at rest and masked write-only (SECUI-2). */
  isSecret?: boolean
  /** First-level entries held as {x}: a list index as text or a map key. */
  entryExpressions?: readonly string[]
  /** An array / map literal's declared element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** A row's name and value messages; `null` where that part is valid. */
export interface RowProblems {
  name: string | null
  value: string | null
}

export interface AvailableVariable {
  name: string
  type: string
  /**
   * Origin of the variable (e.g., "Profile: staging", "System", "Suite",
   * "Regression"). Used to distinguish read-only references (profile aliases,
   * namespaces) from user-settable variables.
   */
  source?: string
}

/** The Block lists the Setter reads and writes; `rowTypes` is window state for new targets, never stored. */
export interface SetterSlots {
  variables: Record<string, unknown>
  expressionFields: string[]
  templateFields: string[]
  elementTypes: Record<string, ElementTypes>
  secretFields: string[]
  rowTypes: Record<string, string>
}
