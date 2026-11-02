/**
 * Workbench Container - Visual Workflow Builder Canvas
 *
 * This is the main canvas page for building and editing workflows.
 * Extracted to its own file for code-splitting (reduces main bundle size).
 *
 * State and logic are organized into extracted hooks:
 * - useCanvasState: environment selection and debug options
 * - useVariableManagement: variable CRUD, output binding analysis, runtime overlay
 * - useTestLifecycle: load test, session recovery, draft persistence
 * - useTestSave: save/close/switch test handlers
 * - useTestRun: run/stop, validation, fix-all
 */

/* v8 ignore next - COV-V8-001 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { CanvasLoadingOverlay } from '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
import { WorkflowCanvas } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { AdHocActionsProvider } from '@/features/workbench/common/canvas/adhoc-actions-context'
import { WorkbenchShell } from '@/features/workbench/common/shell'
import { MirrorBanner } from '@/features/workbench/common/canvas/chrome/mirror-banner'
import { TakeOverWaitingDialog } from '@/features/workbench/common/canvas/chrome/take-over-waiting-dialog'
import { TakeOverApprovalDialog } from '@/features/workbench/common/canvas/chrome/take-over-approval-dialog'
import { TakeOverResultDialog } from '@/features/workbench/common/canvas/chrome/take-over-result-dialog'
import { useSessionOwnership } from '@/features/workbench/hooks/use-session-ownership'
import { StopConfirmationDialog } from '@/components/shared/dialogs/stop-confirmation-dialog'
import { useWorkbenchRun } from '@/features/workbench/hooks/use-workbench-run/hook'
import { useSessionArtifacts } from '@/features/workbench/hooks/use-session-artifacts'
import { useDebugDrillSync } from '@/features/workbench/hooks/use-debug-drill-sync'
import { WorkbenchRunSharedContext } from '@/features/workbench/hooks/use-workbench-run/shared-context'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { clearWorkbenchSession } from '@/features/workbench/lib/clear-session'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { useEnvironments } from '@/hooks/use-environments'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'
import { useFunctionView } from '@/features/functions/canvas/use-function-view'
import { deriveSwitchEntity } from '@/features/workbench/common/canvas/dialogs/switch-entity'
import {
  useReadOnlyCanvas,
  useIsDrilledIntoShared,
} from '@/features/workbench/common/canvas/use-readonly-canvas'
import { derivePausedElementType } from '@/features/workbench/lib/paused-element-type'
import { useCanvasState } from '@/hooks/use-canvas-state'
import { useVariableManagement } from './use-variable-management'
import { useRunConflictGuard } from './use-run-conflict-guard'
import { CurrentEditRunConflictDialog } from '@/features/workbench/common/variables/variable-inspect-modal/current-edit-run-conflict-dialog'
import { useTestLifecycle } from './use-test-lifecycle'
import { dismissDeletedTest } from './deleted-test-dismiss'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { useTestSave } from './use-test-save'
import { useTestClose } from './use-test-close'
import { useFunctionViewLeave } from './use-function-view-leave'
import { useTestRun } from './use-test-run'
import { useValidation } from './use-validation'
import { useKeyboardShortcuts } from './use-keyboard-shortcuts'
import { useFunctionContracts } from './function-versions'
import { useSaveShortcut } from '@/features/workbench/hooks/use-save-shortcut'
import { useFocusCurrent } from '@/features/workbench/hooks/use-focus-current'
import { useFollowChanges } from '@/features/workbench/hooks/use-follow-changes'
import { useRunMirror } from '@/features/workbench/hooks/use-run-mirror'
import { useMirrorVariablePulse } from '@/features/workbench/hooks/use-mirror-variable-pulse'
import { useUndoRedoToasts } from '@/features/workbench/hooks/use-undo-redo-toasts'
import { resolveFocusTarget } from '@/features/workbench/lib/focus-target'
import { WorkbenchDialogs } from './workbench-dialogs'
import { SessionArtifactsSheet } from './session-artifacts-sheet'
import { useTestDataActivity } from '@/features/workbench/common/testdata/use-testdata-activity'
import { TestDataSheet } from './testdata-sheet'
import { refocusSheet } from '@/components/shared/draggable-sheet'
import { LiveActionBar } from './action-bar'
import { LiveBreadcrumbBar } from './breadcrumb-bar'
import { LivePalette } from './palette'
import { LiveConsole } from './console'
import { LiveVariableManager } from './variable-manager'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

// Holder-side mirror stream: minimum gap between draft snapshots.
const DRAFT_PUSH_MS = 300

// Leading-edge throttle with one trailing push per quiet window.
function createDraftThrottle(push: () => void): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let trailing = false
  const schedule = () => {
    if (timer) {
      trailing = true
      return
    }
    push()
    timer = setTimeout(() => {
      timer = null
      if (trailing) {
        trailing = false
        schedule()
      }
    }, DRAFT_PUSH_MS)
  }
  const cancel = () => {
    if (timer) clearTimeout(timer)
  }
  return { schedule, cancel }
}

// Holder side: stream throttled whole-graph snapshots to every mirror.
function useHolderDraftStream(
  isHolder: boolean,
  pushDraft: (snapshot: {
    nodes: ReturnType<typeof useWorkflowStore.getState>['nodes']
    edges: ReturnType<typeof useWorkflowStore.getState>['edges']
    variables: ReturnType<typeof useWorkflowStore.getState>['variables']
    test_id: string | null
    test_name: string | null
    dirty: boolean
  }) => void,
): void {
  useEffect(() => {
    if (!isHolder) return
    const { schedule, cancel } = createDraftThrottle(() => {
      const state = useWorkflowStore.getState()
      pushDraft({
        nodes: state.nodes,
        edges: state.edges,
        variables: state.variables,
        test_id: state.editingTestId,
        test_name: state.editingTestName,
        dirty: state.isDirty,
      })
    })
    schedule()
    const unsubs = [
      useWorkflowStore.subscribe((state) => state.nodes, schedule),
      useWorkflowStore.subscribe((state) => state.edges, schedule),
      useWorkflowStore.subscribe((state) => state.variables, schedule),
      useWorkflowStore.subscribe((state) => state.isDirty, schedule),
      useWorkflowStore.subscribe((state) => state.editingTestId, schedule),
      useWorkflowStore.subscribe((state) => state.editingTestName, schedule),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
      cancel()
    }
  }, [isHolder, pushDraft])
}

// A watcher that navigates itself (open/close/new) becomes a free read-only
// browser: the mirror stops moving its view until it rejoins from the banner.
function useBrowseAwayOnNavigation(searchParams: URLSearchParams, browseAway: () => void): void {
  useEffect(() => {
    const explicit =
      searchParams.get('editTest') ||
      searchParams.get('viewFunction') ||
      searchParams.get('newTest')
    if (explicit) {
      browseAway()
    }
  }, [searchParams, browseAway])
}

// The slot came back from a write-only borrow (assistant create/amend):
// re-converge the open test on storage. Transition-gated for StrictMode.
function useInheritRefresh(
  inheritRefreshTick: number,
  loadTest: (testId: string, options?: { silentNotFound?: boolean }) => Promise<void>,
): void {
  const prevTickRef = useRef(inheritRefreshTick)
  useEffect(() => {
    if (prevTickRef.current === inheritRefreshTick) return
    prevTickRef.current = inheritRefreshTick
    const openTestId = useWorkflowStore.getState().editingTestId
    if (openTestId) {
      loadTest(openTestId, { silentNotFound: true }).catch(alreadyReported)
    }
  }, [inheritRefreshTick, loadTest])
}

// Monotonic epoch keyed on drill changes; used to remount WorkflowCanvas so React Flow's d3-drag rebinds.
function useDrillEpoch(): number {
  const drillPathSerialized = useWorkflowStore((state) =>
    state.drillPath.map((e) => e.nodeId).join('/'),
  )
  const drillEpochRef = useRef(0)
  const prevPathRef = useRef(drillPathSerialized)
  if (prevPathRef.current !== drillPathSerialized) {
    drillEpochRef.current += 1
    prevPathRef.current = drillPathSerialized
  }
  return drillEpochRef.current
}

// Workbench page - Visual Workflow Builder Canvas
export function WorkbenchContainer(): ReactNode {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { error: toastError } = useToast()
  const { environments, loaded: environmentsLoaded } = useEnvironments()
  const {
    selectedEnvironment,
    setSelectedEnvironment,
    recentEnvironments,
    rememberSelection,
    setRememberSelection,
  } = useCanvasState(environments, environmentsLoaded)

  // Debug options are owned by the workflow store (store-level localStorage
  // persistence). The popover reads/writes here so the live /workbench/run
  // payload always reflects what the user toggled.
  const debugOptions = useWorkflowStore((state) => state.debugOptions)
  const setDebugOptions = useWorkflowStore((state) => state.setDebugOptions)

  // Workflow store state
  const isDirty = useWorkflowStore((state) => state.isDirty)
  const canUndo = useWorkflowStore((state) => state.canUndo())
  const canRedo = useWorkflowStore((state) => state.canRedo())
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const pausedNodeId = useWorkflowStore((state) => state.pausedNodeId)
  const isCanvasReady = useWorkflowStore((state) => state.isCanvasReady)
  const deletedTestInfo = useDeletedTestStore((state) => state.info)
  const editingTestId = useWorkflowStore((state) => state.editingTestId)
  const editingTestName = useWorkflowStore((state) => state.editingTestName)
  // Library-View mode hides the Test-lifecycle action-bar controls (Close/Save/Edit).
  const functionViewMode = useWorkflowStore((state) => state.functionViewMode)

  // Active Function scope. Drives the Variable Manager layout (PARAMETERS /
  // VARIABLES groups, IN / OUT badges, scoped variable filtering) and the
  // expression autocomplete gating downstream.
  const functionScope = useFunctionScope()

  const isReadOnlyScope = useReadOnlyCanvas()
  const isDrilledIntoShared = useIsDrilledIntoShared()

  // ---- SESSION OWNERSHIP (single-active-session lock + live mirroring) ----
  const ownership = useSessionOwnership()
  const { isHolder, isMirroring, pushDraft, browsingAway, browseAway, rejoinMirror } = ownership

  useBrowseAwayOnNavigation(searchParams, browseAway)

  useHolderDraftStream(isHolder, pushDraft)

  const drillEpoch = useDrillEpoch()

  // Workbench ephemeral execution
  const workbenchRun = useWorkbenchRun()
  const {
    status: workbenchStatus,
    sessionId,
    currentBlock,
    testId: recoveredTestId,
    isSessionRecoveryComplete,
    isRunning: workbenchIsRunning,
    executionId,
    parentExecutionId,
    startRun,
    startDebugRun,
    runStandaloneFunction,
    stopRun: stopWorkbenchRun,
    continueExecution,
    skipBlockAtPause,
    stepOver,
    stepInto,
    repeatStep,
    repeatBlockDraft,
    updateBreakpoints,
    updateSkippedNodes: updateWorkbenchSkippedNodes,
    reset: resetWorkbenchRun,
    registerVariableHandler,
    registerTrackedTerminalHandler,
    attachToAnnouncedRun,
    detachFromAnnouncedRun,
  } = workbenchRun

  // ---- RUN MIRROR (watcher live-attaches to the holder's announced run) ----
  const { mirroredRun } = useRunMirror({
    run: ownership.mirroredRun,
    isMirroring,
    browsingAway,
    localSessionId: sessionId,
    attach: () => {
      attachToAnnouncedRun().catch(alreadyReported)
    },
    detach: detachFromAnnouncedRun,
  })

  // The canvas follows execution during a debug pause: drill into the paused Function, pop out on resume.
  useDebugDrillSync({
    pausedNodeId,
    isPaused: workbenchStatus === 'paused',
    isRunning: workbenchStatus === 'running',
    toastError,
  })

  // Live breakpoints sync: while a debug session is running or paused, push
  // toggle-breakpoint changes through to the engine so the set stays live.
  // Zustand's subscribe avoids the re-render cascade a useEffect(state-selector)
  // pattern triggers when the store publishes a new Set reference each toggle.
  useEffect(() => {
    if (!sessionId) return
    if (workbenchStatus !== 'running' && workbenchStatus !== 'paused') return
    return useWorkflowStore.subscribe(
      (state) => state.breakpoints,
      (breakpoints) => {
        updateBreakpoints(Array.from(breakpoints)).catch(alreadyReported)
      }
    )
  }, [sessionId, workbenchStatus, updateBreakpoints])

  // V-CANVAS-04: execution is active when status is not idle
  const executionActive = workbenchStatus !== 'idle'

  // ---- SESSION ARTIFACTS (chip + sheet + warn-on-wipe guards) ----
  const [artifactsSheetOpen, setArtifactsSheetOpen] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const isTracked = !!(executionId || parentExecutionId)
  const sessionArtifacts = useSessionArtifacts({
    sessionActive: sessionId !== null,
    running: workbenchIsRunning,
    sheetOpen: artifactsSheetOpen,
  })
  // Tracked sessions never warn - their artifacts persist in the permanent store.
  const sessionArtifactWarnCount = isTracked ? 0 : sessionArtifacts.count
  // Single interception for every Reset entry point (breadcrumb link + canvas
  // context menu): instant at zero artifacts, one confirm dialog otherwise.
  const handleResetRequest = useCallback(() => {
    if (sessionArtifactWarnCount > 0) {
      setShowResetConfirm(true)
      return
    }
    resetWorkbenchRun()
  }, [sessionArtifactWarnCount, resetWorkbenchRun])
  const { remove: removeArtifact } = sessionArtifacts
  const handleDownloadArtifact = useCallback(
    (path: string) => {
      void workbenchApi.downloadSessionArtifact(path).catch((err: unknown) => {
        toastError(toFailureDetail(err).message, 'Download Failed')
      })
    },
    [toastError]
  )
  const handleDeleteArtifact = useCallback(
    (path: string) => {
      void removeArtifact(path).catch((err: unknown) => {
        toastError(
          `The file is still in the session: ${toFailureDetail(err).message}`,
          'Delete Failed'
        )
      })
    },
    [removeArtifact, toastError]
  )
  // Reopen attempt on the chip: raise + pulse the open sheet instead of a no-op.
  const handleOpenArtifacts = useCallback(() => {
    if (artifactsSheetOpen) {
      refocusSheet('session-artifacts')
      return
    }
    setArtifactsSheetOpen(true)
  }, [artifactsSheetOpen])

  // ---- TEST DATA (chip + sheet, TDATA-3) ----
  const [testDataOpen, setTestDataOpen] = useState(false)
  const testDataActivity = useTestDataActivity(editingTestId)
  const handleOpenTestData = useCallback(() => {
    if (testDataOpen) {
      refocusSheet('testdata')
      return
    }
    setTestDataOpen(true)
  }, [testDataOpen])

  // Running or paused: the panel's live and expression state; its pencil and row delete read runStatus (VMGR-107).
  const variableEditingLocked =
    workbenchStatus === 'running' || workbenchStatus === 'paused'

  // ---- VARIABLE MANAGEMENT HOOK ----
  const varMgmt = useVariableManagement(sessionId, registerVariableHandler)

  // ---- MIRROR VARIABLE PULSE (watch-mode changed-row cue) ----
  const recentlyChangedVars = useMirrorVariablePulse(isMirroring, varMgmt.recentlyChangedPaths)

  // ---- RUN-CONFLICT GUARD (an open Edit window's unsaved change holds run/resume) ----
  const conflictGuard = useRunConflictGuard()

  // ---- VALIDATION HOOK ----
  // clearDraft is wired via ref to break circular dep with lifecycle hook
  const clearDraftRef = useRef<() => void>(() => {})
  const validationHook = useValidation(() => { clearDraftRef.current() })

  // ---- LIFECYCLE HOOK ----
  // Shared dialog state setters are wired via refs to break circular dep with save hook
  const setShowSwitchTestDialogRef = useRef<(show: boolean) => void>(() => {})
  const setIsNewTestModeRef = useRef<(mode: boolean) => void>(() => {})

  const lifecycle = useTestLifecycle({
    setValidationErrors: validationHook.setValidationErrors,
    setValidationFatal: validationHook.setValidationFatal,
    setValidationMode: validationHook.setValidationMode,
    setShowValidationErrorDialog: validationHook.setShowValidationErrorDialog,
    isMirroring,
    workbenchStatus,
    isSessionRecoveryComplete,
    recoveredTestId,
    setShowSwitchTestDialog: (show: boolean) => { setShowSwitchTestDialogRef.current(show) },
    setIsNewTestMode: (mode: boolean) => { setIsNewTestModeRef.current(mode) },
  })

  // Wire clearDraft ref now that lifecycle is created
  clearDraftRef.current = lifecycle.clearDraft

  useInheritRefresh(ownership.inheritRefreshTick, lifecycle.loadTest)

  // ---- RUN HOOK ----
  const runHook = useTestRun({
    selectedEnvironment,
    startRun,
    startDebugRun,
    runStandaloneFunction,
    stopWorkbenchRun,
    updateWorkbenchSkippedNodes,
    workbenchStatus,
    readStagedOverrides: varMgmt.readStagedOverrides,
    setValidationErrors: validationHook.setValidationErrors,
    setValidationFatal: validationHook.setValidationFatal,
    setValidationMode: validationHook.setValidationMode,
    setShowValidationErrorDialog: validationHook.setShowValidationErrorDialog,
    isMirroring,
  })
  const adHocEnvironment = useMemo(
    () => ({ selected: selectedEnvironment, select: setSelectedEnvironment }),
    [selectedEnvironment, setSelectedEnvironment],
  )

  // ---- SAVE HOOK ----
  const saveHook = useTestSave({
    pendingEditTestId: lifecycle.pendingEditTestId,
    setPendingEditTestId: lifecycle.setPendingEditTestId,
    loadTest: lifecycle.loadTest,
    clearDraft: lifecycle.clearDraft,
    resetWorkbenchRun,
    setValidationErrors: validationHook.setValidationErrors,
    setValidationFatal: validationHook.setValidationFatal,
    setValidationMode: validationHook.setValidationMode,
    setShowValidationErrorDialog: validationHook.setShowValidationErrorDialog,
  })

  // ---- CLOSE / SWITCH HOOK ----
  const handleCanvasClosed = useCallback(() => {
    if (isMirroring) browseAway()
  }, [isMirroring, browseAway])

  const functionViewLeave = useFunctionViewLeave({
    onCanvasClosed: handleCanvasClosed,
    clearDraft: lifecycle.clearDraft,
  })

  const closeHook = useTestClose({
    executionActive,
    onCanvasClosed: handleCanvasClosed,
    pendingEditTestId: lifecycle.pendingEditTestId,
    setPendingEditTestId: lifecycle.setPendingEditTestId,
    loadTest: lifecycle.loadTest,
    clearDraft: lifecycle.clearDraft,
    resetWorkbenchRun,
    setIsDirectSaving: saveHook.setIsDirectSaving,
    saveAndCloseModeRef: saveHook.saveAndCloseModeRef,
    setShowSaveDialog: saveHook.setShowSaveDialog,
    setValidationErrors: validationHook.setValidationErrors,
    setValidationFatal: validationHook.setValidationFatal,
    setValidationMode: validationHook.setValidationMode,
    setShowValidationErrorDialog: validationHook.setShowValidationErrorDialog,
    closeFunctionView: functionViewLeave.close,
  })

  // Wire the refs now that close/save hooks are created
  setShowSwitchTestDialogRef.current = closeHook.setShowSwitchTestDialog
  setIsNewTestModeRef.current = saveHook.setIsNewTestMode

  // Library-View boot: when the URL carries ?viewFunction, stage the read-only
  // Function canvas (no parent Test). Opening over unsaved work routes through
  // the switch-confirm dialog instead of discarding it. No-op for normal Tests.
  useFunctionView({
    executionActive,
    setShowSwitchDialog: closeHook.setShowSwitchTestDialog,
    setPendingEditTestId: lifecycle.setPendingEditTestId,
  })

  // A library Function Block that lands on the canvas, or opens inside a body, reads its contract (REQ-3.1.2.4).
  useFunctionContracts()

  // ---- KEYBOARD SHORTCUTS ----
  const { handleUndo, handleRedo } = useKeyboardShortcuts()

  // Cmd/Ctrl+S saves the open Test (disabled on read-only historical canvases).
  useSaveShortcut({
    onSave: () => {
      saveHook.handleSaveClick().catch(alreadyReported)
    },
    disabled: isReadOnlyScope || isMirroring,
  })

  // ---- FOCUS CURRENT (run controls: center the paused/running block) ----
  const focusTarget = resolveFocusTarget({
    pausedNodeId,
    currentBlock,
  })
  const handleFocusCurrent = useFocusCurrent(focusTarget)

  // ---- FOLLOW CHANGES (watch-mode: recenter on each live build change) ----
  // Browsing away drops the toggle: a free browser tracks nothing.
  const { following: isFollowingChanges, toggleFollow } = useFollowChanges(
    isMirroring && !browsingAway,
  )

  // Rejoin from the banner: converge back on the holder's surface. A browsed
  // Library View also drops its ?viewFunction URL on the way back.
  const handleWatchSession = useCallback(() => {
    if (functionViewMode) navigate('/workbench')
    rejoinMirror()
  }, [functionViewMode, navigate, rejoinMirror])

  const handleSeeConnection = useCallback(() => {
    if (ownership.holderKind === 'mcp') {
      navigate(`/settings/mcp?session=${ownership.mcpSessionId ?? ''}`)
    } else {
      navigate(`/settings/server?session=${ownership.browserSessionId ?? ''}`)
    }
  }, [navigate, ownership.holderKind, ownership.mcpSessionId, ownership.browserSessionId])

  // ---- UNDO/REDO TOASTS ----
  // Mirrors the store's lastAnnouncement to a stack-collapsing toast so
  // sighted users see what their last undo/redo affected. Screen-reader
  // announcement (live region) is unchanged.
  useUndoRedoToasts()

  // When a tracked execution terminates, close the test on the canvas
  // (reset workflow store → empty Draft Workflow, clear the backend
  // session so session-recovery doesn't re-hydrate the stale state) and
  // redirect to the execution detail view. By design the
  // workbench must NOT stay on a finished tracked execution's canvas.
  useEffect(() => {
    registerTrackedTerminalHandler((execId: string) => {
      useWorkflowStore.getState().reset()
      clearWorkbenchSession(toastError).catch(alreadyReported)
      navigate(`/executions/${execId}`)
    })
    return () => {
      registerTrackedTerminalHandler(null)
    }
  }, [registerTrackedTerminalHandler, navigate, toastError])

  // ---- RENDER-TIME COMPUTED VALUES ----

  // Dismiss behavior lives in ./deleted-test-dismiss; this is wiring only.
  const lifecycleClearDraft = lifecycle.clearDraft
  /* v8 ignore start - COV-V8-003: callback body only reachable via a deletion-in-background race the tests do not simulate */
  const handleDismissDeletedTest = useCallback(() => {
    dismissDeletedTest({ resetWorkbenchRun, toastError, clearDraft: lifecycleClearDraft })
  }, [resetWorkbenchRun, toastError, lifecycleClearDraft])
  /* v8 ignore stop */

  // Detect incoming test switch synchronously during render (not in effect)
  // so the overlay appears on the SAME frame as the URL change, before the
  // browser paints the old canvas. Effects fire AFTER paint, which is too late.
  const pendingEditTest = searchParams.get('editTest')
  const isTestSwitchPending = !!pendingEditTest && pendingEditTest !== editingTestId

  // Contextual loading message for canvas overlay
  const loadingMessage = (lifecycle.isLoadingTest || isTestSwitchPending) ? 'Loading test…' : 'Preparing workbench…'

  // Map workbench status to workflow status for CanvasActionBar and CanvasBreadcrumbBar
  const canvasStatus = workbenchStatus

  // Pre-compute save dialog initial values to avoid nested ternary in JSX
  let saveInitialValues: { name: string } | undefined
  if (!saveHook.isNewTestMode && editingTestName) {
    saveInitialValues = { name: editingTestName }
  }

  // Derive the paused node's normalized element type so the Paused Toolbar
  // can disable Skip Block on diverging parents (if-else, assert-split,
  // switch). Engine names ('switch-case', 'assert' + mode='split') are
  // normalized to the canonical synonyms the backend uses for rejection.
  const pausedElementType = derivePausedElementType(pausedNodeId, nodes)

  // Name the currently-open entity for the switch-confirm dialog (Test vs Function).
  const switchEntity = deriveSwitchEntity(functionViewMode, editingTestName)

  return (
    <WorkbenchRunSharedContext.Provider value={workbenchRun}>
    <div data-testid="canvas-page" className="flex h-full flex-col">
      <WorkbenchShell
        mode="live"
        actionBar={
          <LiveActionBar
            status={canvasStatus}
            isDirty={isDirty || saveHook.isDirectSaving}
            canUndo={canUndo}
            canRedo={canRedo}
            editingLocked={isMirroring}
            mirroredRun={
              mirroredRun
                ? {
                    environmentName: mirroredRun.environmentName,
                    hasCurrentBlock: currentBlock !== null,
                  }
                : null
            }
            watchersCount={isHolder ? ownership.watchers : 0}
            isEditingTest={!!editingTestId}
            showTestControls={!functionViewMode}
            showReadOnlyChrome={isDrilledIntoShared}
            selectedEnvironment={selectedEnvironment}
            availableEnvironments={environments}
            recentEnvironments={recentEnvironments}
            rememberSelection={rememberSelection}
            debugOptions={debugOptions}
            onClose={closeHook.handleClose}
            onSave={() => { saveHook.handleSaveClick().catch(alreadyReported) }}
            onEdit={saveHook.handleEditClick}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onEnvironmentChange={setSelectedEnvironment}
            onRememberSelectionChange={setRememberSelection}
            onRun={conflictGuard.guard(runHook.handleRun)}
            onDebug={conflictGuard.guard(runHook.handleDebug)}
            onContinue={conflictGuard.guard(continueExecution)}
            onSkipBlock={conflictGuard.guard(skipBlockAtPause)}
            onStepOver={conflictGuard.guard(stepOver)}
            onStepInto={conflictGuard.guard(stepInto)}
            onRepeatStep={conflictGuard.guard(repeatStep)}
            pausedElementType={pausedElementType}
            onStop={(mode) => { runHook.handleStop(mode).catch(alreadyReported) }}
            onFocusCurrent={handleFocusCurrent}
            onDebugOptionsChange={setDebugOptions}
          />
        }
        breadcrumbBar={
          <LiveBreadcrumbBar
            /* v8 ignore next - COV-UNREACH-007: isLoadingTest only true when editingTestId also truthy */
            status={lifecycle.isLoadingTest ? 'running' : canvasStatus}
            artifactsCount={sessionArtifacts.count}
            testDataUploading={testDataActivity.uploads > 0}
            testDataInterrupted={testDataActivity.interruptions > 0}
            onReset={handleResetRequest}
            onOpenArtifacts={handleOpenArtifacts}
            onOpenTestData={handleOpenTestData}
          />
        }
        mirrorBanner={
          isMirroring ? (
            <MirrorBanner
              holderLabel={ownership.holderLabel ?? ''}
              holderKind={ownership.holderKind}
              runActive={ownership.mirroredRun !== null}
              browsing={browsingAway}
              onWatchSession={handleWatchSession}
              onTakeOver={ownership.takeOver}
              onSeeConnection={handleSeeConnection}
              isFollowing={isFollowingChanges}
              onToggleFollow={toggleFollow}
            />
          ) : null
        }
        palette={<LivePalette />}
        canvas={
          <AdHocActionsProvider
            dispatch={conflictGuard.guard(runHook.handleAdHocRun)}
            repeatBlockDraft={conflictGuard.guard(repeatBlockDraft)}
            offered={runHook.adHocOffered}
            environment={adHocEnvironment}
          >
            <WorkflowCanvas
              key={`drill:${drillEpoch}`}
              executionStatus={canvasStatus}
              onReset={handleResetRequest}
              sessionId={sessionId ?? undefined}
              readOnly={isReadOnlyScope || isMirroring}
            />
            <CanvasLoadingOverlay
              isReady={isCanvasReady && !isTestSwitchPending}
              message={loadingMessage}
            />
          </AdHocActionsProvider>
        }
        renderConsole={(slot) => (
          <LiveConsole sessionId={sessionId} {...slot} />
        )}
        renderVariableManager={(slot) => (
          <LiveVariableManager
            {...slot}
            readOnly={isMirroring}
            variables={varMgmt.displayVariables}
            unsavedSecretIds={varMgmt.unsavedSecretIds}
            changedSecretIds={varMgmt.changedSecretIds}
            runtimeValues={varMgmt.runtimeValues}
            isExecuting={variableEditingLocked}
            runStatus={workbenchStatus}
            onCreateVariable={varMgmt.handleCreateParameter}
            onVariableEdit={varMgmt.handleVariableWindowSave}
            onVariableCurrentEdit={varMgmt.handleVariableCurrentEdit}
            appliedOverrides={varMgmt.appliedOverrides}
            runStartSnapshot={varMgmt.runStartSnapshot}
            runStartElementTypes={varMgmt.runStartElementTypes}
            onVariableDelete={varMgmt.handleVariableDelete}
            validateExpressionCycle={varMgmt.validateExpressionCycle}
            outputBoundVarNames={varMgmt.outputBoundVarNames}
            workflowReferencedVarNames={varMgmt.workflowReferencedVarNames}
            recentlyChanged={recentlyChangedVars}
            isMirroring={isMirroring}
            availableVariables={varMgmt.availableVariablesForManager}
            scope={functionScope}
            persistenceKey={editingTestId ?? null}
            sessionId={sessionId}
          />
        )}
      />

      <WorkbenchDialogs
        showSaveDialog={saveHook.showSaveDialog}
        onCloseSaveDialog={saveHook.handleCloseSaveDialog}
        onSaveTest={saveHook.handleSave}
        saveMode={saveHook.isNewTestMode || !editingTestId ? 'create' : 'edit'}
        saveWorkflowData={saveHook.isNewTestMode ? { nodes: [], edges: [] } : { nodes, edges }}
        saveTestId={saveHook.isNewTestMode ? undefined : editingTestId ?? undefined}
        saveInitialValues={saveInitialValues}
        showCloseConfirmDialog={closeHook.showCloseConfirmDialog}
        onCloseConfirmDialog={closeHook.handleCloseConfirmDialog}
        onSaveAndClose={closeHook.handleSaveAndClose}
        onDiscardAndClose={closeHook.handleDiscardAndClose}
        onDiscardAndStay={closeHook.handleDiscardAndStay}
        isSaving={saveHook.isSaving}
        isDirty={isDirty}
        executionActive={executionActive}
        sessionArtifactCount={sessionArtifactWarnCount}
        uploadCount={testDataActivity.uploads}
        showResetConfirmDialog={showResetConfirm}
        onCancelResetConfirm={() => setShowResetConfirm(false)}
        onConfirmReset={resetWorkbenchRun}
        showEditModeNag={closeHook.showEditModeNag}
        onCloseEditModeNag={closeHook.handleCloseEditModeNag}
        showFunctionViewLeaveNotice={functionViewLeave.noticeOpen}
        onAcknowledgeFunctionViewLeave={functionViewLeave.acknowledge}
        onCancelFunctionViewLeave={functionViewLeave.cancel}
        showSwitchTestDialog={closeHook.showSwitchTestDialog}
        switchEntityKind={switchEntity.entityKind}
        currentTestName={switchEntity.currentName}
        onViewPendingWorkflow={closeHook.handleViewPendingWorkflow}
        onSaveAndSwitch={closeHook.handleSwitchTestSave}
        onDiscardAndSwitch={closeHook.handleSwitchTestDiscard}
        isRunning={workbenchIsRunning}
        pendingDeleteVarId={varMgmt.pendingDeleteVarId}
        pendingDeleteVarName={varMgmt.pendingDeleteVarName}
        pendingDeleteDescription={varMgmt.pendingDeleteDescription}
        onCloseDeleteVar={varMgmt.cancelPendingDelete}
        onConfirmDeleteVar={varMgmt.confirmVariableDelete}
        editingTestId={editingTestId}
        editingTestName={editingTestName}
        showEditMetadataDialog={saveHook.showEditMetadataDialog}
        onCloseEditMetadata={saveHook.handleCloseEditMetadataDialog}
        onSaveMetadata={saveHook.handleEditMetadataSave}
        showValidationErrorDialog={validationHook.showValidationErrorDialog}
        validationFatal={validationHook.validationFatal}
        validationErrors={validationHook.validationErrors}
        validationMode={validationHook.validationMode}
        isFixingTest={validationHook.isFixingTest}
        onValidationClose={validationHook.handleValidationClose}
        onNavigateToIssue={validationHook.navigateToIssue}
        /* v8 ignore next 2 - COV-BRANCH-175 */
        onFixAll={validationHook.canFixAll ? validationHook.handleFixAll : undefined}
        onDeleteFatalTest={validationHook.validationFatal ? validationHook.handleDeleteFatalTest : undefined}
        deletedTestInfo={deletedTestInfo}
        onDismissDeletedTest={handleDismissDeletedTest}
      />
      <SessionArtifactsSheet
        open={artifactsSheetOpen}
        onClose={() => setArtifactsSheetOpen(false)}
        items={sessionArtifacts.items}
        count={sessionArtifacts.count}
        totalBytes={sessionArtifacts.totalBytes}
        pollError={sessionArtifacts.pollError}
        isTracked={isTracked}
        running={workbenchIsRunning}
        onRefresh={() => { sessionArtifacts.refresh().catch(alreadyReported) }}
        onDownload={handleDownloadArtifact}
        onDelete={handleDeleteArtifact}
      />
      <TestDataSheet
        open={testDataOpen}
        onClose={() => setTestDataOpen(false)}
        testId={editingTestId}
        readOnly={isMirroring}
      />
      <StopConfirmationDialog
        open={runHook.showStopConfirmDialog}
        mode={runHook.pendingStopMode}
        onCancel={runHook.handleStopConfirmCancel}
        onConfirm={(mode) => { runHook.handleStopConfirm(mode).catch(alreadyReported) }}
      />
      <CurrentEditRunConflictDialog
        isOpen={conflictGuard.isOpen}
        entries={conflictGuard.entries}
        isSaving={conflictGuard.isSaving}
        onCancel={conflictGuard.onCancel}
        onDrop={conflictGuard.onDrop}
        onSave={conflictGuard.onSave}
      />
      <TakeOverWaitingDialog
        open={ownership.isRequestingTakeover}
        holderLabel={ownership.holderLabel ?? ''}
        holderKind={ownership.holderKind ?? 'person'}
        onCancel={ownership.cancelRequest}
        onForce={ownership.forceTakeOver}
      />
      <TakeOverApprovalDialog
        open={ownership.pendingTakeover !== null}
        onHandOver={ownership.approve}
        onDeny={ownership.deny}
      />
      <TakeOverResultDialog
        open={ownership.takeoverResult !== null}
        outcome={ownership.takeoverResult ?? 'denied'}
        onClose={ownership.dismissTakeoverResult}
      />
    </div>
    </WorkbenchRunSharedContext.Provider>
  )
}
