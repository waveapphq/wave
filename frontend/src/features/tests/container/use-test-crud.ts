/**
 * Test CRUD Actions Hook - create/open, edit, delete, duplicate,
 * move-to-suite for individual and bulk test actions.
 */

import type React from 'react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Test } from '@/features/tests/api/types'
import type { TestFormPayload } from '@/features/workbench/common/test-form'
import {
  deleteTest,
  cloneTest,
  batchDeleteTests,
  updateTestMetadata,
} from '@/features/tests/api/crud'
import { addTestToSuite, removeTestFromSuite } from '@/features/suites/api/crud'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { workbenchApi, type WorkbenchSessionResponse } from '@/features/workbench/api/workbench'
import { clearWorkbenchSession } from '@/features/workbench/lib/clear-session'
import { alreadyReported } from '@/features/workbench/lib/already-reported'
import { testdataApi } from '@/features/tests/api/testdata'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { bulkFailureMessage, type LandedSentence } from '@/lib/bulk-failure'
import { handleDeleteConflict } from '@/lib/delete-conflict-toast'

/** The session reads decide whether a gesture is safe; without them nothing starts. */
const SESSION_READ_FAILED = 'Could not read the workbench session'

const DUPLICATED: LandedSentence = (done, total) => `Duplicated ${done} of ${total} tests.`
const ADDED: LandedSentence = (done, total) => `Added ${done} of ${total} tests to the suite.`
const REMOVED: LandedSentence = (done, total) => `Removed ${done} of ${total} tests from the suite.`

interface TestCrudDeps {
  tests: Test[]
  selectedIds: string[]
  clearSelection: () => void
  setSelectionModeActive: React.Dispatch<React.SetStateAction<boolean>>
  loadData: () => Promise<void>
  setSwitchTestDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** Records whether a terminal execution session was the trigger for the
   *  switch dialog so the dialog can render the "Active Execution State"
   *  variant instead of the default "Unsaved Changes" variant. */
  setSwitchTestExecutionActive: React.Dispatch<React.SetStateAction<boolean>>
  setPendingOpenTestId: React.Dispatch<React.SetStateAction<string | null>>
  setNewTestDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRunningSession: React.Dispatch<React.SetStateAction<{ testName: string | null } | null>>
  /** Ephemeral-session artifact count feeding the switch dialog's loss callout. */
  setSessionArtifactCount: React.Dispatch<React.SetStateAction<number>>
  setUploadCount: React.Dispatch<React.SetStateAction<number>>
}

