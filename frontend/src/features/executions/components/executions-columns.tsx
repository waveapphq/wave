/**
 * Column definitions for the Executions DataTable.
 *
 * Common columns (name, status, duration, actions) come from the shared
 * column-factories. Type, triggeredBy, and startedAt stay inline because
 * they don't match a factory shape.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  durationColumn,
  nameColumn,
  statusColumn,
} from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { formatDuration } from '@/lib/format-duration'
import { ExecutionsRowActions } from '@/features/executions/components/executions-row-actions'
import type { Execution, ExecutionType } from '@/features/executions/api/types'

export interface ExecutionsColumnCallbacks {
  onRowClick: (executionId: string) => void
  onView: (executionId: string) => void
  onExport: (executionId: string) => void
  onRerun: (executionId: string) => void
  onStop: (executionId: string) => void
  onDelete: (executionId: string) => void
}

function getTypeLabel(type: ExecutionType): string {
  switch (type) {
    case 'test':
      return 'Test'
    case 'suite':
      return 'Suite'
    case 'regression':
      return 'Regression'
  }
}

export function getExecutionsColumns(
  callbacks: ExecutionsColumnCallbacks,
): ColumnDef<Execution, unknown>[] {
  return [
    nameColumn<Execution>({
      accessor: (row) => row.name,
      testId: 'execution-name',
      onClick: (row) => callbacks.onRowClick(row.id),
    }),
    {
      id: 'type',
      accessorKey: 'type',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Type" />
      ),
      cell: ({ row }) => (
        <span data-testid="execution-type">{getTypeLabel(row.original.type)}</span>
      ),
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    {
      id: 'triggeredBy',
      accessorKey: 'triggeredBy',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Triggered By" />
      ),
      cell: ({ row }) => (
        <span data-testid="execution-triggered-by">{row.original.triggeredBy}</span>
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    {
      id: 'startedAt',
      accessorKey: 'startedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Started" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.startedAt} data-testid="execution-started-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    durationColumn<Execution>({
      accessor: (row) => row.durationFormatted ?? formatDuration(row.duration),
      testId: 'execution-duration',
    }),
    statusColumn<Execution>({
      accessor: (row) => row.status,
      testIdPrefix: 'execution',
    }),
    actionsColumn<Execution>({
      render: (row) => (
        <ExecutionsRowActions
          execution={row}
          onView={callbacks.onView}
          onExport={callbacks.onExport}
          onRerun={callbacks.onRerun}
          onStop={callbacks.onStop}
          onDelete={callbacks.onDelete}
        />
      ),
    }),
  ]
}
