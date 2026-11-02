/**
 * Test Lifecycle Hook - Test restoration, draft persistence, and URL-driven test switching
 *
 * Handles session recovery, persisted test restoration, draft auto-save/restore,
 * URL ?editTest and ?newTest handling, and system variable refresh.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'
import { useDraftPersistence, type WorkflowNode, type WorkflowEdge } from '@/features/workbench/hooks/use-draft-persistence'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type {
  ValidationError,
  ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import { convertSystemVariables } from './variable-helpers'
import { SAVE_RESYNC_OWNER, sanitizeEdgesForSave, sanitizeNodesForSave } from './save-utils'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import { reconcileOutputBindingVariables, useLoadTest } from './use-load-test'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { fetchSystemVariables } from '@/features/settings/api/global-variables/crud'
import { fetchTest } from '@/features/tests/api/crud'
import { useToast } from '@/components/ui/toast'
import { usePageBlock } from '@/hooks/use-page-block'
import { toFailureDetail } from '@/lib/failure-detail'
import type { FailedRead } from '@/stores/page-block-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

const SYSTEM_VARIABLES_LABEL = 'system variables'

/** Where a failed route-re-entry refresh of the open test lands. */
export interface TestRefreshFailureSink {
  /** The open test is gone from storage. */
  deleted: () => void
  /** The refresh failed, so suite and regression suggestions stay as they were. */
  stale: (reason: string) => void
}

/** Exported for direct unit testing - not intended for cross-module use. */
export function reportTestRefreshFailure(err: unknown, sink: TestRefreshFailureSink): void {
  if ((err as { status?: number } | null)?.status === 404) {
    sink.deleted()
    return
  }
  sink.stale(toFailureDetail(err).message)
}

type SystemVariablesRead = Awaited<ReturnType<typeof fetchSystemVariables>>

interface SystemVariablesSink {
  store: (systemVars: SystemVariablesRead) => void
  block: (failure: FailedRead) => void
  clear: (label: string) => void
}

function applySystemVariablesResult(
  result: PromiseSettledResult<SystemVariablesRead>,
  sink: SystemVariablesSink,
): void {
  if (result.status === 'fulfilled') {
    sink.store(result.value)
    sink.clear(SYSTEM_VARIABLES_LABEL)
    return
  }
  sink.block({
    label: SYSTEM_VARIABLES_LABEL,
    detail: toFailureDetail(result.reason),
    retry: () => retrySystemVariables(sink),
  })
}

async function retrySystemVariables(sink: SystemVariablesSink): Promise<void> {
  const [result] = await Promise.allSettled([fetchSystemVariables()])
  applySystemVariablesResult(result, sink)
  if (result.status === 'rejected') throw result.reason
}

/**
 * Backend variable metadata as workbench namespace entries (name and type only).
 *
 * Exported for direct unit testing - not intended for cross-module use.
 */
export function toNamespaceEntries(
  vars: ReadonlyArray<{ name: string; type: string }>,
): Array<{ name: string; type: string }> {
  return vars.map((v) => ({ name: v.name, type: v.type }))
}

export interface TestLifecycleResult {
  // Draft persistence
  draft: ReturnType<typeof useDraftPersistence>['draft']
  saveDraft: ReturnType<typeof useDraftPersistence>['saveDraft']
  clearDraft: ReturnType<typeof useDraftPersistence>['clearDraft']

  // Loading state
  isLoadingTest: boolean

  // Pending test to load (for switch-test scenario)
  pendingEditTestId: string | null
  setPendingEditTestId: (id: string | null) => void

  // The loadTest function
  loadTest: (testId: string, options?: { silentNotFound?: boolean }) => Promise<void>

}

export interface UseTestLifecycleParams {
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
  /** Session-ownership mirror: a mirrored stream must never autosave as a local draft. */
  isMirroring?: boolean
  workbenchStatus: string
  isSessionRecoveryComplete: boolean
  recoveredTestId: string | null
  setShowSwitchTestDialog: (show: boolean) => void
  setIsNewTestMode: (mode: boolean) => void
}

