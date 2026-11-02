/**
 * Column definitions for the Suites DataTable.
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
import { SuitesRowActions } from '@/features/suites/components/suites-row-actions'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import type { SuiteListItem } from '@/features/suites/api/types'

export interface SuitesColumnCallbacks {
  onRowClick: (suiteId: string) => void
  onRunSuite: (suiteId: string) => void
  onEditSuite: (suiteId: string) => void
  onDeleteSuite: (suiteId: string) => void
  onDuplicateSuite: (suiteId: string) => void
  onExportSuite?: (suiteId: string) => void
}

export function getSuitesColumns(callbacks: SuitesColumnCallbacks): ColumnDef<SuiteListItem, unknown>[] {
  return [
    nameColumn<SuiteListItem>({
      accessor: (row) => row.name,
      testId: 'suite-name',
      onClick: (row) => callbacks.onRowClick(row.id),
    }),
    countColumn<SuiteListItem>({
      id: 'testsCount',
      accessor: (row) => row.testsCount,
      label: 'Tests',
      singularLabel: 'test',
      pluralLabel: 'tests',
      testId: 'suite-tests-count',
      skeletonWidth: 'w-[60%]',
    }),
    statusColumn<SuiteListItem>({
      accessor: (row) => row.status,
      testIdPrefix: 'suite',
    }),
    {
      id: 'lastRun',
      accessorKey: 'lastRun',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Run" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.lastRun} data-testid="suite-last-run" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    tagsColumn<SuiteListItem>({
      accessor: (row) => row.tags,
      testId: 'suite-tags',
    }),
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} label="Created At" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.createdAt} data-testid="suite-created-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} label="Updated At" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.updatedAt} data-testid="suite-updated-at" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    actionsColumn<SuiteListItem>({
      render: (row) => (
        <SuitesRowActions
          suiteId={row.id}
          suiteName={row.name}
          onRun={callbacks.onRunSuite}
          onEdit={callbacks.onEditSuite}
          onDelete={callbacks.onDeleteSuite}
          onDuplicate={callbacks.onDuplicateSuite}
          onExport={callbacks.onExportSuite}
          runDisabled={row.testsCount === 0}
          runDisabledReason={row.testsCount === 0 ? 'No tests in suite' : undefined}
        />
      ),
    }),
  ]
}
