/**
 * Profiles List Container
 *
 * REQ-4.7.4: Profile management UI
 * REQ-4.7.10: Environment-specific configurations
 *
 * Thin shell container that composes hooks for data fetching,
 * CRUD actions, table UI, and export/import functionality.
 */

import { type ReactNode } from 'react'
import { ProfilesPage } from '@/features/profiles/page'
import { ProfileFormModal } from '@/features/profiles/components/profile-form-modal'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog } from '@/components/shared/dialogs/import-dialog'
import { validateProfileImport, importProfiles } from '@/features/profiles/api/import-export'
import { apiEnvsToModalEnvs } from './transforms'
import { useProfilesData } from './use-profiles-data'
import { useProfilesActions } from './use-profiles-actions'
import { useProfilesTable } from './use-profiles-table'
import { useExportImport } from './use-export-import'

/**
 * Profiles page container with data fetching and state management
 */
export function ProfilesListContainer(): ReactNode {
  // Table UI state (filters, sorting, pagination, columns, selection)
  const table = useProfilesTable()

  // Data fetching (depends on table's filter/sort/pagination state)
  const data = useProfilesData(
    table.pageInfo,
    table.setPageInfo,
    table.filters,
    table.sortColumn,
    table.sortDirection
  )

  // CRUD actions (modal, delete dialog, duplicate)
  const actions = useProfilesActions(
    data.profiles,
    data.environments,
    data.environmentsFailed,
    data.loadData,
    data.setError
  )

  // Export/Import
  const exportImport = useExportImport(
    data.profiles,
    table.selectedIds,
    data.environmentsFailed,
    data.loadData,
    table.handleExitSelectionMode
  )

  // Transform environments for modal
  const modalEnvironments = apiEnvsToModalEnvs(data.environments)

  return (
    <>
      <ProfilesPage
        profiles={data.profiles}
        profileTypes={data.profileTypes}
        allTags={data.allTags}
        pageInfo={table.pageInfo}
        filters={table.filters}
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
        onNewProfile={actions.handleNewProfile}
        onEditProfile={actions.handleEditProfile}
        onDeleteProfile={actions.handleDeleteProfile}
        onDuplicateProfile={actions.handleDuplicateProfile}
        onFilterChange={table.handleFilterChange}
        onPageChange={table.handlePageChange}
        onPageSizeChange={table.handlePageSizeChange}
        onColumnToggle={table.handleColumnToggle}
        onRetry={data.loadData}
        onExportProfile={exportImport.handleExportProfile}
        onImport={exportImport.handleImportOpen}
        onBulkExport={exportImport.handleBulkExport}
        onBulkDuplicate={exportImport.handleBulkDuplicate}
        onBulkDelete={exportImport.handleBulkDelete}
        onEnterSelectionMode={table.handleEnterSelectionMode}
        onExitSelectionMode={table.handleExitSelectionMode}
      />
      <ProfileFormModal
        open={actions.modalOpen}
        mode={actions.modalMode}
        profile={actions.editingProfile}
        profileTypes={data.profileTypes}
        environments={modalEnvironments}
        allTags={data.allTags}
        loading={actions.modalLoading}
        error={actions.modalError}
        onClose={actions.handleModalClose}
        onSubmit={actions.handleModalSubmit}
        onDelete={actions.handleDeleteProfile}
        onFetchTypeSchema={actions.handleFetchTypeSchema}
      />
      <ConfirmationDialog
        isOpen={actions.deleteDialogOpen}
        variant="delete"
        itemName={actions.profileToDelete?.name}
        description="This action cannot be undone. The profile and its configuration will be permanently removed."
        isLoading={actions.deleteLoading}
        onClose={actions.handleCloseDeleteDialog}
        onConfirm={actions.handleConfirmDelete}
      />

      {/* Export Dialog */}
      <ExportDialog
        open={exportImport.exportDialogOpen}
        onOpenChange={exportImport.setExportDialogOpen}
        entityIds={exportImport.exportProfileIds}
        entityNames={exportImport.exportProfileNames}
        entityLabel="Profile"
        hasSecrets={true}
        onExport={exportImport.handleExportAction}
        loading={exportImport.exportLoading}
      />

      {/* Import Dialog */}
      <ImportDialog
        open={exportImport.importDialogOpen}
        onOpenChange={exportImport.setImportDialogOpen}
        entityLabel="Profile"
        onValidate={validateProfileImport}
        onImport={importProfiles}
        onImportComplete={exportImport.handleImportComplete}
      />
    </>
  )
}
