/**
 * Column definitions for the Profiles DataTable.
 *
 * Common columns (name, tags-as-badges, actions) come from the shared
 * column-factories. Type-pill, environments-with-warning, and usage
 * columns have entity-specific rendering and stay inline.
 */

import type { ColumnDef } from '@tanstack/react-table'
import { Icon, AlertTriangleIcon } from '@/components/ui/icon'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { DataTableColumnHeader } from '@/components/shared/data-table/data-table-column-header'
import {
  actionsColumn,
  countColumn,
  nameColumn,
  tagsColumn,
} from '@/components/shared/data-table/column-factories'
import { ProfilesRowActions } from '@/features/profiles/components/profiles-row-actions'
import type { Profile } from '@/features/profiles/api/types'
import type { DataTableColumnMeta } from '@/components/shared/data-table/types'

export interface ProfilesColumnCallbacks {
  onEditProfile: (profileId: string) => void
  onDeleteProfile: (profileId: string) => void
  onDuplicateProfile: (profileId: string) => void
  onExportProfile?: (profileId: string) => void
}

export function getProfilesColumns(callbacks: ProfilesColumnCallbacks): ColumnDef<Profile, unknown>[] {
  return [
    nameColumn<Profile>({
      accessor: (row) => row.name,
      testId: 'profile-name',
      onClick: (row) => callbacks.onEditProfile(row.id),
    }),
    {
      id: 'type',
      accessorKey: 'type',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Type" />
      ),
      cell: ({ row }) => (
        <span
          data-testid="profile-type"
          className="badge inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium"
        >
          {row.original.type}&#8203;
        </span>
      ),
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    tagsColumn<Profile>({
      accessor: (row) => row.tags,
      testId: 'profile-tags',
    }),
    {
      id: 'environments',
      accessorKey: 'environmentsCount',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Environments" />
      ),
      cell: ({ row }) => {
        const { environmentsCount, totalEnvironments, hasIncompleteEnvironments } = row.original
        return (
          <span
            data-testid="profile-environments"
            className={`inline-flex items-center gap-1 text-sm ${
              hasIncompleteEnvironments ? 'text-warning' : ''
            }`}
          >
            {hasIncompleteEnvironments && (
              <ConditionalTooltip
                content={`${totalEnvironments - environmentsCount} ${
                  totalEnvironments - environmentsCount === 1
                    ? 'environment has'
                    : 'environments have'
                } no values configured`}
              >
                <span data-testid="environments-warning-icon">
                  <Icon
                    icon={AlertTriangleIcon}
                    size="sm"
                    className="text-warning"
                  />
                </span>
              </ConditionalTooltip>
            )}
            {environmentsCount} {environmentsCount === 1 ? 'env' : 'envs'}
          </span>
        )
      },
      meta: { skeletonWidth: 'w-16' } satisfies DataTableColumnMeta,
    },
    countColumn<Profile>({
      id: 'usage',
      accessor: (row) => row.usage,
      label: 'Usage',
      singularLabel: 'test',
      pluralLabel: 'tests',
      testId: 'profile-usage',
    }),
    actionsColumn<Profile>({
      render: (row) => (
        <ProfilesRowActions
          profile={{
            id: row.id,
            name: row.name,
            type: row.type,
            usage: row.usage,
          }}
          onEdit={callbacks.onEditProfile}
          onDuplicate={callbacks.onDuplicateProfile}
          onDelete={callbacks.onDeleteProfile}
          onExport={callbacks.onExportProfile}
        />
      ),
    }),
  ]
}
