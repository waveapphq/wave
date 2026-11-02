/**
 * Shared variable value validation.
 *
 * Single source of truth for validation rules used by both
 * System Variables (settings) and Suite Variables (suite detail).
 */

import type { VariableType, VariableRow } from '@/lib/variable-types'
import { isTableShape, toTableRenderModel, tableDictToRowObjects } from '@/lib/variable-table-model'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import {
  isNullValue,
  JsonNumberText,
  nestedJsonTextType,
  numberShapeType,
  plainJsonText,
  realizeNestedText,
  valueMatchesType,
  valueToText,
} from '@/lib/variable-format'
import { isStoredSecretValue } from '@/lib/secret-envelope'
import {
  acceptsNumericInput,
  floatSignificantDigits,
  integerDigitCount,
  MAX_FLOAT_SIG_DIGITS,
  MAX_INTEGER_DIGITS,
  numberProblemMessage,
  numberProblemShort,
  numberTextProblem,
  numberValueProblem,
  PLAIN_FLOAT,
  PLAIN_INTEGER,
  plainNumberText,
  type NumberProblem,
  type NumberType,
} from '@/lib/number-rule'

const COMPLEX_TYPES = new Set<VariableType>(['array', 'map', 'table'])

const NUMBER_TYPES = new Set<VariableType>(['integer', 'float'])

/** The message for text a number box holds while it is still being typed (`-`, `1.`), else null. */
export function unfinishedNumberError(value: unknown, type: NumberType): string | null {
  if (typeof value !== 'string' || value === '' || !acceptsNumericInput(value, type)) return null
  return numberTextProblem(value, type) === null ? null : `Enter a valid ${type} value`
}

function validatePrimitive(type: VariableType, value: unknown): string | null {
  if (isNullValue(value)) return null
  // An emptied number box is invalid, never 0; empty text and an unpicked boolean stay valid.
  if (value === '' && !NUMBER_TYPES.has(type)) return null
  // Entity-scope values round-trip as actual JS values (a real number / boolean), not always strings.
  if (type === 'integer' || type === 'float') {
    const problem = numberValueProblem(value, type)
    if (problem === null) return null
    return unfinishedNumberError(value, type) ?? numberProblemMessage(problem, type)
  }
  if (type === 'boolean' && value !== true && value !== false && value !== 'true' && value !== 'false') {
    return 'Must be true or false'
  }
  return null
}

const NOT_AN_ARRAY = 'Must be a JSON array'
const NOT_AN_OBJECT = 'Must be a JSON object'

/** Shape-check a structured complex value by its type; a table may be a list of rows or stored with its column types. */
function validateStructuredComplex(type: VariableType, value: unknown): string | null {
  if (type === 'map') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? null
      : NOT_AN_OBJECT
  }
  if (type === 'table') {
    return Array.isArray(value) || isTableShape(value) ? null : 'Must be a JSON array of objects'
  }
  return Array.isArray(value) ? null : NOT_AN_ARRAY
}

function validateComplex(type: VariableType, value: unknown): string | null {
  if (value === '' || value === null || value === undefined) return null
  // Entity-scope complex values round-trip verbatim as arrays / objects: validate their shape, never JSON.parse them.
  if (typeof value !== 'string') return validateStructuredComplex(type, value)
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return 'Must be valid JSON format'
  }
  return validateStructuredComplex(type, parsed)
}

/** Validate a variable value against its type. Returns an error string or null. */
export function validateVariableValue(type: VariableType, value: unknown): string | null {
  // A stored secret reads back masked or sealed; the user cannot see it, so it is never judged by type.
  if (isStoredSecretValue(value)) return null
  if (COMPLEX_TYPES.has(type)) return validateComplex(type, value)
  return validatePrimitive(type, value)
}

/** Returns true if any row in the array has a validation error. */
export function hasVariableErrors(rows: VariableRow[]): boolean {
  return rows.some((row) => validateVariableValue(row.type, row.value) !== null)
}

// Design-time edit validators and the value codec shared by every value editor.

/** Scalar column type for table cells (the four primitive variable types). */
export type ColumnType = 'string' | 'integer' | 'float' | 'boolean'
/** An array item / map value type: a scalar, or a nested array / map (authored as JSON). */
export type ValueType = ColumnType | 'array' | 'map'

/** The declared type of each top-level element of an array / map value, stored
 *  beside it (REQ-3.1.3.19): a list for an array, key -> type for a map. */
export type ElementTypes = ValueType[] | Record<string, ValueType>

const VALUE_TYPE_SET: ReadonlySet<unknown> = new Set<ValueType>([
  'string',
  'integer',
  'float',
  'boolean',
  'array',
  'map',
])

function isValueType(value: unknown): value is ValueType {
  return VALUE_TYPE_SET.has(value)
}

/** A stored element-type sidecar: a list or a key -> type record of known types. */
export function isElementTypes(value: unknown): value is ElementTypes {
  if (Array.isArray(value)) return value.every(isValueType)
  if (value === null || typeof value !== 'object') return false
  return Object.values(value).every(isValueType)
}

/** Result of parsing a scalar form value: the parsed value or an error. */
export interface ScalarParseResult {
  valid: boolean
  value?: unknown
  error?: string
}

/** Validate and parse a scalar value from form fields by declared type. */
export function validateAndParseScalarValue(
  type: VariableType,
  stringValue: string,
  numberValue: string,
  booleanValue: boolean,
): ScalarParseResult {
  switch (type) {
    case 'string':
      return { valid: true, value: stringValue }

    case 'integer': {
      const trimmed = numberValue.trim()
      if (!trimmed) {
        return { valid: false, error: 'Must be a valid integer' }
      }
      if (trimmed.includes('.')) {
        return { valid: false, error: 'Integer cannot contain decimal point' }
      }
      // Whole-string match: parseInt lenient-parses "12x" -> 12 (silent truncation).
      if (!PLAIN_INTEGER.test(trimmed)) {
        return { valid: false, error: 'Must be a valid integer' }
      }
      if (integerDigitCount(trimmed) > MAX_INTEGER_DIGITS) {
        return { valid: false, error: `Maximum ${MAX_INTEGER_DIGITS} digits` }
      }
      // Keep the exact digit-string: a JS number rounds past 2^53. The backend's
      // arbitrary-precision int holds the real value (coerced at realization).
      return { valid: true, value: trimmed }
    }

    case 'float': {
      const trimmed = numberValue.trim()
      if (!trimmed) {
        return { valid: false, error: 'Must be a valid number' }
      }
      // Keep the exact digit-string: a JS number rounds past ~15-17 sig digits.
      // The backend's Decimal pipeline holds the real value (REQ-3.1.3.14).
      const problem = numberTextProblem(trimmed, 'float')
      if (problem === 'type') {
        return { valid: false, error: 'Must be a valid number' }
      }
      if (problem === 'float-cap') {
        return { valid: false, error: `Maximum ${MAX_FLOAT_SIG_DIGITS} significant digits` }
      }
      return { valid: true, value: trimmed }
    }

    case 'boolean':
      return { valid: true, value: booleanValue }

    default:
      return { valid: true, value: stringValue }
  }
}

