/**
 * Column definitions for the Environments DataTable.
 *
 * Name is plain text (no row click), tags render as inline badges. Usage
 * uses the count factory. Description stays inline for the truncated-text
 * behavior.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import {
  actionsColumn,
  countColumn,
  nameColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import { EnvironmentRowActions } from '@/features/settings/components/environment-row-actions'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface EnvironmentListItem {
  id: string
  name: string
  description: string | null
  tags: string[]
  usage: number
  createdAt: string
  updatedAt: string
}

export interface EnvironmentsColumnCallbacks {
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onExport?: (id: string) => void
}

export function getEnvironmentsColumns(callbacks: EnvironmentsColumnCallbacks): ColumnDef<EnvironmentListItem, unknown>[] {
  return [
    nameColumn<EnvironmentListItem>({
      accessor: (row) => row.name,
      testId: 'environment-name',
    }),
    {
      id: 'description',
      accessorKey: 'description',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Description" />
      ),
      cell: ({ row }) => (
        <ConditionalTooltip content={row.original.description ?? undefined} wide>
          <span data-testid="environment-description" className="truncate max-w-xs block">
            {row.original.description ?? '-'}
          </span>
        </ConditionalTooltip>
      ),
      meta: { skeletonWidth: 'w-[50%]' } satisfies DataTableColumnMeta,
    },
    tagsColumn<EnvironmentListItem>({
      accessor: (row) => row.tags,
      testId: 'environment-tags',
    }),
    countColumn<EnvironmentListItem>({
      id: 'usage',
      accessor: (row) => row.usage,
      label: 'Usage',
      singularLabel: 'profile',
      pluralLabel: 'profiles',
      testId: 'environment-usage',
    }),
    actionsColumn<EnvironmentListItem>({
      render: (row) => (
        <EnvironmentRowActions
          environmentId={row.id}
          environmentName={row.name}
          usage={row.usage}
          onEdit={callbacks.onEdit}
          onDuplicate={callbacks.onDuplicate}
          onDelete={callbacks.onDelete}
          onExport={callbacks.onExport}
        />
      ),
    }),
  ]
}