export function useTestLifecycle(params: UseTestLifecycleParams): TestLifecycleResult {
  const {
    setValidationErrors,
    setValidationFatal,
    setValidationMode,
    setShowValidationErrorDialog,
    isMirroring = false,
    workbenchStatus,
    isSessionRecoveryComplete,
    recoveredTestId,
    setShowSwitchTestDialog,
    setIsNewTestMode,
  } = params
  const [searchParams, setSearchParams] = useSearchParams()

  // Workflow store state
  const isDirty = useWorkflowStore((state) => state.isDirty)
  const hasDirtySheets = useWorkflowStore((state) => state.dirtyConfigNodeIds.length > 0)
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const viewport = useWorkflowStore((state) => state.viewport)
  const reset = useWorkflowStore((state) => state.reset)
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const editingTestId = useWorkflowStore((state) => state.editingTestId)
  const setVariables = useWorkflowStore((state) => state.setVariables)
  const workflowVariables = useWorkflowStore((state) => state.variables)
  const setNamespaceVariables = useWorkflowStore((state) => state.setNamespaceVariables)
  const functionViewOpen = useWorkflowStore((state) => state.functionViewMode !== null)
  // The open View owns the canvas even on a plain /workbench after a page trip.
  const viewOwnsCanvas = functionViewOpen || Boolean(searchParams.get('viewFunction'))

  // Draft persistence
  const { draft, saveDraft, clearDraft } = useDraftPersistence()

  const { blockPage, clearPageBlock } = usePageBlock()
  const { error: toastError } = useToast()

  // The re-sync reports under this fixed owner; the canvas lifecycle bounds it.
  useEffect(() => {
    const { registerOwner, retireOwner } = usePageBlockStore.getState()
    registerOwner(SAVE_RESYNC_OWNER)
    return () => retireOwner(SAVE_RESYNC_OWNER)
  }, [])

  // Deleted test detection. The store outlives this canvas, so the dialog is
  // dropped when the canvas goes rather than being raised again on the next mount.
  const deletedTestInfo = useDeletedTestStore((state) => state.info)
  useEffect(() => () => useDeletedTestStore.getState().clear(), [])

  // Load test hook (handles API calls, validation, variable reconciliation)
  const { isLoadingTest, loadTest } = useLoadTest(
    clearDraft,
    setValidationErrors,
    setValidationFatal,
    setValidationMode,
    setShowValidationErrorDialog,
  )

  // Track if we've restored draft on mount
  const hasRestoredDraft = useRef(false)
  const hasRestoredPersistedTest = useRef(false)
  // Tracks the last recoveredTestId we loaded from. A ref-based marker lets
  // the session-recovery effect re-fire when the viewer follows a
  // sequential suite/regression to the next child test, without
  // re-loading the same test on unrelated re-renders.
  const lastLoadedRecoveredTestId = useRef<string | null>(null)
  const hasExplicitEditTestRequest = useRef(false)
  const hasInitialFitView = useRef(false)

  // Pending test to load after save/discard dialog
  const [pendingEditTestId, setPendingEditTestId] = useState<string | null>(null)

  // Restore persisted test on page refresh
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    if (hasRestoredPersistedTest.current) return
    if (hasExplicitEditTestRequest.current) return
    const editTestId = searchParams.get('editTest')
    if (editTestId) return
    // Library-View owns the canvas; never restore a persisted Test over it.
    if (searchParams.get('viewFunction')) return
    if (editingTestId && nodes.length === 0) {
      hasRestoredPersistedTest.current = true
      loadTest(editingTestId).catch(alreadyReported)
    }
  }, [editingTestId, nodes.length, searchParams, loadTest])
  /* v8 ignore stop */

  // Load test from session recovery. Fires once per distinct
  // recoveredTestId so the viewer can follow a sequential suite/regression
  // from one child test to the next as the backend swaps sessions.
  // Skipped when the recovered session is already in a terminal
  // state: the Live Workbench container redirects the user away to the
  // Historical Canvas in that case, so pulling the test graph into the
  // canvas would leave it loaded behind the redirect and "stuck open"
  // next time the user returns to /workbench.
  /* v8 ignore start - COV-CONTAINER-002 */
  const TERMINAL_WORKBENCH_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])
  useEffect(
    function loadTestFromSessionRecovery() {
      if (!recoveredTestId) return
      if (TERMINAL_WORKBENCH_STATUSES.has(workbenchStatus)) return
      if (recoveredTestId === editingTestId) return
      if (recoveredTestId === lastLoadedRecoveredTestId.current) return
      const editTestId = searchParams.get('editTest')
      if (editTestId) return
      // Library-View owns the canvas; never restore a recovered Test over it.
      if (searchParams.get('viewFunction')) return
      if (hasExplicitEditTestRequest.current) return
      lastLoadedRecoveredTestId.current = recoveredTestId
      // Session recovery is a background restore the user did not ask for.
      // If the referenced test was deleted (404), fall through to Draft
      // Workflow silently instead of opening the deleted-test modal.
      loadTest(recoveredTestId, { silentNotFound: true }).catch(alreadyReported)
    },
    [recoveredTestId, editingTestId, searchParams, loadTest, workbenchStatus]
  )
  /* v8 ignore stop */

  // Check for ?editTest={testId} and handle test switching
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    const editTestId = searchParams.get('editTest')
    if (!editTestId) return
    hasExplicitEditTestRequest.current = true
    if (!isSessionRecoveryComplete) return

    const newParams = new URLSearchParams(searchParams)
    newParams.delete('editTest')
    setSearchParams(newParams, { replace: true })

    // Same id with an empty canvas means a fresh page load rehydrated only
    // the persisted id - fall through to loadTest or nothing hydrates.
    if (editTestId === editingTestId && nodes.length > 0) return

    // Dirty config sheets gate the switch too: never discard unsaved
    // sheet edits silently. A mirroring tab is showing the holder's draft
    // rather than its own work, so it has nothing to save or discard.
    if (!isMirroring && (isDirty || draft?.isDirty || workbenchStatus !== 'idle' || hasDirtySheets)) {
      setPendingEditTestId(editTestId)
      setShowSwitchTestDialog(true)
      return
    }

    loadTest(editTestId).catch(alreadyReported)
  }, [searchParams, setSearchParams, editingTestId, nodes.length, isDirty, hasDirtySheets, draft, loadTest, workbenchStatus, isSessionRecoveryComplete, isMirroring])
  /* v8 ignore stop */

  // Validate that the currently editing test still exists on the backend.
  // Fires on every route activation (location.key changes on each navigation,
  // even to the same path). Reads editingTestId from store (not dependency array)
  // so Restore doesn't trigger re-validation.
  /* v8 ignore start - COV-CONTAINER-002 */
  const location = useLocation()
  // Skip the first location.key event on every mount: ``loadTest`` (invoked
  // via the restore-persisted / ?editTest / session-recovery effects below)
  // owns initial load on fresh mounts and already populates namespace vars.
  // This refresh effect is only interested in SUBSEQUENT route re-entries
  // within the same mount (e.g. SPA navigation to /regressions and back).
  const hasHandledInitialLocation = useRef(false)

  useEffect(() => {
    if (!location.pathname.startsWith('/workbench')) return
    if (deletedTestInfo) return
    if (!hasHandledInitialLocation.current) {
      hasHandledInitialLocation.current = true
      return
    }
    const currentTestId = useWorkflowStore.getState().editingTestId
    if (!currentTestId) return

    let canceled = false
    // Refresh suite + regression namespace variables in place on workbench
    // route re-entry. Do NOT touch nodes/edges/variables - the user may
    // have unsaved canvas work, and ``loadTest`` is the only path that
    // rebuilds the canvas. This keeps expression-field autocomplete fresh
    // when the user navigates away (e.g. to the regression detail page,
    // edits vars, saves, and comes back) without a page refresh.
    const handleDetails = (details: Awaited<ReturnType<typeof fetchTest>>) => {
      if (canceled) return
      setNamespaceVariables('suite', toNamespaceEntries(details.suite_variables ?? []))
      setNamespaceVariables(
        'regression',
        toNamespaceEntries(details.regression_variables ?? []),
      )
      useWorkflowStore.getState().setEditingTestSuiteIds(details.suite_ids ?? [])
    }
    const handleFetchError = (err: unknown) => {
      if (canceled) return
      reportTestRefreshFailure(err, {
        deleted: () => {
          const name = useWorkflowStore.getState().editingTestName
          useDeletedTestStore.getState().raise({ testId: currentTestId, testName: name })
        },
        stale: (reason) =>
          toastError(
            `Suite and regression variables may be out of date: ${reason}`,
            'Variables Not Refreshed',
          ),
      })
    }
    fetchTest(currentTestId).then(handleDetails).catch(handleFetchError)
    return () => { canceled = true }
  }, [location.key, deletedTestInfo, setNamespaceVariables, toastError])
  /* v8 ignore stop */

  // Load system namespace variables on mount (always - needed for expression autocomplete)
  const systemVariablesSink = useMemo<SystemVariablesSink>(
    () => ({
      store: (systemVars) => {
        // A genuinely empty read leaves the stored entries alone.
        if (Object.keys(systemVars).length === 0) return
        setNamespaceVariables(
          'system',
          convertSystemVariables(
            systemVars as Record<string, { type: string; value: unknown; secret?: boolean }>,
          ),
        )
      },
      block: blockPage,
      clear: clearPageBlock,
    }),
    [setNamespaceVariables, blockPage, clearPageBlock],
  )

  useEffect(() => {
    let canceled = false
    Promise.allSettled([fetchSystemVariables()]).then(([result]) => {
      if (canceled) return
      applySystemVariablesResult(result, systemVariablesSink)
    }, alreadyReported)
    return () => { canceled = true }
  }, [systemVariablesSink])

  // Listen for suite variable changes from suite detail page
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    function onSuiteVarsChanged(e: Event) {
      const { testIds, variables } = (e as CustomEvent).detail as {
        testIds: string[]
        variables: Array<{ name: string; type: string }>
      }
      const currentTestId = useWorkflowStore.getState().editingTestId
      if (!currentTestId || !testIds.includes(currentTestId)) return

      const currentEntries = useWorkflowStore.getState().namespaceVariables.suite
      const newNames = new Set(variables.map((v) => v.name))
      const kept = currentEntries.filter((e) => !newNames.has(e.name))
      setNamespaceVariables('suite', [...kept, ...variables])
    }
    globalThis.addEventListener('suite-variables-changed', onSuiteVarsChanged)
    return () => globalThis.removeEventListener('suite-variables-changed', onSuiteVarsChanged)
  }, [])
  /* v8 ignore stop */

  // Listen for regression variable changes from regression detail page
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    function onRegressionVarsChanged(e: Event) {
      const { suiteIds, variables } = (e as CustomEvent).detail as {
        suiteIds: string[]
        variables: Array<{ name: string; type: string }>
      }
      // Only apply when the editing test actually belongs to the regression
      // that fired the event - otherwise we would clobber an unrelated test's
      // regression namespace with another regression's declarations.
      const editingSuiteIds = useWorkflowStore.getState().editingTestSuiteIds
      if (editingSuiteIds.length === 0) return
      const editingSet = new Set(editingSuiteIds)
      if (!suiteIds.some((id) => editingSet.has(id))) return

      const currentEntries = useWorkflowStore.getState().namespaceVariables.regression
      const newNames = new Set(variables.map((v) => v.name))
      const kept = currentEntries.filter((entry) => !newNames.has(entry.name))
      setNamespaceVariables('regression', [...kept, ...variables])
    }
    globalThis.addEventListener('regression-variables-changed', onRegressionVarsChanged)
    return () => globalThis.removeEventListener('regression-variables-changed', onRegressionVarsChanged)
  }, [])
  /* v8 ignore stop */

  // Check for ?newTest=true on mount. Resets the workflow store and
  // clears any persisted draft so the user lands on a genuinely blank
  // canvas. The name-prompt dialog is owned by the tests-list handler
  // that navigates here with this param; a direct URL visit lands on
  // the clean canvas without popping a dialog, so Playwright visual
  // tests that use `/tests/new` as a clean-canvas entry don't get
  // blocked by an overlay they didn't expect.
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    const newTest = searchParams.get('newTest')
    if (newTest === 'true') {
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('newTest')
      setSearchParams(newParams, { replace: true })
      // Unsaved work goes through the switch dialog, whose Discard or Save leaves a blank canvas.
      if (!isMirroring && (isDirty || hasDirtySheets || workbenchStatus !== 'idle')) {
        setPendingEditTestId(null)
        setShowSwitchTestDialog(true)
        return
      }
      reset()
      clearDraft()
      requestFitView({ padding: 0.2, duration: 0 })
      setIsNewTestMode(true)
    }
  }, [searchParams, setSearchParams, reset, clearDraft, requestFitView, isMirroring, isDirty, hasDirtySheets, workbenchStatus])
  /* v8 ignore stop */

  // Restore draft state on mount. The guard ref is per-mount but the store is
  // module-scoped and outlives the component, so restore must be idempotent
  // against a store that already holds these variables: every setter here
  // replaces rather than appends.
  /* v8 ignore start - COV-UNREACH-006: isLoadingTest branch unreachable in three-way ||, only true when editTestId also truthy */
  useEffect(() => {
    if (hasRestoredDraft.current) return
    const editTestId = searchParams.get('editTest')
    if (editTestId || editingTestId || isLoadingTest) return
    // Library-View owns the canvas; never restore a Test draft over it.
    if (viewOwnsCanvas) return
  /* v8 ignore stop */
    hasRestoredDraft.current = true
    // A mirrored canvas is the holder's work, and this tab's once the mirror ends: never restore over it.
    if (isMirroring) return
    if (!draft) return

    /* v8 ignore start - COV-CONTAINER-002 */
    if (draft.nodes?.length) setNodes(canvasLocalFunctionBodies(draft.nodes) as Parameters<typeof setNodes>[0])
    if (draft.edges?.length) setEdges(draft.edges as Parameters<typeof setEdges>[0])
    requestFitView({ padding: 0.2, duration: 0 })
    if (draft.variables?.length) setVariables(draft.variables as Parameters<typeof setVariables>[0])
    // A restored draft carries the variable types its Blocks declared when it was
    // written, so a Block whose output type has since changed needs the same repair
    // the load path runs.
    reconcileOutputBindingVariables(setVariables)
  /* v8 ignore next - COV-DEF-049: useEffect dependency array V8 tracking quirk */
  }, [draft, setNodes, setEdges, requestFitView, setVariables, searchParams, editingTestId, isLoadingTest, isMirroring, viewOwnsCanvas])
  /* v8 ignore stop */

  // Initial fitView for fresh canvas
  /* v8 ignore start - COV-CONTAINER-002 */
  useEffect(() => {
    if (hasInitialFitView.current) return
    const editTestId = searchParams.get('editTest')
    if (editTestId || editingTestId || isLoadingTest) return
    if (draft) return
    // Library-View drives its own fitView through the drill machinery.
    if (viewOwnsCanvas) return
    hasInitialFitView.current = true
    requestFitView({ padding: 0.2, duration: 0 })
  }, [searchParams, editingTestId, isLoadingTest, draft, requestFitView, viewOwnsCanvas])
  /* v8 ignore stop */

  // Auto-save draft
  /* v8 ignore start - COV-CONTAINER-012 */
  useEffect(() => {
    // Library-View owns the canvas; never auto-save it as a Test draft.
    if (viewOwnsCanvas) return
    // A mirrored holder stream is not this viewer's work; never leak it into the draft.
    if (isMirroring) return
    /* v8 ignore next - COV-CONTAINER-007 */
    if (editingTestId) return
    if (nodes.length > 0 || edges.length > 0 || isDirty || workflowVariables.length > 0) {
      saveDraft({
        nodes: sanitizeNodesForSave(nodes as WorkflowNode[]),
        edges: sanitizeEdgesForSave(edges as WorkflowEdge[]),
        viewport,
        testId: null,
        testName: null,
        isDirty,
        variables: workflowVariables,
      })
    }
  }, [nodes, edges, viewport, isDirty, isMirroring, saveDraft, editingTestId, workflowVariables, viewOwnsCanvas])
  /* v8 ignore stop */

  return {
    draft,
    saveDraft,
    clearDraft,
    isLoadingTest,
    pendingEditTestId,
    setPendingEditTestId,
    loadTest,
  }
}
