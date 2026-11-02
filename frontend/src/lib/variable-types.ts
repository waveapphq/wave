/**
 * Shared variable type definitions.
 *
 * Single source of truth for variable types used by both
 * System Variables (settings) and Suite Variables (suite detail).
 */

import { randomUUID } from '@/lib/uuid'
import { plainNumberText } from '@/lib/number-rule'
import type { ElementTypes } from '@/lib/variable-validation'

export type VariableType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

export const VARIABLE_TYPES: VariableType[] = [
  'string', 'integer', 'float', 'boolean', 'array', 'map', 'table',
]

export const TYPE_LABELS: Record<VariableType, string> = {
  string: 'String',
  integer: 'Integer',
  float: 'Float',
  boolean: 'Boolean',
  array: 'Array',
  map: 'Map',
  table: 'Table',
}

export interface VariableRow {
  id: string
  name: string
  type: VariableType
  secret: boolean
  value: string
  /** Array / map only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** Variable as stored in the API (Record values). */
export interface VariableRecord {
  type: VariableType
  value: string
  secret: boolean
  elementTypes?: ElementTypes
}

const ELEMENT_TYPED = new Set<VariableType>(['array', 'map'])
const COMPLEX_TYPES = new Set<VariableType>(['array', 'map', 'table'])

/** An entity row's stored value as the shared value cell edits it; unparsable complex text seeds an empty shape. */
export function parseEntityCellValue(type: VariableType, value: unknown): unknown {
  if (type === 'boolean') return value === true || value === 'true'
  if (!COMPLEX_TYPES.has(type)) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return type === 'map' ? {} : []
  }
}

/** The shared value cell's value in the entity row's stored shape: numbers as exact text, the rest verbatim. */
export function toEntityStoredValue(type: VariableType, value: unknown): unknown {
  if (type !== 'integer' && type !== 'float') return value
  return typeof value === 'number' ? plainNumberText(value) : String(value)
}

/** Convert a Record of variables to VariableRow[]. */
export function recordToRows(record: Record<string, VariableRecord>): VariableRow[] {
  return Object.entries(record).map(([name, v]) => {
    const row: VariableRow = {
      id: randomUUID(),
      name,
      type: v.type,
      secret: v.secret,
      value: v.value,
    }
    if (v.elementTypes !== undefined) row.elementTypes = v.elementTypes
    return row
  })
}

/** Convert VariableRow[] back to a Record. Skips empty names; element types ride
 *  only on an array / map. */
export function rowsToRecord(
  rows: VariableRow[],
): Record<string, VariableRecord> {
  const result: Record<string, VariableRecord> = {}
  for (const row of rows) {
    if (!row.name.trim()) continue
    const record: VariableRecord = { type: row.type, value: row.value, secret: row.secret }
    if (row.elementTypes !== undefined && ELEMENT_TYPED.has(row.type)) {
      record.elementTypes = row.elementTypes
    }
    result[row.name] = record
  }
  return result
}

/** The edited rows would save something other than the stored record: a changed
 *  name, type, value (structures compared by content), secret flag or element types. */
export function variableRowsDiffer(
  stored: Record<string, VariableRecord>,
  rows: VariableRow[],
): boolean {
  const current = Object.entries(stored).map(([name, v]) =>
    JSON.stringify([name, v.type, v.value, v.secret, v.elementTypes ?? null]),
  )
  const edited = rows.map((row) =>
    JSON.stringify([row.name, row.type, row.value, row.secret, row.elementTypes ?? null]),
  )
  return JSON.stringify(edited) !== JSON.stringify(current)
}

/** Duplicate selected rows, generating unique `_copy` names. */
export function duplicateRows(
  rows: VariableRow[],
  selectedIds: Set<string>,
): VariableRow[] {
  const existingNames = new Set(rows.map((r) => r.name))
  const newRows: VariableRow[] = []
  for (const id of selectedIds) {
    const source = rows.find((r) => r.id === id)
    if (!source) continue
    let copyName = `${source.name}_copy`
    let counter = 2
    while (existingNames.has(copyName)) {
      copyName = `${source.name}_copy_${counter}`
      counter++
    }
    existingNames.add(copyName)
    newRows.push({
      id: randomUUID(),
      name: copyName,
      type: source.type,
      secret: source.secret,
      value: source.value,
      ...(source.elementTypes === undefined ? {} : { elementTypes: source.elementTypes }),
    })
  }
  return newRows
}

/** Remove selected rows. */
export function deleteRows(
  rows: VariableRow[],
  selectedIds: Set<string>,
): VariableRow[] {
  return rows.filter((row) => !selectedIds.has(row.id))
}
