/**
 * useEnvironmentsState Hook
 *
 * Manages all environment-related state and handlers for the settings
 * container, including CRUD, pagination, sorting, searching, tagging,
 * selection, and export/import.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedLoading } from '@/hooks/use-debounced-loading'
import { usePageBlock } from '@/hooks/use-page-block'
import { toFailureDetail } from '@/lib/failure-detail'
import type { FailedRead } from '@/stores/page-block-store'
import type { OnChangeFn, SortingState, VisibilityState } from '@tanstack/react-table'
import type { EnvironmentListItem } from '@/features/settings/components/environments-columns'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import {
  fetchEnvironments,
  fetchEnvironmentsTags,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment as deleteEnvironmentApi,
  duplicateEnvironment as duplicateEnvironmentApi,
} from '@/features/settings/api/environments/crud'
import { exportEnvironment, exportEnvironments } from '@/features/settings/api/environments/import-export'
import { downloadBlob } from '@/lib/download-blob'
import type { EnvironmentFormData } from '@/features/settings/components/environment-form'
import { useToast } from '@/components/ui/toast'
import type { ExportSecretsMode } from '@/types/import-export'

const TAGS_LABEL = 'tags'

/** What the section's two reads last did; drives whether the page is blocked. */
interface SectionReadStatus {
  primaryFailed: boolean
  tagsFailed: boolean
  tagsReason: unknown
}

interface TagsSink {
  status: SectionReadStatus
  setAllTags: (tags: string[]) => void
  blockPage: (failure: FailedRead) => void
  clearPageBlock: (label?: string) => void
}

/** A failed primary read owns the section, so the tag block never shows beside it. */
function applyBlock(sink: TagsSink): void {
  const { primaryFailed, tagsFailed, tagsReason } = sink.status
  if (primaryFailed || !tagsFailed) {
    sink.clearPageBlock(TAGS_LABEL)
    return
  }
  sink.blockPage({
    label: TAGS_LABEL,
    detail: toFailureDetail(tagsReason),
    retry: () => retryTags(sink),
  })
}

async function loadTags(sink: TagsSink): Promise<void> {
  sink.setAllTags(await fetchEnvironmentsTags())
  sink.status.tagsFailed = false
  sink.status.tagsReason = undefined
  applyBlock(sink)
}

/** A failed tag read is named on the section's block card. */
function reportTagsFailure(sink: TagsSink, reason: unknown): void {
  sink.status.tagsFailed = true
  sink.status.tagsReason = reason
  applyBlock(sink)
}

function startTagsRead(sink: TagsSink): void {
  loadTags(sink).catch((error_: unknown) => {
    reportTagsFailure(sink, error_)
  })
}

async function retryTags(sink: TagsSink): Promise<void> {
  try {
    await loadTags(sink)
  } catch (error_) {
    reportTagsFailure(sink, error_)
    throw error_
  }
}

