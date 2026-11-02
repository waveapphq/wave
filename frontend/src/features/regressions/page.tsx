/**
 * RegressionsPage Component
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 *
 * Page structure:
 * - Page title: "Regressions" (h1)
 * - "+ New Regression" button in header
 * - Filters row: search, status, tags (NO Mass Action button - regressions are top of hierarchy)
 * - Columns button
 * - DataTable with columns: Name, Suites, Tests, Status, Last Run, Actions
 * - Pagination controls (built into DataTable)
 * - NO checkbox column (no selection mode for regressions)
 *
 * Design decisions:
 * - LIST-1: Name and Actions columns sticky
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 * - LIST-7: Status badges (Passed=green, Failed=red, Never Run=gray)
 * - LIST-9: Naming pattern: "AppName Version" (e.g., "WAVE 25.12")
 */

/* v8 ignore next - COV-V8-001 */
import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { ListPageHeader } from '@/components/shared/list-page-header'
import type { SortingState, OnChangeFn, VisibilityState, RowSelectionState } from '@tanstack/react-table'
import {
  ListErrorState,
  ListEmptyState,
} from '@/components/shared/list-page-states'
import {
  RegressionsFilters,
  type RegressionsFilters as FiltersType,
  type Column,
} from '@/features/regressions/components/regressions-filters'
import { DataTable } from '@/components/shared/data-table/data-table'
import { getRegressionsColumns } from '@/features/regressions/components/regressions-columns'
import { RegressionsBulkActions } from '@/features/regressions/components/regressions-bulk-actions'
import { COMMON_LIST_COLUMNS, type PageInfo } from '@/components/shared/tables/table-utils'
import type { Regression } from '@/features/regressions/api/types'
import { listVisibility } from '@/lib/list-visibility'

export interface RegressionsPageProps {
  regressions: Regression[]
  pageInfo: PageInfo
  filters: FiltersType
  allTags: string[]
  loading?: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled?: boolean
  error?: string
  className?: string
  // TanStack native sorting
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  // Column visibility
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  // Selection
  enableSelection: boolean
  selectedIds: string[]
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  // Actions
  onNewRegression: () => void
  onEditRegression: (regressionId: string) => void
  onDeleteRegression: (regressionId: string) => void
  onDuplicateRegression: (regressionId: string) => void
  onRunRegression: (regressionId: string) => void
  onExportRegression?: (regressionId: string) => void
  // Bulk actions
  onBulkRun: () => void
  onBulkExport: () => void
  onBulkDuplicate: () => void
  onBulkDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  // Import
  onImport?: () => void
  // Filter/pagination
  onFilterChange: (filters: FiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onRetry: () => void
}

// Columns available for toggle (Name is always visible like Actions)
const columns: Column[] = [
  { id: 'suitesCount', label: 'Suites', visible: true },
  { id: 'testsCount', label: 'Tests', visible: true },
  ...COMMON_LIST_COLUMNS,
]

export function RegressionsPage({
  regressions,
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
  selectedIds,
  rowSelection,
  onRowSelectionChange,
  onNewRegression,
  onEditRegression,
  onDeleteRegression,
  onDuplicateRegression,
  onRunRegression,
  onExportRegression,
  onBulkRun,
  onBulkExport,
  onBulkDuplicate,
  onBulkDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  onImport,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onColumnToggle,
  onRetry,
}: Readonly<RegressionsPageProps>) {
  // Build columns with visibility state from props
  const columnsWithVisibility: Column[] = columns.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  // Memoize column definitions
  const tableColumns = useMemo(
    () =>
      getRegressionsColumns({
        onRowClick: onEditRegression,
        onRunRegression,
        onEditRegression,
        onDeleteRegression,
        onDuplicateRegression,
        onExportRegression,
      }),
    [onEditRegression, onRunRegression, onDeleteRegression, onDuplicateRegression, onExportRegression],
  )

  // Check if any filters are active
  /* v8 ignore start - COV-BRANCH-094: V8 branch tracking inconsistency with || chain */
  const hasActiveFilters =
    filters.search !== '' || filters.status.length > 0 || filters.tags.length > 0
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
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, regressions.length)
  const isFilteredEmpty = showEmpty && hasActiveFilters

  return (
    <div
      data-testid="regressions-page"
      aria-busy={busy ? 'true' : 'false'}
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
    >
      {/* Header */}
      <ListPageHeader
        title="Regressions"
        onImport={onImport}
        create={{ label: 'New Regression', onClick: onNewRegression }}
      />

      {/* Filters - always rendered for single instance */}
      <RegressionsFilters
        filters={filters}
        allTags={allTags}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showError}
        actions={
          showTable && !busy && (
            <RegressionsBulkActions
              selectedCount={selectedIds.length}
              totalCount={regressions.length}
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
        <ListErrorState entityName="regressions" error={error} onRetry={onRetry} />
      )}

      {/* Empty State */}
      {showEmpty && (
        <ListEmptyState
          entityName="regressions"
          entityNameSingular="Regression"
          icon={Layers}
          emptyDescription="Regressions help you group suites for comprehensive testing of releases"
          iconClassName="text-violet-400"
          isFilteredEmpty={isFilteredEmpty}
          onClearFilters={handleClearFilters}
          onCreateNew={onNewRegression}
        />
      )}

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="regressions-table"
          columns={tableColumns}
          data={regressions}
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
          entityName="regressions"
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
