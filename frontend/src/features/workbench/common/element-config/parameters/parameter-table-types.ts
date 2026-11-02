/**
 * Parameter table types, constants, and utility functions.
 *
 * Shared across OutputBindingCombobox, ParameterRow,
 * and the main ParameterTable component.
 */

import { safeStringify } from '@/lib/utils'
import type {
  GroupMeta,
  InputParam,
} from '@/features/workbench/lib/node-parameters/types'
import type { GeneratedMapRow } from '@/components/shared/variable-bodies/map-edit-body'
import type { AvailableVariable } from '../expressions/expression-field'
import type { ScriptEditorProps } from './parameter-value-inputs'
import type { ElementTypes } from '@/lib/variable-validation'
import type { SecretSaveTarget } from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'

/** The table's param row schema: the shared InputParam shape minus the lib-only
 *  validation rules, with selectableType options widened to plain strings. */
export type Parameter = Omit<InputParam, 'notAbove' | 'selectableType'> & {
  /** When present, the Type column renders a dropdown instead of static text */
  selectableType?: { options: string[] }
}

/** A header the node config would generate but currently does not, with the
 *  advisory message the editor's amber stripe shows for it. */
export interface MissingHeaderAdvisory {
  key: string
  message: string
}

/** Generated-row + advisory extras threaded onto one map param's editor. */
export interface MapParamExtras {
  generatedRows: GeneratedMapRow[]
  missingHeaderAdvisories: MissingHeaderAdvisory[]
}

export interface ValidationState {
  isValid: boolean
  errors: Record<string, string>
}

