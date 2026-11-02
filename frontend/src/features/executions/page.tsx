/**
 * ExecutionsPage Component
 *
 * REQ-5.2.1.40: Execution history screen
 *
 * Page structure:
 * - Page title: "Executions" (h1)
 * - NO "+ New" button (executions created by running entities)
 * - Filters row: search, status (Running/Passed/Failed/Canceled), type (Test/Suite/Regression)
 * - Columns button
 * - DataTable with columns: Name, Type, Triggered By, Started, Duration, Status, Actions
 * - Pagination controls (built into DataTable)
 * - Selection mode with Mass Action button (Export, Delete)
 *
 * Design Decisions:
 * - LIST-2: Full pagination (item count, page size 10/25/50/100, navigation)
 * - LIST-3: Single-page lists show all controls, disabled when not applicable
 * - LIST-4: Loading: 9 skeleton rows, varying bar widths
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon (play icon), encouraging message, "Go to Tests" CTA
 * - LIST-8: Executions list has NO "New" button
 * - DASH-4: Page fills viewport height (h-full)
 * - DASH-5: Pagination anchored at bottom (flex-shrink-0)
 * - DASH-8: Table area flex-grows
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SortingState, OnChangeFn, VisibilityState, RowSelectionState } from '@tanstack/react-table'
import { ExecutionsFilters as ExecutionsFiltersComponent, type ExecutionsFilters as ExecutionsFiltersType } from '@/features/executions/components/executions-filters'
import { DataTable } from '@/components/shared/data-table/data-table'
import { ListPageHeader } from '@/components/shared/list-page-header'
import { getExecutionsColumns } from '@/features/executions/components/executions-columns'
import { ExecutionsBulkActions } from '@/features/executions/components/executions-bulk-actions'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { useExportImport } from '@/features/executions/container/use-export-import'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import type { Execution } from '@/features/executions/api/types'

export type { ExecutionsFilters } from '@/features/executions/components/executions-filters'
export type { PageInfo } from '@/components/shared/tables/table-utils'
export type { Execution, ExecutionStatus, ExecutionType } from '@/features/executions/api/types'

export interface ExecutionsPageProps {
  executions: Execution[]
  allUsers: string[]
  pageInfo: PageInfo
  filters: ExecutionsFiltersType
  loading?: boolean
  error?: string
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
  onViewExecution: (executionId: string) => void
  onRerunExecution: (executionId: string) => void
  onStopExecution: (executionId: string) => void
  onDeleteExecution: (executionId: string) => void
  // Bulk actions
  onBulkDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  // Filter/pagination
  onFilterChange: (filters: ExecutionsFiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onRetry: () => void
  className?: string
}

// Column configuration for the columns toggle dropdown
const COLUMNS = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'triggeredBy', label: 'Triggered By', visible: true },
  { id: 'startedAt', label: 'Started', visible: true },
  { id: 'duration', label: 'Duration', visible: true },
  { id: 'status', label: 'Status', visible: true },
]

export function ExecutionsPage({
  executions,
  allUsers,
  pageInfo,
  filters,
  loading = false,
  error,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  visibleColumns,
  enableSelection,
  selectedIds,
  rowSelection,
  onRowSelectionChange,
  onViewExecution,
  onRerunExecution,
  onStopExecution,
  onDeleteExecution,
  onBulkDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onColumnToggle,
  onRetry,
  className = '',
}: Readonly<ExecutionsPageProps>) {
  /* v8 ignore start - COV-BRANCH-093: V8 branch tracking inconsistency with || and && chains */
  const dateRangeActive = !!filters.dateRange && filters.dateRange.kind !== 'all-time'
  const hasActiveFilters =
    filters.search !== '' || filters.status.length > 0 || filters.type.length > 0 || filters.user.length > 0 || dateRangeActive

  const isEmptyWithFilters = executions.length === 0 && hasActiveFilters && !loading && !error
  const isEmptyWithoutFilters = executions.length === 0 && !hasActiveFilters && !loading && !error
  /* v8 ignore stop */

  // Column config with visibility state
  const columnsWithVisibility = COLUMNS.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  // Export dialog state + download orchestration (single GET / bulk ZIP)
  const {
    exportDialogOpen,
    setExportDialogOpen,
    exportIds,
    exportNames,
    exportLoading,
    handleExport,
    handleBulkExport,
    handleExportAction,
  } = useExportImport()

  const handleRowExport = useCallback(
    (executionId: string) => {
      // execution is guaranteed to exist: handler is called from row actions with valid IDs
      const execution = executions.find((e) => e.id === executionId)!
      handleExport(executionId, execution.name)
    },
    [executions, handleExport],
  )

  const handleBulkExportOpen = useCallback(() => {
    const names = selectedIds
      .map((id) => executions.find((e) => e.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    handleBulkExport(selectedIds, names)
  }, [selectedIds, executions, handleBulkExport])

  // Memoize column definitions
  const tableColumns = useMemo(
    () =>
      getExecutionsColumns({
        onRowClick: onViewExecution,
        onView: onViewExecution,
        onExport: handleRowExport,
        onRerun: onRerunExecution,
        onStop: onStopExecution,
        onDelete: onDeleteExecution,
      }),
    [onViewExecution, handleRowExport, onRerunExecution, onStopExecution, onDeleteExecution],
  )

  function handleClearFilters() {
    onFilterChange({
      search: '',
      status: [],
      type: [],
      user: [],
      dateRange: { kind: 'all-time' },
    })
  }

  // Determine content state
  const showError = !!error
  const showTable = !error && (loading || executions.length > 0)

  // Error State
  if (showError) {
    return (
      <div
        data-testid="executions-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Executions" />

        {/* Error State */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <AlertTriangle
            data-testid="error-state-icon"
            className="h-12 w-12 text-error"
            aria-hidden="true"
          />
          <h2 data-testid="error-state-title" className="text-lg font-semibold">
            Unable to load executions
          </h2>
          <p className="text-muted">{error}</p>
          <Button variant="primary" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  // Empty State (no data, no active filters)
  if (isEmptyWithoutFilters) {
    return (
      <div
        data-testid="executions-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Executions" />

        {/* Filters (disabled in empty state) */}
        <ExecutionsFiltersComponent
          filters={filters}
          allUsers={allUsers}
          columns={columnsWithVisibility}
          onFilterChange={onFilterChange}
          onColumnToggle={onColumnToggle}
          disabled={true}
        />

        {/* Empty State */}
        <div
          data-testid="empty-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <div
            data-testid="empty-state-icon"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20"
          >
            <Play className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 data-testid="empty-state-title" className="text-lg font-semibold">
            No executions yet
          </h2>
          <p data-testid="empty-state-description" className="text-muted">
            Run a test, suite, or regression to see execution history here
          </p>
          <Button variant="primary" asChild>
            <Link to="/tests">Go to Tests</Link>
          </Button>
        </div>
      </div>
    )
  }

  // No Results State (empty with active filters)
  if (isEmptyWithFilters) {
    return (
      <div
        data-testid="executions-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Executions" />

        {/* Filters */}
        <ExecutionsFiltersComponent
          filters={filters}
          allUsers={allUsers}
          columns={columnsWithVisibility}
          onFilterChange={onFilterChange}
          onColumnToggle={onColumnToggle}
          disabled={false}
        />

        {/* No Results State */}
        <div
          data-testid="no-results-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
            <Play className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 data-testid="no-results-state-title" className="text-lg font-semibold">
            No matching executions found
          </h2>
          <p className="text-muted">Try adjusting your filters to find what you&apos;re looking for</p>
          <Button variant="outline" onClick={handleClearFilters}>
            Clear Filters
          </Button>
        </div>
      </div>
    )
  }

  // Normal State (loading or with data)
  return (
    <div
      data-testid="executions-page"
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
      aria-busy={loading}
    >
      <ListPageHeader title="Executions" />

      {/* Filters */}
      <ExecutionsFiltersComponent
        filters={filters}
        allUsers={allUsers}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={false}
        actions={
          showTable && !loading && (
            <ExecutionsBulkActions
              selectedCount={selectedIds.length}
              totalCount={executions.length}
              selectionModeActive={enableSelection}
              onExport={handleBulkExportOpen}
              onDelete={onBulkDelete}
              onEnterSelectionMode={onEnterSelectionMode}
              onExitSelectionMode={onExitSelectionMode}
            />
          )
        }
      />

      {/* Table (loading skeleton or data) */}
      {showTable && (
        <DataTable
          data-testid="executions-table"
          columns={tableColumns}
          data={executions}
          loading={loading}
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
          entityName="executions"
          // Selection
          enableSelection={enableSelection}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          // Column visibility
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        entityIds={exportIds}
        entityNames={exportNames}
        entityLabel="execution"
        hasSecrets={false}
        defaultFormat="json"
        loading={exportLoading}
        onExport={handleExportAction}
      />
    </div>
  )
}
