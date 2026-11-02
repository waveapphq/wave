/**
 * Variable Format Utilities
 *
 * Shared utility functions for formatting, truncating, and styling variable values.
 * Used by the workbench variable manager and suite variables display.
 */

import { isTableShape, toTableRenderModel } from '@/lib/variable-table-model'
import { VARIABLE_TYPES, type VariableType } from '@/lib/variable-types'
import { pluralize } from '@/lib/pluralize'
import { MASK_PLACEHOLDER, holdsSecretValue } from '@/lib/secret-envelope'
import { PLAIN_FLOAT, PLAIN_INTEGER, plainNumberText, sameNumber, type NumberType } from '@/lib/number-rule'

// ===========================================================================
// Types
// ===========================================================================

/** Render type of a value's OWN shape - drives per-cell tinting in complex bodies. */
export type RenderType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'null'

export const MAX_VALUE_LENGTH = 100

// ===========================================================================
// Null (REQ-3.1.3.20, VMGR-93)
// ===========================================================================

/** Text Muted: the one gray of a not-set default, null and `<empty string>` in both themes (FIELD-2, FIELD-4, FIELD-5). */
const TEXT_MUTED_CLASS = 'text-[color:var(--color-text-muted)]'

/** The one null look: Text Muted italic mono, no font size so it inherits its host's. */
export const NULL_LOOK_CLASS = `font-mono italic ${TEXT_MUTED_CLASS}`

/** A held default shown in place of an unset value: the gray of an input placeholder, never the disabled look (REQ-3.1.1.5). */
export const HELD_DEFAULT_LOOK_CLASS = TEXT_MUTED_CLASS

/** The pressed look of the null button that every {x} toggle shares, unchanged under the pointer (FIELD-1, FIELD-5). */
export const PRESSED_LOOK_CLASS = [
  // A variant's text-primary resolves the theme's --primary, so the app's --color-primary is named outright.
  'aria-pressed:bg-primary/10 aria-pressed:text-[color:var(--color-primary)]',
  'aria-pressed:hover:bg-primary/10 aria-pressed:hover:text-[color:var(--color-primary)]',
  // The data-state forms replace a Radix toggle's own pressed colors; a tooltip trigger never sets data-state to on.
  'data-[state=on]:bg-primary/10 data-[state=on]:text-[color:var(--color-primary)]',
  'data-[state=on]:hover:bg-primary/10 data-[state=on]:hover:text-[color:var(--color-primary)]',
].join(' ')

/** The word a null value shows as. */
export const NULL_TEXT = 'null'

/** The marker empty text shows as (FIELD-4). */
export const EMPTY_STRING_TEXT = '<empty string>'

/** The `<empty string>` look: Text Muted italic like null, and never selected with the text. */
export const EMPTY_STRING_LOOK_CLASS = `italic select-none ${TEXT_MUTED_CLASS}`

/** The IN / OUT badge colors of an input and an output, readable in both themes. */
export const ROLE_BADGE_CLASS: Record<'input' | 'output', string> = {
  input: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  output: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
}

/** A value is null when it is null or absent (no value key). */
export function isNullValue(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

// ===========================================================================
// Value Formatting
// ===========================================================================

function formatTableValue(value: unknown): string {
  // Handle push summary format {rows, cols}
  if (value && typeof value === 'object' && 'rows' in value && 'cols' in value) {
    const tableVal = value as { rows: number; cols: number }
    return `${tableVal.rows}\u00D7${tableVal.cols} table`
  }
  // Handle array format (list of objects or list of lists)
  if (Array.isArray(value)) {
    const rows = value.length
    const firstRow = value[0]
    const cols = getColumnCount(firstRow)
    return `${rows}\u00D7${cols} table`
  }
  if (isTableShape(value)) {
    const { columns, rows } = value as { columns: unknown[]; rows: unknown[] }
    return `${rows.length}\u00D7${columns.length} table`
  }
  return '0\u00D70 table'
}

function getColumnCount(firstRow: unknown): number {
  if (firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)) {
    return Object.keys(firstRow).length
  }
  if (Array.isArray(firstRow)) {
    return firstRow.length
  }
  return 0
}

