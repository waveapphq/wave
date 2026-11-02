/**
 * Functions List Container.
 *
 * Composes the data / table / actions hooks and renders the Functions page
 * with its delete (single + bulk), export, and import dialog overlays.
 */

import { useCallback, type ReactNode } from 'react'
import { FunctionsPage } from '@/features/functions/page'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { FunctionImportDialog } from '@/features/functions/components/import-dialog'
import { useFunctionsTable } from './use-functions-table'
import { useFunctionsData } from './use-functions-data'
import { useFunctionsActions } from './use-functions-actions'

export function FunctionsListContainer(): ReactNode {
  const table = useFunctionsTable()
  const data = useFunctionsData(
    table.pageInfo,
    table.filters,
    table.sortColumn,
    table.sortDirection,
    table.setPageInfo,
  )
  const actions = useFunctionsActions({
    functions: data.functions,
    selectedIds: table.selectedIds,
    loadData: data.loadData,
    setError: data.setError,
    clearSelection: table.handleExitSelectionMode,
  })

  const handleRetry = useCallback(() => {
    data.loadData().catch(actions.reportFailure)
  }, [data.loadData, actions.reportFailure])

  return (
    <>
      <FunctionsPage
        functions={data.functions}
        pageInfo={table.pageInfo}
        filters={table.filters}
        allTags={data.allTags}
        loading={data.loading}
        settled={data.settled}
        error={data.error ?? undefined}
        sorting={table.sorting}
        onSortingChange={table.onSortingChange}
        columnVisibility={table.columnVisibility}
        onColumnVisibilityChange={table.onColumnVisibilityChange}
        visibleColumns={table.visibleColumns}
        enableSelection={table.selectionModeActive}
        rowSelection={table.rowSelection}
        onRowSelectionChange={table.onRowSelectionChange}
        selectedIds={table.selectedIds}
        onViewFunction={actions.handleViewFunction}
        onExportFunction={actions.handleExportFunction}
        onDeleteFunction={actions.handleDeleteFunction}
        onBulkDelete={actions.handleBulkDelete}
        onBulkExport={actions.handleBulkExport}
        onImport={actions.handleImportOpen}
        onFilterChange={table.handleFilterChange}
        onPageChange={table.handlePageChange}
        onPageSizeChange={table.handlePageSizeChange}
        onColumnToggle={table.handleColumnToggle}
        onEnterSelectionMode={table.handleEnterSelectionMode}
        onExitSelectionMode={table.handleExitSelectionMode}
        onRetry={handleRetry}
      />

      <ConfirmationDialog
        isOpen={actions.deleteDialogOpen}
        onClose={() => {
          actions.setDeleteDialogOpen(false)
          actions.setFunctionToDelete(null)
        }}
        onConfirm={() => { actions.confirmDeleteFunction().catch(actions.reportFailure) }}
        variant="delete"
        itemName={actions.functionToDelete?.name}
        description="This action cannot be undone. The Function and all its versions will be permanently removed. A Test that references a removed version surfaces a missing-version alert on load."
      />

      <ConfirmationDialog
        isOpen={actions.bulkDeleteDialogOpen}
        onClose={() => actions.setBulkDeleteDialogOpen(false)}
        onConfirm={() => { actions.confirmBulkDelete().catch(actions.reportFailure) }}
        variant="delete-multiple"
        itemCount={table.selectedIds.length}
        itemNames={table.selectedIds
          .map((id) => data.functions.find((fn) => fn.id === id)?.name)
          .filter((name): name is string => Boolean(name))}
        description="This action cannot be undone. All selected Functions and their versions will be permanently removed."
      />

      <ExportDialog
        open={actions.exportDialogOpen}
        onOpenChange={actions.setExportDialogOpen}
        entityIds={actions.exportIds}
        entityNames={actions.exportNames}
        entityLabel="Function"
        hasSecrets
        onExport={(options) => { actions.handleExportAction(options).catch(actions.reportFailure) }}
        loading={actions.exportLoading}
      />

      <FunctionImportDialog
        open={actions.importDialogOpen}
        onOpenChange={actions.setImportDialogOpen}
        onImportComplete={actions.handleImportComplete}
      />
    </>
  )
}
