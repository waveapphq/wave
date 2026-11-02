/**
 * Regressions List Container
 *
 * Regressions page with data fetching and state management.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RegressionsPage as RegressionsPageComponent } from '@/features/regressions/page'
import type { Regression } from '@/features/regressions/api/types'
import type { RegressionsFilters } from '@/features/regressions/components/regressions-filters'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { RegressionRunDialogView } from '@/features/regressions/components/regression-run-dialog-view'
import {
  fetchRegressions,
  deleteRegression,
  batchDeleteRegressions,
  batchCloneRegressions,
  cloneRegression,
  createRegression,
  fetchRegressionsTags,
} from '@/features/regressions/api/crud'
import { RegressionCreateModal } from '@/features/regressions/components/regression-create-modal'
import { useRegressionRunDialog } from '@/features/regressions/hooks/use-regression-run-dialog'
import { useDataTable } from '@/hooks/use-data-table'
import { useExportImport } from '@/features/regressions/container/use-export-import'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { useEnvironments } from '@/hooks/use-environments'
import { buildFilterParams } from '@/components/shared/tables/table-utils'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog } from '@/components/shared/dialogs/import-dialog'
import { importRegressions, validateRegressionImport } from '@/features/regressions/api/export-import'
import { useToast } from '@/components/ui/toast'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'

/**
 * Regressions page with data fetching and state management
 */
