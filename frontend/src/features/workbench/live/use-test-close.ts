/**
 * Test Close Hook - Close, discard, and switch test dialog handlers
 *
 * Handles Close button click, Save-and-Close (existing test direct save),
 * Discard-and-Close, and Switch Test dialog (save-and-switch, discard-and-switch,
 * view pending workflow).
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import { usePageBlock } from '@/hooks/use-page-block'
import { runBlockingRead } from '@/hooks/use-blocking-reads'
import type {
  ValidationError,
  ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import { handleSaveError, sanitizeEdgesForSave, sanitizeNodesForSave } from './save-utils'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

const SAVED_TEST_LABEL = 'saved test'

export interface TestCloseResult {
  // Dialog state
  showCloseConfirmDialog: boolean
  setShowCloseConfirmDialog: (show: boolean) => void
  showSwitchTestDialog: boolean
  setShowSwitchTestDialog: (show: boolean) => void
  // Edit-mode close nag (OK-only)
  showEditModeNag: boolean
  setShowEditModeNag: (show: boolean) => void

  // Handlers
  handleClose: () => void
  handleSaveAndClose: () => Promise<void>
  handleDiscardAndClose: () => void
  /** Revert to the saved state and keep the test open. */
  handleDiscardAndStay: () => Promise<void>
  /** Dismiss the OK-only edit-mode nag. */
  handleCloseEditModeNag: () => void
  handleCloseConfirmDialog: () => void
  handleSwitchTestSave: () => Promise<void>
  handleSwitchTestDiscard: () => void
  handleViewPendingWorkflow: () => void
}

export interface UseTestCloseParams {
  executionActive: boolean
  /** Fired right before a close actually resets the canvas (not on cancel). */
  onCanvasClosed?: () => void
  pendingEditTestId: string | null
  setPendingEditTestId: (id: string | null) => void
  loadTest: (testId: string) => Promise<void>
  clearDraft: () => void
  resetWorkbenchRun: () => void
  setIsDirectSaving: (saving: boolean) => void
  saveAndCloseModeRef: React.RefObject<boolean>
  setShowSaveDialog: (show: boolean) => void
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
  /** Close for the library View, which owns its draft-drop notice. */
  closeFunctionView: () => void
}

