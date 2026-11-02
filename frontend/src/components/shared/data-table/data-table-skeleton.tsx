/**
 * Skeleton loading rows for DataTable.
 *
 * Renders placeholder rows with animated skeleton bars,
 * deriving column count and widths from column definitions.
 */

import type { ColumnDef } from '@tanstack/react-table'
/* v8 ignore next - COV-V8-006: V8 coverage merge non-deterministically drops this import across forks pool */
import { Skeleton } from '@/components/ui/skeleton'
import { cn, secureRandom } from '@/lib/utils'
import type { DataTableColumnMeta } from './types'

interface DataTableSkeletonProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  rowCount?: number
  enableSelection?: boolean
}

export function DataTableSkeleton<TData>({
  columns,
  rowCount = 9,
  enableSelection = false,
}: Readonly<DataTableSkeletonProps<TData>>) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`} data-testid="skeleton-row" className="border-b border-border">
          {enableSelection && (
            <td className="sticky left-0 bg-card px-2 py-3">
              <Skeleton className="h-4 w-4" />
            </td>
          )}
          {columns.map((col, colIndex) => {
            const meta = col.meta as DataTableColumnMeta | undefined
            /* v8 ignore next - COV-V8-003: V8 tracks ?? fallback as branch */
            const width = meta?.skeletonWidth ?? `w-[${Math.floor(60 + secureRandom() * 30)}%]`
            const height = meta?.skeletonHeight ?? 'h-4'

            return (
              <td
                key={`skeleton-${rowIndex}-${colIndex}`}
                className={cn(
                  'px-4 py-3',
                  meta?.sticky === 'left' && 'sticky left-0 bg-card',
                  meta?.sticky === 'right' && 'sticky right-0 bg-card',
                )}
              > {/* v8 ignore next - COV-V8-003: V8 tracks cn() as branch */}
                <Skeleton data-testid="skeleton-bar" className={cn(height, width)} />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
