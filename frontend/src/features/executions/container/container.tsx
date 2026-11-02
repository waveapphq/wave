/**
 * Executions List Container
 *
 * Executions page with data fetching and state management.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExecutionsPage as ExecutionsPageComponent } from '@/features/executions/page'
import type { Execution as ExecutionItem } from '@/features/executions/page'
import {
  fetchExecution,
  fetchExecutions,
  fetchExecutionUsers,
  transformApiExecution,
  startExecution,
  stopExecution as stopExecutionApi,
  deleteExecution as deleteExecutionApi,
} from '@/features/executions/api/executions'
import { resolveDateRange } from '@/lib/date-range'
import { RunDialog } from '@/components/shared/dialogs/run-dialog'
import { useSuiteRunDialog } from '@/features/suites/hooks/use-suite-run-dialog'
import { SuiteRunDialogView } from '@/features/suites/components/suite-run-dialog-view'
import { useRegressionRunDialog } from '@/features/regressions/hooks/use-regression-run-dialog'
import { RegressionRunDialogView } from '@/features/regressions/components/regression-run-dialog-view'
import { useEnvironments } from '@/hooks/use-environments'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { useDataTable } from '@/hooks/use-data-table'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useUrlListFilters } from '@/hooks/use-url-list-filters'

/**
 * Executions page with data fetching and state management
 */
