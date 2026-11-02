/**
 * TableBody - shared table mini-grid Visual body over the shared ValueGrid
 * (resizable columns). A muted right-aligned 0-based row-index "#" column (fixed,
 * non-resizable) precedes the model's data columns; per-cell tint; the 500-row
 * Visual cap with the overflow line.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import {
  formatCellText,
  getCellColorClass,
  inferRenderType,
} from '@/lib/variable-format'
import { toTableRenderModel } from '@/lib/variable-table-model'
import {
  ValueGrid,
  type ValueGridColumn,
  type ValueGridRow,
} from '@/components/shared/variable-bodies/value-grid'
import type { ComplexBodyProps } from '@/components/shared/variable-bodies/body-parts'

const INDEX_COLUMN: ValueGridColumn = {
  key: '__rowindex__',
  header: '#',
  width: 30,
  align: 'right',
  resizable: false,
  ariaLabel: 'Row index',
}

export function TableBody({ value, variant }: Readonly<ComplexBodyProps>) {
  const model = toTableRenderModel(value)

  const columns: ValueGridColumn[] = [
    INDEX_COLUMN,
    ...model.columns.map((column) => ({ key: column.name, header: column.name, width: 140 })),
  ]

  const rows: ValueGridRow[] = model.rows.map((row, rowIndex) => ({
    id: `row-${rowIndex}`,
    cells: [
      {
        content: rowIndex,
        className: 'text-right text-xs text-muted-foreground',
        testId: 'table-row-index',
      },
      ...model.columns.map((_column, columnIndex) => ({
        content: formatCellText(row[columnIndex]),
        className: getCellColorClass(inferRenderType(row[columnIndex])),
      })),
    ],
  }))

  return (
    <ValueGrid
      data-testid="table-body"
      columns={columns}
      rows={rows}
      variant={variant}
      emptyLabel="no rows"
      keepHeaderWhenEmpty={model.columns.length > 0}
    />
  )
}