export function useEnvironmentsState(active: boolean) {
  const { success: toastSuccess, error: toastError } = useToast()

  // Environment state
  const [environments, setEnvironments] = useState<EnvironmentListItem[]>([])
  const [environmentsPageInfo, setEnvironmentsPageInfo] = useState<PageInfo>({
    currentPage: 1,
    pageSize: 25,
    totalItems: 0,
    totalPages: 1,
  })
  const {
    loading: environmentsLoading,
    settled: environmentsSettled,
    startLoading: startEnvLoading,
    stopLoading: stopEnvLoading,
  } = useDebouncedLoading()
  const [environmentsError, setEnvironmentsError] = useState<string | undefined>()
  const [environmentsSorting, setEnvironmentsSorting] = useState<SortingState>([])
  const [environmentsSearchQuery, setEnvironmentsSearchQuery] = useState('')
  const [environmentsTagsFilter, setEnvironmentsTagsFilter] = useState<string[]>([])

  // Derived sort values for API calls
  const environmentsSortColumn = environmentsSorting.length > 0 ? environmentsSorting[0].id : null
  let environmentsSortDirection: 'asc' | 'desc' | null = null
  if (environmentsSorting.length > 0) environmentsSortDirection = environmentsSorting[0].desc ? 'desc' : 'asc'

  // Environment form state
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [formEnvironment, setFormEnvironment] = useState<EnvironmentListItem | undefined>()
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()

  // All environment tags (REQ-9.5.3.4)
  const [allEnvironmentTags, setAllEnvironmentTags] = useState<string[]>([])
  const { blockPage, clearPageBlock } = usePageBlock()
  const readStatus = useRef<SectionReadStatus>({
    primaryFailed: false,
    tagsFailed: false,
    tagsReason: undefined,
  })
  const tagsSink = useMemo<TagsSink>(
    () => ({
      status: readStatus.current,
      setAllTags: setAllEnvironmentTags,
      blockPage,
      clearPageBlock,
    }),
    [blockPage, clearPageBlock]
  )

  // Export state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportEnvIds, setExportEnvIds] = useState<string[]>([])
  const [exportEnvNames, setExportEnvNames] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)

  // Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // Delete confirmation state
  const [envToDelete, setEnvToDelete] = useState<EnvironmentListItem | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Column visibility state
  const defaultHiddenColumns = useMemo(() => ['tags'], [])
  const allToggleableColumns = useMemo(() => ['description', 'tags', 'usage'], [])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    const stored = localStorage.getItem('wave_environments_visible_columns')
    if (stored) {
      try {
        const visible = JSON.parse(stored) as string[]
        if (Array.isArray(visible) && visible.length > 0) {
          const state: VisibilityState = {}
          for (const col of allToggleableColumns) {
            state[col] = visible.includes(col)
          }
          return state
        }
      /* v8 ignore next - COV-V8-003: JSON.parse only fails on corrupted localStorage */
      } catch { /* use defaults */ }
    }
    const state: VisibilityState = {}
    for (const col of defaultHiddenColumns) {
      state[col] = false
    }
    return state
  })

  const handleColumnVisibilityChange: OnChangeFn<VisibilityState> = useCallback(
    (updaterOrValue) => {
      setColumnVisibility((prev) => {
        /* v8 ignore next - COV-V8-003: TanStack always calls with function updater; direct-value branch unreachable */
        const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue
        const visibleIds = allToggleableColumns.filter((col) => next[col] !== false)
        localStorage.setItem('wave_environments_visible_columns', JSON.stringify(visibleIds))
        return next
      })
    },
    [allToggleableColumns],
  )

  const handleColumnToggle = useCallback(
    (columnId: string, visible: boolean) => {
      handleColumnVisibilityChange((prev) => ({ ...prev, [columnId]: visible }))
    },
    [handleColumnVisibilityChange],
  )

  const visibleColumns = useMemo(
    () => allToggleableColumns.filter((col) => columnVisibility[col] !== false),
    [allToggleableColumns, columnVisibility],
  )

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  const reportEnvironmentsFailure = useCallback(
    (err: unknown) => {
      setEnvironmentsError(err instanceof Error ? err.message : 'Failed to load environments')
      tagsSink.status.primaryFailed = true
    },
    [tagsSink]
  )

  // Load environments
  const loadEnvironments = useCallback(async () => {
    startEnvLoading()
    setEnvironmentsError(undefined)
    const primaryWasFailed = tagsSink.status.primaryFailed
    try {
      const result = await fetchEnvironments({
        page: environmentsPageInfo.currentPage,
        per_page: environmentsPageInfo.pageSize,
        search: environmentsSearchQuery || undefined,
        tags: environmentsTagsFilter.length > 0 ? environmentsTagsFilter : undefined,
        sort_by: environmentsSortColumn || undefined,
        sort_direction: environmentsSortDirection || undefined,
      })
      setEnvironments(result.data)
      setEnvironmentsPageInfo((prev) => ({
        ...prev,
        totalItems: result.pagination.total,
        totalPages: result.pagination.total_pages,
      }))
      tagsSink.status.primaryFailed = false
      // A tags failure hidden by the primary failure is re-run on recovery, never replayed.
      if (primaryWasFailed && tagsSink.status.tagsFailed) startTagsRead(tagsSink)
    } catch (err) {
      reportEnvironmentsFailure(err)
      applyBlock(tagsSink)
    } finally {
      stopEnvLoading()
    }
  }, [
    environmentsPageInfo.currentPage,
    environmentsPageInfo.pageSize,
    environmentsSearchQuery,
    environmentsTagsFilter,
    environmentsSortColumn,
    environmentsSortDirection,
    reportEnvironmentsFailure,
    tagsSink,
  ])

  // Load all environment tags (REQ-9.5.3.4), on entering the section and after every save
  const reloadTags = useCallback(() => {
    startTagsRead(tagsSink)
  }, [tagsSink])

  // Scoped to the section: a section nobody is looking at never blocks the page.
  useEffect(() => {
    if (!active) {
      tagsSink.status.tagsFailed = false
      tagsSink.status.primaryFailed = false
      tagsSink.clearPageBlock()
      return
    }
    reloadTags()
  }, [active, reloadTags, tagsSink])

  // CRUD handlers
  const handleCreateEnvironment = useCallback(() => {
    setFormMode('create')
    setFormEnvironment(undefined)
    setFormError(undefined)
    setFormOpen(true)
  }, [])

  const handleEditEnvironment = useCallback(
    (id: string) => {
      const env = environments.find((e) => e.id === id)
      if (env) {
        setFormMode('edit')
        setFormEnvironment(env)
        setFormError(undefined)
        setFormOpen(true)
      }
    },
    [environments]
  )

  const handleFormSubmit = useCallback(
    async (data: EnvironmentFormData) => {
      setFormLoading(true)
      setFormError(undefined)
      try {
        // Convert null description to undefined for API compatibility
        const apiData = {
          name: data.name,
          description: data.description ?? undefined,
          tags: data.tags,
        }
        if (formMode === 'create') {
          await createEnvironment(apiData)
        } else if (formEnvironment) {
          await updateEnvironment(formEnvironment.id, apiData)
        }
        setFormOpen(false)
        await loadEnvironments()
        reloadTags()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to save environment')
      } finally {
        setFormLoading(false)
      }
    },
    [formMode, formEnvironment, loadEnvironments, reloadTags]
  )

  const handleDeleteEnvironment = useCallback(
    (id: string) => {
      const env = environments.find((e) => e.id === id)
      if (!env) return
      setEnvToDelete(env)
    },
    [environments]
  )

  const cancelDeleteEnvironment = useCallback(() => {
    setEnvToDelete(null)
  }, [])

  // Confirming closes the dialog, so the failure reports at the gesture.
  const confirmDeleteEnvironment = useCallback(async () => {
    if (!envToDelete) return
    setDeleteLoading(true)
    try {
      await deleteEnvironmentApi(envToDelete.id)
      setEnvToDelete(null)
      await loadEnvironments()
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : 'Failed to delete environment',
        'Delete Failed'
      )
    } finally {
      setDeleteLoading(false)
    }
  }, [envToDelete, loadEnvironments, toastError])

  const handleDuplicateEnvironment = useCallback(
    async (id: string) => {
      try {
        await duplicateEnvironmentApi(id)
        await loadEnvironments()
      } catch (err) {
        setEnvironmentsError(
          err instanceof Error ? err.message : 'Failed to duplicate environment'
        )
      }
    },
    [loadEnvironments]
  )

  // Pagination, search, sort, tags filter
  const handleEnvironmentsPageChange = useCallback((page: number) => {
    setEnvironmentsPageInfo((prev) => ({ ...prev, currentPage: page }))
  }, [])

  const handleEnvironmentsPageSizeChange = useCallback((pageSize: number) => {
    setEnvironmentsPageInfo((prev) => ({ ...prev, pageSize, currentPage: 1 }))
  }, [])

  const handleEnvironmentsSearch = useCallback((query: string) => {
    setEnvironmentsSearchQuery(query)
    setEnvironmentsPageInfo((prev) => ({ ...prev, currentPage: 1 }))
  }, [])

  /* v8 ignore start - COV-V8-003: TanStack always calls with function updater; direct-value branch unreachable */
  const handleEnvironmentsSortingChange: OnChangeFn<SortingState> = useCallback(
    (updaterOrValue) => {
      setEnvironmentsSorting((prev) =>
        typeof updaterOrValue === 'function'
          ? updaterOrValue(prev)
          : updaterOrValue,
      )
    },
    [],
  )
  /* v8 ignore stop */

  const handleEnvironmentsTagsFilterChange = useCallback((tags: string[]) => {
    setEnvironmentsTagsFilter(tags)
    setEnvironmentsPageInfo((prev) => ({ ...prev, currentPage: 1 }))
  }, [])

  // Export handlers
  const handleExportEnvironment = useCallback(
    (envId: string) => {
      // env is guaranteed to exist: handler is called from row actions with valid IDs
      const env = environments.find((e) => e.id === envId)!
      setExportEnvIds([envId])
      setExportEnvNames([env.name])
      setExportDialogOpen(true)
    },
    [environments]
  )

  const handleBulkExport = useCallback(() => {
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    const names = selectedIds
      .map((id) => environments.find((e) => e.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    setExportEnvIds(selectedIds)
    setExportEnvNames(names)
    setExportDialogOpen(true)
  }, [selectedIds, environments])

  const handleExportAction = useCallback(
    async (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => {
      setExportLoading(true)
      try {
        const blob =
          exportEnvIds.length === 1
            ? await exportEnvironment(exportEnvIds[0], { format: options.format })
            : await exportEnvironments(exportEnvIds, { format: options.format })
        downloadBlob(
          blob,
          exportEnvIds.length === 1
            ? `${exportEnvNames[0]}.${options.format}`
            : 'environments-export.zip',
        )
        setExportDialogOpen(false)
      } catch (err) {
        console.error('Export failed:', err)
        toastError(err instanceof Error ? err.message : 'Export failed', 'Export Failed')
      } finally {
        setExportLoading(false)
      }
    },
    [exportEnvIds, exportEnvNames, toastError]
  )

  // Import handlers
  const handleImportOpen = useCallback(() => {
    setImportDialogOpen(true)
  }, [])

  const handleImportComplete = useCallback(
    () => {
      loadEnvironments().catch(reportEnvironmentsFailure)
      toastSuccess('Import completed successfully')
    },
    [loadEnvironments, reportEnvironmentsFailure, toastSuccess]
  )

  // Bulk action handlers
  const handleBulkDuplicate = useCallback(async () => {
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    try {
      for (const id of selectedIds) {
        await duplicateEnvironmentApi(id)
      }
      await loadEnvironments()
      toastSuccess(`Duplicated ${selectedIds.length} environment(s)`)
      setSelectedIds([])
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to duplicate environments')
    }
  }, [selectedIds, loadEnvironments, toastSuccess, toastError])

  const handleBulkDelete = useCallback(async () => {
    // selectedIds is guaranteed non-empty: bulk actions are only shown when items are selected
    try {
      for (const id of selectedIds) {
        await deleteEnvironmentApi(id)
      }
      await loadEnvironments()
      toastSuccess(`Deleted ${selectedIds.length} environment(s)`)
      setSelectedIds([])
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete environments')
    }
  }, [selectedIds, loadEnvironments, toastSuccess, toastError])

  const handleEnterSelectionMode = useCallback(() => {
    setSelectionModeActive(true)
    setSelectedIds([])
  }, [])

  const handleExitSelectionMode = useCallback(() => {
    setSelectionModeActive(false)
    setSelectedIds([])
  }, [])

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids)
  }, [])

  return {
    // Data state
    environments,
    environmentsPageInfo,
    environmentsLoading,
    environmentsSettled,
    environmentsError,
    environmentsSortColumn,
    environmentsSortDirection,
    environmentsSearchQuery,
    environmentsTagsFilter,
    allEnvironmentTags,

    // Form state
    formOpen,
    formMode,
    formEnvironment,
    formLoading,
    formError,
    setFormOpen,

    // Export/Import state
    exportDialogOpen,
    setExportDialogOpen,
    exportEnvIds,
    exportEnvNames,
    exportLoading,
    importDialogOpen,
    setImportDialogOpen,

    // Selection state
    selectedIds,
    selectionModeActive,

    // Data handlers
    loadEnvironments,
    handleCreateEnvironment,
    handleEditEnvironment,
    handleFormSubmit,
    handleDeleteEnvironment,
    handleDuplicateEnvironment,

    // Delete confirmation
    envToDelete,
    deleteLoading,
    cancelDeleteEnvironment,
    confirmDeleteEnvironment,

    // Pagination/search/sort handlers
    handleEnvironmentsPageChange,
    handleEnvironmentsPageSizeChange,
    handleEnvironmentsSearch,
    handleEnvironmentsSortingChange,
    environmentsSorting,
    handleEnvironmentsTagsFilterChange,

    // Column visibility
    columnVisibility,
    handleColumnVisibilityChange,
    handleColumnToggle,
    visibleColumns,

    // Export/Import handlers
    handleExportEnvironment,
    handleBulkExport,
    handleExportAction,
    handleImportOpen,
    handleImportComplete,

    // Bulk action handlers
    handleBulkDuplicate,
    handleBulkDelete,
    handleEnterSelectionMode,
    handleExitSelectionMode,
    handleSelectionChange,
  }
}
