/**
 * Tests List Container
 *
 * Thin shell that composes data, table, CRUD, and dialog hooks
 * and renders the tests page with all dialog overlays.
 */

/* v8 ignore next - COV-V8-005 */
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { TestsPage as TestsPageComponent } from '@/features/tests/page'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { RunDialog } from '@/components/shared/dialogs/run-dialog'
import { TestFormDialog } from '@/features/workbench/common/test-form'
import { SwitchTestConfirmDialog } from '@/features/workbench/common/canvas/dialogs/switch-test-dialog'
import { deriveSwitchEntity } from '@/features/workbench/common/canvas/dialogs/switch-entity'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog } from '@/features/tests/components/import-dialog'
import { validateTestImport, importTests } from '@/features/tests/api/export-import'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useEnvironments } from '@/hooks/use-environments'
import { useFailureToast } from '@/hooks/use-failure-toast'
import { useTestsTable } from './use-tests-table'
import { useTestsData } from './use-tests-data'
import { useTestCrud } from './use-test-crud'
import { useTestDialogs } from './use-test-dialogs'

/**
 * Tests page with data fetching and state management
 */
export function TestsListContainer(): ReactNode {
  const navigate = useNavigate()

  // A void-typed prop cannot carry a rejection, so it is reported here instead.
  const { run } = useFailureToast('Something Went Wrong')

  // Switch-test dialog state lives here to break the circular dependency
  // between useTestCrud (needs setSwitchTestDialogOpen) and useTestDialogs
  // (needs tests/loadData from useTestsData)
  const [switchTestDialogOpen, setSwitchTestDialogOpen] = useState(false)
  // Whether the workbench has terminal execution state (passed/failed/etc.)
  // that the switch would discard. Captured at the moment we decide to open
  // the dialog so the dialog text reflects the actual reason.
  const [switchTestExecutionActive, setSwitchTestExecutionActive] = useState(false)
  // Ephemeral-session artifact count captured when the switch dialog opens
  // so it can render the artifact-loss callout (0 for tracked sessions).
  const [sessionArtifactCount, setSessionArtifactCount] = useState(0)
  // Files still arriving into the open test, captured when the switch dialog opens.
  const [uploadCount, setUploadCount] = useState(0)
  const [pendingOpenTestId, setPendingOpenTestId] = useState<string | null>(null)
  // New-test dialog state - lives here so both crud (handleNewTest opens it)
  // and dialogs (switch-test discard/save handlers open it after resetting
  // the workbench) can share it.
  const [newTestDialogOpen, setNewTestDialogOpen] = useState(false)
  // Running-session blocker dialog - shown when the user attempts to open
  // or create a test while a live execution is in progress in the
  // workbench. The user must stop the running test before proceeding.
  const [runningSession, setRunningSession] = useState<{ testName: string | null } | null>(null)

  // Subscribe so the dialog re-renders if the workbench dirty state shifts
  // while the dialog is open (e.g. a save fires through a side channel).
  const workbenchIsDirty = useWorkflowStore((state) => state.isDirty)
  // A dirty library Function (edit mode) is also "open" in the workbench - the
  // switch dialog must name it as a function, not a test.
  const functionViewMode = useWorkflowStore((state) => state.functionViewMode)

  // Reset executionActive when the dialog closes so the next opener starts
  // with a clean default (handleNewTest does not set it explicitly).
  useEffect(() => {
    if (!switchTestDialogOpen) setSwitchTestExecutionActive(false)
  }, [switchTestDialogOpen])

  // Table presentation: filters, pagination, sorting, columns, selection
  const table = useTestsTable()

  // Data fetching: tests, suites, tags, loading, error
  const data = useTestsData(
    table.pageInfo,
    table.filters,
    table.sortColumn,
    table.sortDirection,
    table.setPageInfo
  )

  // CRUD actions: create, edit, delete, duplicate, move, bulk ops
  const crud = useTestCrud({
    tests: data.tests,
    selectedIds: table.selectedIds,
    clearSelection: table.handleExitSelectionMode,
    setSelectionModeActive: table.setSelectionModeActive,
    loadData: data.loadData,
    setSwitchTestDialogOpen,
    setSwitchTestExecutionActive,
    setPendingOpenTestId,
    setNewTestDialogOpen,
    setRunningSession,
    setSessionArtifactCount,
    setUploadCount,
  })

  // The page owns the one environments read; the run dialog takes its list.
  const { environments } = useEnvironments(data.primary)

  // Dialog state: run, export/import, switch-test
  const dialogs = useTestDialogs({
    tests: data.tests,
    selectedIds: table.selectedIds,
    loadData: data.loadData,
    setError: data.setError,
    environments,
    setSwitchTestDialogOpen,
    pendingOpenTestId,
    setPendingOpenTestId,
    setNewTestDialogOpen,
  })

  // Name the currently-open entity for the switch-confirm dialog (Test vs Function).
  const switchEntity = deriveSwitchEntity(functionViewMode, dialogs.editingTestName)

  return (
    <>
    <TestsPageComponent
      tests={data.tests}
      pageInfo={table.pageInfo}
      filters={table.filters}
      suites={data.suites}
      allTags={data.allTags}
      loading={data.loading}
      settled={data.settled}
      error={data.error ?? undefined}
      // Sorting (TanStack native)
      sorting={table.sorting}
      onSortingChange={table.onSortingChange}
      // Column visibility (TanStack native)
      columnVisibility={table.columnVisibility}
      onColumnVisibilityChange={table.onColumnVisibilityChange}
      visibleColumns={table.visibleColumns}
      // Selection (TanStack native)
      enableSelection={table.selectionModeActive}
      rowSelection={table.rowSelection}
      onRowSelectionChange={table.onRowSelectionChange}
      selectedIds={table.selectedIds}
      // Actions
      onNewTest={crud.handleNewTest}
      onImport={dialogs.handleImportOpen}
      onEditTest={crud.handleEditTest}
      onExportTest={dialogs.handleExportTest}
      onOpenInWorkbench={crud.handleOpenInWorkbench}
      onDeleteTest={crud.handleDeleteTest}
      onDuplicateTest={crud.handleDuplicateTest}
      onRunTest={dialogs.handleRunTest}
      onAddToSuite={crud.handleAddToSuite}
      onRemoveFromSuite={crud.handleRemoveFromSuite}
      onBulkDelete={crud.handleBulkDelete}
      onBulkRun={crud.handleBulkRun}
      onBulkExport={dialogs.handleBulkExport}
      onBulkDuplicate={crud.handleBulkDuplicate}
      onBulkAddToSuite={crud.handleBulkAddToSuite}
      onBulkRemoveFromSuite={crud.handleBulkRemoveFromSuite}
      onFilterChange={table.handleFilterChange}
      onPageChange={table.handlePageChange}
      onPageSizeChange={table.handlePageSizeChange}
      onColumnToggle={table.handleColumnToggle}
      onEnterSelectionMode={table.handleEnterSelectionMode}
      onExitSelectionMode={table.handleExitSelectionMode}
      onRetry={run(data.loadData)}
    />

    {/* Single delete confirmation dialog */}
    <ConfirmationDialog
      isOpen={crud.deleteDialogOpen}
      onClose={() => {
        crud.setDeleteDialogOpen(false)
        crud.setTestToDelete(null)
      }}
      onConfirm={crud.confirmDeleteTest}
      variant="delete"
      itemName={crud.testToDelete?.name}
      description="This action cannot be undone. The test and all its associated data will be permanently removed."
    />

    {/* Bulk delete confirmation dialog */}
    <ConfirmationDialog
      isOpen={crud.bulkDeleteDialogOpen}
      onClose={() => crud.setBulkDeleteDialogOpen(false)}
      onConfirm={crud.confirmBulkDelete}
      variant="delete-multiple"
      itemCount={table.selectedIds.length}
      itemNames={table.selectedIds
        .map((id) => data.tests.find((t) => t.id === id)?.name)
        .filter((name): name is string => Boolean(name))}
      description="This action cannot be undone. All selected tests and their associated data will be permanently removed."
    />

    {/* Run dialog */}
    <RunDialog
      open={dialogs.testRunDialogOpen}
      onOpenChange={dialogs.setTestRunDialogOpen}
      entityType="test"
      entityName={dialogs.testToRun?.name ?? ''}
      entityId={dialogs.testToRun?.id ?? ''}
      environments={dialogs.testEnvironments}
      recentEnvironments={dialogs.testRecentEnvironments}
      selectedEnvironmentId={dialogs.testSelectedEnvironmentId}
      onEnvironmentSelect={dialogs.handleTestEnvironmentSelect}
      onRun={run(dialogs.handleTestRunDialogRun)}
      onCancel={dialogs.handleTestRunDialogCancel}
    />

    {/* Edit Test Info dialog */}
    {crud.testToEdit && (
      <TestFormDialog
        isOpen={crud.editDialogOpen}
        onClose={crud.handleCloseEditDialog}
        onSave={crud.handleEditMetadataSave}
        mode="edit-metadata"
        testId={crud.testToEdit.id}
        initialValues={{ name: crud.testToEdit.name }}
      />
    )}

    {/* New Test dialog - opens directly on Tests List so the user never
        sees the previously edited test's canvas during creation. */}
    <TestFormDialog
      isOpen={newTestDialogOpen}
      onClose={dialogs.handleCloseNewTestDialog}
      onSave={dialogs.handleCreateNewTest}
      mode="create"
      workflowData={{ nodes: [], edges: [] }}
    />

    {/* Switch Test Confirmation Dialog */}
    {/* v8 ignore next - COV-BRANCH-196 */}
    <SwitchTestConfirmDialog
      isOpen={switchTestDialogOpen}
      entityKind={switchEntity.entityKind}
      currentTestName={switchEntity.currentName}
      onViewPendingWorkflow={dialogs.handleViewPendingWorkflow}
      onSaveAndSwitch={run(dialogs.handleSaveAndCreateNew)}
      onDiscardAndSwitch={run(dialogs.handleDiscardAndCreateNew)}
      isSaving={dialogs.isSavingBeforeNewTest}
      isDirty={workbenchIsDirty}
      executionActive={switchTestExecutionActive}
      sessionArtifactCount={sessionArtifactCount}
      uploadCount={uploadCount}
      /* v8 ignore next - COV-BRANCH-177 */
      mode={pendingOpenTestId ? 'switch' : 'create'}
    />

    {/* Running-session blocker dialog - shown when the user attempts to
        open or create a test while a live execution is running. */}
    <SwitchTestConfirmDialog
      isOpen={runningSession !== null}
      isRunning
      sessionArtifactCount={sessionArtifactCount}
      uploadCount={uploadCount}
      currentTestName={runningSession?.testName ?? null}
      onCancel={() => setRunningSession(null)}
      onViewPendingWorkflow={() => {
        setRunningSession(null)
        navigate('/workbench')
      }}
      /* v8 ignore next - COV-BRANCH-177 */
      mode={pendingOpenTestId ? 'switch' : 'create'}
    />

    {/* Export Dialog */}
    <ExportDialog
      open={dialogs.exportDialogOpen}
      onOpenChange={dialogs.setExportDialogOpen}
      entityIds={dialogs.exportTestIds}
      entityNames={dialogs.exportTestNames}
      entityLabel="test"
      onExport={run(dialogs.handleExportAction)}
      loading={dialogs.exportLoading}
    />

    {/* Import Dialog */}
    <ImportDialog
      open={dialogs.importDialogOpen}
      onOpenChange={dialogs.setImportDialogOpen}
      onValidate={validateTestImport}
      onImport={importTests}
      onImportComplete={dialogs.handleImportComplete}
    />
    </>
  )
}