/** Infer a table column type from a sample cell value. */
export function inferColumnType(value: unknown): ColumnType {
  if (value === null || value === undefined || value === '') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return numberShapeType(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const lower = trimmed.toLowerCase()
    if (lower === 'true' || lower === 'false') return 'boolean'
    if (PLAIN_INTEGER.test(trimmed)) return 'integer'
    if (PLAIN_FLOAT.test(trimmed)) return 'float'
  }
  return 'string'
}

/**
 * The type typing into an undeclared array item / map value selects: `true` /
 * `false` -> boolean, an opening bracket -> array / map, else string. Digits never
 * select a number type: a zip code or a version stays text (REQ-3.1.3.19).
 */
export function inferTypeFromText(text: string): ValueType {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'true' || lower === 'false') return 'boolean'
  // An opening bracket commits to array / map so its JSON gets validated (not
  // silently demoted to a string); describeCellError then flags any bad JSON.
  if (trimmed.startsWith('[')) return 'array'
  if (trimmed.startsWith('{')) return 'map'
  return 'string'
}

// A table cell is typed text or an explicit null; invalid text is kept and flagged, never coerced to null.

/** Default text for a freshly added cell, by column type (never null). */
export function defaultCellText(colType: ColumnType): string {
  if (colType === 'boolean') return 'false'
  if (colType === 'integer' || colType === 'float') return '0'
  return ''
}

/** A cell problem: wrong type, or a valid number over its digit cap. */
export type CellProblem = NumberProblem

/** Classify an editor cell's text against its column type (null = no problem). */
function cellTextProblem(cell: string, colType: ColumnType): CellProblem | null {
  const trimmed = cell.trim()
  if (colType === 'integer' || colType === 'float') return numberTextProblem(trimmed, colType)
  if (colType === 'boolean') {
    const lower = trimmed.toLowerCase()
    return lower === 'true' || lower === 'false' ? null : 'type'
  }
  return null
}

/** Classify a Code-view cell's parsed value (null/undefined are always allowed). */
function cellValueProblem(value: unknown, colType: ColumnType): CellProblem | null {
  if (!valueMatchesType(value, colType)) return 'type'
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (colType === 'integer' && integerDigitCount(value) > MAX_INTEGER_DIGITS) return 'integer-cap'
  if (colType === 'float' && floatSignificantDigits(value) > MAX_FLOAT_SIG_DIGITS) return 'float-cap'
  return null
}

/** The inline message for a cell problem, scoped to the column type. */
function cellProblemMessage(problem: CellProblem, colType: ColumnType): string {
  return colType === 'integer' || colType === 'float' ? numberProblemMessage(problem, colType) : 'Must be true or false'
}

/** The strip-style suffix for a cell's problem ("expected integer" / "max 19
 *  digits"), or null when valid. Shared by the table / array / map Visual strips
 *  so their location-prefixed messages read consistently. */
/** Walk a nested array / map's JSON and flag the first number whose exact source
 *  text breaks the scalar caps (integer 19 digits / float 28 significant) - so a
 *  number smuggled inside a nested value is held to the same limit as a top-level
 *  one. Exponent / non-plain numbers are skipped; null when all are within range. */
function nestedNumberCapError(text: string): string | null {
  let error: string | null = null
  // The sole caller (describeCellError) has already validated that `text` parses,
  // so this reviser-parse cannot throw.
  JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }): unknown => {
    if (error === null && typeof value === 'number' && typeof context?.source === 'string') {
      const src = context.source
      if (PLAIN_INTEGER.test(src) && integerDigitCount(src) > MAX_INTEGER_DIGITS) {
        error = `nested integer exceeds ${MAX_INTEGER_DIGITS} digits`
      } else if (PLAIN_FLOAT.test(src) && floatSignificantDigits(src) > MAX_FLOAT_SIG_DIGITS) {
        error = `nested float exceeds ${MAX_FLOAT_SIG_DIGITS} significant digits`
      }
    }
    return value
  })
  return error
}

export function describeCellError(cell: string, colType: ValueType): string | null {
  if (colType === 'array' || colType === 'map') {
    let parsed: unknown
    try {
      parsed = JSON.parse(cell)
    } catch {
      return 'invalid JSON'
    }
    if (colType === 'array' && !Array.isArray(parsed)) return 'expected array'
    if (colType === 'map' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)))
      return 'expected map'
    return nestedNumberCapError(cell)
  }
  const problem = cellTextProblem(cell, colType)
  if (problem === null) return null
  // A digit cap is only ever a number column's problem.
  return problem === 'type' ? `expected ${colType}` : numberProblemShort(problem, colType as NumberType)
}

/** Validate an editor cell. Explicit null is valid; an empty string is valid
 *  only for a string column; otherwise the text is checked against the type. */
export function validateTableCell(cell: string | null, colType: ColumnType): string | null {
  if (cell === null || colType === 'string') return null
  const problem = cellTextProblem(cell, colType)
  return problem === null ? null : cellProblemMessage(problem, colType)
}

/** Parse an editor cell to its typed value. null stays null; a valid cell
 *  yields the typed value; an invalid cell keeps its raw text (survives +
 *  stays flagged, never silently nulled). */
export function parseTableCell(cell: string | null, colType: ColumnType): unknown {
  if (cell === null) return null
  const trimmed = cell.trim()
  // Integers and floats are both kept as exact digit-strings (precision past
  // 2^53 / double); the Code view renders the JS-safe ones back as plain numbers.
  if (colType === 'integer') return PLAIN_INTEGER.test(trimmed) ? trimmed : cell
  if (colType === 'float') return numberTextProblem(trimmed, 'float') === null ? trimmed : cell
  if (colType === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
    return cell
  }
  return cell
}

/** Parse an array item / map value's text to its typed value: a scalar via
 *  parseTableCell, a nested array / map kept as its VERBATIM JSON text (never
 *  re-parsed in JS, so a number like 123.0 is not normalized to 123 nor rounded -
 *  the backend realizes the structure with Decimal, exactly as scalar floats do). */
export function parseItemValue(text: string, type: ValueType): unknown {
  if (type === 'array' || type === 'map') return text
  // parseTableCell only returns null for a null cell; `text` is always a string.
  return parseTableCell(text, type)
}

/** Format a value for inline display/editing (strings verbatim, else JSON). */
export function formatValue(value: unknown): string {
  if (value === undefined) return ''
  return valueToText(value)
}

/** A list item's or map entry's text in its editor: a List or Map held as a structure is one spaced JSON line, as a nested Save writes it. */
export function entryText(value: unknown): string {
  return Array.isArray(value) || isPlainRowObject(value) ? lineJson(value) : formatValue(value)
}

/** The text a null array item / map value takes when the user enters a value: its type default. */
export function defaultItemText(type: ValueType): string {
  return formatValue(getDefaultValueForType(type))
}