/** Try to parse a string as JSON, return the original value if parsing fails */
function tryParse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isCountSummary(value: unknown): value is { count: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'count' in (value as Record<string, unknown>) &&
    typeof (value as { count: unknown }).count === 'number'
  )
}

function getArrayCount(value: unknown): number {
  if (isCountSummary(value)) return value.count
  const parsed = tryParse(value)
  return Array.isArray(parsed) ? parsed.length : 0
}

function formatArrayValue(value: unknown): string {
  // Runtime push envelope is {count, changed: true}; idle/local values
  // are real arrays. Both forms reduce to a count.
  const count = getArrayCount(value)
  return `[${count} ${count === 1 ? 'item' : 'items'}]`
}

function formatMapValue(value: unknown): string {
  if (isCountSummary(value)) {
    return `{${value.count} ${value.count === 1 ? 'key' : 'keys'}}`
  }
  const parsed = tryParse(value)
  const obj = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  const count = Object.keys(obj).length
  return `{${count} ${count === 1 ? 'key' : 'keys'}}`
}

/** A JSON number held as its exact source text, so writing it out again keeps every digit. */
export class JsonNumberText {
  constructor(readonly text: string) {}

  toString(): string {
    return this.text
  }
}

function isJsonContainer(value: object): boolean {
  if (Array.isArray(value)) return true
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function writePlainJson(value: unknown, space: string, pad: string): string | undefined {
  if (value instanceof JsonNumberText) return value.text
  if (typeof value === 'number') return Number.isFinite(value) ? plainNumberText(value) : 'null'
  if (value === null || typeof value !== 'object' || !isJsonContainer(value)) return JSON.stringify(value)
  const inner = pad + space
  const open = space === '' ? '' : `\n${inner}`
  const close = space === '' ? '' : `\n${pad}`
  const separator = space === '' ? ',' : `,\n${inner}`
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = Array.from(value, (item: unknown) => writePlainJson(item, space, inner) ?? 'null')
    return `[${open}${items.join(separator)}${close}]`
  }
  const colon = space === '' ? ':' : ': '
  const members = Object.entries(value).flatMap(([key, entry]) => {
    const text = writePlainJson(entry, space, inner)
    return text === undefined ? [] : [`${JSON.stringify(key)}${colon}${text}`]
  })
  if (members.length === 0) return '{}'
  return `{${open}${members.join(separator)}${close}}`
}

/** JSON text as JSON.stringify writes it, but every number in plain digits (never `1e+21`); `space` indents. */
export function plainJsonText(value: unknown, space = ''): string | undefined {
  return writePlainJson(value, space, '')
}

/** Text for a value in a string position: a number in plain digits, a map / list / table as
 *  compact JSON, never as "[object Object]". */
export function valueToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return plainNumberText(value)
  if (typeof value === 'boolean') return String(value)
  return plainJsonText(value) as string
}

/** The number type a value of no declared type reads as by its own shape: a whole JS number is an integer. */
export function numberShapeType(value: number): NumberType {
  return Number.isInteger(value) ? 'integer' : 'float'
}

function sameNumberForms(value: number, text: string): boolean {
  return Number.isFinite(value) && PLAIN_FLOAT.test(text) && sameNumber(value, text)
}

/** Two stored values are the same: equal JSON, or a JS number and the digit text of that exact number. */
export function sameStoredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left === 'number' && typeof right === 'string') return sameNumberForms(left, right)
  if (typeof left === 'string' && typeof right === 'number') return sameNumberForms(right, left)
  return JSON.stringify(left) === JSON.stringify(right)
}

