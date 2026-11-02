/**
 * ProfilesPage Component
 *
 * REQ-4.7.4: Profile management UI
 *
 * Page structure:
 * - Page title: "Profiles" (h1)
 * - "+ New Profile" button in header
 * - Filters row: search, type, tags
 * - Columns button + Mass Action dropdown (PROFILE-5)
 * - Data table with columns: Name, Type, Tags, Environments, Usage, Actions
 * - Pagination controls
 *
 * Design decisions:
 * - PROFILE-1: Name and Actions columns sticky
 * - PROFILE-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - PROFILE-3: Single-page lists show all controls, disabled when not applicable
 * - PROFILE-4: Loading: 9 skeleton rows
 * - PROFILE-5: Mass Action dropdown: Export, Duplicate, separator, Delete (red)
 * - PROFILE-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - PROFILE-7: Type badges showing profile type
 * - PROFILE-8: No Status filter (profiles don't execute)
 * - PROFILE-9: Delete blocked when Usage > 0
 * - PROFILE-10: No Run action (profiles are configuration, not executable)
 */

import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { UserCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Icon, AlertTriangleIcon } from '@/components/ui/icon'
import { ListPageHeader } from '@/components/shared/list-page-header'
import {
  ProfilesFilters,
  type Column,
} from '@/features/profiles/components/profiles-filters'
import { SimpleBulkActions } from '@/components/shared/actions/simple-bulk-actions'
import { DataTable } from '@/components/shared/data-table/data-table'
import { getProfilesColumns } from '@/features/profiles/components/profiles-columns'
import type { Profile } from '@/features/profiles/api/types'
import type { ProfilesPageProps } from './types'
import { TOGGLEABLE_COLUMNS, DEFAULT_VISIBLE_COLUMNS } from './types'
import { listVisibility } from '@/lib/list-visibility'

export function ProfilesPage({
  profiles,
  pageInfo,
  filters,
  profileTypes,
  allTags,
  loading = false,
  settled = true,
  error,
  className = '',
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  enableSelection = false,
  rowSelection = {},
  onRowSelectionChange,
  selectedIds = [],
  onNewProfile,
  onEditProfile,
  onDeleteProfile,
  onDuplicateProfile,
  onExportProfile,
  onImport,
  onBulkExport,
  onBulkDuplicate,
  onBulkDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onColumnToggle,
  onRetry,
}: Readonly<ProfilesPageProps>) {
  // Build columns with visibility state from props
  const columnsWithVisibility: Column[] = TOGGLEABLE_COLUMNS.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  // Memoize column definitions
  const columns: ColumnDef<Profile, unknown>[] = useMemo(
    () =>
      getProfilesColumns({
        onEditProfile,
        onDeleteProfile,
        onDuplicateProfile,
        onExportProfile,
      }),
    [onEditProfile, onDeleteProfile, onDuplicateProfile, onExportProfile],
  )

  // Check if any filters are active
  const hasActiveFilters =
    filters.search !== '' || filters.type !== '' || filters.tags.length > 0

  // Handle clear filters
  const handleClearFilters = () => {
    onFilterChange({
      search: '',
      type: '',
      tags: [],
    })
  }

  // Determine content state
  const showError = !!error
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, profiles.length)
  const isFilteredEmpty = showEmpty && hasActiveFilters

  return (
    <div
      data-testid="profiles-page"
      aria-busy={busy ? 'true' : 'false'}
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
    >
      {/* Header - always rendered */}
      <ListPageHeader
        title="Profiles"
        onImport={onImport}
        create={{
          label: 'New Profile',
          onClick: onNewProfile,
          testId: 'new-profile-button',
        }}
      />

      {/* Filters - SINGLE INSTANCE, never unmounts */}
      <ProfilesFilters
        filters={filters}
        profileTypes={profileTypes}
        allTags={allTags}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showError}
        actions={
          onEnterSelectionMode && onExitSelectionMode && onBulkExport && onBulkDuplicate && onBulkDelete && (
            <SimpleBulkActions
              selectedCount={selectedIds.length}
              totalCount={profiles.length}
              selectionModeActive={enableSelection}
              onExport={onBulkExport}
              onDuplicate={onBulkDuplicate}
              onDelete={onBulkDelete}
              onEnterSelectionMode={onEnterSelectionMode}
              onExitSelectionMode={onExitSelectionMode}
            />
          )
        }
      />

      {/* Error State */}
      {showError && (
        <div
          data-testid="error-state"
          className="flex flex-col items-center justify-center py-16"
        >
          <Icon
            icon={AlertTriangleIcon}
            size="xl"
            data-testid="error-state-icon"
            className="text-error mb-4"
          />
          <p data-testid="error-state-title" className="mb-4 text-lg font-medium">
            Unable to load profiles
          </p>
          <p
            data-testid="error-state-description"
            className="mb-6 max-w-md text-center text-muted"
          >
            Something went wrong while loading. Please try again.
            {error && <span className="mt-2 block text-sm">({error})</span>}
          </p>
          <Button onClick={onRetry}>Try Again</Button>
        </div>
      )}

      {/* Empty State */}
      {showEmpty && (
        <div
          data-testid={isFilteredEmpty ? 'no-results-state' : 'empty-state'}
          className="flex flex-col items-center justify-center py-16"
        >
          <span
            data-testid={
              isFilteredEmpty ? 'no-results-state-icon' : 'empty-state-icon'
            }
            className="mb-4 text-muted"
          >
            <UserCircle className="h-16 w-16" />
          </span>
          <h2
            data-testid={
              isFilteredEmpty ? 'no-results-state-title' : 'empty-state-title'
            }
            className="mb-2 text-lg font-medium"
          >
            {isFilteredEmpty ? 'No matching profiles found' : 'No profiles yet'}
          </h2>
          <p
            data-testid={
              isFilteredEmpty
                ? 'no-results-state-description'
                : 'empty-state-description'
            }
            className="mb-6 max-w-md text-center text-muted"
          >
            {isFilteredEmpty
              ? 'No profiles match your current filters. Try adjusting your search criteria.'
              : 'Create your first profile to store connection credentials and configuration.'}
          </p>
          {isFilteredEmpty ? (
            <Button
              variant="outline"
              onClick={handleClearFilters}
              className="border-warning text-warning hover:bg-warning/10"
            >
              Clear Filters
            </Button>
          ) : (
            <Button className="btn-primary" onClick={onNewProfile}>
              Create Your First Profile
            </Button>
          )}
        </div>
      )}

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="profiles-table"
          columns={columns}
          data={profiles}
          loading={busy}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          // Sorting
          sorting={sorting}
          onSortingChange={onSortingChange}
          manualSorting
          // Pagination
          pageInfo={pageInfo}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityName="profiles"
          // Selection
          enableSelection={enableSelection}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          // Column visibility
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}
    </div>
  )
}