// ===========================================================================
// Shared design-time table-schema validators. One family backs BOTH the Visual
// and the Code view of the inspect-modal table editor so Save gates identically;
// the rules mirror the backend Table contract (REQ-3.5.5.1) and move the failure
// to design time.
// ===========================================================================

/** A table column's name + cell type; the carried schema travels with the value. */
export interface TableColumnSchema {
  name: string
  type: ColumnType
}

/** Column-level problem. `empty` carries the 1-based position; the rest carry the name. */
export type TableColumnError =
  | { kind: 'empty'; position: number }
  | { kind: 'duplicate' | 'unexpected' | 'missing'; name: string }

/** Cell-level problem: 0-based row, column name, the expected type, and the
 *  problem kind (a type mismatch, or a valid number over its digit cap). */
export interface TableCellError {
  row: number
  column: string
  expected: ColumnType
  reason?: CellProblem
}

/** Structured table validation: structure, column-name, and per-cell problems. */
export interface TableValidationResult {
  valid: boolean
  structureError: string | null
  columnErrors: TableColumnError[]
  cellErrors: TableCellError[]
}

function isPlainRowObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Column-name rules: non-empty (whitespace trimmed) + unique (case-sensitive, trimmed). */
function validateColumnNames(headers: string[]): TableColumnError[] {
  const trimmed = headers.map((header) => header.trim())
  const counts = new Map<string, number>()
  for (const name of trimmed) {
    if (name !== '') counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name)
  }
  const errors: TableColumnError[] = []
  trimmed.forEach((name, index) => {
    if (name === '') {
      errors.push({ kind: 'empty', position: index + 1 })
    } else if (duplicates.has(name)) {
      errors.push({ kind: 'duplicate', name })
    }
  })
  return errors
}

/**
 * Validate the Visual-view model (string cells). Column-name rules + per-cell
 * type checking against the column types, returned as one structured result.
 */
export function validateTableValue(model: {
  headers: string[]
  types: ColumnType[]
  rows: (string | null)[][]
}): TableValidationResult {
  const columnErrors = validateColumnNames(model.headers)
  const cellErrors: TableCellError[] = []
  model.rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const problem = cell === null ? null : cellTextProblem(cell, model.types[colIndex])
      if (problem !== null) {
        const error: TableCellError = {
          row: rowIndex,
          column: model.headers[colIndex],
          expected: model.types[colIndex],
        }
        if (problem !== 'type') error.reason = problem
        cellErrors.push(error)
      }
    })
  })
  return {
    valid: columnErrors.length === 0 && cellErrors.length === 0,
    structureError: null,
    columnErrors,
    cellErrors,
  }
}

/** Keys present in the data but absent from the schema (deduped, first-seen order). */
function collectUnexpectedColumns(
  rows: Record<string, unknown>[],
  schemaNames: Set<string>,
): TableColumnError[] {
  const seen = new Set<string>()
  const errors: TableColumnError[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!schemaNames.has(key) && !seen.has(key)) {
        seen.add(key)
        errors.push({ kind: 'unexpected', name: key })
      }
    }
  }
  return errors
}

/** Schema columns absent from at least one row (deduped). */
function collectMissingColumns(
  rows: Record<string, unknown>[],
  schema: TableColumnSchema[],
): TableColumnError[] {
  const seen = new Set<string>()
  const errors: TableColumnError[] = []
  for (const row of rows) {
    for (const column of schema) {
      if (!(column.name in row) && !seen.has(column.name)) {
        seen.add(column.name)
        errors.push({ kind: 'missing', name: column.name })
      }
    }
  }
  return errors
}

/** In-schema cells whose value does not match the column type (row-major). */
function collectCodeCellErrors(
  rows: Record<string, unknown>[],
  schema: TableColumnSchema[],
): TableCellError[] {
  const errors: TableCellError[] = []
  rows.forEach((row, rowIndex) => {
    for (const column of schema) {
      if (column.name in row) {
        const problem = cellValueProblem(row[column.name], column.type)
        if (problem !== null) {
          const error: TableCellError = { row: rowIndex, column: column.name, expected: column.type }
          if (problem !== 'type') error.reason = problem
          errors.push(error)
        }
      }
    }
  })
  return errors
}

/**
 * Validate the Code-view value (parsed JSON) against the carried column schema.
 * Rejects anything that is not an array of plain row objects, then flags
 * column-shape drift (unexpected / missing keys) and per-cell type mismatches.
 */
export function validateTableCodeValue(
  value: unknown,
  schema: TableColumnSchema[],
): TableValidationResult {
  if (!Array.isArray(value) || !value.every(isPlainRowObject)) {
    return {
      valid: false,
      structureError: 'Table must be a list of rows',
      columnErrors: [],
      cellErrors: [],
    }
  }
  const rows: Record<string, unknown>[] = value
  const schemaNames = new Set(schema.map((column) => column.name))
  const columnErrors = [
    ...collectUnexpectedColumns(rows, schemaNames),
    ...collectMissingColumns(rows, schema),
  ]
  const cellErrors = collectCodeCellErrors(rows, schema)
  return {
    valid: columnErrors.length === 0 && cellErrors.length === 0,
    structureError: null,
    columnErrors,
    cellErrors,
  }
}

/** Visual-strip messages for an array, each prefixed with its index. In Code, a
 *  `lineOf` resolver also prefixes `Line N:` (pointing at the item's JSON line). */
export function arrayErrorMessages(
  value: unknown[],
  types: ValueType[],
  lineOf?: (index: number) => number | null,
): string[] {
  const messages: string[] = []
  value.forEach((element, index) => {
    // A null item fits any element type (REQ-3.1.3.19).
    if (isNullValue(element)) return
    const error = describeCellError(formatValue(element), types[index] ?? 'string')
    if (error !== null) {
      const line = lineOf?.(index)
      const prefix = line == null ? '' : `Line ${line}: `
      messages.push(`${prefix}Index ${index}: ${error}`)
    }
  })
  return messages
}

/** A resolved map key policy: the checks + exact messages ride as plain data so
 *  one validator backs the Visual editor, the Code view, and the strip while
 *  staying ignorant of the owning plugin. */
export interface ResolvedMapKeyPolicy {
  keyNoun: string
  caseInsensitive?: boolean
  /** canonical lowercase key -> exact message (matched case-insensitively) */
  blockedKeys?: Record<string, string>
  /** the key as saved must match; `{key}` in the message is the key as saved */
  keyPattern?: { pattern: string; message: string }
  /** case-sensitive prefixes, checked only on a key that passed the pattern */
  blockedPrefixes?: { prefix: string; message: string }[]
}

function nameRuleMessage(key: string, keyPolicy: ResolvedMapKeyPolicy): string | undefined {
  const { keyPattern, blockedPrefixes } = keyPolicy
  if (keyPattern && !new RegExp(keyPattern.pattern).test(key)) {
    return keyPattern.message.replaceAll('{key}', key)
  }
  return blockedPrefixes?.find((rule) => key.startsWith(rule.prefix))?.message.replaceAll('{key}', key)
}

/** The duplicate-key message under a policy names the LATER duplicate row as typed. */
export function mapKeyPolicyDuplicateMessage(noun: string, key: string): string {
  return `Duplicate ${noun} "${key}" (${noun} names are case-insensitive)`
}