export function ExecutionsListContainer(): ReactNode {
  const navigate = useNavigate()

  // Shared table state: sort, pagination, columns (TanStack native)
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
    rowSelection,
    onRowSelectionChange,
    selectedIds,
    clearSelection,
  } = useDataTable({
    defaultPageSize: 10,
    defaultVisibleColumns: [
      'name',
      'type',
      'triggeredBy',
      'startedAt',
      'duration',
      'status',
    ],
    visibleColumnsStorageKey: 'wave_executions_visible_columns',
    defaultSorting: [{ id: 'startedAt', desc: true }],
  })

  // State
  const [executions, setExecutions] = useState<ExecutionItem[]>([])
  const [allUsers, setAllUsers] = useState<string[]>([])
  const { loading, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)

  // Selection mode
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  const { filters, handleFilterChange } = useUrlListFilters({
    pageSize: pageInfo.pageSize,
    setPageInfo,
  })

  // The users read blocks the page; the executions read keeps the page's own error state.
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const blocking = useBlockingReads(primary)
  const userReads = useMemo<BlockingRead[]>(
    () => [{ label: 'users', run: async () => setAllUsers(await fetchExecutionUsers()) }],
    []
  )

  /* v8 ignore start - COV-ROUTER-001 */
  // Load data
  const readExecutions = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    // Started before the primary read is awaited so both reads stay concurrent.
    const reads = blocking.load(userReads)

    try {
      const resolved = resolveDateRange(filters.dateRange ?? { kind: 'all-time' })
      const result = await fetchExecutions({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        status: filters.status.length > 0 ? filters.status : undefined,
        type: filters.type.length > 0 ? filters.type : undefined,
        triggered_by: filters.user.length > 0 ? filters.user : undefined,
        from_date: resolved.from_date,
        to_date: resolved.to_date,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
      })

      const transformedExecutions = result.data.map(transformApiExecution)
      setExecutions(transformedExecutions)
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

  // Nothing that starts the read can await it, so the page's own error state
  // is where a failure is reported.
  const loadData = useCallback((): void => {
    readExecutions().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load executions')
    })
  }, [readExecutions])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Run dialog hooks for re-run from the list (same flow as execution-toolbar)
  const { environments: fetchedEnvs } = useEnvironments(primary)
  const environments = useMemo(
    () => fetchedEnvs.map((e) => ({ id: e.id, name: e.name })),
    [fetchedEnvs]
  )
  const suiteRunDialog = useSuiteRunDialog({ setError, environments })
  const regressionRunDialog = useRegressionRunDialog({ setError, environments })
  const [testRerunOpen, setTestRerunOpen] = useState(false)
  const [testRerunExec, setTestRerunExec] = useState<{
    entityType: string; entityId: string; name: string; envId: string
  } | null>(null)
  const [selectedEnvId, setSelectedEnvId] = useState<string>('')

  // Handlers
  const handleViewExecution = useCallback(
    (executionId: string) => {
      const exec = executions.find((e) => e.id === executionId)
      if (exec?.type === 'test') {
        navigate(`/executions/history/${executionId}`)
      } else {
        navigate(`/executions/${executionId}`)
      }
    },
    [navigate, executions]
  )

  const handleRerunExecution = useCallback(
    (executionId: string): void => {
      const rerun = async (): Promise<void> => {
        const response = await fetchExecution(executionId)
        const exec = response.data
        const entityType = exec.entity_type ?? exec.type ?? 'test'
        const entityId = exec.entity_id
        const envId = exec.environment_id ?? ''
        const name = exec.name ?? ''

        if (entityType === 'suite') {
          const seedIds = Array.isArray(exec.selected_tests)
            ? (exec.selected_tests as string[])
            : null
          suiteRunDialog.openForSuite(entityId, name, seedIds)
          suiteRunDialog.selectEnvironment(envId)
        } else if (entityType === 'regression') {
          const seedPairs = Array.isArray(exec.selected_tests)
            ? (exec.selected_tests as Array<{ suite_id: string; test_id: string }>).map((p) => ({
                suiteId: p.suite_id,
                testId: p.test_id,
              }))
            : null
          regressionRunDialog.openForRegression(entityId, name, seedPairs)
          regressionRunDialog.selectEnvironment(envId)
        } else {
          setTestRerunExec({ entityType, entityId, name, envId })
          setSelectedEnvId(envId)
          setTestRerunOpen(true)
        }
      }
      rerun().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load execution for re-run')
      })
    },
    [suiteRunDialog, regressionRunDialog]
  )

  const handleTestRerun = useCallback((): void => {
    if (!testRerunExec) return
    startExecution({
      type: testRerunExec.entityType,
      id: testRerunExec.entityId,
      environmentId: selectedEnvId,
    })
      .then(() => {
        setTestRerunOpen(false)
        setTestRerunExec(null)
        // Test runs stream live on the Workbench canvas.
        navigate('/workbench')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to start execution')
      })
  }, [testRerunExec, selectedEnvId, navigate])

  const handleStopExecution = useCallback(
    (executionId: string): void => {
      stopExecutionApi(executionId)
        .then(loadData)
        .catch((err: unknown) => {
          console.error('Failed to stop execution:', err)
          setError(err instanceof Error ? err.message : 'Failed to stop execution')
        })
    },
    [loadData]
  )

  const handleDeleteExecution = useCallback(
    (executionId: string): void => {
      deleteExecutionApi(executionId)
        .then(loadData)
        .catch((err: unknown) => {
          console.error('Failed to delete execution:', err)
          setError(err instanceof Error ? err.message : 'Failed to delete execution')
        })
    },
    [loadData]
  )

  const handleRetry = useCallback(() => {
    loadData()
  }, [loadData])
  /* v8 ignore stop */

  // Selection mode handlers
  /* v8 ignore start - COV-V8-003: V8 tracks callback bodies; exercised via router integration */
  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
  }, [])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    clearSelection()
  }, [clearSelection])
  /* v8 ignore stop */

  // Bulk action handlers
  /* v8 ignore start - COV-ROUTER-001 */
  const handleBulkDelete = useCallback((): void => {
    if (selectedIds.length === 0) return
    Promise.all(selectedIds.map((id) => deleteExecutionApi(id)))
      .then(() => {
        clearSelection()
        setSelectionModeActive(false)
        loadData()
      })
      .catch((err: unknown) => {
        console.error('Failed to delete executions:', err)
        setError(err instanceof Error ? err.message : 'Failed to delete executions')
      })
  }, [selectedIds, loadData, clearSelection])

  /* v8 ignore stop */

  /* v8 ignore start - COV-DEF-047: Container return statement and error fallback */
  return (
    <>
      <ExecutionsPageComponent
        executions={executions}
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
        enableSelection={selectionModeActive}
        selectedIds={selectedIds}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        onViewExecution={handleViewExecution}
        onRerunExecution={handleRerunExecution}
        onStopExecution={handleStopExecution}
        onDeleteExecution={handleDeleteExecution}
        onBulkDelete={handleBulkDelete}
        onEnterSelectionMode={handleEnterSelectionMode}
        onExitSelectionMode={handleExitSelectionMode}
        onFilterChange={handleFilterChange}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onColumnToggle={toggleColumn}
        onRetry={handleRetry}
      />

      {/* Re-run dialogs (same hooks as execution-toolbar) */}
      {/* v8 ignore start - COV-CONTAINER-004: Conditional dialog render; exercised via router integration */}
      {testRerunOpen && testRerunExec && (
        <RunDialog
          open={testRerunOpen}
          onOpenChange={setTestRerunOpen}
          entityType="test"
          entityName={testRerunExec.name}
          entityId={testRerunExec.entityId}
          environments={environments}
          recentEnvironments={[]}
          selectedEnvironmentId={selectedEnvId}
          onEnvironmentSelect={(id) => setSelectedEnvId(id)}
          onRun={handleTestRerun}
          onCancel={() => { setTestRerunOpen(false); setTestRerunExec(null) }}
        />
      )}
      {/* v8 ignore stop */}

      <SuiteRunDialogView hook={suiteRunDialog} />
      <RegressionRunDialogView hook={regressionRunDialog} />
    </>
  )
}