export function useTestCrud({
  tests,
  selectedIds,
  clearSelection,
  setSelectionModeActive,
  loadData,
  setSwitchTestDialogOpen,
  setSwitchTestExecutionActive,
  setPendingOpenTestId,
  setNewTestDialogOpen,
  setRunningSession,
  setSessionArtifactCount,
  setUploadCount,
}: TestCrudDeps) {
  const navigate = useNavigate()
  const toastCtx = useToast()

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [testToDelete, setTestToDelete] = useState<{ id: string; name: string } | null>(null)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [testToEdit, setTestToEdit] = useState<{ id: string; name: string } | null>(null)

  // Ephemeral sessions feed the dialog's artifact-loss callout; tracked
  // sessions never produce a positive count (their artifacts persist).
  const updateSwitchDialogArtifactCount = useCallback(
    async (session: WorkbenchSessionResponse | null) => {
      if (!session || session.execution_id || session.parent_execution_id) {
        setSessionArtifactCount(0)
        return
      }
      const { items } = await workbenchApi.listSessionArtifacts()
      setSessionArtifactCount(items.length)
    },
    [setSessionArtifactCount]
  )

  /** What the open test still has arriving, read when the dialog is about to show it. */
  const updateSwitchDialogUploadCount = useCallback(async () => {
    const { editingTestId } = useWorkflowStore.getState()
    if (editingTestId === null) {
      setUploadCount(0)
      return
    }
    const { uploads } = await testdataApi.uploadState(editingTestId)
    setUploadCount(uploads.length)
  }, [setUploadCount])

  const updateSwitchDialogCounts = useCallback(
    async (session: WorkbenchSessionResponse | null) => {
      await Promise.all([
        updateSwitchDialogArtifactCount(session),
        updateSwitchDialogUploadCount().catch(alreadyReported),
      ])
    },
    [updateSwitchDialogArtifactCount, updateSwitchDialogUploadCount]
  )

  const handleNewTest = useCallback((): void => {
    const startNewTest = async (): Promise<void> => {
      // Refuse to start a new test while a live execution is running -
      // resetting the workflow store and clearing the backend session would
      // silently kill the running test.
      const running = await workbenchApi.getRunningSession()
      if (running) {
        setRunningSession(running)
        return
      }

      const { isDirty, editingTestId, reset } = useWorkflowStore.getState()
      // Confirm when the workbench has unsaved work OR any session whose run
      // state (and ephemeral artifacts) the new test would silently wipe.
      const session = await workbenchApi.getCurrentSession()
      if (isDirty || session) {
        setSwitchTestExecutionActive(!!session)
        await updateSwitchDialogCounts(session)
        setSwitchTestDialogOpen(true)
        return
      }
      if (editingTestId) {
        // The session clear comes first: while it is still there, a remount's
        // session recovery restores it and re-fires the unsaved-changes dialog,
        // so a new test must not be started on top of it.
        if (!(await clearWorkbenchSession(toastCtx.error))) return
        reset()
      }
      setNewTestDialogOpen(true)
    }

    startNewTest().catch((err: unknown) => {
      toastCtx.error(`${SESSION_READ_FAILED}: ${toFailureDetail(err).message}`, 'New Test Not Started')
    })
  }, [
    setSwitchTestDialogOpen,
    setSwitchTestExecutionActive,
    setNewTestDialogOpen,
    setRunningSession,
    updateSwitchDialogCounts,
    toastCtx,
  ])

  /* v8 ignore start - COV-BRANCH-151: V8 tracks multi-path if/return branches in callback */
  const openInWorkbench = useCallback(
    async (testId: string) => {
      const { isDirty, editingTestId } = useWorkflowStore.getState()
      if (testId === editingTestId) {
        navigate(`/workbench?editTest=${testId}`)
        return
      }

      const session = await workbenchApi.getCurrentSession()
      if (session && (session.status === 'running' || session.status === 'paused')) {
        setRunningSession({ testName: session.test_name ?? null })
        return
      }

      // Confirm switch when the workbench has unsaved work OR a terminal
      // execution session whose results would be discarded by the swap.
      // Without the session check the dialog still opens, but only after
      // the user has already navigated to /workbench - the workbench-side
      // ``?editTest=`` effect catches it on remount once session recovery
      // restores the terminal status.
      if (isDirty || session) {
        setPendingOpenTestId(testId)
        setSwitchTestExecutionActive(!!session)
        await updateSwitchDialogCounts(session)
        setSwitchTestDialogOpen(true)
        return
      }
      navigate(`/workbench?editTest=${testId}`)
    },
    [navigate, setSwitchTestDialogOpen, setSwitchTestExecutionActive, setPendingOpenTestId, setRunningSession, updateSwitchDialogCounts]
  )
  /* v8 ignore stop */

  const handleOpenInWorkbench = useCallback(
    (testId: string): void => {
      openInWorkbench(testId).catch((err: unknown) => {
        toastCtx.error(`${SESSION_READ_FAILED}: ${toFailureDetail(err).message}`, 'Test Not Opened')
      })
    },
    [openInWorkbench, toastCtx]
  )

  /* v8 ignore start - COV-V8-003: V8 tracks callback deps as branch */
  const handleEditTest = useCallback(
    (testId: string) => {
      const test = tests.find((t) => t.id === testId)
      setTestToEdit({ id: testId, name: test?.name ?? testId })
      setEditDialogOpen(true)
    },
    [tests]
  )
  /* v8 ignore stop */

  /* v8 ignore start - COV-CONTAINER-003 */
  const handleEditMetadataSave = useCallback(
    async (payload: TestFormPayload) => {
      await updateTestMetadata(payload.testId!, {
        name: payload.name,
        description: payload.description || undefined,
        tags: payload.tags,
      })
      const { editingTestId, setEditingTest } = useWorkflowStore.getState()
      if (payload.testId === editingTestId) {
        setEditingTest(payload.testId, payload.name)
      }
      await loadData()
      /* v8 ignore next - COV-CONTAINER-003: V8 tracks arrow function closing brace separately */
    },
    [loadData]
  )

  const handleCloseEditDialog = useCallback(() => {
    setEditDialogOpen(false)
    setTestToEdit(null)
  }, [])
  /* v8 ignore stop */

  /* v8 ignore start - COV-V8-003: V8 tracks callback deps as branch */
  const handleDeleteTest = useCallback(
    (testId: string) => {
      const test = tests.find((t) => t.id === testId)
      setTestToDelete({ id: testId, name: test?.name ?? testId })
      setDeleteDialogOpen(true)
    },
    [tests]
  )
  /* v8 ignore stop */

  const confirmDeleteTest = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-017 */
    if (!testToDelete) return
    const target = testToDelete
    const removeTest = async (): Promise<void> => {
      try {
        await deleteTest(target.id)
        /* v8 ignore start - COV-CONTAINER-003 */
        const { editingTestId, reset } = useWorkflowStore.getState()
        if (target.id === editingTestId) {
          reset()
        }
        /* v8 ignore stop */
      } finally {
        setDeleteDialogOpen(false)
        setTestToDelete(null)
      }
      await loadData()
    }
    removeTest().catch((err: unknown) => {
      const handled = handleDeleteConflict({
        error: err,
        entityType: 'test',
        toast: toastCtx,
        navigate,
      })
      if (!handled) {
        console.error('Failed to delete test:', err)
        toastCtx.error(toFailureDetail(err).message, 'Delete Failed')
      }
    })
  }, [testToDelete, loadData, toastCtx, navigate])

  const handleDuplicateTest = useCallback(
    (testId: string): void => {
      const duplicate = async (): Promise<void> => {
        await cloneTest(testId)
        await loadData()
      }
      duplicate().catch((err: unknown) => {
        console.error('Failed to duplicate test:', err)
        toastCtx.error(toFailureDetail(err).message, 'Duplicate Failed')
      })
    },
    [loadData, toastCtx]
  )

  const handleAddToSuite = useCallback(
    (testId: string, suiteId: string): void => {
      const add = async (): Promise<void> => {
        await addTestToSuite(suiteId, testId)
        await loadData()
      }
      add().catch((err: unknown) => {
        console.error('Failed to add test to suite:', err)
        toastCtx.error(toFailureDetail(err).message, 'Add to Suite Failed')
      })
    },
    [loadData, toastCtx]
  )

  const handleRemoveFromSuite = useCallback(
    (testId: string, suiteId: string): void => {
      const remove = async (): Promise<void> => {
        await removeTestFromSuite(suiteId, testId)
        await loadData()
      }
      remove().catch((err: unknown) => {
        console.error('Failed to remove test from suite:', err)
        toastCtx.error(toFailureDetail(err).message, 'Remove from Suite Failed')
      })
    },
    [loadData, toastCtx]
  )

  /* v8 ignore start - COV-V8-003: V8 tracks callback deps as branch */
  const handleBulkDelete = useCallback(() => {
    if (selectedIds.length === 0) return
    setBulkDeleteDialogOpen(true)
  }, [selectedIds])
  /* v8 ignore stop */

  const confirmBulkDelete = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-017 */
    if (selectedIds.length === 0) return
    const removeAll = async (): Promise<void> => {
      try {
        await batchDeleteTests(selectedIds)
        const { editingTestId, reset } = useWorkflowStore.getState()
        /* v8 ignore start - COV-CONTAINER-001 */
        if (editingTestId && selectedIds.includes(editingTestId)) {
          reset()
        }
        /* v8 ignore stop */
        clearSelection()
        setSelectionModeActive(false)
      } finally {
        setBulkDeleteDialogOpen(false)
      }
      await loadData()
    }
    removeAll().catch((err: unknown) => {
      console.error('Failed to bulk delete:', err)
      toastCtx.error(toFailureDetail(err).message, 'Delete Failed')
    })
  }, [selectedIds, loadData, clearSelection, setSelectionModeActive, toastCtx])

  const handleBulkRun = useCallback(() => {
    const ids = selectedIds.join(',')
    navigate(`/executions/new?tests=${ids}`)
  }, [selectedIds, navigate])

  // Every selected test is attempted, the list always reloads so what landed
  // is visible, and the selection survives a failure.
  const handleBulkDuplicate = useCallback((): void => {
    /* v8 ignore next - COV-BRANCH-017 */
    if (selectedIds.length === 0) return
    Promise.allSettled(selectedIds.map((testId) => cloneTest(testId)))
      .then((results) => {
        const message = bulkFailureMessage(results, DUPLICATED)
        if (message !== null) throw new Error(message)
        clearSelection()
        setSelectionModeActive(false)
      })
      .finally(loadData)
      .catch((err: unknown) => {
        toastCtx.error((err as Error).message, 'Duplicate Failed')
      })
  }, [selectedIds, loadData, clearSelection, setSelectionModeActive, toastCtx])

  const handleBulkAddToSuite = useCallback(
    (suiteId: string): void => {
      if (selectedIds.length === 0) return
      Promise.allSettled(selectedIds.map((id) => addTestToSuite(suiteId, id)))
        .then((results) => {
          const message = bulkFailureMessage(results, ADDED)
          if (message !== null) throw new Error(message)
          clearSelection()
          setSelectionModeActive(false)
        })
        .finally(loadData)
        .catch((err: unknown) => {
          toastCtx.error((err as Error).message, 'Add to Suite Failed')
        })
    },
    [selectedIds, loadData, clearSelection, setSelectionModeActive, toastCtx]
  )

  const handleBulkRemoveFromSuite = useCallback(
    (suiteId: string): void => {
      if (selectedIds.length === 0) return
      Promise.allSettled(selectedIds.map((id) => removeTestFromSuite(suiteId, id)))
        .then((results) => {
          const message = bulkFailureMessage(results, REMOVED)
          if (message !== null) throw new Error(message)
          clearSelection()
          setSelectionModeActive(false)
        })
        .finally(loadData)
        .catch((err: unknown) => {
          toastCtx.error((err as Error).message, 'Remove from Suite Failed')
        })
    },
    [selectedIds, loadData, clearSelection, setSelectionModeActive, toastCtx]
  )

  return {
    // New/Open
    handleNewTest,
    handleOpenInWorkbench,
    // Edit
    handleEditTest,
    handleEditMetadataSave,
    handleCloseEditDialog,
    editDialogOpen,
    testToEdit,
    // Delete
    handleDeleteTest,
    confirmDeleteTest,
    deleteDialogOpen,
    setDeleteDialogOpen,
    testToDelete,
    setTestToDelete,
    // Duplicate
    handleDuplicateTest,
    // Suite membership
    handleAddToSuite,
    handleRemoveFromSuite,
    // Bulk
    handleBulkDelete,
    confirmBulkDelete,
    bulkDeleteDialogOpen,
    setBulkDeleteDialogOpen,
    handleBulkRun,
    handleBulkDuplicate,
    handleBulkAddToSuite,
    handleBulkRemoveFromSuite,
  }
}
