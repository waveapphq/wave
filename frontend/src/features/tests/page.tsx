/**
 * TestsPage Component
 *
 * REQ-5.2.1.35: Test management screen (list, create, edit, delete, duplicate)
 *
 * Page structure:
 * - Page title: "Tests" (h1)
 * - "+ New Test" button in header
 * - Filters row: search, status, suite, tags
 * - Mass Action and Columns buttons
 * - Data table with columns: Name, Suite, Status, Last Run, Actions
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
import { TestTube2 } from 'lucide-react'
import { ListPageHeader } from '@/components/shared/list-page-header'
import {
  ListErrorState,
  ListEmptyState,
} from '@/components/shared/list-page-states'
import { DataTable } from '@/components/shared/data-table/data-table'
import { TestsFilters, type TestsFilters as FiltersType, type Column, type Suite } from '@/features/tests/components/tests-filters'
import { TestsBulkActions } from '@/features/tests/components/tests-bulk-actions'
import { getTestsColumns } from '@/features/tests/components/tests-columns'
import { COMMON_LIST_COLUMNS } from '@/components/shared/tables/table-utils'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import type { Test } from '@/features/tests/api/types'
import { listVisibility } from '@/lib/list-visibility'

// Re-export types for consumers
export type { Test } from '@/features/tests/api/types'
export type { PageInfo } from '@/components/shared/tables/table-utils'

export interface TestsPageProps {
  tests: Test[]
  pageInfo: PageInfo
  filters: FiltersType
  suites: Suite[]
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
  onNewTest: () => void
  onImport: () => void
  onEditTest: (testId: string) => void
  onExportTest: (testId: string) => void
  onOpenInWorkbench: (testId: string) => void
  onDeleteTest: (testId: string) => void
  onDuplicateTest: (testId: string) => void
  onRunTest: (testId: string) => void
  onAddToSuite?: (testId: string, suiteId: string) => void
  onRemoveFromSuite?: (testId: string, suiteId: string) => void
  // Bulk actions
  onBulkDelete: () => void
  onBulkRun: () => void
  onBulkExport: () => void
  onBulkDuplicate: () => void
  onBulkAddToSuite: (suiteId: string) => void
  onBulkRemoveFromSuite: (suiteId: string) => void
  // Filter/pagination/selection
  onFilterChange: (filters: FiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  onRetry: () => void
}

// Columns available for toggle (Name is always visible like Actions)
const filterColumns: Column[] = [
  { id: 'suite', label: 'Suite', visible: true },
  ...COMMON_LIST_COLUMNS,
]

export function TestsPage({
  tests,
  pageInfo,
  filters,
  suites,
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
  onNewTest,
  onImport,
  onEditTest,
  onExportTest,
  onOpenInWorkbench,
  onDeleteTest,
  onDuplicateTest,
  onRunTest,
  onAddToSuite,
  onRemoveFromSuite,
  onBulkDelete,
  onBulkRun,
  onBulkExport,
  onBulkDuplicate,
  onBulkAddToSuite,
  onBulkRemoveFromSuite,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onColumnToggle,
  onEnterSelectionMode,
  onExitSelectionMode,
  onRetry,
}: Readonly<TestsPageProps>) {
  // Build columns with visibility state from props
  const columnsWithVisibility: Column[] = filterColumns.map(col => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  // Memoize column definitions to avoid recreation on every render
  const columns: ColumnDef<Test, unknown>[] = useMemo(
    () =>
      getTestsColumns({
        onRowClick: onOpenInWorkbench,
        onRunTest,
        onEditTest,
        onDeleteTest,
        onDuplicateTest,
        onExportTest,
        onAddToSuite,
        onRemoveFromSuite,
        suites,
      }),
    [onOpenInWorkbench, onRunTest, onEditTest, onDeleteTest, onDuplicateTest, onExportTest, onAddToSuite, onRemoveFromSuite, suites],
  )

  // Check if any filters are active
  /* v8 ignore start - COV-BRANCH-096: V8 branch tracking inconsistency with || chain */
  const hasActiveFilters =
    filters.search !== '' ||
    filters.status.length > 0 ||
    filters.suiteIds.length > 0 ||
    filters.tags.length > 0
  /* v8 ignore stop */

  // Handle clear filters
  const handleClearFilters = () => {
    onFilterChange({
      search: '',
      status: [],
      suiteIds: [],
      tags: [],
    })
  }

  // Determine content state
  const showError = !!error
  const { busy, showEmpty, showTable } = listVisibility(settled, loading, error, tests.length)
  const isFilteredEmpty = showEmpty && hasActiveFilters

  return (
    <div
      data-testid="tests-page"
      aria-busy={busy ? 'true' : 'false'}
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
    >
      {/* Header - always rendered */}
      <ListPageHeader
        title="Tests"
        onImport={onImport}
        create={{ label: 'New Test', onClick: onNewTest }}
      />

      {/* Filters - SINGLE INSTANCE, never unmounts */}
      <TestsFilters
        filters={filters}
        suites={suites}
        allTags={allTags}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={showError}
        actions={
          showTable && !busy && (
            <TestsBulkActions
              selectedCount={selectedIds.length}
              totalCount={tests.length}
              selectionModeActive={enableSelection}
              selectedTestSuiteIds={[...new Set(tests.filter(t => selectedIds.includes(t.id)).flatMap(t => t.suiteIds))]}
              onRun={onBulkRun}
              onExport={onBulkExport}
              onDuplicate={onBulkDuplicate}
              onAddToSuite={onBulkAddToSuite}
              onRemoveFromSuite={onBulkRemoveFromSuite}
              onDelete={onBulkDelete}
              onEnterSelectionMode={onEnterSelectionMode}
              onExitSelectionMode={onExitSelectionMode}
              suites={suites}
            />
          )
        }
      />

      {/* Error State */}
      {showError && (
        <ListErrorState entityName="tests" error={error} onRetry={onRetry} />
      )}

      {/* Empty State */}
      {showEmpty && (
        <ListEmptyState
          entityName="tests"
          entityNameSingular="Test"
          icon={TestTube2}
          emptyDescription="Create your first test to start validating your systems"
          isFilteredEmpty={isFilteredEmpty}
          onClearFilters={handleClearFilters}
          onCreateNew={onNewTest}
        />
      )}

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="tests-table"
          columns={columns}
          data={tests}
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
          entityName="tests"
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
