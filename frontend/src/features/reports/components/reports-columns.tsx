/**
 * Column definitions for the Reports DataTable (RVIEW-11, RVIEW-12).
 *
 * Common columns (name, status, duration, actions) come from the shared
 * column-factories. The Report cell keys off the JSON artifact only - the
 * viewer consumes JSON, so an HTML-only directory still reads "Not
 * generated". Both row actions open the viewer; the viewer owns generation.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { Eye, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  durationColumn,
  nameColumn,
  statusColumn,
} from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { EntityTypeChip } from '@/components/shared/entity-type-chip'
import { formatDuration } from '@/lib/format-duration'
import { formatBytes } from '@/lib/format-bytes'
import type { ReportListRow } from '@/features/reports/api/types'

export interface ReportsColumnCallbacks {
  onRowClick: (executionId: string) => void
  onView: (executionId: string) => void
}

function ReportCell({ row }: Readonly<{ row: ReportListRow }>) {
  const json = row.reports.json
  if (!json) {
    return (
      <span data-testid="report-cell">
        <span className="italic text-muted-foreground">Not generated</span>
      </span>
    )
  }
  return (
    <span data-testid="report-cell" className="whitespace-nowrap">
      Generated <Timestamp value={json.generated_at} style="relative" />{' '}
      <span className="text-muted-foreground">&middot; {formatBytes(json.size_bytes)}</span>
    </span>
  )
}

function ReportRowActions({
  row,
  onView,
}: Readonly<{ row: ReportListRow; onView: (executionId: string) => void }>) {
  if (row.reports.json) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          data-testid="row-action-view"
          aria-label="View report"
          onClick={() => onView(row.execution.id)}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        data-testid="row-action-generate"
        aria-label="Generate report"
        onClick={() => onView(row.execution.id)}
      >
        <FilePlus2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function getReportsColumns(
  callbacks: ReportsColumnCallbacks,
): ColumnDef<ReportListRow, unknown>[] {
  return [
    nameColumn<ReportListRow>({
      accessor: (row) => row.execution.name,
      testId: 'report-name',
      onClick: (row) => callbacks.onRowClick(row.execution.id),
    }),
    {
      id: 'type',
      accessorFn: (row) => row.execution.entity_type,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Type" />,
      cell: ({ row }) => (
        <EntityTypeChip
          type={row.original.execution.entity_type}
          showIcon
          data-testid="report-type"
        />
      ),
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    statusColumn<ReportListRow>({
      accessor: (row) => row.execution.status,
      testIdPrefix: 'report',
    }),
    {
      id: 'finishedAt',
      accessorFn: (row) => row.execution.ended_at,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Finished" />,
      cell: ({ row }) => (
        <RelativeTimeCell
          dateString={row.original.execution.ended_at}
          data-testid="report-finished-at"
        />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    durationColumn<ReportListRow>({
      accessor: (row) => formatDuration(row.execution.duration),
      testId: 'report-duration',
    }),
    {
      id: 'report',
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Report" />,
      cell: ({ row }) => <ReportCell row={row.original} />,
      meta: { skeletonWidth: 'w-32' } satisfies DataTableColumnMeta,
    },
    actionsColumn<ReportListRow>({
      render: (row) => <ReportRowActions row={row} onView={callbacks.onView} />,
    }),
  ]
}