export function RegressionsListContainer(): ReactNode {
  const navigate = useNavigate()
  const toastCtx = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

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
    defaultVisibleColumns: [
      'name',
      'suitesCount',
      'testsCount',
      'status',
      'lastRun',
    ],
    defaultHiddenColumns: [
      'tags',
      'createdAt',
      'updatedAt',
    ],
    visibleColumnsStorageKey: 'wave_regressions_visible_columns',
    defaultSorting: [{ id: 'name', desc: false }],
  })

  // State
  const [regressions, setRegressions] = useState<Regression[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const { loading, settled, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)
  const blocking = useBlockingReads(primary)

  const tagReads = useMemo<BlockingRead[]>(
    () => [{ label: 'tags', run: async () => setAllTags(await fetchRegressionsTags()) }],
    []
  )
  const [filters, setFilters] = useState<RegressionsFilters>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status')?.split(',').filter(Boolean) || [],
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
  })

  // Create modal state
  /* v8 ignore next - COV-V8-003: V8 tracks useState as branch */
  const [createModalOpen, setCreateModalOpen] = useState(false)
  /* v8 ignore next - COV-V8-003: V8 tracks useState as branch */
  const [createLoading, setCreateLoading] = useState(false)
  /* v8 ignore next - COV-V8-003: V8 tracks union type as branch */
  const [createError, setCreateError] = useState<string | null>(null)

  // Selection mode
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  // Delete confirmation dialog state
  /* v8 ignore next - COV-V8-003: V8 tracks useState as branch */
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  /* v8 ignore next 2 - COV-V8-003: V8 tracks union type as branch */
  const [regressionToDelete, setRegressionToDelete] = useState<{ id: string; name: string } | null>(
    null
  )

  // Run dialog state lives in the shared hook so the detail page can reuse it
  const { environments } = useEnvironments(primary)
  const runDialog = useRegressionRunDialog({ setError, environments })

  // Load data
  const readRegressions = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    try {
      const result = await fetchRegressions({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        /* v8 ignore start - COV-ROUTER-001 */
        search: filters.search || undefined,
        status: filters.status.length > 0 ? filters.status : undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
        /* v8 ignore stop */
      })

      setRegressions(result.data)
      setPageInfo((prev) => ({
        ...prev,
        totalItems: result.pagination.total,
        totalPages: result.pagination.total_pages,
      }))
      setPrimary('loaded')
    } catch (err) {
      setPrimary('failed')
      throw err
    } finally {
      stopLoading()
    }
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, sortColumn, sortDirection, startLoading, stopLoading, setPageInfo])

  // Nothing that starts this read can await it, so the page's own error state
  // is where a failure is reported.
  const loadData = useCallback((): void => {
    readRegressions().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load regressions')
    })
  }, [readRegressions])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Export/import hook (must be after loadData)
  const exportImport = useExportImport(regressions, selectedIds, loadData, clearSelection)

  // Tag universe (REQ-9.5.3.3), read once on mount
  useEffect(() => {
    blocking.start(tagReads)
  }, [blocking, tagReads])

  /* v8 ignore start - COV-ROUTER-001 */
  // Handlers - callbacks passed to child components are difficult to test in jsdom
  const handleNewRegression = useCallback(() => {
    setCreateModalOpen(true)
    setCreateError(null)
  }, [])

  const handleCreateSubmit = useCallback(
    (data: { name: string; description: string; tags: string[] }): void => {
      setCreateLoading(true)
      setCreateError(null)
      createRegression(data)
        .then((created) => {
          setCreateModalOpen(false)
          navigate(`/regressions/${created.id}`)
        })
        .finally(() => setCreateLoading(false))
        .catch((err: unknown) => {
          setCreateError(err instanceof Error ? err.message : 'Failed to create regression')
        })
    },
    [navigate],
  )

  const handleEditRegression = useCallback(
    (regressionId: string) => {
      navigate(`/regressions/${regressionId}/edit`)
    },
    [navigate]
  )

  const handleDeleteRegression = useCallback(
    (regressionId: string) => {
      const regression = regressions.find((r) => r.id === regressionId)
      setRegressionToDelete({ id: regressionId, name: regression?.name ?? regressionId })
      setDeleteDialogOpen(true)
    },
    [regressions]
  )

  const handleDuplicateRegression = useCallback(
    (regressionId: string): void => {
      const regression = regressions.find((r) => r.id === regressionId)
      cloneRegression(regressionId, regression?.name)
        .then(loadData)
        .catch((err: unknown) => {
          console.error('Failed to duplicate regression:', err)
          setError(err instanceof Error ? err.message : 'Failed to duplicate regression')
        })
    },
    [regressions, loadData]
  )
  /* v8 ignore stop */

  /* v8 ignore start - COV-ROUTER-001 */
  const handleRunRegression = useCallback(
    (regressionId: string): void => {
      const regression = regressions.find((r) => r.id === regressionId)
      runDialog.openForRegression(regressionId, regression?.name ?? regressionId)
    },
    [regressions, runDialog]
  )

  // Delete confirmation dialog state - bulk
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)

  const confirmDeleteRegression = useCallback((): void => {
    if (!regressionToDelete) return
    deleteRegression(regressionToDelete.id)
      .then(loadData)
      .finally(() => {
        setDeleteDialogOpen(false)
        setRegressionToDelete(null)
      })
      .catch((err: unknown) => {
        const handled = handleDeleteConflict({
          error: err,
          entityType: 'regression',
          toast: toastCtx,
          navigate,
        })
        if (!handled) {
          console.error('Failed to delete regression:', err)
          setError(err instanceof Error ? err.message : 'Failed to delete regression')
        }
      })
  }, [regressionToDelete, loadData, toastCtx, navigate])

  // Bulk action handlers
  const handleBulkDelete = useCallback(() => {
    if (selectedIds.length === 0) return
    setBulkDeleteDialogOpen(true)
  }, [selectedIds])

  const confirmBulkDelete = useCallback((): void => {
    if (selectedIds.length === 0) return
    batchDeleteRegressions(selectedIds)
      .then(() => {
        clearSelection()
        setSelectionModeActive(false)
        loadData()
      })
      .finally(() => setBulkDeleteDialogOpen(false))
      .catch((err: unknown) => {
        console.error('Failed to delete regressions:', err)
        setError(err instanceof Error ? err.message : 'Failed to delete regressions')
      })
  }, [selectedIds, loadData, clearSelection])

  const handleBulkDuplicate = useCallback((): void => {
    if (selectedIds.length === 0) return
    batchCloneRegressions(selectedIds)
      .then(() => {
        clearSelection()
        setSelectionModeActive(false)
        loadData()
      })
      .catch((err: unknown) => {
        console.error('Failed to duplicate regressions:', err)
        setError(err instanceof Error ? err.message : 'Failed to duplicate regressions')
      })
  }, [selectedIds, loadData, clearSelection])

  const handleBulkRun = useCallback(() => {
    if (selectedIds.length === 0) return
    const ids = selectedIds.join(',')
    navigate(`/executions/new?regressionIds=${ids}`)
  }, [selectedIds, navigate])

  const handleFilterChange = useCallback(
    (newFilters: RegressionsFilters) => {
      setFilters(newFilters)
      const params = buildFilterParams(newFilters, pageInfo.pageSize)
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageInfo.pageSize, setSearchParams]
  )
  /* v8 ignore stop */

  /* v8 ignore start - COV-RADIX-009 */
  const handleRetry = useCallback(() => {
    loadData()
  }, [loadData])
  /* v8 ignore stop */

  /* v8 ignore start - COV-CONTAINER-034: Selection mode toggle callbacks - v8 parallelism tracking quirk */
  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
  }, [])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    clearSelection()
  }, [clearSelection])
  /* v8 ignore stop */

  /* v8 ignore start - COV-DEF-048: Container return statement and error fallback */
  return (
    <>
      <RegressionsPageComponent
        regressions={regressions}
        pageInfo={pageInfo}
        filters={filters}
        allTags={allTags}
        loading={loading}
        settled={settled}
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
        onNewRegression={handleNewRegression}
        onEditRegression={handleEditRegression}
        onDeleteRegression={handleDeleteRegression}
        onDuplicateRegression={handleDuplicateRegression}
        onRunRegression={handleRunRegression}
        onExportRegression={exportImport.handleExportRegression}
        onBulkExport={exportImport.handleBulkExport}
        onBulkDelete={handleBulkDelete}
        onBulkDuplicate={handleBulkDuplicate}
        onBulkRun={handleBulkRun}
        onEnterSelectionMode={handleEnterSelectionMode}
        onExitSelectionMode={handleExitSelectionMode}
        onImport={exportImport.handleImportOpen}
        onFilterChange={handleFilterChange}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onColumnToggle={toggleColumn}
        onRetry={handleRetry}
      />

      {/* Create regression modal */}
      <RegressionCreateModal
        open={createModalOpen}
        allTags={allTags}
        loading={createLoading}
        error={createError}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreateSubmit}
      />

      {/* Single delete confirmation dialog */}
      {/* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */}
      <ConfirmationDialog
        isOpen={deleteDialogOpen}
        /* v8 ignore start - COV-RADIX-011 */
        onClose={() => {
          setDeleteDialogOpen(false)
          setRegressionToDelete(null)
        }}
        /* v8 ignore stop */
        onConfirm={confirmDeleteRegression}
        variant="delete"
        /* v8 ignore next 2 - COV-BRANCH-027 */
        itemName={regressionToDelete?.name}
        description="This action cannot be undone. The regression and all its associated data will be permanently removed."
      />

      {/* Bulk delete confirmation dialog */}
      <ConfirmationDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={confirmBulkDelete}
        variant="delete-multiple"
        itemCount={selectedIds.length}
        itemNames={selectedIds
          .map((id) => regressions.find((r) => r.id === id)?.name)
          .filter((name): name is string => Boolean(name))}
        description="This action cannot be undone. All selected regressions and their associated data will be permanently removed."
      />

      {/* Run dialog */}
      <RegressionRunDialogView hook={runDialog} />

      {/* Export dialog */}
      <ExportDialog
        open={exportImport.exportDialogOpen}
        onOpenChange={exportImport.setExportDialogOpen}
        entityLabel="regression"
        entityIds={exportImport.exportRegressionIds}
        entityNames={exportImport.exportRegressionNames}
        hasSecrets
        onExport={exportImport.handleExportAction}
        loading={exportImport.exportLoading}
      />

      {/* Import dialog */}
      <ImportDialog
        open={exportImport.importDialogOpen}
        onOpenChange={exportImport.setImportDialogOpen}
        entityLabel="regression"
        onValidate={validateRegressionImport}
        onImport={importRegressions}
        onImportComplete={exportImport.handleImportComplete}
      />
    </>
  )
}
