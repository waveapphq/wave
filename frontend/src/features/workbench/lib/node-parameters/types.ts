/**
 * Node Parameter Types and Factories
 *
 * Shared types, factories, and validation maps for node input and output
 * parameter schemas. Input parameters define configuration fields shown
 * in the node config modal. Output parameters define the named values a
 * node produces after execution, which can be bound to workflow variables.
 */

import type { QuickInsertMenu } from '@/lib/quick-inserts'
import type { VariableType } from '@/lib/variable-types'

// ---------------------------------------------------------------------------
// Input Parameters
// ---------------------------------------------------------------------------

/** Declarative key policy for a map param; messages ride as data so the editor
 *  and validators stay plugin-ignorant. Keys are canonical lowercase. */
export interface MapKeyPolicy {
  keyNoun: string
  caseInsensitive?: boolean
  blockedKeys?: Record<string, string>
  /** Keys must match this pattern, checked as saved and case-sensitively; `{key}` in the message */
  keyPattern?: { pattern: string; message: string }
  /** Keys may not start with these prefixes (case-sensitive); `{key}` in the message */
  blockedPrefixes?: { prefix: string; message: string }[]
}

/** An author-declared output list: each row names an extra output bound to one variable. */
export interface OutputListPolicy {
  nameHeading: string
  bindingHeading: string
  itemNoun: string
  addLabel: string
  namePattern: string
  /** Shown under the name field, which already shows the name. */
  nameRuleMessage: string
  /** Canvas issue messages; they carry the name through `{name}`. */
  invalidNameMessage: string
  clashMessage: string
  duplicateMessage: string
  /** Body parameter the row names must be assigned in; drives the unassigned-export warning. */
  assignedIn?: string
}

export interface OutputListRowState {
  name: string
  binding: string
  secret: boolean
  /** Edit-time only: the type a bound variable that does not exist yet is created with. */
  type: VariableType
}

