/**
 * Artifacts list container: fetches the execution-artifact summaries, owns the
 * table/filter/selection state, and wires row + mass actions. Row "open"
 * navigates to the per-execution drill; download streams a .zip; delete
 * soft-deletes (single execution or the selected set) and reloads.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RowSelectionState } from '@tanstack/react-table'
import { ArtifactsListPage } from '@/features/artifacts/page'
import {
  deleteExecutionArtifacts,
  fetchExecutionArtifactSummaries,
} from '@/features/artifacts/api/artifacts'
import { downloadExecutionZip } from '@/features/artifacts/api/download'
import {
  DEFAULT_ARTIFACTS_FILTERS,
  type ArtifactsFilters,
} from '@/features/artifacts/components/artifacts-filters'
import { bulkFailureMessage } from '@/lib/bulk-failure'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'
import { useDataTable } from '@/hooks/use-data-table'
import { useToast } from '@/components/ui/toast'

const VISIBLE_COLUMNS = ['execution', 'type', 'status', 'finishedAt', 'artifacts', 'size']
const DOWNLOAD_FAILED = 'Download Failed'
const DELETE_FAILED = 'Delete Failed'

export function ArtifactsListContainer(): ReactNode {
  const navigate = useNavigate()
  const { error: toastError } = useToast()

  const {
    pageInfo,
    setPageInfo,
    onPageChange,
    onPageSizeChange,
    sorting,
    onSortingChange,
    columnVisibility,
    onColumnVisibilityChange,
    visibleColumns,
    toggleColumn,
  } = useDataTable({
    defaultPageSize: 10,
    defaultVisibleColumns: VISIBLE_COLUMNS,
    visibleColumnsStorageKey: 'wave_artifacts_visible_columns',
    defaultSorting: [{ id: 'finishedAt', desc: true }],
  })

  const [rows, setRows] = useState<ExecutionArtifactSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ArtifactsFilters>(DEFAULT_ARTIFACTS_FILTERS)
  const [selectionModeActive, setSelectionModeActive] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [totalSizeBytes, setTotalSizeBytes] = useState(0)
  // Accumulates id -> size across loaded pages so the selected-size total is
  // correct even when the selection spans pages (rows holds one page only).
  const sizeByIdRef = useRef<Map<string, number>>(new Map())

  const readRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchExecutionArtifactSummaries({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search,
        status: filters.status,
        type: filters.type,
      })
      setRows(result.data)
      for (const row of result.data) {
        sizeByIdRef.current.set(row.execution_id, row.total_size_bytes)
      }
      setTotalSizeBytes(result.pagination.total_size_bytes)
      setPageInfo((prev) => ({
        ...prev,
        totalItems: result.pagination.total,
        totalPages: result.pagination.total_pages,
      }))
    } finally {
      setLoading(false)
    }
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, setPageInfo])

  // Nothing that starts this read can await it, so the page's own error state
  // is where a failure is reported.
  const loadData = useCallback((): void => {
    readRows().catch((error_: unknown) => {
      setError(error_ instanceof Error ? error_.message : 'Failed to load artifacts')
    })
  }, [readRows])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleFilterChange = useCallback(
    (next: ArtifactsFilters) => {
      setFilters(next)
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [setPageInfo],
  )

  const handleOpenExecution = useCallback(
    (execution: ExecutionArtifactSummary) => {
      navigate(`/artifacts/${execution.execution_id}`)
    },
    [navigate],
  )

  const handleDownloadZip = useCallback(
    (execution?: ExecutionArtifactSummary): void => {
      const ids = execution ? [execution.execution_id] : Object.keys(rowSelection)
      Promise.allSettled(ids.map((id) => downloadExecutionZip(id)))
        .then((results) => {
          const message = bulkFailureMessage(
            results,
            (done, total) => `${done} of ${total} downloads finished.`,
          )
          if (message !== null) throw new Error(message)
        })
        .catch((error_: unknown) => {
          toastError((error_ as Error).message, DOWNLOAD_FAILED)
        })
    },
    [rowSelection, toastError],
  )

  const handleDelete = useCallback(
    (execution?: ExecutionArtifactSummary): void => {
      const ids = execution ? [execution.execution_id] : Object.keys(rowSelection)
      Promise.allSettled(ids.map((id) => deleteExecutionArtifacts(id)))
        .then((results) => {
          const message = bulkFailureMessage(
            results,
            (removed, total) => `${removed} of ${total} executions had their artifacts removed.`,
          )
          if (message !== null) throw new Error(message)
          setRowSelection({})
        })
        .finally(loadData)
        .catch((error_: unknown) => {
          toastError((error_ as Error).message, DELETE_FAILED)
        })
    },
    [rowSelection, loadData, toastError],
  )

  const enterSelectionMode = useCallback(() => setSelectionModeActive(true), [])
  const exitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    setRowSelection({})
  }, [])

  let selectedSizeBytes = 0
  for (const [id, size] of sizeByIdRef.current) {
    if (rowSelection[id]) {
      selectedSizeBytes += size
    }
  }

  return (
    <ArtifactsListPage
      rows={rows}
      pageInfo={pageInfo}
      totalSizeBytes={totalSizeBytes}
      selectedSizeBytes={selectedSizeBytes}
      filters={filters}
      loading={loading}
      error={error ?? undefined}
      sorting={sorting}
      onSortingChange={onSortingChange}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      visibleColumns={visibleColumns}
      onColumnToggle={toggleColumn}
      selectionModeActive={selectionModeActive}
      selectedCount={Object.keys(rowSelection).length}
      onEnterSelectionMode={enterSelectionMode}
      onExitSelectionMode={exitSelectionMode}
      onOpenExecution={handleOpenExecution}
      onDownloadZip={handleDownloadZip}
      onDeleteSelected={handleDelete}
      onFilterChange={handleFilterChange}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRetry={loadData}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
    />
  )
}
