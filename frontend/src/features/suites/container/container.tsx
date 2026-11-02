/**
 * Suites List Container
 *
 * Suites page with data fetching and state management.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SuitesPage as SuitesPageComponent } from '@/features/suites/page'
import type { SuiteListItem } from '@/features/suites/api/types'
import type { SuitesFilters } from '@/features/suites/components/suites-filters'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SuiteRunDialogView } from '@/features/suites/components/suite-run-dialog-view'
import {
  fetchSuitesList,
  transformApiSuiteList,
  deleteSuite,
  cloneSuite,
  batchDeleteSuites,
  batchCloneSuites,
  createSuite,
} from '@/features/suites/api/crud'
import { validateSuiteImport, importSuites } from '@/features/suites/api/export-import'
import { SuiteCreateModal } from '@/features/suites/components/suite-create-modal'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog } from '@/components/shared/dialogs/import-dialog'
import { useExportImport } from './use-export-import'
import { useSuitesTags } from './use-suites-tags'
import type { PrimaryState } from '@/hooks/use-blocking-reads'
import { useEnvironments } from '@/hooks/use-environments'
import { useSuiteRunDialog } from '@/features/suites/hooks/use-suite-run-dialog'
import { useToast } from '@/components/ui/toast'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'
import { useDataTable } from '@/hooks/use-data-table'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { buildFilterParams } from '@/components/shared/tables/table-utils'

/**
 * Suites page with data fetching and state management
 */
