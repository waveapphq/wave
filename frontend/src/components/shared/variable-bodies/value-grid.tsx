/**
 * ValueGrid - the shared resizable-column grid behind the map + table Visual
 * bodies. Fixed table layout with a <colgroup> of per-column pixel widths, a
 * sticky uppercase header with a drag handle on each resizable column's right
 * edge, per-cell tint, scroll, and the 500-row Visual cap with the overflow line.
 *
 * The caller supplies columns (header + width + align) and rows of cells
 * (content + tint), so map (Key | Value) and table (# + data columns) share one
 * grid. Width / resize / auto-fit live in useResizableColumns, shared with the
 * table edit body; widths are transient (re-seeded when the column set changes).
 *
 * (Distinct from `components/shared/data-table` - that is the TanStack-backed
 * entity-list table; this is the small read-only value-body grid.)
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import {
  BodyEmptyLine,
  BodyOverflowLine,
  VISUAL_CAP,
} from '@/components/shared/variable-bodies/body-parts'
import {
  fitColumnWidth,
  hasTextMetrics,
  useResizableColumns,
} from '@/components/shared/variable-bodies/use-resizable-columns'

function cellText(content: ReactNode): string {
  return typeof content === 'string' || typeof content === 'number' ? String(content) : ''
}

export interface ValueGridColumn {
  /** Unique column key (also the React key). */
  key: string
  header: string
  width: number
  align?: 'left' | 'right'
  /** Resizable by default; set false for the fixed row-index column. */
  resizable?: boolean
  /** Screen-reader name when the visible header is a glyph (e.g. "#"). */
  ariaLabel?: string
}

export interface ValueGridCell {
  content: ReactNode
  className?: string
  testId?: string
}

export interface ValueGridRow {
  id: string
  cells: ValueGridCell[]
  testId?: string
}

export interface ValueGridProps {
  columns: ValueGridColumn[]
  rows: ValueGridRow[]
  variant: 'current' | 'initial'
  emptyLabel: string
  /** Keep the column header above the empty label, for a value whose columns are known without rows. */
  keepHeaderWhenEmpty?: boolean
  'data-testid': string
}

/** Texts measured to auto-fit column `index`: its header + every visible cell. */
function columnTexts(
  columns: ValueGridColumn[],
  rows: ValueGridRow[],
  index: number,
): string[] {
  return [columns[index].header, ...rows.map((row) => cellText(row.cells[index]?.content))]
}

const HEADER_CELL_CLASS =
  'sticky top-0 z-10 bg-muted px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

export function ValueGrid({
  columns,
  rows,
  variant,
  emptyLabel,
  keepHeaderWhenEmpty = false,
  'data-testid': testId,
}: Readonly<ValueGridProps>) {
  const columnSig = columns.map((column) => column.key).join('|')
  // Non-resizable columns (the row-index "#") are fixed, not content - they keep
  // their configured width; only content columns auto-fit.
  const seed = (): number[] => {
    const metrics = hasTextMetrics()
    const visible = rows.slice(0, VISUAL_CAP)
    return columns.map((column, index) =>
      metrics && column.resizable !== false
        ? fitColumnWidth(columnTexts(columns, visible, index))
        : column.width,
    )
  }
  const fit = (index: number): number =>
    fitColumnWidth(columnTexts(columns, rows.slice(0, VISUAL_CAP), index))

  const { widths, startResize, fitColumn } = useResizableColumns({ columnSig, seed, fit })

  const visible = rows.slice(0, VISUAL_CAP)
  const hiddenCount = rows.length - visible.length
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)

  return (
    <div
      data-testid={testId}
      className={cn(
        'flex h-full flex-col font-mono text-[12.5px] select-text',
        variant === 'initial' && 'italic opacity-70',
      )}
    >
      {rows.length === 0 && !keepHeaderWhenEmpty ? (
        <BodyEmptyLine label={emptyLabel} />
      ) : (
        <div className={cn('min-h-0 overflow-x-auto overflow-y-auto', rows.length > 0 && 'grow')}>
          <table
            className="border-collapse"
            // Exactly the sum of the column widths (no `minWidth: 100%`): a
            // fixed-layout table stretches its columns to fill any extra width,
            // which would override the colgroup widths and hide resize/auto-fit.
            style={{ tableLayout: 'fixed', width: `${totalWidth}px` }}
          >
            <colgroup>
              {columns.map((column, index) => (
                <col key={column.key} style={{ width: `${widths[index]}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-label={column.ariaLabel}
                    // `sticky` (from HEADER_CELL_CLASS) is the positioning context
                    // for the absolute resize handle - do NOT add `relative` here
                    // (tailwind-merge would drop `sticky`, un-sticking the header).
                    className={cn(
                      HEADER_CELL_CLASS,
                      column.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <span className="block truncate">{column.header}</span>
                    {column.resizable !== false && (
                      <ConditionalTooltip content="Drag to resize, double-click to fit">
                      <span
                        data-testid={`${testId}-col-resize-${index}`}
                        aria-hidden="true"
                        onMouseDown={(event) => startResize(index, event)}
                        onDoubleClick={() => fitColumn(index)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30"
                      />
                      </ConditionalTooltip>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  data-testid={row.testId}
                  className="border-b border-border/40 last:border-b-0"
                >
                  {row.cells.map((cell, index) => (
                    <td
                      key={columns[index].key}
                      data-testid={cell.testId}
                      className={cn(
                        'px-2 py-1.5 align-top whitespace-pre-wrap break-words',
                        cell.className,
                      )}
                    >
                      {cell.content}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hiddenCount > 0 && <BodyOverflowLine hiddenCount={hiddenCount} />}
        </div>
      )}
      {rows.length === 0 && keepHeaderWhenEmpty && (
        <div className="min-h-0 grow">
          <BodyEmptyLine label={emptyLabel} />
        </div>
      )}
    </div>
  )
}