export function formatValue(value: unknown, type: VariableType, isSecret?: boolean): string {
  // Null wins over the secret mask: there is no hidden value to claim.
  if (isNullValue(value)) return NULL_TEXT
  if (isSecret) return holdsSecretValue(value) ? MASK_PLACEHOLDER : ''

  switch (type) {
    case 'string':
      // The type is already shown (badge), so wrapping quotes would read as part
      // of the value. Render the raw string - any quotes in it are its own.
      return valueToText(value)
    case 'integer':
    case 'float':
    case 'boolean':
      return valueToText(value)
    case 'array':
      return formatArrayValue(value)
    case 'map':
      return formatMapValue(value)
    case 'table':
      return formatTableValue(tryParse(value))
    default:
      return valueToText(value)
  }
}

/** Footer metric shown while an expression watcher has no runtime value yet. */
export const METRIC_NO_VALUE_YET = 'no value yet'

/** Footer metric shown while the type-mismatch guard body is displayed. */
export const METRIC_TYPE_MISMATCH = 'type mismatch'

/** Footer metric for a displayed scalar value: "N chars" for strings, else null. */
export function formatScalarMetric(value: unknown, type: VariableType): string | null {
  if (isNullValue(value)) return null
  if (type === 'string') {
    const length = valueToText(value).length
    return `${length} ${compareUnit('string', length)}`
  }
  return null
}

/** True for the WS push summary shapes: array/map {count, changed} and table {rows, cols, changed}. */
export function isSummaryEnvelope(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  if (envelope.changed !== true) return false
  if (typeof envelope.count === 'number') return true
  return typeof envelope.rows === 'number' && typeof envelope.cols === 'number'
}


function getMapKeyCount(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0
  return Object.keys(value).length
}

function getTableCounts(value: unknown): { rows: number; cols: number } {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>
    if (typeof envelope.rows === 'number' && typeof envelope.cols === 'number') {
      return { rows: envelope.rows, cols: envelope.cols }
    }
  }
  const model = toTableRenderModel(value)
  return { rows: model.rows.length, cols: model.columns.length }
}

/**
 * Footer metric for the complex inspect bodies, identical in both views:
 * "N items" / "N keys" / "N rows x M cols" (U+00D7). Counts are readable
 * from the WS summary envelopes; scalar types and a null value return null.
 */
export function formatComplexMetric(value: unknown, type: VariableType): string | null {
  if (isNullValue(value)) return null
  switch (type) {
    case 'array':
      return pluralize(getArrayCount(value), 'item')
    case 'map':
      return pluralize(isCountSummary(value) ? value.count : getMapKeyCount(value), 'key')
    case 'table': {
      const { rows, cols } = getTableCounts(value)
      return `${pluralize(rows, 'row')} × ${pluralize(cols, 'col')}`
    }
    default:
      return null
  }
}

/** The countable types reaching the delta helpers - numeric/boolean are filtered out upstream. */
type CompareCountableType = Exclude<VariableType, 'integer' | 'float' | 'boolean'>

function compareCount(value: unknown, type: CompareCountableType): number | null {
  if (isNullValue(value)) return null
  switch (type) {
    case 'string':
      return valueToText(value).length
    case 'array':
      return getArrayCount(value)
    case 'map':
      return isCountSummary(value) ? value.count : getMapKeyCount(value)
    case 'table':
      return getTableCounts(value).rows
  }
}

function compareUnit(type: CompareCountableType, count: number): string {
  switch (type) {
    case 'string':
      return count === 1 ? 'char' : 'chars'
    case 'array':
      return count === 1 ? 'item' : 'items'
    case 'map':
      return count === 1 ? 'key' : 'keys'
    case 'table':
      return count === 1 ? 'row' : 'rows'
  }
}

/**
 * Footer delta metric for the inspect modal Compare mode: the Initial count, an
 * always-rendered arrow, then the Current count with the unit once at the end
 * ("2 -> 4 chars" / "3 -> 4 items" / "2 -> 3 keys" / "1 -> 3 rows"). Expression
 * watchers label the left side "expression"; an unevaluated one yields
 * "expression -> no value yet". A type-incompatible current value collapses to
 * the bare "type mismatch" (no arrow); summary envelopes are valid current
 * values. Numeric / boolean types carry no center metric (null).
 */
