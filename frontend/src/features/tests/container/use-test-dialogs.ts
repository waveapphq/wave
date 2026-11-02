/**
 * Test Dialogs Hook
 *
 * Manages run dialog, export/import dialogs, and switch-test dialog
 * state and handlers.
 */

import type React from 'react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Test, ImportResult } from '@/features/tests/api/types'
import type { TestFormPayload } from '@/features/workbench/common/test-form'
import { createTest } from '@/features/tests/api/crud'
import { exportTest, exportTests } from '@/features/tests/api/export-import'
import { downloadBlob } from '@/lib/download-blob'
import { startExecution } from '@/features/executions/api/executions'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { clearWorkbenchSession } from '@/features/workbench/lib/clear-session'
import { useToast } from '@/components/ui/toast'
import type { ExportSecretsMode } from '@/types/import-export'

interface TestDialogsDeps {
  tests: Test[]
  selectedIds: string[]
  loadData: () => Promise<void>
  setError: (error: string | null) => void
  /** The surface's gated environments list; the dialog runs no environments read of its own. */
  environments: Array<{ id: string; name: string }>
  // Switch-test dialog state owned by container to break circular dependency
  setSwitchTestDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  pendingOpenTestId: string | null
  setPendingOpenTestId: React.Dispatch<React.SetStateAction<string | null>>
  setNewTestDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useTestDialogs({
  tests,
  selectedIds,
  loadData,
  setError,
  environments,
  setSwitchTestDialogOpen,
  pendingOpenTestId,
  setPendingOpenTestId,
  setNewTestDialogOpen,
}: TestDialogsDeps) {
  const navigate = useNavigate()
  const { error: toastError } = useToast()

  // Get current editing test name from store (for switch test dialog)
  const editingTestName = useWorkflowStore((state) => state.editingTestName)

  // --- Run dialog state ---
  const [testRunDialogOpen, setTestRunDialogOpen] = useState(false)
  const [testToRun, setTestToRun] = useState<{ id: string; name: string } | null>(null)
  const [testSelectedEnvironmentId, setTestSelectedEnvironmentId] = useState<string | null>(null)
  const [testRecentEnvironments, setTestRecentEnvironments] = useState<{ id: string; name: string }[]>([])

  // --- Export/Import dialog state ---
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportTestIds, setExportTestIds] = useState<string[]>([])
  const [exportTestNames, setExportTestNames] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // --- Switch test dialog state (switchTestDialogOpen/pendingOpenTestId from container) ---
  const [isSavingBeforeNewTest, setIsSavingBeforeNewTest] = useState(false)

  // --- Run handlers ---

  /* v8 ignore start - COV-V8-003: V8 tracks callback deps as branch */
  const handleRunTest = useCallback((testId: string) => {
    const test = tests.find((t) => t.id === testId)
    setTestToRun({ id: testId, name: test?.name ?? testId })
    setTestSelectedEnvironmentId(null)
    setTestRunDialogOpen(true)
  }, [tests])
  /* v8 ignore stop */

  const handleTestRunDialogRun = useCallback(async () => {
    /* v8 ignore next - COV-BRANCH-026 */
    if (!testToRun || !testSelectedEnvironmentId) return
    try {
      await startExecution({
        type: 'test',
        id: testToRun.id,
        environmentId: testSelectedEnvironmentId,
      })
      setTestRunDialogOpen(false)
      setTestToRun(null)
      setTestSelectedEnvironmentId(null)
      // Test runs stream live on the Workbench canvas. On terminal the
      // workbench redirects to the Historical Test Canvas.
      navigate('/workbench')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start execution')
    }
  }, [testToRun, testSelectedEnvironmentId, navigate, setError])

  const handleTestRunDialogCancel = useCallback(() => {
    setTestRunDialogOpen(false)
    setTestToRun(null)
    setTestSelectedEnvironmentId(null)
  }, [])

  const handleTestEnvironmentSelect = useCallback((envId: string | null) => {
    setTestSelectedEnvironmentId(envId)
    if (envId) {
      const envData = environments.find(e => e.id === envId)
      if (envData) {
        setTestRecentEnvironments(prev => {
          const filtered = prev.filter(e => e.id !== envId)
          return [{ id: envData.id, name: envData.name }, ...filtered].slice(0, 3)
        })
      }
    }
  }, [environments])

  // --- Export handlers ---

  /* v8 ignore start - COV-BRANCH-152: V8 tracks optional chaining + nullish coalescing as branches */
  const handleExportTest = useCallback((testId: string) => {
    const test = tests.find((t) => t.id === testId)
    setExportTestIds([testId])
    setExportTestNames([test?.name ?? testId])
    setExportDialogOpen(true)
  }, [tests])
  /* v8 ignore stop */

  const handleBulkExport = useCallback(() => {
    /* v8 ignore next - COV-BRANCH-173 */
    if (selectedIds.length === 0) return
    const names = selectedIds
      .map((id) => tests.find((t) => t.id === id)?.name)
      .filter((n): n is string => Boolean(n))
    setExportTestIds(selectedIds)
    setExportTestNames(names)
    setExportDialogOpen(true)
  }, [selectedIds, tests])

  /* v8 ignore start - COV-CONTAINER-003 */
  const handleExportAction = useCallback(async (options: { format: 'yaml' | 'json'; secrets: ExportSecretsMode }) => {
    setExportLoading(true)
    try {
      if (exportTestIds.length === 1) {
        const { blob, filename } = await exportTest(exportTestIds[0], {
          ...options,
          name: exportTestNames[0],
        })
        downloadBlob(blob, filename)
      } else {
        downloadBlob(await exportTests(exportTestIds, options), 'tests-export.zip')
      }
      setExportDialogOpen(false)
    } catch (err) {
      console.error('Export failed:', err)
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExportLoading(false)
    }
  }, [exportTestIds, exportTestNames, setError])
  /* v8 ignore stop */