function policyMessages(
  entries: { key: string }[],
  keyPolicy: ResolvedMapKeyPolicy,
): Map<number, string[]> {
  const byIndex = new Map<number, string[]>()
  const push = (index: number, message: string) => {
    const list = byIndex.get(index) ?? []
    list.push(message)
    byIndex.set(index, list)
  }
  const seen = new Set<string>()
  const dupReported = new Set<string>()
  entries.forEach((entry, index) => {
    const key = entry.key.trim()
    if (key === '') return
    const lowered = key.toLowerCase()
    if (keyPolicy.caseInsensitive && seen.has(lowered) && !dupReported.has(lowered)) {
      dupReported.add(lowered)
      push(index, mapKeyPolicyDuplicateMessage(keyPolicy.keyNoun, key))
    }
    seen.add(lowered)
    const blocked = keyPolicy.blockedKeys?.[lowered]
    if (blocked !== undefined) push(index, blocked)
    const nameRule = nameRuleMessage(entry.key, keyPolicy)
    if (nameRule !== undefined) push(index, nameRule)
  })
  return byIndex
}

/** The row indexes a policy flags (for key error styling; duplicates flag EVERY
 *  colliding row, not just the reported one). */
export function mapKeyPolicyFlaggedIndexes(
  entries: { key: string }[],
  keyPolicy: ResolvedMapKeyPolicy,
): Set<number> {
  const flagged = new Set<number>()
  const byLowered = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    const key = entry.key.trim()
    if (key === '') return
    const lowered = key.toLowerCase()
    if (keyPolicy.caseInsensitive) {
      const list = byLowered.get(lowered) ?? []
      list.push(index)
      byLowered.set(lowered, list)
    }
    if (keyPolicy.blockedKeys?.[lowered] !== undefined) flagged.add(index)
    if (nameRuleMessage(entry.key, keyPolicy) !== undefined) flagged.add(index)
  })
  for (const indexes of byLowered.values()) {
    if (indexes.length > 1) for (const index of indexes) flagged.add(index)
  }
  return flagged
}

/** Visual-strip messages for a map's positional entries: a value error reads
 *  `Key "k": ...`; a missing key folds into one `Element #i: key missing[, ...]`
 *  line; a repeated key reads `Duplicate key "k"`. In Code, a `lineOf` resolver
 *  prefixes `Line N:` for the keyed messages. A `keyPolicy` adds case-insensitive
 *  duplicate and blocked-key checks with their exact messages. */
export function mapEntryErrorMessages(
  entries: { key: string; value: string; type: ValueType }[],
  lineOf?: (key: string) => number | null,
  keyPolicy?: ResolvedMapKeyPolicy,
): string[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = entry.key.trim()
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const duplicateKeys = new Set(
    [...counts].filter(([, count]) => count > 1).map(([key]) => key),
  )
  const linePrefix = (key: string): string => {
    const line = lineOf?.(key)
    return line == null ? '' : `Line ${line}: `
  }
  const byIndex = keyPolicy ? policyMessages(entries, keyPolicy) : null
  const messages: string[] = []
  const dupReported = new Set<string>()
  entries.forEach((entry, index) => {
    const key = entry.key.trim()
    const error = describeCellError(entry.value, entry.type)
    if (key === '') {
      if (entry.value.trim() === '') return // a fully-empty row is transient, not an error
      messages.push(error ? `Element #${index}: key missing, ${error}` : `Element #${index}: key missing`)
      return
    }
    for (const message of byIndex?.get(index) ?? []) {
      messages.push(`${linePrefix(key)}${message}`)
    }
    // A policy's case-insensitive duplicate check supersedes the exact-match one.
    if (!keyPolicy?.caseInsensitive && duplicateKeys.has(key) && !dupReported.has(key)) {
      dupReported.add(key)
      messages.push(`${linePrefix(key)}Duplicate key "${key}"`)
    }
    if (error !== null) messages.push(`${linePrefix(key)}Key "${key}": ${error}`)
  })
  return messages
}

const NUMERIC_COLUMN = new Set<ColumnType>(['integer', 'float'])

/** True when an int/float cell renders as a real JSON number in the Code view:
 *  any plain numeric literal, at any precision (JSON number literals are
 *  unbounded). The source-preserving parse keeps the exact text, so a value past
 *  2^53 / double is never rounded into a JS float. */
function rendersAsCodeNumber(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  return PLAIN_INTEGER.test(value) || PLAIN_FLOAT.test(value)
}

/** Render a numeric-column scalar as a Code-view JSON token: a real number
 *  literal (its exact text, any precision) when it renders as a code number, else
 *  quoted / `true`/`false` via JSON.stringify. Non-numeric columns serialize the
 *  value with JSON.stringify directly. Shared by table cells, array items, map values. */
function renderNumericToken(value: unknown): string {
  return rendersAsCodeNumber(value) ? plainNumberText(value as number | string) : JSON.stringify(value)
}

/** The runtime type of a plain-parsed JSON value (number -> integer/float by
 *  shape, boolean, else string). null / object fall back to string - the safeguard. */
export function inferRuntimeType(value: unknown): ValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return numberShapeType(value)
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'map'
  return 'string'
}

/** The type of a STORED array item / map value when re-seeding the editor from a
 *  persisted value. Unlike inferRuntimeType, a nested array / map carried as
 *  verbatim JSON text (a string) is recognized as that nested type - matching the
 *  backend, which realizes such a string into a real structure - so a saved
 *  array-of-map keeps its element types on inspect instead of decaying to string. */
export function inferStoredElementType(value: unknown): ValueType {
  return nestedJsonTextType(value) ?? inferRuntimeType(value)
}

/** Array item types: each item's declared type where it has one, else its stored shape. */
export function resolveArrayTypes(items: unknown[], declared: unknown): ValueType[] {
  const list: unknown[] = Array.isArray(declared) ? declared : []
  return items.map((item, index) => {
    const type = list[index]
    return isValueType(type) ? type : inferStoredElementType(item)
  })
}

/** Map value types: each key's declared type where it has one, else its stored shape. */
export function resolveMapTypes(
  value: Record<string, unknown>,
  declared: unknown,
): Record<string, ValueType> {
  const types =
    declared !== null && typeof declared === 'object' && !Array.isArray(declared)
      ? (declared as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const type = types[key]
      return [key, isValueType(type) ? type : inferStoredElementType(entry)]
    }),
  )
}

/** Code text layout: 2-space pretty-printed over several lines, or one line (the window's value field). */
export type CodeLayout = 'pretty' | 'line'

/** Wrap tokens in brackets: one per line indented by nesting depth, or `, `-joined on one line. */
function wrapTokens(open: string, close: string, tokens: string[], layout: CodeLayout, depth = 0): string {
  if (layout === 'line') return `${open}${tokens.join(', ')}${close}`
  const pad = '  '.repeat(depth)
  const lines = tokens.map((token) => `${pad}  ${token}`).join(',\n')
  return `${open}\n${lines}\n${pad}${close}`
}

