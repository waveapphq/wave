/**
 * Column definitions for the execution-first artifacts DataTable.
 *
 * Execution (name, opens the drill), Type, Status, Finished, Artifacts (count),
 * Size (rollup bytes), and a row-actions column (open / download .zip / delete).
 */

import type { ColumnDef } from '@tanstack/react-table'
import { Archive } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  nameColumn,
  statusColumn,
} from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { formatBytes } from '@/lib/format-bytes'
import { ArtifactsRowActions } from '@/features/artifacts/components/artifacts-row-actions'
import { EntityTypeChip } from '@/components/shared/entity-type-chip'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

export interface ArtifactsColumnCallbacks {
  onOpen: (execution: ExecutionArtifactSummary) => void
  onDownloadZip: (execution: ExecutionArtifactSummary) => void
  onDelete: (execution: ExecutionArtifactSummary) => void
}

export function getArtifactsColumns(
  callbacks: ArtifactsColumnCallbacks,
): ColumnDef<ExecutionArtifactSummary, unknown>[] {
  return [
    nameColumn<ExecutionArtifactSummary>({
      id: 'execution',
      label: 'Execution',
      accessor: (row) => row.name ?? '',
      testId: 'artifact-execution',
      onClick: (row) => callbacks.onOpen(row),
    }),
    {
      id: 'type',
      accessorFn: (row) => row.entity_type,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Type" />,
      cell: ({ row }) => (
        <EntityTypeChip type={row.original.entity_type} showIcon data-testid="artifact-type" />
      ),
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    statusColumn<ExecutionArtifactSummary>({
      accessor: (row) => row.status ?? '',
      testIdPrefix: 'artifact',
    }),
    {
      id: 'finishedAt',
      accessorFn: (row) => row.finished_at,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Finished" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.finished_at} data-testid="artifact-finished-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    {
      id: 'artifacts',
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Artifacts" />,
      cell: ({ row }) => (
        <span data-testid="artifact-count" className="flex items-center gap-1.5">
          <Archive className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          {row.original.artifact_count}
        </span>
      ),
      meta: { skeletonWidth: 'w-12' } satisfies DataTableColumnMeta,
    },
    {
      id: 'size',
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Size" />,
      cell: ({ row }) => (
        <span data-testid="artifact-size">{formatBytes(row.original.total_size_bytes)}</span>
      ),
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    actionsColumn<ExecutionArtifactSummary>({
      render: (row) => (
        <ArtifactsRowActions
          execution={row}
          onOpen={callbacks.onOpen}
          onDownloadZip={callbacks.onDownloadZip}
          onDelete={callbacks.onDelete}
        />
      ),
    }),
  ]
}
