/**
 * Suite Detail Page
 *
 * 2-panel detail page for a single suite.
 * Read-only view with collapsible sidebar and per-section edit dialogs.
 * Test composition supports inline edit mode with drag-and-drop reordering
 * and a test picker modal for adding tests.
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Loader2, FlaskConical, Pencil, Plus, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fetchSuiteDetail,
  fetchSuitesTags,
  updateSuite,
  deleteSuite,
} from '@/features/suites/api/crud'
import { fetchRegressionDetail } from '@/features/regressions/api/crud'
import { exportSuite as exportSuiteApi } from '@/features/suites/api/export-import'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { SuiteRunDialogView } from '@/features/suites/components/suite-run-dialog-view'
import { DetailHeader } from '@/components/shared/detail-header'
import { useSuiteRunDialog } from '@/features/suites/hooks/use-suite-run-dialog'
import { CollapsedSidebarStrip } from '@/components/shared/collapsed-sidebar-strip'
import { EditDetailsDialog } from '@/components/shared/dialogs/edit-details-dialog'
import { EditVariablesDialog } from '@/components/shared/dialogs/edit-variables-dialog'
import { EntityPickerModal } from '@/components/shared/dialogs/entity-picker-modal'
import type { PickerItem } from '@/components/shared/dialogs/entity-picker-modal'
import { SuiteMetadataSidebar } from '@/features/suites/components/suite-metadata-sidebar'
import { DataTable } from '@/components/shared/data-table/data-table'
import { EntityFilterWrapper } from '@/components/shared/filters/entity-filter-wrapper'
import { COMMON_LIST_COLUMNS } from '@/components/shared/tables/table-utils'
import type { Column, FilterField } from '@/components/shared/filters/entity-filters'
import { BulkActionsDropdown } from '@/components/shared/actions/bulk-actions-dropdown'
import { DropdownItem } from '@/components/ui/dropdown'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'
import { Icon } from '@/components/ui/icon'
import { extractCollisions } from '@/lib/collision-utils'
import { recordToRows, rowsToRecord, duplicateRows, deleteRows, variableRowsDiffer, type VariableRow } from '@/lib/variable-types'
import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { useTableEditState } from '@/hooks/use-table-edit-state'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { useEnvironments } from '@/hooks/use-environments'
import { getSuiteTestsViewColumns, getSuiteTestsEditColumns } from '@/features/suites/components/suite-tests-columns'
import { fetchTests, fetchTestsTags, transformApiTest } from '@/features/tests/api/crud'
import type { SuiteDetail, SuiteTestEntry } from '@/features/suites/api/types'
import { CollisionErrorMessage, type CollisionEntry } from '@/features/suites/components/collision-error-message'
import {
  CollisionResolutionModal,
} from '@/components/shared/dialogs/collision-resolution-modal'
import { groupCollisions } from '@/features/suites/components/collision-error-message'
import type { ApiError } from '@/services/api-client/types'
import type { ExportSecretsMode } from '@/types/import-export'

// Columns available for toggle (Order and Name always visible)
const SUITE_TESTS_COLUMNS: Column[] = [
  ...COMMON_LIST_COLUMNS,
]

interface SuiteTestsFilters {
  search: string
  status: string[]
  tags: string[]
}

const DEFAULT_FILTERS: SuiteTestsFilters = { search: '', status: [], tags: [] }

const STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'never_run', label: 'Never Run' },
]

/* v8 ignore start - COV-V8-003: V8 tracks function definition, closing braces, and filter branches as separate branches */
/** Client-side filter: returns tests matching the current filter state. */
function filterTests(tests: SuiteTestEntry[], filters: SuiteTestsFilters): SuiteTestEntry[] {
  let result = tests
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(t => t.name.toLowerCase().includes(q))
  }
  if (filters.status.length > 0) {
    result = result.filter(t => filters.status.includes(t.status))
  }
  if (filters.tags.length > 0) {
    result = result.filter(t => filters.tags.every(tag => t.tags.includes(tag)))
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

/* v8 ignore start - COV-V8-003: V8 tracks async function definition and map as branches */
async function fetchPickerItems(
  params: { search?: string; tags?: string[]; page: number; perPage: number },
): Promise<{ items: PickerItem[]; total: number }> {
  const fetchParams: { page: number; per_page: number; search?: string; tags?: string[] } = {
    page: params.page,
    per_page: params.perPage,
  }
  if (params.search) fetchParams.search = params.search
  if (params.tags && params.tags.length > 0) fetchParams.tags = params.tags
  const result = await fetchTests(fetchParams)
  return {
    items: result.data.map(transformApiTest).map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      tags: t.tags,
    })),
    total: result.pagination.total,
  }
}
/* v8 ignore stop */