export function formatCompareMetric(
  initialValue: unknown,
  currentValue: unknown,
  type: VariableType,
  showingSourceLeft: boolean,
): string | null {
  if (showingSourceLeft && currentValue === undefined) {
    return `expression -> ${METRIC_NO_VALUE_YET}`
  }
  if (type === 'integer' || type === 'float' || type === 'boolean') {
    return typeof currentValue === 'object' && currentValue !== null
      ? METRIC_TYPE_MISMATCH
      : null
  }
  if (!isSummaryEnvelope(currentValue) && !valueMatchesType(currentValue, type)) {
    return METRIC_TYPE_MISMATCH
  }
  const currentCount = compareCount(currentValue, type)
  const currentPart =
    currentCount === null ? NULL_TEXT : `${currentCount} ${compareUnit(type, currentCount)}`
  const initialPart = showingSourceLeft
    ? 'expression'
    : String(compareCount(initialValue, type) ?? NULL_TEXT)
  return `${initialPart} -> ${currentPart}`
}

export function inferRenderType(value: unknown): RenderType {
  if (isNullValue(value)) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return numberShapeType(value)
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'map'
  return 'string'
}

/** Per-cell tint class by render type; a null item takes the one null look (VMGR-93). */
export function getCellColorClass(type: RenderType): string {
  if (type === 'null') return NULL_LOOK_CLASS
  return getValueColorClass(type)
}

/** Cell text for complex bodies: strings quoted, nested values as compact one-line JSON. */
export function formatCellText(value: unknown): string {
  const renderType = inferRenderType(value)
  if (renderType === 'string') return `"${String(value)}"`
  if (renderType === 'array' || renderType === 'map') return plainJsonText(value) as string
  return valueToText(value)
}

/** The nested type of a top-level array item / map value held as VERBATIM JSON
 *  text: a string that parses as a JSON array / map is that nested type (the
 *  backend realizes it into a real structure), else null. A non-JSON bracketed
 *  string (e.g. `[x]`) is NOT a structure and stays null. Lets the UI recover the
 *  nested type a verbatim-text element would otherwise lose to a bare string. */
export function nestedJsonTextType(value: unknown): 'array' | 'map' | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return 'array'
    if (parsed !== null && typeof parsed === 'object') return 'map'
  } catch {
    // Not valid JSON - a genuine string, kept as a string.
  }
  return null
}

/** Render type for an array item / map value cell, recognizing a nested array /
 *  map held as verbatim JSON text (so it tints by its structure, not as a string). */
export function inferElementRenderType(value: unknown): RenderType {
  return nestedJsonTextType(value) ?? inferRenderType(value)
}

/** Cell text for an array item / map value: a nested array / map held as verbatim
 *  JSON text renders as that text (the structure), not a quoted, escaped string. */
export function formatElementCellText(value: unknown): string {
  if (typeof value === 'string' && nestedJsonTextType(value) !== null) return value.trim()
  return formatCellText(value)
}

const DECLARED_RENDER_TYPES: ReadonlySet<unknown> = new Set<RenderType>([
  'string',
  'integer',
  'float',
  'boolean',
  'array',
  'map',
])

/** Render type of an array item / map value: its declared element type
 *  (REQ-3.1.3.19), else its stored shape; a null value renders as null. */
export function declaredElementRenderType(value: unknown, declared: unknown): RenderType {
  if (isNullValue(value)) return 'null'
  return DECLARED_RENDER_TYPES.has(declared)
    ? (declared as RenderType)
    : inferElementRenderType(value)
}

/** Cell text for an array item / map value under its declared type: a number or a
 *  structure as it is written, text quoted, whatever it looks like. */
export function formatDeclaredElementCell(value: unknown, declared: unknown): string {
  const renderType = declaredElementRenderType(value, declared)
  if (!DECLARED_RENDER_TYPES.has(declared)) return formatElementCellText(value)
  if (renderType === 'string') return `"${String(value)}"`
  if (typeof value === 'string') return value.trim()
  return formatCellText(value)
}

