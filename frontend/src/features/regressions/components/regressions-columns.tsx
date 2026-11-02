/**
 * Column definitions for the Regressions DataTable.
 *
 * Common columns (name, status, tags, count, actions) come from the shared
 * column-factories. Relative-time columns stay inline since they're not
 * covered by a factory yet.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import {
  actionsColumn,
  countColumn,
  nameColumn,
  statusColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { RegressionsRowActions } from '@/features/regressions/components/regressions-row-actions'

export interface RegressionsColumnCallbacks {
  onRowClick: (regressionId: string) => void
  onRunRegression: (regressionId: string) => void
  onEditRegression: (regressionId: string) => void
  onDeleteRegression: (regressionId: string) => void
  onDuplicateRegression: (regressionId: string) => void
  onExportRegression?: (regressionId: string) => void
}

interface RegressionRow {
  id: string
  name: string
  version: string
  suitesCount: number
  testsCount: number
  status: string
  lastRun: string | null
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
}

export function getRegressionsColumns(
  callbacks: RegressionsColumnCallbacks,
): ColumnDef<RegressionRow, unknown>[] {
  return [
    nameColumn<RegressionRow>({
      accessor: (row) => row.name,
      testId: 'regression-name',
      onClick: (row) => callbacks.onRowClick(row.id),
    }),
    countColumn<RegressionRow>({
      id: 'suitesCount',
      accessor: (row) => row.suitesCount,
      label: 'Suites',
      singularLabel: 'suite',
      pluralLabel: 'suites',
      testId: 'regression-suites-count',
    }),
    countColumn<RegressionRow>({
      id: 'testsCount',
      accessor: (row) => row.testsCount,
      label: 'Tests',
      singularLabel: 'test',
      pluralLabel: 'tests',
      testId: 'regression-tests-count',
    }),
    statusColumn<RegressionRow>({
      accessor: (row) => row.status,
      testIdPrefix: 'regression',
    }),
    {
      id: 'lastRun',
      accessorKey: 'lastRun',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Run" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.lastRun} data-testid="regression-last-run" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    tagsColumn<RegressionRow>({
      accessor: (row) => row.tags,
      testId: 'regression-tags',
    }),
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Created At" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.createdAt} data-testid="regression-created-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Updated At" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.updatedAt} data-testid="regression-updated-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    actionsColumn<RegressionRow>({
      render: (row) => (
        <RegressionsRowActions
          regressionId={row.id}
          regressionName={row.name}
          onRun={callbacks.onRunRegression}
          onEdit={callbacks.onEditRegression}
          onDelete={callbacks.onDeleteRegression}
          onDuplicate={callbacks.onDuplicateRegression}
          onExport={callbacks.onExportRegression}
          runDisabled={row.testsCount === 0}
          runDisabledReason={row.testsCount === 0 ? 'No tests in regression' : undefined}
        />
      ),
    }),
  ]
}