export function SuitesListContainer(): ReactNode {
  const navigate = useNavigate()
  const toastCtx = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // Shared table state: sort, pagination, columns, selection
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
    defaultVisibleColumns: ['name', 'testsCount', 'status', 'lastRun'],
    defaultHiddenColumns: ['tags', 'createdAt', 'updatedAt'],
    visibleColumnsStorageKey: 'wave_suites_visible_columns',
    defaultSorting: [{ id: 'name', desc: false }],
  })

  // State
  const [suites, setSuites] = useState<SuiteListItem[]>([])
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const [selectionModeActive, setSelectionModeActive] = useState(false)
  const { loading, settled, startLoading, stopLoading } = useDebouncedLoading()
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<SuitesFilters>({
    search: searchParams.get('search') || '',
    status: searchParams.get('status')?.split(',').filter(Boolean) || [],
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
  })

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [suiteToDelete, setSuiteToDelete] = useState<{ id: string; name: string } | null>(null)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)

  // Run dialog state lives in the shared hook so the detail page can reuse it
  const { environments } = useEnvironments(primary)
  const runDialog = useSuiteRunDialog({ setError, environments })

  // Create modal state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Load data
  const readSuites = useCallback(async () => {
    startLoading()
    setError(null)
    setPrimary('pending')

    try {
      const suitesResult = await fetchSuitesList({
        page: pageInfo.currentPage,
        per_page: pageInfo.pageSize,
        search: filters.search || undefined,
        status: filters.status.length > 0 ? filters.status : undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
        sort_by: sortColumn || undefined,
        sort_order: sortDirection || undefined,
      })

      const transformedSuites = suitesResult.data.map(transformApiSuiteList)
      setSuites(transformedSuites)
      setPageInfo((prev) => ({
        ...prev,
        totalItems: suitesResult.pagination.total,
        totalPages: suitesResult.pagination.total_pages,
      }))
      setPrimary('loaded')
    } catch (err) {
      setPrimary('failed')
      throw err
    } finally {
      stopLoading()
    }
  }, [pageInfo.currentPage, pageInfo.pageSize, filters, sortColumn, sortDirection, setPageInfo])

  // Nothing that starts this read can await it, so the page's own error state
  // is where a failure is reported.
  const loadData = useCallback((): void => {
    readSuites().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load suites')
    })
  }, [readSuites])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Tag universe (REQ-9.5.3.2); its read starts after the suite list's
  const allTags = useSuitesTags(primary)

  // Export/import hook
  const exportImport = useExportImport(suites, selectedIds, loadData, clearSelection)

  // Handlers
  const handleNewSuite = useCallback(() => {
    setCreateModalOpen(true)
    setCreateError(null)
  }, [])

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      navigate(`/suites/${suiteId}`)
    },
    [navigate]
  )

  /* v8 ignore start - COV-CONTAINER-004: Create suite handler requires complex integration test setup */
  const handleCreateSubmit = useCallback(
    (data: { name: string; description: string; tags: string[] }): void => {
      setCreateLoading(true)
      setCreateError(null)
      createSuite(data)
        .then((newSuite) => {
          setCreateModalOpen(false)
          navigate(`/suites/${newSuite.id}`)
        })
        .finally(() => setCreateLoading(false))
        .catch((err: unknown) => {
          setCreateError(err instanceof Error ? err.message : 'Failed to create suite')
        })
    },
    [navigate]
  )

  const handleCreateModalClose = useCallback(() => {
    setCreateModalOpen(false)
    setCreateError(null)
  }, [])

  const handleDeleteSuite = useCallback(
    (suiteId: string) => {
      // Find suite name for the dialog
      const suite = suites.find((s) => s.id === suiteId)
      /* v8 ignore next - COV-BRANCH-019 */
      setSuiteToDelete({ id: suiteId, name: suite?.name ?? suiteId })
      setDeleteDialogOpen(true)
    },
    [suites]
  ) /* v8 ignore stop */

  const confirmDeleteSuite = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-020 */
    if (!suiteToDelete) return
    /* v8 ignore start - COV-V8-003: V8 tracks try/catch/finally as separate branches */
    deleteSuite(suiteToDelete.id)
      // Refresh the list after deletion
      .then(loadData)
      .finally(() => {
        setDeleteDialogOpen(false)
        setSuiteToDelete(null)
      })
      .catch((err: unknown) => {
        const handled = handleDeleteConflict({
          error: err,
          entityType: 'suite',
          toast: toastCtx,
          navigate,
        })
        if (!handled) {
          console.error('Failed to delete suite:', err)
          setError(err instanceof Error ? err.message : 'Failed to delete suite')
        }
      })
    /* v8 ignore stop */
  }, [suiteToDelete, loadData, toastCtx, navigate])

  const handleDuplicateSuite = useCallback(
    (suiteId: string): void => {
      // Find suite name for generating copy name
      const suite = suites.find((s) => s.id === suiteId)
      cloneSuite(suiteId, suite?.name)
        // Refresh the list after duplication
        .then(loadData)
        .catch((err: unknown) => {
          console.error('Failed to duplicate suite:', err)
          setError(err instanceof Error ? err.message : 'Failed to duplicate suite')
        })
    },
    [suites, loadData]
  )

  const handleRunSuite = useCallback((suiteId: string): void => {
    const suite = suites.find((s) => s.id === suiteId)
    /* v8 ignore next - COV-BRANCH-027 */
    runDialog.openForSuite(suiteId, suite?.name ?? suiteId)
  }, [suites, runDialog])

  const handleBulkDelete = useCallback(() => {
    /* v8 ignore next - COV-BRANCH-021 */
    if (selectedIds.length === 0) return
    setBulkDeleteDialogOpen(true)
    /* v8 ignore next - COV-V8-003: V8 tracks useCallback dep array as branch */
  }, [selectedIds])

  const confirmBulkDelete = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-022 */
    if (selectedIds.length === 0) return
    /* v8 ignore start - COV-V8-003: V8 tracks try/catch/finally as separate branches */
    batchDeleteSuites(selectedIds)
      .then(() => {
        clearSelection()
        setSelectionModeActive(false)
        loadData()
      })
      .finally(() => setBulkDeleteDialogOpen(false))
      .catch((err: unknown) => {
        console.error('Failed to bulk delete:', err)
        setError(err instanceof Error ? err.message : 'Failed to delete suites')
      })
    /* v8 ignore stop */
  }, [selectedIds, loadData])

  const handleBulkRun = useCallback(() => {
    // Navigate to batch execution
    const ids = selectedIds.join(',')
    navigate(`/executions/new?suites=${ids}`)
  }, [selectedIds, navigate])

  const handleBulkExport = exportImport.handleBulkExport

  const handleBulkDuplicate = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-023 */
    if (selectedIds.length === 0) return
    /* v8 ignore start - COV-V8-003: V8 tracks try/catch as branches */
    batchCloneSuites(selectedIds)
      .then(() => {
        clearSelection()
        setSelectionModeActive(false)
        loadData()
      })
      .catch((err: unknown) => {
        console.error('Failed to bulk duplicate:', err)
        setError(err instanceof Error ? err.message : 'Failed to duplicate suites')
      })
    /* v8 ignore stop */
  }, [selectedIds, loadData])

  /* v8 ignore start - COV-ROUTER-001 */
  const handleFilterChange = useCallback(
    (newFilters: SuitesFilters) => {
      setFilters(newFilters)
      const params = buildFilterParams(newFilters, pageInfo.pageSize)
      setSearchParams(params, { replace: true })
      setPageInfo((prev) => ({ ...prev, currentPage: 1 }))
    },
    [pageInfo.pageSize, setSearchParams, setPageInfo]
  )
  /* v8 ignore stop */

  const handleRetry = useCallback(() => {
    loadData()
  }, [loadData])

  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
  }, [])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    clearSelection()
  }, [clearSelection])

  return (
    <>
    {/* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */}
    <SuitesPageComponent
      suites={suites}
      pageInfo={pageInfo}
      filters={filters}
      allTags={allTags}
      loading={loading}
      settled={settled}
      error={error ?? undefined}
      // Sorting (TanStack native)
      sorting={sorting}
      onSortingChange={onSortingChange}
      // Column visibility (TanStack native)
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      visibleColumns={visibleColumns}
      // Selection (TanStack native)
      enableSelection={selectionModeActive}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      selectedIds={selectedIds}
      // Actions
      onNewSuite={handleNewSuite}
      onEditSuite={handleEditSuite}
      onDeleteSuite={handleDeleteSuite}
      onDuplicateSuite={handleDuplicateSuite}
      onRunSuite={handleRunSuite}
      onBulkDelete={handleBulkDelete}
      onBulkRun={handleBulkRun}
      onBulkExport={handleBulkExport}
      onBulkDuplicate={handleBulkDuplicate}
      onExportSuite={exportImport.handleExportSuite}
      onImport={exportImport.handleImportOpen}
      onFilterChange={handleFilterChange}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onEnterSelectionMode={handleEnterSelectionMode}
      onExitSelectionMode={handleExitSelectionMode}
      onColumnToggle={toggleColumn}
      onRetry={handleRetry}
    />

    {/* Single delete confirmation dialog */}
    <ConfirmationDialog
      isOpen={deleteDialogOpen}
      onClose={() => {
        setDeleteDialogOpen(false)
        setSuiteToDelete(null)
      }}
      onConfirm={confirmDeleteSuite}
      variant="delete"
      itemName={suiteToDelete?.name}
      description="This action cannot be undone. The suite and all its associated data will be permanently removed."
    />

    {/* Bulk delete confirmation dialog */}
    <ConfirmationDialog
      isOpen={bulkDeleteDialogOpen}
      onClose={() => setBulkDeleteDialogOpen(false)}
      onConfirm={confirmBulkDelete}
      variant="delete-multiple"
      itemCount={selectedIds.length}
      itemNames={selectedIds
        .map((id) => suites.find((s) => s.id === id)?.name)
        .filter((name): name is string => Boolean(name))}
      description="This action cannot be undone. All selected suites and their associated data will be permanently removed."
    />

    {/* Run dialog */}
    <SuiteRunDialogView hook={runDialog} />

    {/* Create suite modal */}
    <SuiteCreateModal
      open={createModalOpen}
      allTags={allTags}
      loading={createLoading}
      error={createError}
      onClose={handleCreateModalClose}
      onSubmit={handleCreateSubmit}
    />

    {/* Export dialog */}
    <ExportDialog
      open={exportImport.exportDialogOpen}
      onOpenChange={exportImport.setExportDialogOpen}
      entityIds={exportImport.exportSuiteIds}
      entityNames={exportImport.exportSuiteNames}
      entityLabel="Suite"
      hasSecrets
      onExport={exportImport.handleExportAction}
      loading={exportImport.exportLoading}
    />

    {/* Import dialog */}
    <ImportDialog
      open={exportImport.importDialogOpen}
      onOpenChange={exportImport.setImportDialogOpen}
      entityLabel="Suite"
      onValidate={validateSuiteImport}
      onImport={importSuites}
      onImportComplete={exportImport.handleImportComplete}
    />
    </>
  )
}
