/**
 * Reports List Container
 *
 * Reports page with data fetching and state management. Both row
 * actions (View and Generate) navigate to the viewer route - the viewer
 * owns generation.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ReportsPage as ReportsPageComponent } from '@/features/reports/page'
import { fetchReports } from '@/features/reports/api/reports'
import type { ReportListRow } from '@/features/reports/api/types'
import { fetchExecutionUsers } from '@/features/executions/api/executions'
import { resolveDateRange } from '@/lib/date-range'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { useDataTable } from '@/hooks/use-data-table'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useUrlListFilters } from '@/hooks/use-url-list-filters'

/** List-column id -> GET /reports sort field (no report-field sorts exist). */
const SORT_FIELD_BY_COLUMN: Record<string, string> = {
  name: 'name',
  type: 'type',
  status: 'status',
  finishedAt: 'started_at',
  duration: 'duration',
}

export function ReportsListContainer(): ReactNode {
  const navigate = useNavigate()

  const {
    pageInfo,
    setPageInfo,
    onPageChange,
    onPageSizeChange,
    sorting,
    onSortingChange,
    sortColumn,
    sortDirection,
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    toggleColumn,
  } = useDataTable({
    defaultPageSize: 10,
    defaultVisibleColumns: ['name', 'type', 'status', 'finishedAt', 'duration', 'report'],
    visibleColumnsStorageKey: 'wave_reports_visible_columns',
    defaultSorting: [{ id: 'finishedAt', desc: true }],
  })

  const [rows, setRows] = useState<ReportListRow[]>([])
  const [allUsers, setAllUsers] = useState<string[]>([])
  const { loading, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)

  const { filters, handleFilterChange } = useUrlListFilters({
    pageSize: pageInfo.pageSize,
    setPageInfo,
  })

  // The users read blocks the page; the reports read keeps the page's own error state.
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const blocking = useBlockingReads(primary)
  const userReads = useMemo<BlockingRead[]>(
    () => [{ label: 'users', run: async () => setAllUsers(await fetchExecutionUsers()) }],
    [],
  )

  /* v8 ignore start - COV-ROUTER-001 */
  const readReports = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    // Started before the primary read is awaited so both reads stay concurrent.
    const reads = blocking.load(userReads)

    try {
      const resolved = resolveDateRange(filters.dateRange ?? { kind: 'all-time' })
      const result = await fetchReports({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        status: filters.status.length > 0 ? filters.status : undefined,
        type: filters.type.length > 0 ? filters.type : undefined,
        triggered_by: filters.user.length > 0 ? filters.user : undefined,
        from_date: resolved.from_date,
        to_date: resolved.to_date,
        sort_by: SORT_FIELD_BY_COLUMN[String(sortColumn)],
        sort_order: sortDirection || undefined,
      })

      setRows(result.data)
      setPageInfo((prev) => ({
        ...prev,
        totalItems: result.pagination.total,
        totalPages: result.pagination.total_pages,
      }))
      setPrimary('loaded')
      await reads
    } catch (err) {
      setPrimary('failed')
      throw err
    } finally {
      stopLoading()
    }
  }, [
    pageInfo.currentPage,
    pageInfo.pageSize,
    filters,
    sortColumn,
    sortDirection,
    setPageInfo,
    blocking,
    userReads,
  ])

  // Nothing that starts this read can await it, so the page's own error state
  // is where a failure is reported.
  const loadData = useCallback((): void => {
    readReports().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    })
  }, [readReports])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleViewReport = useCallback(
    (executionId: string) => {
      navigate(`/reports/${executionId}`)
    },
    [navigate],
  )

  const handleRetry = useCallback(() => {
    loadData()
  }, [loadData])
  /* v8 ignore stop */

  /* v8 ignore start - COV-DEF-047: Container return statement and error fallback */
  return (
    <ReportsPageComponent
      rows={rows}
      allUsers={allUsers}
      pageInfo={pageInfo}
      filters={filters}
      loading={loading}
      error={error ?? undefined}
      /* v8 ignore stop */
      sorting={sorting}
      onSortingChange={onSortingChange}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      visibleColumns={visibleColumns}
      onColumnToggle={toggleColumn}
      onViewReport={handleViewReport}
      onFilterChange={handleFilterChange}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRetry={handleRetry}
    />
  )
}
