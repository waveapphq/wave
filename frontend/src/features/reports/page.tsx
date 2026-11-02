/**
 * ReportsPage Component (RVIEW-11, RVIEW-12)
 *
 * Presentational reports list: Executions-list chrome (filters, DataTable,
 * pagination) with columns Name, Type, Status, Finished, Duration, Report,
 * Actions. One row per finished execution; no selection mode, no bulk
 * actions, no "+ New" button (reports come from executions).
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FileBarChart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SortingState, OnChangeFn, VisibilityState } from '@tanstack/react-table'
import {
  ReportsFilters as ReportsFiltersComponent,
  type ReportsFilters as ReportsFiltersType,
} from '@/features/reports/components/reports-filters'
import { DataTable } from '@/components/shared/data-table/data-table'
import { ListPageHeader } from '@/components/shared/list-page-header'
import { getReportsColumns } from '@/features/reports/components/reports-columns'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import type { ReportListRow } from '@/features/reports/api/types'

export type { ReportsFilters } from '@/features/reports/components/reports-filters'

export interface ReportsPageProps {
  rows: ReportListRow[]
  allUsers: string[]
  pageInfo: PageInfo
  filters: ReportsFiltersType
  loading?: boolean
  error?: string
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  onColumnToggle: (columnId: string, visible: boolean) => void
  onViewReport: (executionId: string) => void
  onFilterChange: (filters: ReportsFiltersType) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRetry: () => void
  className?: string
}

const COLUMNS = [
  { id: 'name', label: 'Name', visible: true },
  { id: 'type', label: 'Type', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'finishedAt', label: 'Finished', visible: true },
  { id: 'duration', label: 'Duration', visible: true },
  { id: 'report', label: 'Report', visible: true },
]

export function ReportsPage({
  rows,
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
  onColumnToggle,
  onViewReport,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onRetry,
  className = '',
}: Readonly<ReportsPageProps>) {
  /* v8 ignore start - COV-BRANCH-093: V8 branch tracking inconsistency with || and && chains */
  const dateRangeActive = !!filters.dateRange && filters.dateRange.kind !== 'all-time'
  const hasActiveFilters =
    filters.search !== '' ||
    filters.status.length > 0 ||
    filters.type.length > 0 ||
    filters.user.length > 0 ||
    dateRangeActive

  const isEmptyWithFilters = rows.length === 0 && hasActiveFilters && !loading && !error
  const isEmptyWithoutFilters = rows.length === 0 && !hasActiveFilters && !loading && !error
  /* v8 ignore stop */

  const columnsWithVisibility = COLUMNS.map((col) => ({
    ...col,
    visible: visibleColumns.includes(col.id),
  }))

  const tableColumns = useMemo(
    () =>
      getReportsColumns({
        onRowClick: onViewReport,
        onView: onViewReport,
      }),
    [onViewReport],
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

  const showError = !!error
  const showTable = !error && (loading || rows.length > 0)

  // Error State
  if (showError) {
    return (
      <div
        data-testid="reports-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Reports" />

        <div
          data-testid="error-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <AlertTriangle
            data-testid="error-state-icon"
            className="h-12 w-12 text-error"
            aria-hidden="true"
          />
          <h2 data-testid="error-state-title" className="text-lg font-semibold">
            Unable to load reports
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
        data-testid="reports-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Reports" />

        <ReportsFiltersComponent
          filters={filters}
          allUsers={allUsers}
          columns={columnsWithVisibility}
          onFilterChange={onFilterChange}
          onColumnToggle={onColumnToggle}
          disabled={true}
        />

        <div
          data-testid="empty-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <div
            data-testid="empty-state-icon"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20"
          >
            <FileBarChart className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 data-testid="empty-state-title" className="text-lg font-semibold">
            No reports yet
          </h2>
          <p data-testid="empty-state-description" className="text-muted">
            Finished executions appear here, ready for report generation
          </p>
          <Button variant="primary" asChild>
            <Link to="/executions">Go to Executions</Link>
          </Button>
        </div>
      </div>
    )
  }

  // No Results State (empty with active filters)
  if (isEmptyWithFilters) {
    return (
      <div
        data-testid="reports-page"
        className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
        aria-busy={false}
      >
        <ListPageHeader title="Reports" />

        <ReportsFiltersComponent
          filters={filters}
          allUsers={allUsers}
          columns={columnsWithVisibility}
          onFilterChange={onFilterChange}
          onColumnToggle={onColumnToggle}
          disabled={false}
        />

        <div
          data-testid="no-results-state"
          className="flex flex-1 flex-col items-center justify-center gap-4"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
            <FileBarChart className="h-8 w-8 text-muted" aria-hidden="true" />
          </div>
          <h2 data-testid="no-results-state-title" className="text-lg font-semibold">
            No matching reports found
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
      data-testid="reports-page"
      className={`flex h-full flex-col gap-6 overflow-hidden p-6 ${className}`}
      aria-busy={loading}
    >
      <ListPageHeader title="Reports" />

      <ReportsFiltersComponent
        filters={filters}
        allUsers={allUsers}
        columns={columnsWithVisibility}
        onFilterChange={onFilterChange}
        onColumnToggle={onColumnToggle}
        disabled={false}
      />

      {showTable && (
        <DataTable
          data-testid="reports-table"
          columns={tableColumns}
          data={rows}
          loading={loading}
          getRowId={(row) => row.execution.id}
          getRowLabel={(row) => row.execution.name}
          sorting={sorting}
          onSortingChange={onSortingChange}
          manualSorting
          pageInfo={pageInfo}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityName="reports"
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
        />
      )}
    </div>
  )
}