/** Serialize a table value to Code-view JSON, int/float cells as real JSON numbers at any precision. */
export function serializeTableForCode(
  value: unknown,
  schema: TableColumnSchema[],
  layout: CodeLayout = 'pretty',
): string {
  const rows = tableDictToRowObjects(value)
  if (!Array.isArray(rows)) return plainJsonText(rows, layout === 'line' ? '' : '  ') as string
  if (rows.length === 0) return '[]'
  const numeric = new Set(schema.filter((c) => NUMERIC_COLUMN.has(c.type)).map((c) => c.name))
  const rowTexts = rows.map((row) => {
    const entries = Object.entries(row as Record<string, unknown>).map(([key, cell]) => {
      const token = numeric.has(key) ? renderNumericToken(cell) : (plainJsonText(cell) as string)
      return `${JSON.stringify(key)}: ${token}`
    })
    return entries.length === 0 ? '{}' : wrapTokens('{', '}', entries, layout, 1)
  })
  return wrapTokens('[', ']', rowTexts, layout)
}

/** Parse Code-view table JSON, keeping every numeric literal's EXACT source text
 *  instead of the JS float the engine would round it to (so a 19-digit id / a
 *  28-digit decimal survive verbatim). Falls back to the JS value when the engine
 *  has no JSON source access. Only int/float cells are numbers in a table, so the
 *  capture needs no schema. */
export function parseTableCodeText(text: string): unknown {
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: { source?: string }): unknown =>
      typeof value === 'number' && typeof context?.source === 'string' ? context.source : value,
  )
}

