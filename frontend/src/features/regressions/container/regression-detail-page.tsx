/**
 * Regression Detail Page
 *
 * 2-panel detail page for a single regression.
 * Read-only view with collapsible sidebar and per-section edit dialogs.
 * Suite composition supports inline edit mode with drag-and-drop reordering
 * and a suite picker modal for adding suites.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Layers,
  Pencil,
  Plus,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  deleteRegression,
  fetchRegressionDetail,
  fetchRegressionsTags,
  updateRegression,
} from '@/features/regressions/api/crud'
import type {
  RegressionDetail,
  RegressionSuiteEntry,
} from '@/features/regressions/api/types'
import { DetailHeader } from '@/components/shared/detail-header'
import { RegressionRunDialogView } from '@/features/regressions/components/regression-run-dialog-view'
import { useRegressionRunDialog } from '@/features/regressions/hooks/use-regression-run-dialog'
import { useEnvironments } from '@/hooks/use-environments'
import type { PrimaryState } from '@/hooks/use-blocking-reads'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'
import { CollapsedSidebarStrip } from '@/components/shared/collapsed-sidebar-strip'
import { EntityPickerModal, type PickerItem } from '@/components/shared/dialogs/entity-picker-modal'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { EditDetailsDialog } from '@/components/shared/dialogs/edit-details-dialog'
import { EditVariablesDialog } from '@/components/shared/dialogs/edit-variables-dialog'
import { DataTable } from '@/components/shared/data-table/data-table'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import { COMMON_LIST_COLUMNS } from '@/components/shared/tables/table-utils'
import type { Column, FilterField } from '@/components/shared/filters/entity-filters'
import { BulkActionsDropdown } from '@/components/shared/actions/bulk-actions-dropdown'
import { DropdownItem } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { extractCollisions } from '@/lib/collision-utils'
import { recordToRows, rowsToRecord, duplicateRows, deleteRows, variableRowsDiffer, type VariableRow } from '@/lib/variable-types'
import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { useTableEditState } from '@/hooks/use-table-edit-state'
import { RegressionMetadataSidebar } from '@/features/regressions/components/regression-metadata-sidebar'
import { fetchSuitesList, fetchSuitesTags } from '@/features/suites/api/crud'
import type { SuiteListApiResponse } from '@/features/suites/api/types'
import {
  CollisionErrorMessage,
  collisionKind,
  entityLabelForKind,
  groupCollisions,
  type CollisionEntry,
  type CollisionKind,
} from '@/features/regressions/components/collision-error-message'
import { CollisionResolutionModal } from '@/components/shared/dialogs/collision-resolution-modal'
import { getRegressionSuitesViewColumns, getRegressionSuitesEditColumns } from '@/features/regressions/components/regression-suites-columns'
import { exportRegression } from '@/features/regressions/api/export-import'
import type { ExportSecretsMode } from '@/types/import-export'

// Columns available for toggle (Order and Name always visible)
const REGRESSION_SUITES_COLUMNS: Column[] = [
  ...COMMON_LIST_COLUMNS,
]

interface RegressionSuitesFilters {
  search: string
  status: string[]
  tags: string[]
}

const DEFAULT_FILTERS: RegressionSuitesFilters = { search: '', status: [], tags: [] }

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'never_run', label: 'Never Run' },
]

/* v8 ignore start - COV-V8-003: V8 tracks function definition, closing braces, and filter branches as separate branches */
/** Client-side filter: returns suites matching the current filter state. */
function filterSuites(suites: RegressionSuiteEntry[], filters: RegressionSuitesFilters): RegressionSuiteEntry[] {
  let result = suites
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(s => s.name.toLowerCase().includes(q))
  }
  if (filters.status.length > 0) {
    result = result.filter(s => filters.status.includes(s.status || 'never_run'))
  }
  if (filters.tags.length > 0) {
    result = result.filter(s => filters.tags.every(tag => s.tags.includes(tag)))
  }
  return result
}
/* v8 ignore stop */

/* v8 ignore start - COV-V8-003: V8 tracks function definitions and optional chaining as branches */
function formatCollisionError(err: unknown): ReactNode {
  const collisions = extractCollisions<CollisionEntry>(err)
  if (collisions) return <CollisionErrorMessage collisions={collisions} />
  return err instanceof Error ? err.message : 'Failed to save'
}
/* v8 ignore stop */

