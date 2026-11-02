/**
 * Test Save Hook - Save handlers and metadata editing
 *
 * Handles direct save for existing tests, save dialog for drafts,
 * and metadata-only edits. Owns save-related state (isSaving, isDirectSaving,
 * isNewTestMode, saveAndCloseModeRef).
 */

import { useState, useCallback, useRef } from 'react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import type { TestFormPayload } from '@/features/workbench/common/test-form'
import type {
  ValidationError,
  ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import { buildVariablesPayload, handleSaveError, resyncSealedNodeSecrets, sanitizeEdgesForSave, sanitizeNodesForSave } from './save-utils'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

export interface TestSaveResult {
  // Dialog state
  showSaveDialog: boolean
  setShowSaveDialog: (show: boolean) => void
  showEditMetadataDialog: boolean
  isSaving: boolean
  isDirectSaving: boolean
  setIsDirectSaving: (saving: boolean) => void
  isNewTestMode: boolean
  setIsNewTestMode: (mode: boolean) => void

  // Save handlers
  handleSaveClick: () => Promise<void>
  handleSave: (payload: TestFormPayload) => Promise<void>
  handleCloseSaveDialog: () => void
  handleEditClick: () => void
  handleCloseEditMetadataDialog: () => void
  handleEditMetadataSave: (payload: TestFormPayload) => Promise<void>

  // Ref for save-and-close mode (shared with close hook)
  saveAndCloseModeRef: React.RefObject<boolean>
}

export interface UseTestSaveParams {
  pendingEditTestId: string | null
  setPendingEditTestId: (id: string | null) => void
  loadTest: (testId: string) => Promise<void>
  clearDraft: () => void
  resetWorkbenchRun: () => void
  setValidationErrors: (errors: ValidationError[]) => void
  setValidationFatal: (fatal: boolean) => void
  setValidationMode: (mode: ValidationDialogMode) => void
  setShowValidationErrorDialog: (show: boolean) => void
}

export function useTestSave(params: UseTestSaveParams): TestSaveResult {
  const {
    pendingEditTestId,
    setPendingEditTestId,
    loadTest,
    clearDraft,
    resetWorkbenchRun,
    setValidationErrors,
    setValidationFatal,
    setValidationMode,
    setShowValidationErrorDialog,
  } = params
  const toast = useToast()

  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const setNodeTree = useWorkflowStore((state) => state.setNodeTree)
  const reset = useWorkflowStore((state) => state.reset)
  const markSaved = useWorkflowStore((state) => state.markSaved)
  const setPulseValidationNodeIds = useWorkflowStore((state) => state.setPulseValidationNodeIds)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const editingTestId = useWorkflowStore((state) => state.editingTestId)
  const editingTestName = useWorkflowStore((state) => state.editingTestName)
  const setEditingTest = useWorkflowStore((state) => state.setEditingTest)
  const clearEditingTest = useWorkflowStore((state) => state.clearEditingTest)
  const workflowVariables = useWorkflowStore((state) => state.variables)

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showEditMetadataDialog, setShowEditMetadataDialog] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirectSaving, setIsDirectSaving] = useState(false)
  const [isNewTestMode, setIsNewTestMode] = useState(false)
  const saveAndCloseModeRef = useRef(false)

  // Handle Save button click
  /* v8 ignore start - COV-CONTAINER-002 */
  const handleSaveClick = useCallback(
    async function handleSave() {
      if (editingTestId) {
        setIsDirectSaving(true)
        // Undo/redo refuse while the save request is pending.
        useWorkflowStore.getState().setSaveInFlight(true)
        try {
          const { updateTest } = await import('@/features/tests/api/crud')
          const workflow = { nodes: sanitizeNodesForSave(nodes), edges: sanitizeEdgesForSave(edges) }
          const variablesForBackend = buildVariablesPayload(workflowVariables)
          await updateTest(editingTestId, {
            name: editingTestName ?? 'Untitled',
            workflow,
            variables: variablesForBackend,
          })
          // Reflect the just-sealed credential values before marking the saved
          // baseline, so credential fields mask write-only without a reload.
          await resyncSealedNodeSecrets(editingTestId, useWorkflowStore.getState().nodes, setNodeTree)
          markSaved()
          setPulseValidationNodeIds([])
          clearDraft()
        } catch (err: unknown) {
          handleSaveError(err, toast, {
            setValidationErrors,
            setValidationFatal,
            setValidationMode,
            setShowValidationErrorDialog,
          })
        } finally {
          setIsDirectSaving(false)
          useWorkflowStore.getState().setSaveInFlight(false)
        }
      } else {
        setShowSaveDialog(true)
      }
    },
    [editingTestId, editingTestName, nodes, edges, setNodeTree, workflowVariables, markSaved, clearDraft, toast, setPulseValidationNodeIds, setValidationErrors, setValidationFatal, setValidationMode, setShowValidationErrorDialog]
  )
  /* v8 ignore stop */

  // Handle Save from dialog
  /* v8 ignore start - COV-CONTAINER-002 */
  const handleSave = useCallback(
    async function saveTest(payload: TestFormPayload) {
      setIsSaving(true)
      // Undo/redo refuse while the save request is pending.
      useWorkflowStore.getState().setSaveInFlight(true)
      try {
        const { createTest, updateTest } = await import('@/features/tests/api/crud')
        const workflow = {
          nodes: sanitizeNodesForSave(payload.workflowData!.nodes),
          edges: sanitizeEdgesForSave(payload.workflowData!.edges),
        }
        const variablesForBackend = buildVariablesPayload(workflowVariables)

        let createdTestId: string | null = null
        if (payload.testId) {
          await updateTest(payload.testId, {
            name: payload.name,
            description: payload.description || undefined,
            tags: payload.tags,
            workflow,
            variables: variablesForBackend,
          })
        } else {
          const createdTest = await createTest({
            name: payload.name,
            description: payload.description || undefined,
            tags: payload.tags,
            workflow,
            variables: variablesForBackend,
          })
          createdTestId = createdTest.id
        }

        if (createdTestId) {
          setEditingTest(createdTestId, payload.name)
        }

        // Reflect the just-sealed credential values before the saved baseline.
        const savedTestId = payload.testId ?? createdTestId
        if (savedTestId) {
          await resyncSealedNodeSecrets(savedTestId, useWorkflowStore.getState().nodes, setNodeTree)
        }

        markSaved()
        setPulseValidationNodeIds([])
        clearDraft()
        setShowSaveDialog(false)
        setIsNewTestMode(false)

        if (saveAndCloseModeRef.current) {
          saveAndCloseModeRef.current = false
          resetWorkbenchRun()

          if (pendingEditTestId) {
            const testIdToLoad = pendingEditTestId
            setPendingEditTestId(null)
            loadTest(testIdToLoad).catch(alreadyReported)
          } else {
            clearEditingTest()
            reset()
            requestFitView({ padding: 0.2, duration: 0 })
          }
        }
      } finally {
        setIsSaving(false)
        useWorkflowStore.getState().setSaveInFlight(false)
      }
    },
    [clearDraft, reset, resetWorkbenchRun, markSaved, pendingEditTestId, loadTest, clearEditingTest, setEditingTest, setNodeTree, workflowVariables, requestFitView, setPulseValidationNodeIds]
  )
  /* v8 ignore stop */

  // Close save dialog (Cancel)
  /* v8 ignore start - COV-CONTAINER-002 */
  const handleCloseSaveDialog = useCallback(function closeSaveDialog() {
    setShowSaveDialog(false)
    saveAndCloseModeRef.current = false
    setIsNewTestMode(false)
    setPendingEditTestId(null)
  }, [setPendingEditTestId])
  /* v8 ignore stop */

  // Handle Edit button click
  const handleEditClick = useCallback(function openEditMetadataDialog() {
    setShowEditMetadataDialog(true)
  }, [])

  // Close edit metadata dialog
  const handleCloseEditMetadataDialog = useCallback(function closeEditMetadataDialog() {
    setShowEditMetadataDialog(false)
  }, [])

  // Handle save from edit metadata dialog
  const handleEditMetadataSave = useCallback(
    async function saveMetadata(payload: TestFormPayload) {
      const { updateTestMetadata } = await import('@/features/tests/api/crud')
      await updateTestMetadata(payload.testId!, {
        name: payload.name,
        description: payload.description || undefined,
        tags: payload.tags,
      })
      setEditingTest(payload.testId!, payload.name)
    },
    [setEditingTest]
  )

  return {
    showSaveDialog,
    setShowSaveDialog,
    showEditMetadataDialog,
    isSaving,
    isDirectSaving,
    setIsDirectSaving,
    isNewTestMode,
    setIsNewTestMode,
    handleSaveClick,
    handleSave,
    handleCloseSaveDialog,
    handleEditClick,
    handleCloseEditMetadataDialog,
    handleEditMetadataSave,
    saveAndCloseModeRef,
  }
}