export interface InputParam {
  name: string
  /** Human-readable display label (falls back to name if omitted) */
  label?: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  required: boolean
  description?: string
  defaultValue?: unknown
  /** Allowed values, typed by `type`: `1`, `2.5` or `'low'` (REQ-3.1.2.11). */
  enumValues?: Array<string | number>
  /** The field takes a whole null: an optional Function input with no default (REQ-3.1.3.21). */
  acceptsNull?: boolean
  showWhen?: { field: string; values: string[] }
  /** Visible only while EVERY condition matches (conjunctive showWhen). */
  showWhenAll?: { field: string; values: string[] }[]
  /** Visible while AT LEAST ONE condition matches (disjunctive showWhen). */
  showWhenAny?: { field: string; values: string[] }[]
  requiredWhen?: { field: string; values: string[] }
  /** Required only while EVERY condition matches (conjunctive requiredWhen). */
  requiredWhenAll?: { field: string; values: string[] }[]
  /** Exact message replacing the generic required-param error. */
  requiredMessage?: string
  group?: string
  /** Value is a secret: runtime masking applies to what the plugin receives */
  secret?: boolean
  /** Restrict the value editor's format selector to these formats. A single-element
   *  array LOCKS the editor to that format: the picker renders disabled and pinned,
   *  with no Auto / auto-detect. */
  allowedFormats?: string[]
  /** Hide the expression toggle for this parameter */
  noExpression?: boolean
  /** Variable reference selector - filters available variables by allowed types */
  variableRef?: { types: string[] }
  /** variableRef selectors only: reject free-text names; the value must name an
   *  existing (type-compatible) variable, chosen from the dropdown. */
  variableRefExistingOnly?: boolean
  /** When present, the Type column renders a dropdown with these options instead of static text.
   *  The selected type is stored in values as `{name}_type`. */
  selectableType?: { options: ParamType[] }
  /** Map params: declarative key policy (case-insensitive duplicates, blocked keys) */
  keyPolicy?: MapKeyPolicy
  /** Map params: scaffold menus rendered beside "+ Add entry" in the editor */
  quickInserts?: QuickInsertMenu[]
  /** Map params: one muted info line above the editor grid */
  editorNote?: string
  /** List and map params: each item carries one of the six element types, not text only
   *  (REQ-3.1.3.19); the types store beside the value. */
  typedValues?: boolean
  /** Static muted note line rendered under the param row while visible */
  note?: string
  /** Survive the hidden-param auto-clear in the draft; stripped at save */
  retainOnHide?: boolean
  /** Empty-state placeholder on the value affordance */
  placeholder?: string
  /** Enum value -> display label for the select trigger + menu */
  enumLabels?: Record<string, string>
  /** Enum value -> muted menu sublabel */
  enumSublabels?: Record<string, string>
  /** Presentation-only partition of the flat enumValues into headed sections */
  enumGroups?: { heading: string; values: string[] }[]
  /** Render the enum through the searchable picker instead of the plain select */
  enumSearchable?: boolean
  /** Map params: entries under the plugin's credential-key catalog get the
   *  value-based advisory treatment */
  credentialCatalog?: boolean
  /** Array params: edit through the multipart Parts editor sheet */
  partsEditor?: boolean
  /** Array params: edit through the TLS cipher-suite picker sheet */
  cipherPicker?: boolean
  /** Cipher Suites: the Block id the TLS capabilities payload keys its unset lists by. */
  cipherDefaultsBlock?: string
  /** Render disabled and forced to `value` while the referenced field matches */
  lockedWhen?: { field: string; values: string[]; value: unknown }
  /** Render disabled, reading `displayText`, while the block runs on a remote host; a Save there stores nothing */
  lockedOnRemoteHost?: { displayText: string }
  /** Boolean params: setting this row true sets each listed field false in the
   *  same change. Setting it false touches nothing; no row is disabled or hidden. */
  exclusiveWith?: string[]
  /** Numeric params: the lowest literal value the config form accepts */
  minimum?: number
  /** Numeric params: the highest literal value the config form accepts */
  maximum?: number
  /** Numeric params: the highest value is another row's value, with its own message */
  maximumField?: { field: string; message: string }
  /** Enum params: error when this value orders after `field` on the shared
   *  enumValues scale */
  notAbove?: { field: string; message: string }
  /** Enum params: when this field changes, clamp the referenced sibling on the
   *  shared enumValues scale so it stays at-or-above ('atLeast') or at-or-below
   *  ('atMost') this value (both selects still offer every option). */
  clampsSibling?: { field: string; keep: 'atMost' | 'atLeast' }
  /** String params: Browse opens the file-reference picker in this mode (TDATA-8) */
  fileReference?: 'file' | 'file-or-folder' | 'folder' | 'save-as'
  /** fileReference rows only: the picker offers Artifacts, never Test Data */
  fileReferenceArtifactsOnly?: boolean
  /** String params: amber in-field advisory when the value is JSON but no
   *  Content-Type header row exists */
  contentTypeAdvisory?: boolean
  /** Array params: edit inline as an ordered list of values or expressions; `entry`
   *  picks the literal entry editor (absent = a plain value field) */
  orderedList?: { itemNoun: string; positionPrefix: string; entry?: 'field' | 'stat' }
  /** Array params: the rows declare extra outputs, edited under Output Variables */
  outputList?: OutputListPolicy
  /** String params: the literal is an OpenSearch From / To time, edited through the time picker (OS-4) */
  timeValue?: true
  /** String params: the literal suggests the block's pulled fields or indexes (OS-13) */
  fieldSuggest?: FieldSuggestPolicy
  /** Opens in Template kind while the saved row is blank */
  templateByDefault?: true
  /** Amber note under the row; shown when it returns text and the row has no expression warning */
  rowNote?: (ctx: RowNoteContext) => string | null
}