interface DecodedCollision {
  kind: CollisionKind
  collisions: CollisionEntry[]
  conflictingSuiteIds: string[]
  conflictingRegressionIds: string[]
}

/** Decode a backend collision error into a normalized payload for the modal. */
function decodeCollision(err: unknown): DecodedCollision | null {
  const collisions = extractCollisions<CollisionEntry>(err)
  if (!collisions || collisions.length === 0) return null
  const kinds = new Set(collisions.map(collisionKind))
  // If collisions are uniform, surface that kind; otherwise the "mixed" case
  // is unusual but default to "pair" which covers suite-side conflicts.
  const kind: CollisionKind = kinds.size === 1 ? [...kinds][0] : 'pair'
  const details = (err as { details?: { conflicting_suite_ids?: string[]; conflicting_regression_ids?: string[] } }).details
  return {
    kind,
    collisions,
    conflictingSuiteIds: details?.conflicting_suite_ids ?? [],
    conflictingRegressionIds: details?.conflicting_regression_ids ?? [],
  }
}

function primaryStateOf(error: string | null, loading: boolean): PrimaryState {
  if (error !== null) return 'failed'
  if (loading) return 'pending'
  return 'loaded'
}

/* v8 ignore next 3 - COV-V8-003: V8 tracks function definition and hook calls as branches */
export function RegressionDetailPage(): ReactNode {
  const { regressionId } = useParams<{ regressionId: string }>()
  const navigate = useNavigate()
  const toastCtx = useToast()

  // Data state
  const [regression, setRegression] = useState<RegressionDetail | null>(null)
  const [suites, setSuites] = useState<RegressionSuiteEntry[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Run dialog - same hook the list container uses
  const primary = primaryStateOf(error, loading)
  const { environments } = useEnvironments(primary)
  const runDialog = useRegressionRunDialog({ setError, environments })

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Details edit dialog state
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])

  // Variables edit dialog state
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false)
  const [editVariables, setEditVariables] = useState<VariableRow[]>([])
  const [varSelectedIds, setVarSelectedIds] = useState<Set<string>>(new Set())

  // Suite edit mode state
  const [isSuiteEditMode, setIsSuiteEditMode] = useState(false)
  const [editSuites, setEditSuites] = useState<RegressionSuiteEntry[]>([])
  const [suitePickerOpen, setSuitePickerOpen] = useState(false)
  const [isSavingSuites, setIsSavingSuites] = useState(false)

  // Collision resolution modal state. ``source`` remembers which save path
  // raised the collision so ``onFix`` can roll back the right mutation.
  const [collisionData, setCollisionData] = useState<{
    kind: CollisionKind
    collisions: CollisionEntry[]
    conflictingSuiteIds: string[]
    conflictingRegressionIds: string[]
    source: 'details' | 'variables' | 'suites'
  } | null>(null)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // DataTable view mode state + edit mode selection state
  const { sorting, onSortingChange, editRowSelection, setEditRowSelection, onEditRowSelectionChange } = useTableEditState()

  // Client-side filter state for the suites table
  const [suiteFilters, setSuiteFilters] = useState<RegressionSuitesFilters>(DEFAULT_FILTERS)
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  // Column visibility toggle state
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    () => REGRESSION_SUITES_COLUMNS.filter(c => c.visible).map(c => c.id),
  )

  const handleColumnToggle = useCallback((columnId: string, visible: boolean) => {
    setVisibleColumnIds(prev =>
      visible ? [...prev, columnId] : prev.filter(id => id !== columnId),
    )
  }, [])

  // Build column visibility state for DataTable from toggle state
  /* v8 ignore start - COV-V8-003: V8 tracks useMemo factory and for-loop as branches */
  const hiddenVisibility = useMemo(() => {
    const vis: Record<string, boolean> = {}
    for (const col of REGRESSION_SUITES_COLUMNS) {
      vis[col.id] = visibleColumnIds.includes(col.id)
    }
    return vis
  }, [visibleColumnIds])
  /* v8 ignore stop */

  // Columns with current visibility for the filter bar
  const columnsWithVisibility: Column[] = useMemo(
    () => REGRESSION_SUITES_COLUMNS.map(col => ({
      ...col,
      visible: visibleColumnIds.includes(col.id),
    })),
    [visibleColumnIds],
  )

  // All tags from the suites in this regression (for tag filter options)
  const regressionSuiteTags = useMemo(
    () => [...new Set(suites.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b)),
    [suites],
  )

  // Filter fields for the EntityFilterWrapper
  const filterFields = useMemo((): FilterField[] => [
    {
      key: 'status',
      placeholder: 'Status',
      countLabel: 'statuses',
      countLabelSingular: 'status',
      testId: 'filter-status',
      ariaLabel: 'Filter by status',
      buttonWidth: 'w-[140px]',
      searchPlaceholder: 'Search status…',
      emptyMessage: 'No status found.',
      options: STATUS_OPTIONS,
      mode: 'multi',
      selectedValues: suiteFilters.status,
    },
  ], [suiteFilters.status])

  // Apply client-side filtering
  const filteredSuites = useMemo(
    () => filterSuites(isSuiteEditMode ? editSuites : suites, suiteFilters),
    [isSuiteEditMode, editSuites, suites, suiteFilters],
  )

  // Stable references for DataTable props (prevents TanStack Table thrashing)
  const getRowId = useCallback((row: RegressionSuiteEntry) => row.id, [])
  const getRowLabel = useCallback((row: RegressionSuiteEntry) => row.name, [])

  const reportLoadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load regression')
  }, [])

  /* v8 ignore start - COV-V8-003: V8 tracks Promise.all, try/catch/finally, and useCallback as branches */
  const loadData = useCallback(async () => {
    if (!regressionId) return
    setLoading(true)
    setError(null)

    try {
      const [detail, tags] = await Promise.all([
        fetchRegressionDetail(regressionId),
        fetchRegressionsTags(),
      ])
      setRegression(detail.regression)
      setSuites(detail.suites)
      setAllTags(tags)
    } catch (err) {
      reportLoadFailure(err)
    } finally {
      setLoading(false)
    }
  }, [regressionId, reportLoadFailure])
  /* v8 ignore stop */

  // The mount effect and Try Again cannot await, so a load failure reports
  // through the page's own error state either way.
  const startLoad = useCallback((): void => {
    loadData().catch(reportLoadFailure)
  }, [loadData, reportLoadFailure])

  // Re-fetch when the system shared-variables reveal flips: the detail GET
  // returns plaintext secret variables when revealed, the placeholder when masked.
  const sharedVariablesReveal = useMaskingSettingsStore((s) => s.sharedVariables)
  useEffect(() => {
    startLoad()
  }, [startLoad, sharedVariablesReveal])

  /* v8 ignore start - COV-V8-003: V8 tracks useCallback definitions and deps as branches */

  const handleOpenDetailsDialog = useCallback(() => {
    if (!regression) return
    setEditName(regression.name)
    setEditDescription(regression.description ?? '')
    setEditTags([...regression.tags])
    setDetailsDialogOpen(true)
  }, [regression])
  /* v8 ignore stop */

  /* v8 ignore start - COV-V8-003: V8 tracks useMemo/useCallback definition and OR branches */
  const detailsAreDirty = useMemo(() => {
    if (!regression) return false
    return (
      editName !== regression.name ||
      editDescription !== (regression.description ?? '') ||
      JSON.stringify(editTags) !== JSON.stringify(regression.tags)
    )
  }, [regression, editName, editDescription, editTags])
  /* v8 ignore stop */

  /* v8 ignore start - COV-V8-003: V8 tracks useCallback/useMemo definitions and deps as branches */
  const handleSaveDetails = useCallback(async () => {
    if (!regressionId) return
    try {
      await updateRegression(regressionId, {
        name: editName,
        description: editDescription,
        tags: editTags,
      })
      await loadData()
    } catch (err) {
      const decoded = decodeCollision(err)
      if (decoded) {
        setCollisionData({ ...decoded, source: 'details' })
        return
      }
      throw err
    }
  }, [regressionId, editName, editDescription, editTags, loadData])

  const handleOpenVariablesDialog = useCallback(() => {
    if (!regression) return
    setEditVariables(recordToRows(regression.variables))
    setVarSelectedIds(new Set())
    setVariablesDialogOpen(true)
  }, [regression])

  const handleVarBulkDelete = useCallback(() => {
    setEditVariables((prev) => deleteRows(prev, varSelectedIds))
    setVarSelectedIds(new Set())
  }, [varSelectedIds])

  const handleVarBulkDuplicate = useCallback(() => {
    const newRows = duplicateRows(editVariables, varSelectedIds)
    setEditVariables((prev) => [...prev, ...newRows])
    setVarSelectedIds(new Set())
  }, [varSelectedIds, editVariables])

  const variablesAreDirty = useMemo(
    () => (regression ? variableRowsDiffer(regression.variables, editVariables) : false),
    [regression, editVariables],
  )

  const handleSaveVariables = useCallback(async () => {
    if (!regressionId) return
    try {
      await updateRegression(regressionId, {
        variables: rowsToRecord(editVariables),
      })
      await loadData()
    } catch (err) {
      const decoded = decodeCollision(err)
      if (decoded) {
        setCollisionData({ ...decoded, source: 'variables' })
        return
      }
      throw err
    }

    // Notify any listening workbench that regression variables changed
    globalThis.dispatchEvent(
      new CustomEvent('regression-variables-changed', {
        detail: {
          regressionId,
          suiteIds: regression?.suiteIds ?? [],
          variables: editVariables.map((r) => ({
            name: r.name,
            type: r.type,
          })),
        },
      }),
    )
  }, [regressionId, editVariables, loadData, regression])

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      /* v8 ignore next - COV-V8-003: regressionId always defined when this page mounts */
      const query = regressionId ? `?regressionId=${regressionId}` : ''
      navigate(`/suites/${suiteId}${query}`)
    },
    [navigate, regressionId],
  )

  const handleConfirmDelete = useCallback((): void => {
    if (!regressionId) return
    setIsDeleting(true)
    setDeleteError(null)
    deleteRegression(regressionId)
      .then(() => {
        setDeleteDialogOpen(false)
        navigate('/regressions')
      })
      .catch((err: unknown) => {
        const handled = handleDeleteConflict({
          error: err,
          entityType: 'regression',
          toast: toastCtx,
          navigate,
        })
        if (handled) {
          setDeleteDialogOpen(false)
        } else {
          setDeleteError(err instanceof Error ? err.message : 'Failed to delete regression')
        }
      })
      .finally(() => {
        setIsDeleting(false)
      })
  }, [regressionId, navigate, toastCtx])

  // Suite edit mode handlers
  const handleEnterSuiteEditMode = useCallback(() => {
    setEditSuites([...suites])
    setEditRowSelection({})
    setIsSuiteEditMode(true)
  }, [suites])

  const handleCancelSuiteEditMode = useCallback(() => {
    setEditSuites([])
    setIsSuiteEditMode(false)
  }, [])

  const handleSaveSuiteEdits = useCallback((): void => {
    if (!regressionId) return
    setIsSavingSuites(true)
    const save = async (): Promise<void> => {
      await updateRegression(regressionId, {
        suites: editSuites.map((s) => s.id),
      })
      await loadData()
      setIsSuiteEditMode(false)
      setEditSuites([])
    }
    save()
      .catch((err: unknown) => {
        const decoded = decodeCollision(err)
        if (decoded) {
          setCollisionData({ ...decoded, source: 'suites' })
        } else {
          setError(err instanceof Error ? err.message : 'Failed to save suites')
        }
      })
      .finally(() => {
        setIsSavingSuites(false)
      })
  }, [regressionId, editSuites, loadData])

  /**
   * Remove conflicting suites from the edit buffer. Invoked from the
   * CollisionResolutionModal for pair and regression-vs-member-suite
   * conflicts. The modal closes automatically and the user can hit Save
   * again to retry.
   */
  const handleCollisionFix = useCallback((suiteIdsToRemove: string[]) => {
    const removeSet = new Set(suiteIdsToRemove)
    setEditSuites((prev) => prev.filter((s) => !removeSet.has(s.id)))
    setCollisionData(null)
  }, [])

  const editSuiteNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of editSuites) map.set(s.id, s.name)
    return map
  }, [editSuites])

  // Cache of suite metadata returned by the picker so that
  // ``handleAddSuites`` can synthesize edit-mode rows with truthful values
  // (tests count, status, tags, etc.) instead of all-zero placeholders
  // that would confuse the user until the next save/reload.
  const pickerSuiteCache = useRef<Map<string, SuiteListApiResponse>>(new Map())

  const handleAddSuites = useCallback(
    (newSuites: Array<{ id: string; name: string }>) => {
      setEditSuites((prev) => {
        const existingIds = new Set(prev.map((s) => s.id))
        const additions: RegressionSuiteEntry[] = newSuites
          .filter((s) => !existingIds.has(s.id))
          .map((s) => {
            const cached = pickerSuiteCache.current.get(s.id)
            return {
              id: s.id,
              name: s.name,
              description: cached?.description ?? null,
              status: cached?.status ?? 'never_run',
              lastRun: cached?.last_run ?? null,
              tags: cached?.tags ?? [],
              testsCount: cached?.tests_count ?? 0,
              avgDuration: null,
              createdAt: cached?.created_at ?? new Date().toISOString(),
              updatedAt: cached?.updated_at ?? new Date().toISOString(),
            }
          })
        return [...prev, ...additions]
      })
    },
    [],
  )

  const handleExcludeSuite = useCallback((suiteId: string) => {
    setEditSuites(prev => prev.filter(s => s.id !== suiteId))
  }, [])

  const handleBulkExclude = useCallback(() => {
    const selectedIds = new Set(Object.keys(editRowSelection).filter(id => editRowSelection[id]))
    setEditSuites(prev => prev.filter(s => !selectedIds.has(s.id)))
    setEditRowSelection({})
  }, [editRowSelection])

  const handleReorderSuites = useCallback((newOrder: string[]) => {
    setEditSuites(prev => {
      const suiteMap = new Map(prev.map(s => [s.id, s]))
      return newOrder.map(id => suiteMap.get(id)!).filter(Boolean)
    })
  }, [])

  // EntityPickerModal callbacks for suite picker. Uses the paginated list
  // endpoint and caches each page's metadata so handleAddSuites can build
  // edit-mode rows with real values rather than zeroed placeholders.
  const fetchPickerSuites = useCallback(
    async (params: { search?: string; tags?: string[]; page: number; perPage: number }): Promise<{ items: PickerItem[]; total: number }> => {
      const result = await fetchSuitesList({
        search: params.search,
        tags: params.tags,
        page: params.page,
        per_page: params.perPage,
      })
      // Populate the cache for handleAddSuites to look up on click.
      for (const s of result.data) {
        pickerSuiteCache.current.set(s.id, s)
      }
      return {
        items: result.data.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          tags: s.tags,
        })),
        total: result.pagination.total,
      }
    },
    [],
  )

  const fetchPickerTags = useCallback(async (): Promise<string[]> => {
    return fetchSuitesTags()
  }, [])

  // Export handler
  const handleExport = useCallback(
    (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => {
      if (!regressionId || !regression) return
      const doExport = async () => {
        const blob = await exportRegression(regressionId, {
          format: options.format,
          secrets: options.secrets,
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${regression.name}.${options.format}`
        a.click()
        URL.revokeObjectURL(url)
        setExportDialogOpen(false)
      }
      doExport().catch((err: unknown) => {
        console.error('Export failed:', err)
        toastCtx.error(toFailureDetail(err).message, 'Export Failed')
      })
    },
    [regressionId, regression, toastCtx],
  )

  // Memoize column definitions
  const viewColumns = useMemo(
    () => getRegressionSuitesViewColumns({ onEditSuite: handleEditSuite }),
    [handleEditSuite],
  )

  const editColumns = useMemo(
    () => getRegressionSuitesEditColumns({ onExcludeSuite: handleExcludeSuite }),
    [handleExcludeSuite],
  )

  const editSelectedCount = Object.keys(editRowSelection).filter(id => editRowSelection[id]).length
  /* v8 ignore stop */

  // Loading state
  if (loading) {
    return (
      /* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */
      <div data-testid="regression-detail-loading" className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading regression…</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !regression) {
    return (
      <div data-testid="regression-detail-error" className="flex h-full flex-col items-center justify-center gap-4">
        <Layers className="h-10 w-10 text-muted-foreground/40" />
        <div className="text-center">
          <p className="text-sm font-medium mb-1">Failed to load regression</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={startLoad}>
          Try Again
        </Button>
      </div>
    )
  }

  /* v8 ignore next - COV-BRANCH-020 */
  if (!regression) return null

  const displaySuites = isSuiteEditMode ? editSuites : suites

  return (
    /* v8 ignore next - COV-V8-003: V8 tracks JSX return as branch */
    <div data-testid="regression-detail-page" className="flex h-full flex-col">
      {/* Header */}
      {/* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */}
      <DetailHeader
        name={regression.name}
        entityType="regression"
        onBack={() => { navigate('/regressions') }}
        onRun={() => runDialog.openForRegression(regression.id, regression.name)}
        onExport={() => setExportDialogOpen(true)}
        onDelete={() => setDeleteDialogOpen(true)}
        runTestId="regression-run-btn"
        exportTestId="regression-export-btn"
        deleteTestId="delete-regression-btn"
      />

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 2-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - always rendered, switches between expanded and collapsed */}
        <aside
          data-testid="regression-sidebar"
          className={cn(
            'flex h-full flex-col border-r bg-muted/30 shrink-0 overflow-hidden',
            sidebarOpen ? 'w-[380px]' : 'w-[64px]'
          )}
        >
          {sidebarOpen ? (
            <RegressionMetadataSidebar
              regression={regression}
              onEditDetails={handleOpenDetailsDialog}
              onEditVariables={handleOpenVariablesDialog}
              onCollapse={() => setSidebarOpen(false)}
            />
          ) : (
            <CollapsedSidebarStrip icon={Layers} label="Details" onExpand={() => setSidebarOpen(true)} />
          )}
        </aside>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex h-full flex-col gap-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Regression Suites</h2>
              <div className="flex items-center gap-2">
                {isSuiteEditMode ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="add-suites-btn"
                      onClick={() => setSuitePickerOpen(true)}
                      className="gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Suites
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="cancel-suites-btn"
                      onClick={handleCancelSuiteEditMode}
                      disabled={isSavingSuites}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      data-testid="save-suites-btn"
                      onClick={handleSaveSuiteEdits}
                      disabled={isSavingSuites}
                    >
                      {isSavingSuites && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="edit-suites-btn"
                    onClick={handleEnterSuiteEditMode}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit Suites
                  </Button>
                )}
              </div>
            </div>

            {/* Filter bar */}
            <EntityFilterWrapper
              entityName="regression suites"
              filters={suiteFilters}
              defaultFilters={DEFAULT_FILTERS}
              allTags={regressionSuiteTags}
              columns={columnsWithVisibility}
              fields={filterFields}
              onFilterChange={setSuiteFilters}
              onColumnToggle={handleColumnToggle}
              actions={
                isSuiteEditMode && (
                  <BulkActionsDropdown
                    selectedCount={editSelectedCount}
                    selectionModeActive={selectionModeActive}
                    selectionLabel={`${editSelectedCount} selected`}
                    onEnterSelectionMode={() => setSelectionModeActive(true)}
                    onExitSelectionMode={() => {
                      setSelectionModeActive(false)
                      setEditRowSelection({})
                    }}
                  >
                    <DropdownItem
                      disabled={editSelectedCount === 0}
                      onSelect={() => { if (editSelectedCount > 0) handleBulkExclude() }}
                      data-testid="bulk-action-exclude"
                      /* v8 ignore next - COV-V8-003: V8 tracks JSX className ternary as branch */
                      className={editSelectedCount === 0 ? 'text-muted' : 'text-destructive'}
                    >
                      {/* v8 ignore next - COV-V8-003: V8 tracks JSX child as branch */}
                      <Icon icon={XCircle} size="sm" className="mr-2" />
                      Exclude from regression
                    </DropdownItem>
                  </BulkActionsDropdown>
                )
              }
            />

            {/* DataTable */}
            {isSuiteEditMode ? (
              <DataTable
                key="edit"
                data-testid="regression-suites-table"
                columns={editColumns}
                data={filteredSuites}
                getRowId={getRowId}
                getRowLabel={getRowLabel}
                enableSorting={false}
                enableDnD
                onReorder={handleReorderSuites}
                enableSelection={selectionModeActive}
                rowSelection={editRowSelection}
                onRowSelectionChange={onEditRowSelectionChange}
                defaultPageSize={0}
                entityName="suites"
                emptyIcon={<Layers className="h-10 w-10 text-muted-foreground/40" />}
                emptyMessage="No suites yet. Use Add Suites to include suites in this regression."
                columnVisibility={hiddenVisibility}
              />
            ) : (
              <DataTable
                key="view"
                data-testid="regression-suites-table"
                columns={viewColumns}
                data={filteredSuites}
                getRowId={getRowId}
                getRowLabel={getRowLabel}
                sorting={sorting}
                onSortingChange={onSortingChange}
                defaultPageSize={25}
                entityName="suites"
                emptyIcon={<Layers className="h-10 w-10 text-muted-foreground/40" />}
                emptyMessage="No suites in this regression"
                columnVisibility={hiddenVisibility}
                emptyAction={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnterSuiteEditMode}
                    className="mt-2"
                  >
                    Edit Suites
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Suite Picker Modal */}
      <EntityPickerModal
        open={suitePickerOpen}
        onClose={() => setSuitePickerOpen(false)}
        onSelect={handleAddSuites}
        excludeIds={displaySuites.map((s) => s.id)}
        title="Add Suites to Regression"
        description="Search and select suites to add."
        searchPlaceholder="Search suites…"
        excludedLabel="(in regression)"
        emptyIcon={<Layers className="h-8 w-8" />}
        testId="suite-picker"
        itemKind="suite"
        entityNamePlural="suites"
        fetchItems={fetchPickerSuites}
        fetchTags={fetchPickerTags}
      />

      {/* Edit Details Dialog */}
      <EditDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        title="Edit Regression Details"
        description="Update the regression name, description, and tags."
        isDirty={detailsAreDirty}
        onSave={handleSaveDetails}
        onDiscard={() => setDetailsDialogOpen(false)}
        editName={editName}
        onEditNameChange={setEditName}
        editDescription={editDescription}
        onEditDescriptionChange={setEditDescription}
        editTags={editTags}
        allTags={allTags}
        onEditTagsChange={setEditTags}
      />

      {/* Edit Variables Dialog */}
      <EditVariablesDialog
        open={variablesDialogOpen}
        onOpenChange={setVariablesDialogOpen}
        title="Edit Regression Variables"
        description="Add, remove, or modify regression variables."
        isDirty={variablesAreDirty}
        onSave={handleSaveVariables}
        onDiscard={() => setVariablesDialogOpen(false)}
        formatError={formatCollisionError}
        editVariables={editVariables}
        onChange={setEditVariables}
        selectedIds={varSelectedIds}
        onSelectionChange={setVarSelectedIds}
        onBulkDuplicate={handleVarBulkDuplicate}
        onBulkDelete={handleVarBulkDelete}
        renderValueCell={(row) => (
          <EntityVariableValueCell row={row} rows={editVariables} onRowsChange={setEditVariables} />
        )}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteError(null)
        }}
      >
        <DialogContent data-testid="delete-confirmation-dialog">
          <DialogHeader>
            <DialogTitle>Delete Regression</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this regression? Suites will not be
              deleted - they will continue to exist independently.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div
              data-testid="delete-regression-error"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteError(null)
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-delete-regression-btn"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run dialog */}
      <RegressionRunDialogView hook={runDialog} />

      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        entityIds={[regression.id]}
        entityNames={[regression.name]}
        entityLabel="Regression"
        onExport={handleExport}
      />

      {/* Collision resolution modal for cross-regression/suite variable conflicts */}
      {collisionData && (
        <CollisionResolutionModal
          open
          onClose={() => setCollisionData(null)}
          description={collisionModalDescription(collisionData.kind)}
          entityLabel={entityLabelForKind(collisionData.kind)}
          conflicts={groupCollisions(collisionData.collisions).map((g) => ({
            variable: g.variable,
            thisType: g.thisType,
            otherType: g.otherType,
            entities: g.regressions,
          }))}
          fixAction={
            // "Remove conflicting suites" is only actionable when the
            // collision is suite-side (pair or reg-vs-suite) AND we are in
            // suite edit mode, so removing rows from ``editSuites`` is
            // meaningful. Cross-regression conflicts require the user to
            // edit the variable, not remove entities.
            collisionData.kind !== 'regression' &&
            collisionData.source === 'suites' &&
            collisionData.conflictingSuiteIds.length > 0
              ? {
                  buttonLabel: 'Remove conflicting suites',
                  items: collisionData.conflictingSuiteIds.map((id) => ({
                    id,
                    name: editSuiteNameMap.get(id) ?? id,
                  })),
                  onFix: handleCollisionFix,
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function collisionModalDescription(kind: CollisionKind): string {
  if (kind === 'regression') {
    return (
      'Another regression sharing the same suites has conflicting variable types. ' +
      'Change the variable type to match, or rename the variable.'
    )
  }
  if (kind === 'pair') {
    return (
      'Two suites in this regression declare the same variable with different types. ' +
      'Remove one of the suites or align their variable types.'
    )
  }
  return (
    'A member suite declares the same variable with a different type than the regression. ' +
    'Align the types, or remove the suite from the regression.'
  )
}