export interface ParameterTableProps {
  mode: 'input' | 'output'
  parameters: Parameter[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  onValidationChange?: (state: ValidationState) => void
  availableVariables: AvailableVariable[]
  /** Per-field error messages (keyed by parameter name) */
  fieldErrors?: Record<string, string>
  /** Parameter names currently in expression mode (controlled externally) */
  expressionFields?: string[]
  /** Called when expression mode changes for any parameter */
  onExpressionFieldsChange?: (fields: string[]) => void
  /** Parameter names currently in template mode (controlled externally) */
  templateFields?: string[]
  /** Called when template mode changes for any parameter */
  onTemplateFieldsChange?: (fields: string[]) => void
  /** Per-group header description + default expansion, keyed by group name */
  groupMeta?: Record<string, GroupMeta>
  /** Output mode only: output names whose bound variable is secret (SECUI-3/4). */
  secretFields?: string[]
  /** Output mode only: called when an output's Secret checkbox toggles. */
  onSecretFieldsChange?: (fields: string[]) => void
  /** Plugin credential-key catalog for map-entry advisories (lowercase keys). */
  credentialCatalogKeys?: string[]
  /** Generated-row + advisory extras per map param name. */
  mapExtras?: Record<string, MapParamExtras>
  /** The block runs on the execution host: no Browse. */
  runsOnRemoteHost?: boolean
  /** Read-only canvas: rows show no Browse. */
  readOnly?: boolean
  /** The open test, for the file-reference picker; null while the test is unsaved. */
  testId?: string | null
  /** Python and SQL blocks only: what their script body carries into the editor sheet. */
  scriptEditor?: ScriptEditorProps
  /** Typed map settings: each one's element types, and their change sink (REQ-3.1.3.19). */
  elementTypes?: Partial<Record<string, ElementTypes>>
  onElementTypesChange?: (name: string, types: ElementTypes | undefined) => void
  /** What saving seals a credential typed in a row: the Test, or the Function a View shows. */
  secretSaveTarget?: SecretSaveTarget
}

// Stable references to avoid re-triggering useEffect in editor modals
export const EMPTY_MAP: Record<string, string> = {}
export const EMPTY_ARRAY: unknown[] = []

/** The name a row shows: its label, else its wire name. */
export function parameterLabel(parameter: Pick<Parameter, 'name' | 'label'>): string {
  return parameter.label ?? parameter.name
}

/**
 * Validate that a string is a well-formed http:// or https:// URL.
 */
export function isValidUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

/** The default an unset field reads: its visible descriptor's, else its first descriptor's (SQL-8). */
function unsetFieldDefault(
  field: string,
  values: Record<string, unknown>,
  allParameters: Parameter[]
): unknown {
  const named = allParameters.filter((p) => p.name === field)
  if (named.length < 2) return named[0]?.defaultValue
  const visible = named.filter((p) => isParameterVisible(p, values, allParameters))
  return (visible.length === 1 ? visible[0] : named[0]).defaultValue
}

/** One showWhen/requiredWhen-style condition, resolved through enum defaults. */
export function matchesCondition(
  condition: { field: string; values: string[] },
  values: Record<string, unknown>,
  allParameters?: Parameter[]
): boolean {
  let raw = values[condition.field]
  if (raw === undefined && allParameters) {
    raw = unsetFieldDefault(condition.field, values, allParameters)
  }
  /* v8 ignore next - COV-BRANCH-110 */
  const fieldValue = safeStringify(raw)
  return condition.values.includes(fieldValue)
}

/** The visibility gates an input row or an output row can carry. */
export type VisibilityGates = Pick<Parameter, 'showWhen' | 'showWhenAll' | 'showWhenAny'>

/**
 * Check if a parameter (or an output) should be visible based on its showWhen /
 * showWhenAll / showWhenAny conditions. When a referenced field has no explicit
 * value, falls back to its defaultValue from the allParameters list (needed for
 * freshly-created nodes).
 */
export function isParameterVisible(
  param: VisibilityGates,
  values: Record<string, unknown>,
  allParameters?: Parameter[]
): boolean {
  if (param.showWhen && !matchesCondition(param.showWhen, values, allParameters)) return false
  if (
    param.showWhenAny &&
    !param.showWhenAny.some((condition) => matchesCondition(condition, values, allParameters))
  ) {
    return false
  }
  if (param.showWhenAll) {
    return param.showWhenAll.every((condition) =>
      matchesCondition(condition, values, allParameters)
    )
  }
  return true
}

/**
 * When an enum param with `clampsSibling` changes, returns the sibling update
 * needed to keep it at-or-above / at-or-below the new value on the shared scale
 * (or null when the sibling is already in order). Both selects still offer every
 * option; the sibling is nudged only when a pick would invert the order.
 */
export function clampSibling(
  param: Parameter,
  newValue: unknown,
  values: Record<string, unknown>,
  allParameters?: Parameter[]
): { field: string; value: string } | null {
  const rule = param.clampsSibling
  if (!rule || !param.enumValues) return null
  const scale = param.enumValues.map(String)
  const newIndex = scale.indexOf(String(newValue))
  const siblingParam = allParameters?.find((p) => p.name === rule.field)
  const siblingRaw = values[rule.field] ?? siblingParam?.defaultValue
  const siblingIndex = scale.indexOf(String(siblingRaw))
  if (newIndex < 0 || siblingIndex < 0) return null
  const violates = rule.keep === 'atLeast' ? siblingIndex < newIndex : siblingIndex > newIndex
  return violates ? { field: rule.field, value: String(newValue) } : null
}

/**
 * Fields a boolean with `exclusiveWith` clears when it is set true; empty for
 * any other change, so unticking a row touches nothing.
 */
export function exclusiveClears(param: Parameter, newValue: unknown): string[] {
  if (!param.exclusiveWith || newValue !== true) return []
  return param.exclusiveWith
}

export interface ParameterGroup {
  name: string
  description?: string
  defaultExpanded?: boolean
  params: Parameter[]
}

/**
 * Derive ordered groups from parameters: ungrouped first, then named groups
 * preserving insertion order. Group meta (when provided) carries the footer
 * description, default expansion, and live summary formatter onto each group.
 */
export function deriveGroups(
  params: Parameter[],
  groupMeta?: Record<string, GroupMeta>
): { ungrouped: Parameter[]; groups: ParameterGroup[] } {
  const ungrouped: Parameter[] = []
  const groupMap = new Map<string, Parameter[]>()

  for (const param of params) {
    if (param.group) {
      const existing = groupMap.get(param.group)
      if (existing) {
        existing.push(param)
      } else {
        groupMap.set(param.group, [param])
      }
    } else {
      ungrouped.push(param)
    }
  }

  const groups = Array.from(groupMap.entries()).map(([name, params]) => ({
    name,
    description: groupMeta?.[name]?.description,
    defaultExpanded: groupMeta?.[name]?.defaultExpanded,
    params,
  }))

  return { ungrouped, groups }
}