  // --- Import handlers ---

  /* v8 ignore next 3 - COV-BRANCH-153: V8 tracks useCallback deps as branch */
  const handleImportOpen = useCallback(() => {
    setImportDialogOpen(true)
  }, [])

  /* v8 ignore start - COV-CONTAINER-003 */
  const handleImportComplete = useCallback((result: ImportResult) => {
    // The dialog has already closed, so a failed reload reports on the list itself.
    loadData().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not reload the tests')
    })
    const { editingTestId, reset: resetWorkflow } = useWorkflowStore.getState()
    if (editingTestId) {
      const overwritten = result.imported.some(
        (t) => t.action === 'overwritten' && t.id === editingTestId
      )
      if (overwritten) {
        resetWorkflow()
      }
    }
  }, [loadData, setError])
  /* v8 ignore stop */

  // --- Switch test dialog handlers ---

  /* v8 ignore start - COV-CONTAINER-003 */
  const handleViewPendingWorkflow = useCallback(() => {
    setSwitchTestDialogOpen(false)
    setPendingOpenTestId(null)
    // Return to whatever is open: a Function View keeps its ?viewFunction param
    // (the read-only guards depend on it); a Test returns to /workbench.
    const fvm = useWorkflowStore.getState().functionViewMode
    if (fvm) {
      navigate(`/workbench?viewFunction=${fvm.functionId}&version=${fvm.version}`)
    } else {
      navigate('/workbench')
    }
  }, [navigate, setSwitchTestDialogOpen, setPendingOpenTestId])
  /* v8 ignore stop */

  const handleSaveAndCreateNew = useCallback(async () => {
    setIsSavingBeforeNewTest(true)
    try {
      const { editingTestId, editingTestName: storeName, nodes, edges, markSaved, reset } = useWorkflowStore.getState()
      const { updateTest } = await import('@/features/tests/api/crud')

      if (editingTestId && storeName) {
        await updateTest(editingTestId, {
          name: storeName,
          workflow: { nodes, edges },
        })
        markSaved()
      }

      // The session clear comes first (see handleDiscardAndCreateNew): the save
      // is done, but the switch stops here while the old session is still there.
      if (!(await clearWorkbenchSession(toastError))) return

      const targetTestId = pendingOpenTestId
      setPendingOpenTestId(null)
      reset()
      setSwitchTestDialogOpen(false)

      if (targetTestId) {
        navigate(`/workbench?editTest=${targetTestId}`)
      } else {
        setNewTestDialogOpen(true)
      }
    } catch (err) {
      console.error('Failed to save before creating new test:', err)
      setError(err instanceof Error ? err.message : 'Failed to save test')
    } finally {
      setIsSavingBeforeNewTest(false)
    }
  }, [navigate, pendingOpenTestId, setPendingOpenTestId, setSwitchTestDialogOpen, setNewTestDialogOpen, setError, toastError])

  const handleDiscardAndCreateNew = useCallback(async () => {
    // The session clear comes first: while it is still there, the Workbench
    // remount's session recovery restores it and re-fires the dialog, so the
    // discard neither drops the canvas nor moves on.
    if (!(await clearWorkbenchSession(toastError))) return

    const targetTestId = pendingOpenTestId
    setPendingOpenTestId(null)

    const { reset } = useWorkflowStore.getState()
    reset()
    setSwitchTestDialogOpen(false)

    /* v8 ignore next 5 - COV-BRANCH-154: V8 tracks if/else navigate branches */
    if (targetTestId) {
      navigate(`/workbench?editTest=${targetTestId}`)
    } else {
      setNewTestDialogOpen(true)
    }
  }, [navigate, pendingOpenTestId, setPendingOpenTestId, setSwitchTestDialogOpen, setNewTestDialogOpen, toastError])

  const handleCreateNewTest = useCallback(
    async (payload: TestFormPayload) => {
      const created = await createTest({
        name: payload.name,
        description: payload.description || undefined,
        tags: payload.tags,
        workflow: { nodes: [], edges: [] },
      })
      setNewTestDialogOpen(false)
      navigate(`/workbench?editTest=${created.id}`)
    },
    [navigate, setNewTestDialogOpen]
  )

  const handleCloseNewTestDialog = useCallback(() => {
    setNewTestDialogOpen(false)
  }, [setNewTestDialogOpen])

  return {
    // Run dialog
    handleRunTest,
    handleTestRunDialogRun,
    handleTestRunDialogCancel,
    handleTestEnvironmentSelect,
    testRunDialogOpen,
    setTestRunDialogOpen,
    testToRun,
    testSelectedEnvironmentId,
    testEnvironments: environments,
    testRecentEnvironments,
    // Export
    handleExportTest,
    handleBulkExport,
    handleExportAction,
    exportDialogOpen,
    setExportDialogOpen,
    exportTestIds,
    exportTestNames,
    exportLoading,
    // Import
    handleImportOpen,
    handleImportComplete,
    importDialogOpen,
    setImportDialogOpen,
    // New test
    handleCreateNewTest,
    handleCloseNewTestDialog,
    // Switch test
    editingTestName,
    isSavingBeforeNewTest,
    handleViewPendingWorkflow,
    handleSaveAndCreateNew,
    handleDiscardAndCreateNew,
  }
}
