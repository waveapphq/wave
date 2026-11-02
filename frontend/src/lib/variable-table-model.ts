/**
 * Table render model normalizer for the table value bodies.
 *
 * The render edge sees two stored table shapes: array-of-row-objects
 * (FE design-time values) and the {columns, rows} dict (core Table
 * serialization / the workbench session variables endpoint). Anything
 * else normalizes to the defensive empty model.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

export interface TableRenderColumn {
  name: string
  type?: string
}

export interface TableRenderModel {
  columns: TableRenderColumn[]
  rows: unknown[][]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isColumnsRowsDict(
  value: unknown,
): value is { columns: unknown[]; rows: unknown[][] } {
  if (!isPlainObject(value)) return false
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return false
  const columnsValid = value.columns.every(
    (column) => isPlainObject(column) && typeof column.name === 'string',
  )
  return columnsValid && value.rows.every((row) => Array.isArray(row))
}

function isRowObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((row) => isPlainObject(row))
  )
}

/** True for the two stored table shapes: array of plain row objects (empty ok) or a {columns, rows} dict. */
export function isTableShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((row) => isPlainObject(row))
  return isPlainObject(value) && Array.isArray(value.columns) && Array.isArray(value.rows)
}

/** {columns, rows} dict -> array-of-row-objects (Code view shape); all else passes through. */
export function tableDictToRowObjects(value: unknown): unknown {
  if (!isColumnsRowsDict(value)) return value
  const model = toTableRenderModel(value)
  return model.rows.map((row) =>
    Object.fromEntries(model.columns.map((column, index) => [column.name, row[index]])),
  )
}

/** A table as stored: {columns, rows} under the schema's names and types, cells as
 *  written (REQ-3.5.5.4); a value with no column to type passes through. */
export function toStoredTable(
  value: unknown,
  schema: readonly { name: string; type: string }[],
): unknown {
  const rows = tableDictToRowObjects(value)
  if (schema.length === 0 || !Array.isArray(rows) || !rows.every(isPlainObject)) return value
  return {
    columns: schema.map(({ name, type }) => ({ name, type })),
    rows: rows.map((row: Record<string, unknown>) => schema.map(({ name }) => row[name])),
  }
}

export function toTableRenderModel(value: unknown): TableRenderModel {
  if (isColumnsRowsDict(value)) {
    return {
      columns: value.columns.map((column) => {
        const entry = column as Record<string, unknown>
        return {
          name: String(entry.name),
          type: typeof entry.type === 'string' ? entry.type : undefined,
        }
      }),
      rows: value.rows.map((row) => [...row]),
    }
  }
  if (isRowObjectArray(value)) {
    const columnNames = Object.keys(value[0])
    return {
      columns: columnNames.map((name) => ({ name, type: undefined })),
      rows: value.map((row) => columnNames.map((name) => row[name])),
    }
  }
  return { columns: [], rows: [] }
}
