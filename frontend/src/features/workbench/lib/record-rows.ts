/**
 * List settings stored as record rows `[{value: x}]` (Shell / Python Arguments, SQL Out arguments, OpenSearch
 * Fields and Stats): the list editor works on the plain items, the Block keeps the rows.
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 */

/** One stored row of a record-row list. */
export interface RecordRow {
  value: unknown
}

function isRecordRow(row: unknown): row is RecordRow {
  return typeof row === 'object' && row !== null && !Array.isArray(row)
}

/** The plain items of stored rows; a row that is not a record reads as itself. */
export function recordItems(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => (isRecordRow(row) ? row.value : row))
}

/** The stored rows of plain items. */
export function recordRows(items: readonly unknown[]): RecordRow[] {
  return items.map((value) => ({ value }))
}