/** Plain JSON on one line, with `, ` between items and `: ` after keys. */
function lineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => lineJson(item)).join(', ')}]`
  if (value !== null && typeof value === 'object' && !(value instanceof JsonNumberText)) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
    const members = entries.map(([key, entry]) => JSON.stringify(key) + ': ' + lineJson(entry))
    return `{${members.join(', ')}}`
  }
  return plainJsonText(value) ?? 'null'
}

/** Render one array item / map value as a Code token: a nested array / map is its
 *  plain JSON (an invalid one is the raw text the user typed, kept verbatim so the
 *  Code view flags the bad JSON); a scalar uses the number-or-quoted rules. */
function renderValueToken(value: unknown, type: ValueType, layout: CodeLayout): string {
  if (type === 'array' || type === 'map') {
    if (typeof value === 'string') return value
    return layout === 'line' ? lineJson(value) : (plainJsonText(value) as string)
  }
  return NUMERIC_COLUMN.has(type) ? renderNumericToken(value) : (plainJsonText(value) as string)
}

/** Serialize an array's items to Code JSON: scalars as real numbers / quoted /
 *  boolean, a nested array / map as its plain JSON; an expression item renders as
 *  a bare `{{ <raw expression> }}`. */
export function serializeArrayForCode(
  items: unknown[],
  types: ValueType[],
  layout: CodeLayout = 'pretty',
  exprIndices: ReadonlySet<number> = new Set(),
): string {
  if (items.length === 0) return '[]'
  const tokens = items.map((item, i) =>
    exprIndices.has(i) ? `{{ ${String(item)} }}` : renderValueToken(item, types[i] ?? 'string', layout),
  )
  return wrapTokens('[', ']', tokens, layout)
}

/** Serialize a map's values to Code JSON (keys quoted, values by their type); an
 *  expression key renders as a bare `{{ <raw expression> }}`. */
export function serializeMapForCode(
  value: Record<string, unknown>,
  types: Record<string, ValueType>,
  exprKeys: ReadonlySet<string> = new Set(),
  layout: CodeLayout = 'pretty',
): string {
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const entries = keys.map((key) => {
    const token = exprKeys.has(key)
      ? `{{ ${String(value[key])} }}`
      : renderValueToken(value[key], types[key] ?? 'string', layout)
    return `${JSON.stringify(key)}: ${token}`
  })
  return wrapTokens('{', '}', entries, layout)
}

/** Serialize a complex value for a READ Code view, recognizing array / map
 *  elements held as verbatim JSON text (a nested map renders as the structure,
 *  not a JSON.stringify-escaped quoted string). Declared element types, when the
 *  value carries them, render each element as its type (REQ-3.1.3.19). */
export function serializeComplexForCode(
  type: VariableType,
  value: unknown,
  elementTypes?: ElementTypes,
): string {
  if (type === 'table') return serializeTableForCode(value, deriveTableSchema(value))
  if (elementTypes !== undefined && type === 'array' && Array.isArray(value)) {
    return serializeArrayForCode(value, resolveArrayTypes(value, elementTypes))
  }
  if (elementTypes !== undefined && type === 'map' && isPlainRowObject(value)) {
    return serializeMapForCode(value, resolveMapTypes(value, elementTypes))
  }
  // Array / map READ views pretty-print like before; realizeNestedText turns a
  // verbatim-JSON-text element into its structure so it is not escaped to a string.
  if (type === 'array' || type === 'map') {
    return plainJsonText(realizeNestedText(value), '  ') as string
  }
  return plainJsonText(value, '  ') as string
}

const NESTED_TYPE = new Set<ValueType>(['array', 'map'])

/** Parse JSON text with every number held as its exact source text, so a number is never narrowed to a JS double. */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && typeof context?.source === 'string'
      ? new JsonNumberText(context.source)
      : value,
  )
}

/** A top-level item's stored value from its source-captured form: a nested array /
 *  map keeps its exact text (full precision) as one spaced line, a scalar number its
 *  exact digits, else the value (a null item stays null). */
function capturedItem(captured: unknown, type: ValueType): unknown {
  if (NESTED_TYPE.has(type)) return lineJson(captured)
  if (captured instanceof JsonNumberText) return captured.text
  return captured
}

/** A whole Code text that is not a list is refused, a whole `null` included (VMGR-96). */
function codeArray(parsed: unknown): unknown[] {
  if (!Array.isArray(parsed)) throw new Error(NOT_AN_ARRAY)
  return parsed
}

/** A whole Code text that is not a map is refused, a whole `null` included (VMGR-96). */
function codeObject(parsed: unknown): Record<string, unknown> {
  if (!isPlainRowObject(parsed)) throw new Error(NOT_AN_OBJECT)
  return parsed
}

/** The type a Code token writes: a number by its own digits (`1.0` is a float,
 *  `16` an integer), anything else by its JSON shape. */
function codeTokenType(plain: unknown, captured: unknown): ValueType {
  if (captured instanceof JsonNumberText) return PLAIN_INTEGER.test(captured.text) ? 'integer' : 'float'
  return inferRuntimeType(plain)
}

/** Code text taken as written, with no {x} members. */
function plainCode(text: string): { transformed: string; exprs: string[] } {
  return { transformed: text, exprs: [] }
}

/** The raw expression a masked bare {{ }} member stands for; undefined for any other member. */
function bareExpressionOf(member: unknown, exprs: string[]): string | undefined {
  return typeof member === 'string' && member.startsWith(EXPR_SENTINEL)
    ? exprs[Number(member.slice(EXPR_SENTINEL.length))]
    : undefined
}

/** Parse Code array JSON into items + the type inferred from each token. A scalar
 *  keeps its exact numeric text; a nested array / map keeps its exact source text
 *  (numbers at any depth stay full-precision); a null item stays null. With
 *  `allowExpressions` a bare `{{ }}` item is an expression item holding its raw
 *  text. Throws `Must be a JSON array` for a whole text that is not a list (VMGR-96). */
export function parseArrayCode(
  text: string,
  allowExpressions = false,
): { items: unknown[]; types: ValueType[]; exprIndices: number[] } {
  const { transformed, exprs } = allowExpressions ? extractBareExpressions(text) : plainCode(text)
  const plain = codeArray(JSON.parse(transformed))
  const captured = parseJsonExact(transformed) as unknown[]
  const types: ValueType[] = []
  const exprIndices: number[] = []
  const items = plain.map((element: unknown, index: number) => {
    const expression = bareExpressionOf(element, exprs)
    if (expression !== undefined) {
      exprIndices.push(index)
      types.push('string')
      return expression
    }
    const type = codeTokenType(element, captured[index])
    types.push(type)
    return capturedItem(captured[index], type)
  })
  return { items, types, exprIndices }
}

/** Parse Code map JSON into values + per-key type from the JSON token (scalar exact
 *  text; nested array / map exact source text; a null value stays null). With
 *  `allowExpressions` a bare `{{ }}` value is an expression key holding its raw
 *  text. Throws `Must be a JSON object` for a whole text that is not a map. */
export function parseMapCode(
  text: string,
  allowExpressions = false,
): {
  value: Record<string, unknown>
  types: Record<string, ValueType>
  exprKeys: string[]
} {
  const { transformed, exprs } = allowExpressions ? extractBareExpressions(text) : plainCode(text)
  const plain = codeObject(JSON.parse(transformed))
  const captured = parseJsonExact(transformed) as Record<string, unknown>
  const value: Record<string, unknown> = {}
  const types: Record<string, ValueType> = {}
  const exprKeys: string[] = []
  for (const key of Object.keys(plain)) {
    const member = plain[key]
    const expression = bareExpressionOf(member, exprs)
    if (expression !== undefined) {
      exprKeys.push(key)
      types[key] = 'string'
      value[key] = expression
      continue
    }
    const type = codeTokenType(member, captured[key])
    types[key] = type
    value[key] = capturedItem(captured[key], type)
  }
  return { value, types, exprKeys }
}

/** A List or Map entry type: the structure its own editor opens on. */
export type NestedType = 'array' | 'map'

/** Whether a List or Map entry's text is that structure's JSON, so its own editor can open on it. */
export function opensNestedEditor(text: string, type: ValueType): boolean {
  return (type === 'array' || type === 'map') && nestedJsonTextType(text) === type
}

/** A nested List or Map as its editor shows it: the items, each typed by its own JSON token. */
export interface NestedValue {
  value: unknown[] | Record<string, unknown>
  types: ElementTypes
}

/** A List or Map entry's JSON text read as the items of its own editor (REQ-3.1.3.19). */
export function nestedValueFromText(type: NestedType, text: string): NestedValue {
  if (type === 'array') {
    const { items, types } = parseArrayCode(text)
    return { value: items, types }
  }
  const { value, types } = parseMapCode(text)
  return { value, types }
}

/** A number item's text as a JSON number of its type: no leading zeros, and a whole float keeps `.0`. */
function jsonNumberToken(item: unknown, type: ValueType): unknown {
  if ((type !== 'integer' && type !== 'float') || typeof item !== 'string' || !PLAIN_FLOAT.test(item)) return item
  const canonical = item.replace(/^(-?)0+(?=\d)/, '$1')
  return type === 'float' && PLAIN_INTEGER.test(canonical) ? `${canonical}.0` : canonical
}

/** The JSON text a List or Map entry holds for its nested items, each read back as the type it shows. */
export function nestedValueText(type: NestedType, value: unknown, types: ElementTypes | undefined): string {
  if (type === 'array') {
    const items = value as unknown[]
    const itemTypes = resolveArrayTypes(items, types)
    return serializeArrayForCode(
      items.map((item, index) => jsonNumberToken(item, itemTypes[index])),
      itemTypes,
      'line',
    )
  }
  const entries = value as Record<string, unknown>
  const entryTypes = resolveMapTypes(entries, types)
  const tokens = Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, jsonNumberToken(entry, entryTypes[key])]),
  )
  return serializeMapForCode(tokens, entryTypes, undefined, 'line')
}

/** A table cell's column type from its JSON token: a bare number by its digits, true / false boolean, else string. */
function columnTokenType(token: unknown): ColumnType {
  if (token instanceof JsonNumberText) return PLAIN_INTEGER.test(token.text) ? 'integer' : 'float'
  return typeof token === 'boolean' ? 'boolean' : 'string'
}

/** The columns that rows written as JSON text define, typed by the tokens of the first row (REQ-3.5.5.1). */
export function tableSchemaFromCode(text: string): TableColumnSchema[] {
  const captured = parseJsonExact(text)
  const first: unknown = Array.isArray(captured) ? captured[0] : undefined
  if (!isPlainRowObject(first) || first instanceof JsonNumberText) return []
  return Object.entries(first).map(([name, token]) => ({ name, type: columnTokenType(token) }))
}

const isJsonWs = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'

interface CapCursor {
  depth: number
  inString: boolean
  escaped: boolean
  line: number
  rootOpened: boolean
  rootIsArray: boolean
  awaitingElement: boolean
  expectingKey: boolean
  elementIndex: number
  slot: number | string
  stringStart: number
  numStart: number
  numLine: number
}

function newCapCursor(): CapCursor {
  return {
    depth: 0,
    inString: false,
    escaped: false,
    line: 1,
    rootOpened: false,
    rootIsArray: false,
    awaitingElement: false,
    expectingKey: false,
    elementIndex: -1,
    slot: -1,
    stringStart: -1,
    numStart: -1,
    numLine: 0,
  }
}

/** A numeric literal that breaks the integer-digit or float-significant-digit cap. */
function isOverCap(src: string): boolean {
  return (
    (PLAIN_INTEGER.test(src) && integerDigitCount(src) > MAX_INTEGER_DIGITS) ||
    (PLAIN_FLOAT.test(src) && floatSignificantDigits(src) > MAX_FLOAT_SIG_DIGITS)
  )
}

/** On a non-number character, close any open number run and record the first
 *  over-cap one per slot. */
function flushNumber(
  codeText: string,
  i: number,
  ch: string,
  c: CapCursor,
  lines: Map<number | string, number>,
): void {
  if (c.numStart < 0) return
  if (/[-+0-9.eE]/.test(ch)) return
  const src = codeText.slice(c.numStart, i)
  if (isOverCap(src) && !lines.has(c.slot)) lines.set(c.slot, c.numLine)
  c.numStart = -1
}

/** A just-closed top-level object string becomes the current slot when it is a key
 *  (followed by a colon). */
function captureKeySlot(codeText: string, i: number, c: CapCursor): void {
  if (c.rootIsArray || c.depth !== 1 || !c.expectingKey) return
  let j = i + 1
  while (j < codeText.length && isJsonWs(codeText[j])) j++
  if (codeText[j] === ':') {
    c.slot = codeText.slice(c.stringStart + 1, i)
    c.expectingKey = false
  }
}

/** Within a string: consume one char, capturing a key slot when the string closes. */
function stepInString(codeText: string, i: number, c: CapCursor): void {
  const ch = codeText[i]
  if (c.escaped) {
    c.escaped = false
    return
  }
  if (ch === '\\') {
    c.escaped = true
    return
  }
  if (ch !== '"') return
  c.inString = false
  captureKeySlot(codeText, i, c)
}

/** At the first char of a fresh top-level array element, advance the slot index. */
function maybeStartElement(ch: string, c: CapCursor): void {
  if (
    c.rootIsArray &&
    c.depth === 1 &&
    c.awaitingElement &&
    ch !== ',' &&
    ch !== ']'
  ) {
    c.elementIndex++
    c.slot = c.elementIndex
    c.awaitingElement = false
  }
}

/** Open a bracket: the first one fixes the root container type, later ones nest. */
function openBracket(ch: string, c: CapCursor): void {
  if (c.rootOpened) {
    c.depth++
    return
  }
  c.rootOpened = true
  c.rootIsArray = ch === '['
  c.depth = 1
  if (c.rootIsArray) c.awaitingElement = true
  else c.expectingKey = true
}

/** A top-level comma readies the next slot (array element or object key). */
function markSlotBoundary(c: CapCursor): void {
  if (c.rootIsArray) c.awaitingElement = true
  else c.expectingKey = true
}

/** Outside a string: consume one structural / number character. */
function stepStructural(i: number, ch: string, c: CapCursor): void {
  maybeStartElement(ch, c)
  if (ch === '"') {
    c.inString = true
    c.stringStart = i
  } else if (ch === '[' || ch === '{') {
    openBracket(ch, c)
  } else if (ch === ']' || ch === '}') {
    c.depth--
  } else if (ch === ',') {
    if (c.depth === 1) markSlotBoundary(c)
  } else if (c.numStart < 0 && /[-0-9]/.test(ch)) {
    c.numStart = i
    c.numLine = c.line
  }
}

/** For a complex value's Code text, the 1-based line of the FIRST over-cap number
 *  inside each top-level slot (array index / map key) - so a nested cap error
 *  points at the offending number's line, not the slot's opening line. Depth +
 *  string aware; numbers are checked against the same scalar caps. */
export function overCapNumberLines(codeText: string): Map<number | string, number> {
  const lines = new Map<number | string, number>()
  const c = newCapCursor()
  for (let i = 0; i <= codeText.length; i++) {
    const ch = i < codeText.length ? codeText[i] : ' '
    flushNumber(codeText, i, ch, c, lines)
    if (i >= codeText.length) break
    if (ch === '\n') {
      c.line++
      continue
    }
    if (c.inString) {
      stepInString(codeText, i, c)
      continue
    }
    if (isJsonWs(ch)) continue
    stepStructural(i, ch, c)
  }
  return lines
}

// ---------------------------------------------------------------------------
// String-only maps: each value is a LITERAL or a whole-value
// EXPRESSION. Code view is valid-JSON-shaped: a quoted string is a literal
// (a literal `{{ }}` inside quotes stays literal), a bare `{{ expr }}` (unquoted
// value) is an expression carrying the raw expression text. Expression-ness is
// a sidecar set of keys, never embedded in the stored value.
// ---------------------------------------------------------------------------

/** The exact rejection for any value that is neither a quoted string nor a
 *  bare {{ }} expression. */
function nonStringValueMessage(key: string): string {
  return `Key "${key}": value must be a quoted string or a {{ expression }}`
}

/** Private-use-area sentinel prefix a bare {{ }} value is swapped to so the
 *  surrounding document parses as JSON; a real literal never contains it.
 *  Exported so nested codecs (e.g. multipart parts) share one grammar. */
export const EXPR_SENTINEL = String.fromCodePoint(0xe000)

/** Index just past the {{ }} pair opening at `start`, or -1 when unterminated.
 *  Single braces inside the expression are ignored; only {{ }} pairs nest. */
function bareExpressionEnd(text: string, start: number): number {
  let depth = 0
  let j = start
  while (j < text.length) {
    if (text[j] === '{' && text[j + 1] === '{') {
      depth++
      j += 2
    } else if (text[j] === '}' && text[j + 1] === '}') {
      depth--
      j += 2
      if (depth === 0) return j
    } else {
      j++
    }
  }
  return -1
}

/** Advance the JSON-string escape state over one in-string character. */
function stepStringState(ch: string, state: { inString: boolean; escaped: boolean }): void {
  if (state.escaped) state.escaped = false
  else if (ch === '\\') state.escaped = true
  else if (ch === '"') state.inString = false
}

/** Walk the text, replacing each bare (unquoted) {{ }} token via `replace` and
 *  copying the rest verbatim. A {{ inside a JSON string is left untouched; an
 *  unterminated {{ leaves the remainder verbatim so JSON.parse reports it. */
function mapBareExpressions(text: string, replace: (token: string) => string): string {
  const state = { inString: false, escaped: false }
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (state.inString) {
      out += ch
      stepStringState(ch, state)
      i++
      continue
    }
    if (ch === '"') {
      state.inString = true
      out += ch
      i++
      continue
    }
    if (ch === '{' && text[i + 1] === '{') {
      const end = bareExpressionEnd(text, i)
      if (end === -1) {
        out += text.slice(i)
        break
      }
      out += replace(text.slice(i, end))
      i = end
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Swap every bare (unquoted) {{ }} value for a sentinel JSON string so the
 *  document parses as JSON; returns the transformed text + the captured raw
 *  expression texts (indexed). Exported so nested codecs (e.g. multipart parts)
 *  share one grammar. */
export function extractBareExpressions(text: string): { transformed: string; exprs: string[] } {
  const exprs: string[] = []
  const transformed = mapBareExpressions(text, (token) => {
    exprs.push(token.slice(2, -2).trim())
    return JSON.stringify(`${EXPR_SENTINEL}${exprs.length - 1}`)
  })
  return { transformed, exprs }
}

/** Mask every bare (unquoted) {{ }} token as a SAME-LENGTH quoted string so the
 *  document lints as valid JSON while character offsets stay put (the JSON linter
 *  reports positions against the original text). Empty {{}} masks to a string too. */
export function maskBareExpressionsForLint(text: string): string {
  return mapBareExpressions(text, (token) => `"${'x'.repeat(token.length - 2)}"`)
}

/** Serialize a string-only map to Code text: expression keys render as bare
 *  `{{ <raw expression> }}`, every other key as a JSON-quoted literal. */
export function serializeStringMapForCode(
  value: Record<string, string>,
  exprKeys: ReadonlySet<string> = new Set(),
): string {
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const body = keys
    .map((key) => {
      const rendered = exprKeys.has(key)
        ? `{{ ${String(value[key])} }}`
        : JSON.stringify(String(value[key]))
      return `  ${JSON.stringify(key)}: ${rendered}`
    })
    .join(',\n')
  return `{\n${body}\n}`
}

/** Parse string-map Code text into its literal values, expression keys, and
 *  per-member rejections. A bare {{ }} value yields an expression key holding
 *  the raw expression text; a quoted string is a literal (verbatim, braces and
 *  all); anything else is rejected. Throws on invalid JSON and on a whole text
 *  that is not a map (caller renders the message). */
export function parseStringMapCode(text: string): {
  value: Record<string, string>
  exprKeys: string[]
  errors: string[]
} {
  const value: Record<string, string> = {}
  const exprKeys: string[] = []
  const errors: string[] = []
  const { transformed, exprs } = extractBareExpressions(text)
  const parsed = codeObject(JSON.parse(transformed))
  for (const [key, member] of Object.entries(parsed)) {
    if (typeof member === 'string' && member.startsWith(EXPR_SENTINEL)) {
      value[key] = exprs[Number(member.slice(EXPR_SENTINEL.length))]
      exprKeys.push(key)
    } else if (typeof member === 'string') {
      value[key] = member
    } else {
      errors.push(nonStringValueMessage(key))
    }
  }
  return { value, exprKeys, errors }
}

interface DupScanCursor {
  depth: number
  inString: boolean
  escaped: boolean
  stringStart: number
  expectingKey: boolean
}

/** A just-closed depth-1 string is a member key when a colon follows. */
function scanKeyAt(text: string, closeIndex: number, openIndex: number): string | null {
  let j = closeIndex + 1
  while (j < text.length && isJsonWs(text[j])) j++
  if (text[j] !== ':') return null
  return JSON.parse(text.slice(openIndex, closeIndex + 1)) as string
}

/** Advance the cursor over one in-string character; returns the member key
 *  whose closing quote sits at `i`, when there is one. */
function stepDupScanInString(text: string, i: number, c: DupScanCursor): string | null {
  const ch = text[i]
  if (c.escaped) {
    c.escaped = false
    return null
  }
  if (ch === '\\') {
    c.escaped = true
    return null
  }
  if (ch !== '"') return null
  c.inString = false
  if (c.depth !== 1 || !c.expectingKey) return null
  return scanKeyAt(text, i, c.stringStart)
}

/** Advance the cursor over one structural (non-string) character. */
function stepDupScanStructural(i: number, ch: string, c: DupScanCursor): void {
  if (ch === '"') {
    c.inString = true
    c.stringStart = i
  } else if (ch === '{' || ch === '[') {
    c.depth++
    if (c.depth === 1 && ch === '{') c.expectingKey = true
  } else if (ch === '}' || ch === ']') {
    c.depth--
  } else if (ch === ',' && c.depth === 1) {
    c.expectingKey = true
  }
}

/** Register a scanned member key; returns the FIRST-seen casing when `key` is
 *  a not-yet-reported duplicate, null otherwise. */
function recordMemberKey(
  key: string,
  caseInsensitive: boolean,
  firstSeen: Map<string, string>,
  reported: Set<string>,
): string | null {
  const canonical = caseInsensitive ? key.toLowerCase() : key
  const first = firstSeen.get(canonical)
  if (first === undefined) {
    firstSeen.set(canonical, key)
    return null
  }
  if (reported.has(canonical)) return null
  reported.add(canonical)
  return first
}

/** Source-level top-level duplicate member scan (JSON.parse silently keeps the
 *  last duplicate). Returns each duplicated key once, in first-seen order,
 *  rendered with its FIRST-seen casing; `caseInsensitive` groups header-style. */
export function scanDuplicateMapMemberKeys(text: string, caseInsensitive = false): string[] {
  const c: DupScanCursor = { depth: 0, inString: false, escaped: false, stringStart: -1, expectingKey: false }
  const firstSeen = new Map<string, string>()
  const duplicates: string[] = []
  const reported = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    if (!c.inString) {
      stepDupScanStructural(i, text[i], c)
      continue
    }
    const key = stepDupScanInString(text, i, c)
    if (key !== null) {
      c.expectingKey = false
      const duplicate = recordMemberKey(key, caseInsensitive, firstSeen, reported)
      if (duplicate !== null) duplicates.push(duplicate)
    }
  }
  return duplicates
}

function renderColumnError(error: TableColumnError): string {
  switch (error.kind) {
    case 'empty':
      return `Column ${error.position} needs a name`
    case 'duplicate':
      return `Duplicate column name "${error.name}"`
    case 'unexpected':
      return `Unexpected column "${error.name}" - change columns in the Visual view`
    case 'missing':
      return `Missing column "${error.name}" - change columns in the Visual view`
  }
}

function renderCellError(error: TableCellError): string {
  const where = `Row ${error.row} "${error.column}"`
  const short = error.reason === undefined ? `expected ${error.expected}` : numberProblemShort(error.reason, error.expected as NumberType)
  return `${where}: ${short}`
}

/**
 * Every validation problem rendered as a message, in strip priority order:
 * structure first, then column errors (column order), then cell errors
 * (row-major). Drives the strip's count and the expandable "(+N more)" list.
 * When `cellLine` is supplied (the Code editor's cell-to-line map), each cell error
 * is prefixed with the JSON line its bad cell sits on.
 */
export function tableErrorMessages(
  result: TableValidationResult,
  cellLine?: (row: number, column: string) => number | null,
): string[] {
  const messages: string[] = []
  if (result.structureError !== null) messages.push(result.structureError)
  for (const error of result.columnErrors) messages.push(renderColumnError(error))
  for (const error of result.cellErrors) {
    const base = renderCellError(error)
    const line = cellLine?.(error.row, error.column) ?? null
    messages.push(line === null ? base : `Line ${line}: ${base}`)
  }
  return messages
}

/**
 * The single validation-strip line: the highest-priority problem with a
 * `(+N more)` count when several problems exist, or null when clean.
 */
export function firstTableErrorMessage(
  result: TableValidationResult,
  cellLine?: (row: number, column: string) => number | null,
): string | null {
  const messages = tableErrorMessages(result, cellLine)
  if (messages.length === 0) return null
  return messages.length > 1 ? `${messages[0]} (+${messages.length - 1} more)` : messages[0]
}

/**
 * Seed the carried column schema (names + types) the host and body share, so an
 * explicit Visual type survives a Visual -> Code -> Visual round trip instead of
 * being re-inferred. A dict column's explicit type is preserved; otherwise the
 * type is inferred from the first row cell. Empty array / non-table -> [].
 */
export function deriveTableSchema(value: unknown): TableColumnSchema[] {
  const model = toTableRenderModel(value)
  const firstRow = model.rows[0] ?? []
  return model.columns.map((column, index) => ({
    name: column.name,
    type:
      column.type === undefined
        ? inferColumnType(firstRow[index])
        : (column.type as ColumnType),
  }))
}