/** What a `fieldSuggest` row offers: pulled fields (optionally of one kind) or indexes. */
export interface FieldSuggestPolicy {
  source: 'fields' | 'indexes'
  types?: 'date' | 'aggregatable' | 'numeric'
}

/** What a `rowNote` function reads: the row's value and mode, the sibling values, the clock. */
export interface RowNoteContext {
  value: unknown
  isExpression: boolean
  allValues: Record<string, unknown>
  now: Date
}

export type ParamType = InputParam['type']

/** Factory helper to reduce structural duplication in input parameter literals. */
export function param(
  name: string,
  label: string,
  type: ParamType,
  required: boolean,
  description: string,
  opts?: Omit<InputParam, 'name' | 'label' | 'type' | 'required' | 'description'>,
): InputParam {
  return { name, label, type, required, description, ...opts }
}

// ---------------------------------------------------------------------------
// Parameter Groups
// ---------------------------------------------------------------------------

export interface GroupMeta {
  name: string
  /** Compact muted footer note rendered inside the expanded group card */
  description?: string
  /** Render the group expanded on mount (groups default to collapsed) */
  defaultExpanded?: boolean
}

/** Factory helper to reduce structural duplication in group metadata literals. */
export function group(name: string, opts?: Omit<GroupMeta, 'name'>): GroupMeta {
  return { name, ...opts }
}

// ---------------------------------------------------------------------------
// Output Parameters
// ---------------------------------------------------------------------------

/** One condition inside an output type rule; same shape as showWhen. */
export interface OutputTypeCondition {
  field: string
  values: string[]
}

/** First rule whose EVERY condition matches decides the output's type. */
export interface OutputTypeRule {
  when: OutputTypeCondition[]
  type: ParamType
}

export interface OutputParam {
  name: string
  /** Human-readable display label (falls back to name if omitted) */
  label?: string
  type: string
  description?: string
  /** Offered for binding only while the referenced input field matches */
  showWhen?: { field: string; values: string[] }
  /** Offered for binding only while EVERY condition matches (conjunctive showWhen). */
  showWhenAll?: { field: string; values: string[] }[]
  /** This output's type follows other fields: first matching rule wins, else `type`. */
  typeWhen?: OutputTypeRule[]
  /** Schema-secret output: seeds the instance's Secret checkbox checked (K8SCON-4) */
  secret?: boolean
}

/** Factory helper to reduce structural duplication in output parameter literals. */
export function output(
  name: string,
  label: string,
  type: string,
  description: string,
  opts?: Omit<OutputParam, 'name' | 'label' | 'type' | 'description'>,
): OutputParam {
  return { name, label, type, description, ...opts }
}

/**
 * Maps output parameter types to workflow variable types.
 * Used when auto-creating variables from output bindings.
 */
export const PARAM_TYPE_TO_VAR_TYPE: Record<string, string> = {
  string: 'string',
  integer: 'integer',
  float: 'float',
  boolean: 'boolean',
  array: 'array',
  map: 'map',
  table: 'table',
}

/**
 * Map from output parameter type to compatible variable types.
 * Used by the output binding combobox filter and save-time validation.
 */
export const OUTPUT_TYPE_COMPAT: Record<string, Set<string>> = {
  string: new Set(['string']),
  integer: new Set(['integer']),
  float: new Set(['float', 'integer']),
  boolean: new Set(['boolean']),
  map: new Set(['map']),
  array: new Set(['array']),
  table: new Set(['table']),
}

export interface OutputBindingError {
  nodeLabel: string
  paramName: string
  paramType: string
  varName: string
  varType: string
}

// ---------------------------------------------------------------------------
// Secret Mask Fields
// ---------------------------------------------------------------------------

/**
 * A plugin-declared credential-bearing field the per-block Secret Masking
 * control can reveal. `key` is the canonical lowercase field identifier
 * (matches the backend authority, e.g. HTTP's _SENSITIVE_HEADERS); `label`
 * is the display form.
 */
export interface SecretMaskField {
  key: string
  label: string
}