export function useTestClose(params: UseTestCloseParams): TestCloseResult {
  const {
    executionActive,
    onCanvasClosed,
    pendingEditTestId,
    setPendingEditTestId,
    loadTest,
    clearDraft,
    resetWorkbenchRun,
    setIsDirectSaving,
    saveAndCloseModeRef,
    setShowSaveDialog,
    setValidationErrors,
    setValidationFatal,
    setValidationMode,
    setShowValidationErrorDialog,
    closeFunctionView,
  } = params
  const navigate = useNavigate()

  const isDirty = useWorkflowStore((state) => state.isDirty)
  const hasDirtySheets = useWorkflowStore((state) => state.dirtyConfigNodeIds.length > 0)
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const reset = useWorkflowStore((state) => state.reset)
  const markSaved = useWorkflowStore((state) => state.markSaved)
  const setPulseValidationNodeIds = useWorkflowStore((state) => state.setPulseValidationNodeIds)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const editingTestId = useWorkflowStore((state) => state.editingTestId)
  const editingTestName = useWorkflowStore((state) => state.editingTestName)
  const clearEditingTest = useWorkflowStore((state) => state.clearEditingTest)
  const functionViewMode = useWorkflowStore((state) => state.functionViewMode)
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const hasEditModeNodes = useWorkflowStore((state) => state.hasEditModeNodes)
  const { blockPage, clearPageBlock } = usePageBlock()
  const { error: toastError } = useToast()

  const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false)
  const [showSwitchTestDialog, setShowSwitchTestDialog] = useState(false)
  // OK-only nag shown before a close proceeds when a Function is still in
  // edit mode (non-blocking - the close continues on OK).
  const [showEditModeNag, setShowEditModeNag] = useState(false)

  // Final canvas reset for a close - after the nag is acknowledged, or directly
  // when no Function is in edit mode. The draft is cleared by the caller.
  const finalizeCloseReset = useCallback(
    function finalizeCloseReset() {
      onCanvasClosed?.()
      reset()
      clearEditingTest()
      requestFitView({ padding: 0.2, duration: 0 })
    },
    [onCanvasClosed, reset, clearEditingTest, requestFitView]
  )

  // Handle Close button click
  /* v8 ignore start - COV-CONTAINER-002 */
  const handleClose = useCallback(
    function handleCloseClick() {
      if (functionViewMode) {
        closeFunctionView()
        return
      }
      // Dirty / running / dirty config sheets: the confirm dialog
      // decides first; the nag (if any) fires from the chosen close action
      // so it is skipped on Discard.
      if (isDirty || executionActive || hasDirtySheets) {
        setShowCloseConfirmDialog(true)
        return
      }
      // Clean close: drop the draft, then nag (canvas still visible) if a
      // Function is left in edit mode; the reset finalizes on OK.
      clearDraft()
      if (hasEditModeNodes()) {
        setShowEditModeNag(true)
        return
      }
      finalizeCloseReset()
    },
    [functionViewMode, closeFunctionView, isDirty, executionActive, hasDirtySheets, clearDraft, hasEditModeNodes, finalizeCloseReset]
  )
  /* v8 ignore stop */

  // Shared direct-save path used by both Save-and-Close and Save-and-Switch.
  // If there is no editing test (untitled draft), routes to the save dialog
  // instead. After a successful save the helper either loads the pending
  // test (if one was queued) or invokes the caller-supplied `onAfterSave`.
  // Both callers report a failure the same way: the validation dialog when the
  // server named the offending elements, a toast otherwise.
  const performDirectSaveOrShowDialog = useCallback(
    async function performDirectSave(
      onAfterSaveWithoutPending: (() => void) | null,
    ): Promise<void> {
      if (!editingTestId || !editingTestName) {
        saveAndCloseModeRef.current = true
        setShowSaveDialog(true)
        return
      }
      setIsDirectSaving(true)
      try {
        const { updateTest } = await import('@/features/tests/api/crud')
        const workflow = { nodes: sanitizeNodesForSave(nodes), edges: sanitizeEdgesForSave(edges) }
        await updateTest(editingTestId, {
          name: editingTestName,
          workflow,
        })
        markSaved()
        setPulseValidationNodeIds([])
        clearDraft()
        resetWorkbenchRun()

        if (pendingEditTestId) {
          const testIdToLoad = pendingEditTestId
          setPendingEditTestId(null)
          loadTest(testIdToLoad).catch(alreadyReported)
        } else if (onAfterSaveWithoutPending) {
          /* v8 ignore next 2 - COV-CONTAINER-013 */
          onAfterSaveWithoutPending()
        }
      } catch (err: unknown) {
        handleSaveError(err, { error: toastError }, {
          setValidationErrors,
          setValidationFatal,
          setValidationMode,
          setShowValidationErrorDialog,
        })
      } finally {
        setIsDirectSaving(false)
      }
    },
    [editingTestId, editingTestName, nodes, edges, markSaved, clearDraft, resetWorkbenchRun, pendingEditTestId, loadTest, setPulseValidationNodeIds, setIsDirectSaving, saveAndCloseModeRef, setShowSaveDialog, setPendingEditTestId, toastError, setValidationErrors, setValidationFatal, setValidationMode, setShowValidationErrorDialog]
  )

  // Handle "Save and Close" from close confirm dialog
  const handleSaveAndClose = useCallback(
    async function saveAndClose() {
      setShowCloseConfirmDialog(false)
      // Captured before the save resets the canvas: a saved edit-mode
      // Function persists, so nag before the reset; otherwise reset now.
      const hadEditMode = hasEditModeNodes()
      await performDirectSaveOrShowDialog(() => {
        if (hadEditMode) {
          setShowEditModeNag(true)
        } else {
          finalizeCloseReset()
        }
      })
    },
    [performDirectSaveOrShowDialog, hasEditModeNodes, finalizeCloseReset]
  )

  // Handle "Discard and Close"
  /* v8 ignore start - COV-CONTAINER-002 */
  const handleDiscardAndClose = useCallback(
    function discardAndClose() {
      setShowCloseConfirmDialog(false)
      onCanvasClosed?.()
      clearDraft()
      reset()
      resetWorkbenchRun()
      clearEditingTest()

      if (pendingEditTestId) {
        const testIdToLoad = pendingEditTestId
        setPendingEditTestId(null)
        loadTest(testIdToLoad).catch(alreadyReported)
      } else {
        requestFitView({ padding: 0.2, duration: 0 })
      }
    },
    [onCanvasClosed, clearDraft, reset, resetWorkbenchRun, pendingEditTestId, loadTest, clearEditingTest, requestFitView, setPendingEditTestId]
  )
  /* v8 ignore stop */

  // "Discard and Stay" - revert the canvas to the saved state and keep the
  // test open (no close, no editing-test clear).
  const handleDiscardAndStay = useCallback(
    async function discardAndStay() {
      setShowCloseConfirmDialog(false)
      if (!editingTestId) return
      // Blocked means inert, so edits the user believes are gone cannot be saved.
      await runBlockingRead(
        {
          label: SAVED_TEST_LABEL,
          run: async () => {
            const { fetchTestWorkflow } = await import('@/features/tests/api/crud')
            const workflow = await fetchTestWorkflow(editingTestId)
            setNodes(canvasLocalFunctionBodies(workflow.nodes) as unknown as Parameters<typeof setNodes>[0])
            setEdges(workflow.edges as unknown as Parameters<typeof setEdges>[0])
            markSaved()
            clearPageBlock(SAVED_TEST_LABEL)
          },
        },
        blockPage,
      ).catch(() => {})
    },
    [editingTestId, setNodes, setEdges, markSaved, blockPage, clearPageBlock]
  )

  // Close confirm dialog (Cancel)
  const handleCloseConfirmDialog = useCallback(function closeConfirmDialog() {
    setShowCloseConfirmDialog(false)
    setPendingEditTestId(null)
  }, [setPendingEditTestId])

  // Acknowledge the OK-only edit-mode nag, then finalize the close.
  const handleCloseEditModeNag = useCallback(() => {
    setShowEditModeNag(false)
    finalizeCloseReset()
  }, [finalizeCloseReset])

  // Switch Test Dialog handlers
  /* v8 ignore start - COV-CONTAINER-002 */
  // No test waiting: a View named in the URL then boots over this blank canvas.
  const leaveForBlankCanvas = useCallback(
    function leaveForBlankCanvas() {
      reset()
      requestFitView({ padding: 0.2, duration: 0 })
    },
    [reset, requestFitView]
  )

  const handleSwitchTestSave = useCallback(
    async function saveAndSwitch() {
      setShowSwitchTestDialog(false)
      await performDirectSaveOrShowDialog(leaveForBlankCanvas)
    },
    [performDirectSaveOrShowDialog, leaveForBlankCanvas]
  )

  const handleSwitchTestDiscard = useCallback(
    function discardAndSwitch() {
      setShowSwitchTestDialog(false)
      clearDraft()
      reset()
      resetWorkbenchRun()

      if (pendingEditTestId) {
        const testIdToLoad = pendingEditTestId
        setPendingEditTestId(null)
        loadTest(testIdToLoad).catch(alreadyReported)
      } else {
        requestFitView({ padding: 0.2, duration: 0 })
      }
    },
    [clearDraft, reset, resetWorkbenchRun, pendingEditTestId, loadTest, setPendingEditTestId, requestFitView]
  )
  /* v8 ignore stop */

  /* v8 ignore start - COV-CONTAINER-002 */
  const handleViewPendingWorkflow = useCallback(
    function viewPendingWorkflow() {
      setShowSwitchTestDialog(false)
      setPendingEditTestId(null)
      // Restore the open entity's URL. A Function View keeps its ?viewFunction
      // param (the read-only guards depend on it); a Test returns to /workbench.
      if (functionViewMode) {
        navigate(`/workbench?viewFunction=${functionViewMode.functionId}&version=${functionViewMode.version}`)
      } else {
        navigate('/workbench')
      }
    },
    [navigate, setPendingEditTestId, functionViewMode]
  )
  /* v8 ignore stop */

  return {
    showCloseConfirmDialog,
    setShowCloseConfirmDialog,
    showSwitchTestDialog,
    setShowSwitchTestDialog,
    showEditModeNag,
    setShowEditModeNag,
    handleClose,
    handleSaveAndClose,
    handleDiscardAndClose,
    handleDiscardAndStay,
    handleCloseEditModeNag,
    handleCloseConfirmDialog,
    handleSwitchTestSave,
    handleSwitchTestDiscard,
    handleViewPendingWorkflow,
  }
}
