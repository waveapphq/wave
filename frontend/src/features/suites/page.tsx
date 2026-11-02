/**
 * SuitesPage Component
 *
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 *
 * Page structure:
 * - Page title: "Suites" (h1)
 * - "+ New Suite" button in header
 * - Filters row: search, status, tags (NO Suite filter - suites have no parent)
 * - Mass Action and Columns buttons
 * - Data table with columns: Name, Tests (count), Status, Last Run, Actions
 * - Pagination controls
 *
 * Design decisions:
 * - LIST-1: Name and Actions columns sticky
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - LIST-7: Status badges (Passed=green, Failed=red, Never Run=gray)
 */

/* v8 ignore next - COV-V8-001 */
import { useMemo } from 'react'
import type { ColumnDef, OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import { FolderOpen } from 'lucide-react'
import { ListPageHeader } from '@/components/shared/list-page-header'
import {
  ListErrorState,
  ListEmptyState,
} from '@/components/shared/list-page-states'
import { DataTable } from '@/components/shared/data-table/data-table'
import { SuitesFilters, type SuitesFilters as FiltersType, type Column } from '@/features/suites/components/suites-filters'
import { SuitesBulkActions } from '@/features/suites/components/suites-bulk-actions'
import { getSuitesColumns } from '@/features/suites/components/suites-columns'
import type { SuiteListItem } from '@/features/suites/api/types'
import { COMMON_LIST_COLUMNS } from '@/components/shared/tables/table-utils'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import { listVisibility } from '@/lib/list-visibility'

// Re-export types for consumers
export type { SuiteListItem as Suite } from '@/features/suites/api/types'
export type { PageInfo } from '@/components/shared/tables/table-utils'

export interface SuitesPageProps {
  suites: SuiteListItem[]
  pageInfo: PageInfo
  filters: FiltersType
  allTags: string[]
  loading?: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled?: boolean
  error?: string
  className?: string
  // Sorting (TanStack native)
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  // Column visibility (TanStack native)
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  // Selection (TanStack native)
  enableSelection: boolean
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  selectedIds: string[]
  // Actions
  onNewSuite: () => void
  onEditSuite: (suiteId: string) => void
  onDeleteSuite: (suiteId: string) => void
  onDuplicateSuite: (suiteId: string) => void
  onRunSuite: (suiteId: string) => void
  // Bulk actions
  onBulkDelete: () => void
  onBulkRun: () => void
  onBulkExport: () => void
  onBulkDuplicate: () => void
  onExportSuite?: (suiteId: string) => void
  onImport?: () => void
  // Filter/pagination/selection
  onFilterChange: (filters: FiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onRetry: () => void
}

// Columns available for toggle (Name is always visible like Actions)
const filterColumns: Column[] = [
  { id: 'testsCount', label: 'Tests', visible: true },
  ...COMMON_LIST_COLUMNS,
]

export function SuitesPage({
  suites,
  pageInfo,
  filters,
  allTags,
  loading = false,
  settled = true,
  error,
  className = '',
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
  selectedIds,
  onNewSuite,
  onEditSuite,
  onDeleteSuite,
  onDuplicateSuite,
  onRunSuite,
  onBulkDelete,
  onBulkRun,
  onBulkExport,
  onBulkDuplicate,
  onExportSuite,
  onImport,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onEnterSelectionMode,
  onExitSelectionMode,
  onColumnToggle,
  onRetry,
}: Readonly<SuitesPageProps>) {
  // Build columns with visibility state from props
  const columnsWithVisibility: Column[] = filterColumns.map(col => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  // Memoize column definitions
  const columns: ColumnDef<SuiteListItem, unknown>[] = useMemo(
    () =>
      getSuitesColumns({
        onRowClick: onEditSuite,
        onRunSuite,
        onEditSuite,
        onDeleteSuite,
        onDuplicateSuite,
        onExportSuite,
      }),
    [onEditSuite, onRunSuite, onDeleteSuite, onDuplicateSuite, onExportSuite],
  )

  // Check if any filters are active
  /* v8 ignore start - COV-BRANCH-095: V8 branch tracking inconsistency with || chain */
  const hasActiveFilters =
    filters.search !== '' ||
    filters.status.length > 0 ||
    filters.tags.length > 0
  /* v8 ignore stop */

  // Handle clear filters
  function handleClearFilters() {
    onFilterChange({
      search: '',
      status: [],
      tags: [],
    })
  }

  // Determine content state
  const showError = !!error
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, suites.length)
  const isFilteredEmpty = showEmpty && hasActiveFilters

  return (
    <div
      data-testid="suites-page"
      aria-busy={busy ? 'true' : 'false'}
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
    >
      {/* Header - always rendered */}
      <ListPageHeader
        title="Suites"
        onImport={onImport}
        create={{ label: 'New Suite', onClick: onNewSuite }}
      />

      {/* Filters - SINGLE INSTANCE, never unmounts */}
      <SuitesFilters
        filters={filters}
        allTags={allTags}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showError}
        actions={
          showTable && !busy && (
            <SuitesBulkActions
              selectedCount={selectedIds.length}
              totalCount={suites.length}
              selectionModeActive={enableSelection}
              onRun={onBulkRun}
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
        <ListErrorState entityName="suites" error={error} onRetry={onRetry} />
      )}

      {/* Empty State */}
      {showEmpty && (
        <ListEmptyState
          entityName="suites"
          entityNameSingular="Suite"
          icon={FolderOpen}
          emptyDescription="Suites help you organize tests into logical groups"
          isFilteredEmpty={isFilteredEmpty}
          onClearFilters={handleClearFilters}
          onCreateNew={onNewSuite}
        />
      )}

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="suites-table"
          columns={columns}
          data={suites}
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
          entityName="suites"
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