/** Recursively replace an array item / map value held as verbatim JSON text with
 *  its parsed structure, so a read-view `JSON.stringify(..., 2)` pretty-prints it
 *  instead of escaping it to a quoted string. Real values (objects, scalars) pass
 *  through; only a string that IS valid JSON array / map is realized. */
export function realizeNestedText(value: unknown): unknown {
  if (typeof value === 'string') {
    // nestedJsonTextType returns a type only when value.trim() already parsed as a
    // JSON array / map, so this re-parse cannot throw (no defensive catch needed).
    if (nestedJsonTextType(value) === null) return value
    return realizeNestedText(JSON.parse(value.trim()) as unknown)
  }
  if (Array.isArray(value)) return value.map(realizeNestedText)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        realizeNestedText(item),
      ]),
    )
  }
  return value
}

/** Mirrors the backend type gate: null passes all; ints pass float; bools never pass integer. */
export function valueMatchesType(value: unknown, declaredType: VariableType): boolean {
  if (isNullValue(value)) return true
  switch (declaredType) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      // Digit text is the integer it spells: exact past 2^53.
      return (
        (typeof value === 'number' && Number.isInteger(value)) ||
        (typeof value === 'string' && PLAIN_INTEGER.test(value))
      )
    case 'float':
      // Plain decimal text is the float it spells: exact past double precision.
      return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && PLAIN_FLOAT.test(value))
      )
    case 'array':
      return Array.isArray(value)
    case 'map':
      return typeof value === 'object' && !Array.isArray(value)
    case 'table':
      return isTableShape(value)
  }
}

export function truncateValue(formattedValue: string, type: VariableType, rawValue: unknown): string {
  if (type === 'string') {
    const strVal = String(rawValue)
    if (strVal.length <= MAX_VALUE_LENGTH) {
      return formattedValue
    }
    return `"${strVal.slice(0, MAX_VALUE_LENGTH)}\u2026"`
  }
  if (formattedValue.length <= MAX_VALUE_LENGTH) {
    return formattedValue
  }
  return formattedValue.slice(0, MAX_VALUE_LENGTH) + '\u2026'
}

// ===========================================================================
// Style Utilities
// ===========================================================================

/** Shape of the type pill; pair with the color from `getTypeBadgeClass`. */
export const TYPE_PILL_CLASS =
  'text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0'

/** Color for a type that arrives as a plain string. Namespace members and
 *  other non-variable kinds stay neutral rather than resolving to nothing. */
export function getTypePillColorClass(type: string): string {
  return (VARIABLE_TYPES as readonly string[]).includes(type)
    ? getTypeBadgeClass(type as VariableType)
    : 'bg-muted text-muted-foreground'
}

/** Panel type-badge palette shared by the variable rows and inspect modal. */
export function getTypeBadgeClass(type: VariableType): string {
  switch (type) {
    case 'string':
      return 'bg-sky-500/15 text-sky-300'
    case 'integer':
      return 'bg-violet-500/15 text-violet-400'
    case 'float':
      return 'bg-pink-500/15 text-pink-400'
    case 'boolean':
      return 'bg-orange-500/15 text-orange-400'
    case 'array':
      return 'bg-amber-500/15 text-amber-300'
    case 'map':
      return 'bg-emerald-500/15 text-emerald-400'
    case 'table':
      return 'bg-blue-500/20 text-blue-400'
  }
}

export function getValueColorClass(type: VariableType, isSecret?: boolean): string {
  if (isSecret) {
    return 'text-muted-foreground'
  }
  switch (type) {
    case 'string':
      return 'text-sky-300'
    case 'integer':
      return 'text-violet-400'
    case 'float':
      return 'text-pink-400'
    case 'boolean':
      return 'text-orange-400'
    case 'array':
      return 'text-amber-300'
    case 'map':
      return 'text-emerald-400'
    case 'table':
      return 'text-blue-500'
    default:
      return ''
  }
}
