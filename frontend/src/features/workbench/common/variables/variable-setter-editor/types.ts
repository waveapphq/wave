/**
 * Variable Setter Editor - Types and Constants
 *
 * Shared type definitions and constants for the variable setter editor.
 * Design decisions: VARSET-1 through VARSET-10
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import type { ElementTypes } from '@/lib/variable-validation'

export { VARIABLE_NAME_PATTERN } from '@/lib/field-constraints'

export const VARIABLE_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
  { value: 'map', label: 'Map' },
  { value: 'table', label: 'Table' },
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariableRow {
  key: string // stable key for React rendering
  name: string
  value: unknown
  type: string
  isExpression: boolean
  /** A string row whose value is a {{ }} template (mutually exclusive with
   *  isExpression). Optional so external row constructors may omit it. */
  isTemplate?: boolean
  /** A secret-flagged target: the value is sealed at rest and masked write-only
   *  (SECUI-2). Rides variableSecretKeys, mirroring isExpression/isTemplate. */
  isSecret?: boolean
  /** An array / map literal's declared element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** A row's check: the first problem and the field it is about (`null` when the row is valid). */
export interface RowValidation {
  error: string | null
  field: 'name' | 'value' | null
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

export interface VariableSetterEditorProps {
  variables: Record<string, unknown>
  expressionKeys: string[]
  templateKeys: string[]
  secretKeys: string[]
  variableTypes: Record<string, string>
  /** Each array / map literal row's declared element types (REQ-3.1.3.19). */
  variableElementTypes?: Record<string, ElementTypes>
  availableVariables: AvailableVariable[]
  onVariablesChange: (variables: Record<string, unknown>) => void
  onExpressionKeysChange: (keys: string[]) => void
  onTemplateKeysChange: (keys: string[]) => void
  onSecretKeysChange: (keys: string[]) => void
  onTypesChange: (types: Record<string, string>) => void
  onElementTypesChange?: (types: Record<string, ElementTypes>) => void
  onValidChange?: (valid: boolean) => void
}
