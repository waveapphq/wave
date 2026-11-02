/**
 * Pure column-width helpers for the controlled table edit body. The widths live
 * in useComplexValueEditor (so they survive a Visual <-> Code round trip and the
 * body unmount) and are seeded / fitted here from the table value or model. The
 * edit body's inline header (name + type pill + kebab) needs a wider floor and
 * extra room beside the first text than the read grid, so these wrap
 * fitColumnWidth with the edit-specific minimum + control room.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { formatValue } from '@/lib/variable-validation'
import { toTableRenderModel } from '@/lib/variable-table-model'
import {
  fitColumnWidth,
  hasTextMetrics,
} from '@/components/shared/variable-bodies/use-resizable-columns'

/** No-metrics fallback (jsdom / SSR) and the inline-header floor - both the min. */
export const EDIT_COLUMN_WIDTH = 180
export const EDIT_MIN_COLUMN_WIDTH = 180
/** Room the type pill + kebab add beside the column name in the inline header. */
const HEADER_CONTROLS_WIDTH = 140

/** Auto-fit width for one edit column: its header (with control room) + cells. */
export function fitTableEditColumn(
  headers: readonly string[],
  rows: readonly (string | null)[][],
  index: number,
): number {
  return fitColumnWidth(
    [headers[index], ...rows.map((row) => row[index] ?? 'null')],
    { minWidth: EDIT_MIN_COLUMN_WIDTH, firstExtra: HEADER_CONTROLS_WIDTH },
  )
}

/** Per-column seed widths: auto-fit when text metrics exist, else the fallback. */
export function seedTableEditWidths(
  headers: readonly string[],
  rows: readonly (string | null)[][],
): number[] {
  return hasTextMetrics()
    ? headers.map((_header, index) => fitTableEditColumn(headers, rows, index))
    : headers.map(() => EDIT_COLUMN_WIDTH)
}

/** Seed widths straight from a table value (the columns / cells it normalizes to). */
export function seedTableEditWidthsFromValue(value: unknown): number[] {
  const model = toTableRenderModel(value)
  const headers = model.columns.map((column) => column.name)
  const rows = model.rows.map((row) =>
    model.columns.map((_column, index) => {
      const cell = row[index]
      return cell == null ? null : formatValue(cell)
    }),
  )
  return seedTableEditWidths(headers, rows)
}

/** Width for a freshly added empty column - its header plus the control room. */
export function newTableColumnWidth(header: string): number {
  return fitTableEditColumn([header], [], 0)
}
