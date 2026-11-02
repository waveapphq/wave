/**
 * Column definitions for the Functions DataTable.
 *
 * Columns: Name(+description) / Tags / Version pill / Updated / Actions
 * (view / export / delete). No Status, Suite, Run, or Duplicate.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import { RelativeTimeCell } from '@/components/shared/data-table/cell-renderers'
import { nameColumn, tagsColumn, actionsColumn } from '@/components/shared/data-table/column-factories'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { FunctionsRowActions } from '@/features/functions/components/functions-row-actions'

/** A single row in the Functions library list. */
export interface FunctionRow {
  id: string
  name: string
  description: string
  tags: string[]
  latestVersion: string
  updatedAt: string
}

export interface FunctionsColumnCallbacks {
  onView: (functionId: string) => void
  onExport: (functionId: string) => void
  onDelete: (functionId: string) => void
}

function FunctionVersionCell({ version }: Readonly<{ version: string }>) {
  return (
    <span
      data-testid="function-version"
      className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums"
    >
      {version}
    </span>
  )
}

export function getFunctionsColumns(
  callbacks: FunctionsColumnCallbacks,
): ColumnDef<FunctionRow, unknown>[] {
  return [
    nameColumn<FunctionRow>({
      accessor: (row) => row.name,
      testId: 'function-name',
      onClick: (row) => callbacks.onView(row.id),
      description: (row) => row.description,
      descriptionTestId: 'function-description',
    }),
    tagsColumn<FunctionRow>({ accessor: (row) => row.tags, testId: 'function-tags' }),
    {
      id: 'version',
      accessorFn: (row) => row.latestVersion,
      header: ({ column }) => <DataTableColumnHeader column={column} label="Version" />,
      cell: ({ row }) => <FunctionVersionCell version={row.original.latestVersion} />,
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    {
      id: 'updated',
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} label="Updated" />,
      cell: ({ row }) => (
        <RelativeTimeCell dateString={row.original.updatedAt} data-testid="function-updated" />
      ),
      meta: { skeletonWidth: 'w-24' } satisfies DataTableColumnMeta,
    },
    actionsColumn<FunctionRow>({
      render: (row) => (
        <FunctionsRowActions
          functionId={row.id}
          functionName={row.name}
          onView={callbacks.onView}
          onExport={callbacks.onExport}
          onDelete={callbacks.onDelete}
        />
      ),
    }),
  ]
}
