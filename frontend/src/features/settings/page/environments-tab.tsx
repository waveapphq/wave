/**
 * EnvironmentsTab Component
 *
 * Environments management panel with search, tag filtering,
 * bulk actions, and paginated DataTable.
 */

import { useCallback, useMemo } from 'react'
import type { ColumnDef, OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import { AlertCircle, Globe, Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table/data-table'
import { getEnvironmentsColumns, type EnvironmentListItem } from '@/features/settings/components/environments-columns'
import { SimpleBulkActions } from '@/components/shared/actions/simple-bulk-actions'
import { EnvironmentsFilters, type EnvironmentsFilters as EnvironmentsFiltersType } from '@/features/settings/components/environments-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import { listVisibility } from '@/lib/list-visibility'

export type { EnvironmentListItem as Environment } from '@/features/settings/components/environments-columns'
export type { PageInfo } from '@/components/shared/tables/table-utils'

export interface EnvironmentsTabProps {
  environments: EnvironmentListItem[]
  pageInfo: PageInfo
  loading: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled: boolean
  error?: string
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  visibleColumns?: string[]
  onColumnToggle?: (columnId: string, visible: boolean) => void
  searchQuery?: string
  tagsFilter?: string[]
  allTags?: string[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onExport?: (id: string) => void
  onCreate: () => void
  onImport?: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSearch: (query: string) => void
  onTagsFilterChange?: (tags: string[]) => void
  onRetry: () => void
  // Selection / bulk actions
  selectedIds?: string[]
  selectionModeActive?: boolean
  onBulkExport?: () => void
  onBulkDuplicate?: () => void
  onBulkDelete?: () => void
  onEnterSelectionMode?: () => void
  onExitSelectionMode?: () => void
  onSelectionChange?: (ids: string[]) => void
}

export function EnvironmentsTab({
  environments,
  pageInfo,
  loading,
  settled,
  error,
  sorting = [],
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns = [],
  onColumnToggle,
  searchQuery,
  tagsFilter = [],
  allTags = [],
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  onCreate,
  onImport,
  onPageChange,
  onPageSizeChange,
  onSearch,
  onTagsFilterChange,
  onRetry,
  selectedIds = [],
  selectionModeActive = false,
  onBulkExport,
  onBulkDuplicate,
  onBulkDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectionChange,
}: Readonly<EnvironmentsTabProps>) {
  // Unified filter state bridged from individual props
  const filters: EnvironmentsFiltersType = useMemo(() => ({
    search: searchQuery || '',
    tags: tagsFilter,
  }), [searchQuery, tagsFilter])

  // Memoize column definitions
  const columns: ColumnDef<EnvironmentListItem, unknown>[] = useMemo(
    () => getEnvironmentsColumns({ onEdit, onDelete, onDuplicate, onExport }),
    [onEdit, onDelete, onDuplicate, onExport],
  )

  // Bridge unified filter changes back to individual callbacks
  const handleFilterChange = useCallback((newFilters: EnvironmentsFiltersType) => {
    onSearch(newFilters.search)
    onTagsFilterChange?.(newFilters.tags)
  }, [onSearch, onTagsFilterChange])

  // Column config for the shared filter component
  const columnsConfig = useMemo(() => [
    { id: 'description', label: 'Description', visible: visibleColumns.includes('description') },
    { id: 'tags', label: 'Tags', visible: visibleColumns.includes('tags') },
    { id: 'usage', label: 'Usage', visible: visibleColumns.includes('usage') },
  ], [visibleColumns])

  // Convert array-based selection to TanStack RowSelectionState
  const rowSelection: RowSelectionState = useMemo(() => {
    const state: RowSelectionState = {}
    for (const id of selectedIds) {
      state[id] = true
    }
    return state
  }, [selectedIds])

  /* v8 ignore start - COV-V8-003: TanStack always calls with function updater; direct-value branch unreachable */
  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback(
    (updaterOrValue) => {
      if (!onSelectionChange) return
      const next = typeof updaterOrValue === 'function'
        ? updaterOrValue(rowSelection)
        : updaterOrValue
      onSelectionChange(Object.keys(next).filter((key) => next[key]))
    },
    [onSelectionChange, rowSelection],
  )
  /* v8 ignore stop */

  // Check if any filters are active
  const hasActiveFilters = (searchQuery || '') !== '' || tagsFilter.length > 0

  // Content state - mirrors suites/regressions/profiles/tests so the column-shaped
  // DataTableSkeleton renders during initial load instead of a bespoke set of bars.
  const showError = !!error
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, environments.length)

  return (
    <div data-testid="environments-tab" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Environments</h2>
          <p data-testid="environments-subtitle" className="text-muted-foreground">
            Manage environment names used across profiles
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onImport && (
            <Button variant="outline" onClick={onImport} data-testid="import-button">
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          )}
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Environment
          </Button>
        </div>
      </div>

      {/* Filters */}
      <EnvironmentsFilters
        filters={filters}
        allTags={allTags}
        columns={columnsConfig}
        onFilterChange={handleFilterChange}
        onColumnToggle={onColumnToggle ?? (() => {})}
        actions={
          onEnterSelectionMode && onExitSelectionMode && onBulkExport && onBulkDuplicate && onBulkDelete && showTable && !busy && (
            <SimpleBulkActions
              selectedCount={selectedIds.length}
              totalCount={environments.length}
              selectionModeActive={selectionModeActive}
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
          data-testid="environments-error"
          role="alert"
          className="flex flex-col items-center justify-center py-12 text-center"
        >
          <AlertCircle className="h-12 w-12 text-error mb-4" />
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      )}

      {/* Empty State */}
      {showEmpty && (
        <div data-testid="environments-empty" className="flex flex-col items-center justify-center py-12 text-center">
          <Globe className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground mb-4">
            {hasActiveFilters ? 'No environments match your filters' : 'No environments yet'}
          </p>
          {!hasActiveFilters && (
            <Button onClick={onCreate}>
              Create your first environment
            </Button>
          )}
        </div>
      )}

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="environments-table"
          columns={columns}
          data={environments}
          loading={busy}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          // Sorting
          sorting={sorting}
          onSortingChange={onSortingChange}
          manualSorting
          // Column visibility
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
          // Pagination
          pageInfo={pageInfo}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityName="environments"
          // Selection
          enableSelection={selectionModeActive}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
        />
      )}
    </div>
  )
}