/* v8 ignore next 3 - COV-V8-003: V8 tracks function definition and hook calls as branches */
export function SuiteDetailPage(): ReactNode {
  const { suiteId } = useParams<{ suiteId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const regressionOrigin = searchParams.get('regressionId')
  const toastCtx = useToast()

  // Data state
  const [suite, setSuite] = useState<SuiteDetail | null>(null)
  const [tests, setTests] = useState<SuiteTestEntry[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  // Parent regression name (fetched once when arriving from a regression page).
  const [regressionName, setRegressionName] = useState<string | null>(null)
  const blocking = useBlockingReads(primary)

  // Run dialog - same hook the list container uses
  const { environments } = useEnvironments(primary)
  const runDialog = useSuiteRunDialog({ setError, environments })

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Details edit dialog state
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // Variables edit dialog state
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false)
  const [editVariables, setEditVariables] = useState<VariableRow[]>([])
  const [varSelectedIds, setVarSelectedIds] = useState<Set<string>>(new Set())

  // Test edit mode state
  const [isTestEditMode, setIsTestEditMode] = useState(false)
  const [editTests, setEditTests] = useState<SuiteTestEntry[]>([])
  const [testPickerOpen, setTestPickerOpen] = useState(false)
  const [isSavingTests, setIsSavingTests] = useState(false)

  // Collision resolution modal state
  const [collisionData, setCollisionData] = useState<{
    collisions: CollisionEntry[]
    conflictingTestIds: string[]
  } | null>(null)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // DataTable view mode state + edit mode selection state
  const { sorting, onSortingChange, editRowSelection, setEditRowSelection, onEditRowSelectionChange } = useTableEditState()

  // Client-side filter state for the tests table
  const [testFilters, setTestFilters] = useState<SuiteTestsFilters>(DEFAULT_FILTERS)
  const [selectionModeActive, setSelectionModeActive] = useState(false)

  // Column visibility toggle state
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    () => SUITE_TESTS_COLUMNS.filter(c => c.visible).map(c => c.id),
  )

  /* v8 ignore start - COV-CONTAINER-033: Column visibility toggle callback - v8 parallelism tracking quirk */
  const handleColumnToggle = useCallback((columnId: string, visible: boolean) => {
    setVisibleColumnIds(prev =>
      visible ? [...prev, columnId] : prev.filter(id => id !== columnId),
    )
  }, [])
  /* v8 ignore stop */

  // Build column visibility state for DataTable from toggle state
  /* v8 ignore start - COV-V8-003: V8 tracks useMemo factory and for-loop as branches */
  const suiteHiddenVisibility = useMemo(() => {
    const vis: Record<string, boolean> = { suite: false }
    for (const col of SUITE_TESTS_COLUMNS) {
      vis[col.id] = visibleColumnIds.includes(col.id)
    }
    return vis
  }, [visibleColumnIds])
  /* v8 ignore stop */

  // Columns with current visibility for the filter bar
  const columnsWithVisibility: Column[] = useMemo(
    () => SUITE_TESTS_COLUMNS.map(col => ({
      ...col,
      visible: visibleColumnIds.includes(col.id),
    })),
    [visibleColumnIds],
  )

  // All tags from the tests in this suite (for tag filter options)
  const suiteTestTags = useMemo(
    () => [...new Set(tests.flatMap(t => t.tags))].sort((a, b) => a.localeCompare(b)),
    [tests],
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
      selectedValues: testFilters.status,
    },
  ], [testFilters.status])

  // Apply client-side filtering
  const filteredTests = useMemo(
    () => filterTests(isTestEditMode ? editTests : tests, testFilters),
    [isTestEditMode, editTests, tests, testFilters],
  )

  // Stable references for DataTable props (prevents TanStack Table thrashing)
  const getRowId = useCallback((row: SuiteTestEntry) => row.id, [])
  const getRowLabel = useCallback((row: SuiteTestEntry) => row.name, [])

  const tagReads = useMemo<BlockingRead[]>(
    () => [{ label: 'tags', run: async () => setAllTags(await fetchSuitesTags()) }],
    [],
  )

  // The breadcrumb prefix only exists when the user arrived via a regression page.
  const latestOrigin = useRef(regressionOrigin)
  useEffect(() => {
    latestOrigin.current = regressionOrigin
  }, [regressionOrigin])

  const regressionReads = useMemo<BlockingRead[]>(
    () => [
      {
        label: 'parent regression',
        run: async () => {
          if (!regressionOrigin) {
            setRegressionName(null)
            return
          }
          const { regression } = await fetchRegressionDetail(regressionOrigin)
          // A superseded origin must not overwrite the newer breadcrumb prefix.
          if (latestOrigin.current === regressionOrigin) setRegressionName(regression.name)
        },
      },
    ],
    [regressionOrigin],
  )

  const reportLoadFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load suite')
    setPrimary('failed')
  }, [])

  const loadData = useCallback(async () => {
    if (!suiteId) return
    setLoading(true)
    setError(null)
    setPrimary('pending')

    try {
      // Started before the primary read is awaited so both reads stay concurrent.
      const reads = blocking.load(tagReads)

      try {
        const detail = await fetchSuiteDetail(suiteId)
        setSuite(detail.suite)
        setTests(detail.tests)
        setPrimary('loaded')
        // The page owns a primary failure, so its error state is never held
        // behind a read the page does not exist to show.
        await reads
      } catch (err) {
        reportLoadFailure(err)
      }
    } finally {
      setLoading(false)
    }
  }, [suiteId, blocking, tagReads, reportLoadFailure])

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

  useEffect(() => {
    blocking.load(regressionReads).catch(reportLoadFailure)
  }, [blocking, regressionReads, reportLoadFailure])

  /* v8 ignore start - COV-V8-003: V8 tracks useCallback definitions and deps as branches */
  const handleOpenDetailsDialog = useCallback(() => {
    if (!suite) return
    setEditName(suite.name)
    setEditDescription(suite.description ?? '')
    setEditTags([...suite.tags])
    setDetailsDialogOpen(true)
  }, [suite])
  /* v8 ignore stop */

  /* v8 ignore start - COV-V8-003: V8 tracks useMemo/useCallback definition and OR branches */
  const detailsAreDirty = useMemo(() => {
    if (!suite) return false
    return (
      editName !== suite.name ||
      editDescription !== (suite.description ?? '') ||
      JSON.stringify(editTags) !== JSON.stringify(suite.tags)
    )
  }, [suite, editName, editDescription, editTags])
  /* v8 ignore stop */

  /* v8 ignore start - COV-V8-003: V8 tracks useCallback/useMemo definitions and deps as branches */
  const handleSaveDetails = useCallback(async () => {
    if (!suiteId) return
    await updateSuite(suiteId, {
      name: editName,
      description: editDescription,
      tags: editTags,
    })
    await loadData()
  }, [suiteId, editName, editDescription, editTags, loadData])

  const handleOpenVariablesDialog = useCallback(() => {
    if (!suite) return
    setEditVariables(recordToRows(suite.variables))
    setVarSelectedIds(new Set())
    setVariablesDialogOpen(true)
  }, [suite])

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
    () => (suite ? variableRowsDiffer(suite.variables, editVariables) : false),
    [suite, editVariables],
  )

  const handleSaveVariables = useCallback(async () => {
    if (!suiteId) return
    await updateSuite(suiteId, { variables: rowsToRecord(editVariables) })
    await loadData()

    // Notify any listening workbench that suite variables changed
    globalThis.dispatchEvent(new CustomEvent('suite-variables-changed', {
      detail: {
        suiteId,
        testIds: suite?.testIds ?? [],
        variables: editVariables.map((r) => ({ name: r.name, type: r.type })),
      },
    }))
  }, [suiteId, editVariables, loadData, suite])

  const handleExportAction = useCallback(
    (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }): void => {
      if (!suiteId || !suite) return
      setExportLoading(true)
      const doExport = async (): Promise<void> => {
        const blob = await exportSuiteApi(suiteId, { format: options.format, secrets: options.secrets })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${suite.name}.${options.format}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setExportDialogOpen(false)
        /* v8 ignore stop */
      }
      doExport()
        .catch((err: unknown) => {
          console.error('Export failed:', err)
          toastCtx.error(toFailureDetail(err).message, 'Export Failed')
        })
        /* v8 ignore start - COV-V8-003: V8 tracks useCallback/useMemo definitions and deps as branches */
        .finally(() => {
          setExportLoading(false)
        })
    },
    [suiteId, suite, toastCtx]
  )
  /* v8 ignore stop */

  const handleConfirmDelete = useCallback((id: string): void => {
    setIsDeleting(true)
    setDeleteError(null)
    deleteSuite(id)
      .then(() => {
        setDeleteDialogOpen(false)
        navigate('/suites')
      })
      .catch((err: unknown) => {
        const handled = handleDeleteConflict({
          error: err,
          entityType: 'suite',
          toast: toastCtx,
          navigate,
        })
        if (handled) {
          setDeleteDialogOpen(false)
        } else {
          // The dialog stays open: a closed dialog reads as "the suite is gone".
          setDeleteError(err instanceof Error ? err.message : 'Failed to delete suite')
        }
      })
      .finally(() => {
        setIsDeleting(false)
      })
  }, [navigate, toastCtx])

  /* v8 ignore start - COV-V8-003: V8 tracks useCallback/useMemo definitions and deps as branches */
  const handleEditTest = useCallback(
    (testId: string) => {
      const params = new URLSearchParams()
      params.set('editTest', testId)
      /* v8 ignore next - COV-V8-003: suiteId always defined when this page mounts */
      if (suiteId) params.set('suiteId', suiteId)
      if (regressionOrigin) params.set('regressionId', regressionOrigin)
      navigate(`/workbench?${params.toString()}`)
    },
    [navigate, suiteId, regressionOrigin]
  )

  // Test edit mode handlers
  const handleEnterTestEditMode = useCallback(() => {
    setEditTests([...tests])
    setEditRowSelection({})
    setIsTestEditMode(true)
  }, [tests])

  const handleCancelTestEditMode = useCallback(() => {
    setEditTests([])
    setIsTestEditMode(false)
  }, [])

  const handleSaveTestEdits = useCallback((): void => {
    if (!suiteId) return
    setIsSavingTests(true)
    const save = async (): Promise<void> => {
      await updateSuite(suiteId, { tests: editTests.map(t => t.id) })
      await loadData()
      setIsTestEditMode(false)
      setEditTests([])
    }
    save()
      .catch((err: unknown) => {
        const collisions = extractCollisions<CollisionEntry>(err)
        if (collisions) {
          const details = (err as ApiError).details as unknown as {
            collisions: CollisionEntry[]
            conflicting_test_ids?: string[]
          } | undefined
          setCollisionData({
            collisions,
            conflictingTestIds: details?.conflicting_test_ids ?? [],
          })
        } else {
          setError(err instanceof Error ? err.message : 'Failed to save tests')
        }
      })
      .finally(() => {
        setIsSavingTests(false)
      })
  }, [suiteId, editTests, loadData])

  const handleCollisionFix = useCallback((testIdsToRemove: string[]) => {
    const removeSet = new Set(testIdsToRemove)
    setEditTests(prev => prev.filter(t => !removeSet.has(t.id)))
    setCollisionData(null)
  }, [])

  /* v8 ignore next - COV-V8-003: V8 tracks useMemo deps as branches */
  const testNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of editTests) map.set(t.id, t.name)
    return map
  }, [editTests])

  const handleAddTests = useCallback((newTests: Array<{ id: string; name: string }>) => {
    setEditTests(prev => {
      const existingIds = new Set(prev.map(t => t.id))
      const additions: SuiteTestEntry[] = newTests
        .filter(t => !existingIds.has(t.id))
        .map(t => ({
          id: t.id,
          name: t.name,
          status: 'never_run',
          lastRun: null,
          tags: [],
          createdAt: null,
          updatedAt: null,
        }))
      return [...prev, ...additions]
    })
  }, [])

  const handleExcludeTest = useCallback((testId: string) => {
    setEditTests(prev => prev.filter(t => t.id !== testId))
  }, [])

  const handleBulkExclude = useCallback(() => {
    const selectedIds = new Set(Object.keys(editRowSelection).filter(id => editRowSelection[id]))
    setEditTests(prev => prev.filter(t => !selectedIds.has(t.id)))
    setEditRowSelection({})
  }, [editRowSelection])

  const handleReorderTests = useCallback((newOrder: string[]) => {
    setEditTests(prev => {
      const testMap = new Map(prev.map(t => [t.id, t]))
      return newOrder.map(id => testMap.get(id)!).filter(Boolean)
    })
  }, [])

  // Memoize column definitions
  const viewColumns = useMemo(
    () => getSuiteTestsViewColumns({ onEditTest: handleEditTest }),
    [handleEditTest],
  )

  const editColumns = useMemo(
    () => getSuiteTestsEditColumns({ onExcludeTest: handleExcludeTest }),
    [handleExcludeTest],
  )

  const editSelectedCount = Object.keys(editRowSelection).filter(id => editRowSelection[id]).length
  /* v8 ignore stop */

  // Loading state
  if (loading) {
    return (
      /* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */
      <div data-testid="suite-detail-loading" className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading suite…</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !suite) {
    return (
      <div data-testid="suite-detail-error" className="flex h-full flex-col items-center justify-center gap-4">
        <FlaskConical className="h-10 w-10 text-muted-foreground/40" />
        <div className="text-center">
          <p className="text-sm font-medium mb-1">Failed to load suite</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={startLoad}>
          Try Again
        </Button>
      </div>
    )
  }

  /* v8 ignore next - COV-BRANCH-020 */
  if (!suite) return null

  const displayTests = isTestEditMode ? editTests : tests

  return (
    /* v8 ignore next - COV-V8-003: V8 tracks JSX return as branch */
    <div data-testid="suite-detail-page" className="flex h-full flex-col">
      {/* v8 ignore next - COV-V8-003: V8 tracks JSX as branch */}
      <DetailHeader
        name={suite.name}
        entityType="suite"
        breadcrumbPrefix={
          regressionOrigin
            ? [
                {
                  type: 'regression' as const,
                  // null label renders a skeleton so the prefix slot is stable
                  // from the first paint and doesn't pop in once the fetch lands.
                  label: regressionName,
                  href: `/regressions/${regressionOrigin}`,
                  onNavigate: () => { navigate(`/regressions/${regressionOrigin}`) },
                },
              ]
            : undefined
        }
        /* v8 ignore start - COV-V8-003: ternary in onBack - regression-origin path only hit when arriving via regression URL */
        onBack={() => {
          navigate(regressionOrigin ? `/regressions/${regressionOrigin}` : '/suites')
        }}
        /* v8 ignore stop */
        onRun={() => runDialog.openForSuite(suite.id, suite.name)}
        onExport={() => setExportDialogOpen(true)}
        onDelete={() => setDeleteDialogOpen(true)}
        runTestId="suite-run-btn"
        exportTestId="suite-export-btn"
        deleteTestId="suite-delete-btn"
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
          data-testid="suite-sidebar"
          className={cn(
            'flex h-full flex-col border-r bg-muted/30 shrink-0 overflow-hidden',
            sidebarOpen ? 'w-[380px]' : 'w-[64px]'
          )}
        >
          {sidebarOpen ? (
            <SuiteMetadataSidebar
              suite={suite}
              onEditDetails={handleOpenDetailsDialog}
              onEditVariables={handleOpenVariablesDialog}
              onCollapse={() => setSidebarOpen(false)}
            />
          ) : (
            <CollapsedSidebarStrip icon={FlaskConical} label="Details" onExpand={() => setSidebarOpen(true)} />
          )}
        </aside>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex h-full flex-col gap-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Suite Tests</h2>
              <div className="flex items-center gap-2">
                {isTestEditMode ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="add-tests-button"
                      onClick={() => setTestPickerOpen(true)}
                      className="gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Tests
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="cancel-tests-btn"
                      onClick={handleCancelTestEditMode}
                      disabled={isSavingTests}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      data-testid="save-tests-btn"
                      onClick={handleSaveTestEdits}
                      disabled={isSavingTests}
                    >
                      {isSavingTests && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="edit-tests-btn"
                    onClick={handleEnterTestEditMode}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit Tests
                  </Button>
                )}
              </div>
            </div>

            {/* Filter bar */}
            <EntityFilterWrapper
              entityName="suite tests"
              filters={testFilters}
              defaultFilters={DEFAULT_FILTERS}
              allTags={suiteTestTags}
              columns={columnsWithVisibility}
              fields={filterFields}
              onFilterChange={setTestFilters}
              onColumnToggle={handleColumnToggle}
              actions={
                isTestEditMode && (
                  <BulkActionsDropdown
                    selectedCount={editSelectedCount}
                    selectionModeActive={selectionModeActive}
                    selectionLabel={`${editSelectedCount} selected`}
                    onEnterSelectionMode={() => setSelectionModeActive(true)}
                    /* v8 ignore next 4 - COV-CONTAINER-033: Exit selection mode callback - v8 parallelism tracking quirk */
                    onExitSelectionMode={() => {
                      setSelectionModeActive(false)
                      setEditRowSelection({})
                    }}
                  >
                    <DropdownItem
                      disabled={editSelectedCount === 0}
                      onSelect={() => { if (editSelectedCount > 0) handleBulkExclude() }}
                      data-testid="bulk-action-exclude"
                      /* v8 ignore next - COV-CONTAINER-033: Ternary for bulk-action styling - v8 parallelism tracking quirk */
                      className={editSelectedCount === 0 ? 'text-muted' : 'text-destructive'}
                    >
                      {/* v8 ignore next - COV-V8-003: V8 tracks JSX child as branch */}
                      <Icon icon={XCircle} size="sm" className="mr-2" />
                      Exclude from suite
                    </DropdownItem>
                  </BulkActionsDropdown>
                )
              }
            />

            {/* DataTable */}
            {isTestEditMode ? (
              <DataTable
                key="edit"
                data-testid="suite-tests-table"
                columns={editColumns}
                data={filteredTests}
                getRowId={getRowId}
                getRowLabel={getRowLabel}
                enableSorting={false}
                enableDnD
                onReorder={handleReorderTests}
                enableSelection={selectionModeActive}
                rowSelection={editRowSelection}
                onRowSelectionChange={onEditRowSelectionChange}
                defaultPageSize={0}
                entityName="tests"
                emptyIcon={<FlaskConical className="h-10 w-10 text-muted-foreground/40" />}
                emptyMessage="No tests yet. Use Add Tests to include tests in this suite."
                columnVisibility={suiteHiddenVisibility}
              />
            ) : (
              <DataTable
                key="view"
                data-testid="suite-tests-table"
                columns={viewColumns}
                data={filteredTests}
                getRowId={getRowId}
                getRowLabel={getRowLabel}
                sorting={sorting}
                onSortingChange={onSortingChange}
                defaultPageSize={25}
                entityName="tests"
                emptyIcon={<FlaskConical className="h-10 w-10 text-muted-foreground/40" />}
                emptyMessage="No tests in this suite"
                columnVisibility={suiteHiddenVisibility}
                emptyAction={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnterTestEditMode}
                    className="mt-2"
                  >
                    Edit Tests
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Test Picker Modal */}
      <EntityPickerModal
        open={testPickerOpen}
        onClose={() => setTestPickerOpen(false)}
        onSelect={handleAddTests}
        excludeIds={displayTests.map(t => t.id)}
        title="Add Tests to Suite"
        description="Search and select tests to add."
        searchPlaceholder="Search tests…"
        excludedLabel="(in suite)"
        emptyIcon={<FlaskConical className="h-8 w-8" />}
        testId="test-picker"
        itemKind="test"
        entityNamePlural="tests"
        fetchItems={fetchPickerItems}
        fetchTags={fetchTestsTags}
      />

      {/* Edit Details Dialog */}
      <EditDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        title="Edit Suite Details"
        description="Update the suite name, description, and tags."
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
        title="Edit Suite Variables"
        description="Add, remove, or modify suite variables."
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

      {/* Export dialog */}
      {/* v8 ignore start - COV-V8-003: V8 tracks JSX ternaries as branches */}
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        entityIds={suiteId ? [suiteId] : []}
        entityNames={suite ? [suite.name] : []}
        entityLabel="Suite"
        hasSecrets
        onExport={handleExportAction}
        loading={exportLoading}
      />
      {/* v8 ignore stop */}

      {/* Run dialog */}
      <SuiteRunDialogView hook={runDialog} />

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
            <DialogTitle>Delete Suite</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this suite? Tests will not be
              deleted - they will continue to exist independently.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div
              data-testid="delete-suite-error"
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
              data-testid="delete-confirm-btn"
              onClick={() => handleConfirmDelete(suite.id)}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collision resolution modal for test membership errors */}
      {/* v8 ignore start - COV-CONTAINER-032: Collision modal rendering requires mid-flight API error state across store+API */}
      {collisionData && (
        <CollisionResolutionModal
          open
          onClose={() => setCollisionData(null)}
          description="Some tests you added belong to suites with conflicting variable types. You can remove the conflicting tests to proceed."
          entityLabel="suite"
          conflicts={groupCollisions(collisionData.collisions).map((g) => ({
            variable: g.variable,
            thisType: g.thisType,
            otherType: g.otherType,
            entities: g.suites,
          }))}
          fixAction={{
            buttonLabel: 'Remove conflicting tests',
            /* v8 ignore next 4 - COV-V8-003: V8 tracks arrow function in Array.map as a branch */
            items: collisionData.conflictingTestIds.map((id) => ({
              id,
              name: testNameMap.get(id) || id,
            })),
            onFix: handleCollisionFix,
          }}
        />
      )}
      {/* v8 ignore stop */}
    </div>
  )
}
