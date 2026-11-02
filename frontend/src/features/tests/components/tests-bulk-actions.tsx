/**
 * TestsBulkActions Component
 *
 * Bulk action dropdown for selected tests.
 * - BULK-1: Selection button 118px, dropdown 155px
 * - BULK-3: Actions grouped with separator before Delete (red)
 * - BULK-4: 0 selected = disabled items, menu still opens
 */

import { FolderPlus, FolderMinus } from 'lucide-react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { BulkActionsDropdown, BulkActionMenuItems } from '@/components/shared/actions/bulk-actions-dropdown'
import { SuitePickerPopover } from './suite-picker-popover'
import { useSuiteConfirmState } from './use-suite-confirm-state'

export interface Suite {
  id: string
  name: string
}

export interface TestsBulkActionsProps {
  selectedCount: number
  totalCount: number
  selectionModeActive: boolean
  /** Suite IDs from all selected tests (union) - used to filter Remove picker */
  selectedTestSuiteIds?: string[]
  onRun: () => void
  onExport: () => void
  onDuplicate: () => void
  onAddToSuite: (suiteId: string) => void
  onRemoveFromSuite: (suiteId: string) => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  suites: Suite[]
}

export function TestsBulkActions({
  selectedCount,
  totalCount,
  selectionModeActive,
  selectedTestSuiteIds = [],
  onRun,
  onExport,
  onDuplicate,
  onAddToSuite,
  onRemoveFromSuite,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  suites,
}: Readonly<TestsBulkActionsProps>) {
  const isDisabled = selectedCount === 0
  const isAllSelected = selectedCount === totalCount && totalCount > 0

  // For Remove from Suite, only show suites that at least one selected test belongs to
  const removableSuites = suites.filter(s => selectedTestSuiteIds.includes(s.id))

  const selectionLabel = isAllSelected
    ? `All ${selectedCount} selected`
    : `${selectedCount} selected`

  const confirm = useSuiteConfirmState(suites)

  const handleAddConfirm = () => {
    if (confirm.pendingSuiteId) {
      onAddToSuite(confirm.pendingSuiteId)
    }
    confirm.resetPending()
  }

  const handleRemoveConfirm = () => {
    if (confirm.pendingSuiteId) {
      onRemoveFromSuite(confirm.pendingSuiteId)
    }
    confirm.resetPending()
  }

  return (
    <BulkActionsDropdown
      selectedCount={selectedCount}
      selectionModeActive={selectionModeActive}
      selectionLabel={selectionLabel}
      onEnterSelectionMode={onEnterSelectionMode}
      onExitSelectionMode={onExitSelectionMode}
      extraContent={
        <>
          <ConfirmationDialog
            isOpen={confirm.addConfirmOpen}
            onClose={confirm.handleAddCancel}
            onConfirm={handleAddConfirm}
            variant="move"
            title={`Add ${selectedCount} test${selectedCount === 1 ? '' : 's'} to "${confirm.pendingSuiteName}"?`}
            description={selectedCount === 1
              ? "This test will be added to the selected suite."
              : "These tests will be added to the selected suite."
            }
            confirmLabel="Add"
          />
          <ConfirmationDialog
            isOpen={confirm.removeConfirmOpen}
            onClose={confirm.handleRemoveCancel}
            onConfirm={handleRemoveConfirm}
            variant="move"
            title={`Remove ${selectedCount} test${selectedCount === 1 ? '' : 's'} from "${confirm.pendingSuiteName}"?`}
            description={selectedCount === 1
              ? "This test will be removed from the selected suite."
              : "These tests will be removed from the selected suite."
            }
            confirmLabel="Remove"
          />
        </>
      }
    >
      <BulkActionMenuItems
        isDisabled={isDisabled}
        onRun={onRun}
        onExport={onExport}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        extraItems={
          <>
            <SuitePickerPopover
              label="Add to Suite"
              icon={FolderPlus}
              testId="bulk-action-add-to-suite"
              disabled={isDisabled}
              suites={suites}
              onSelect={confirm.handleAddSelect}
            />
            <SuitePickerPopover
              label="Remove from Suite"
              icon={FolderMinus}
              testId="bulk-action-remove-from-suite"
              disabled={isDisabled || removableSuites.length === 0}
              suites={removableSuites}
              onSelect={confirm.handleRemoveSelect}
            />
          </>
        }
      />
    </BulkActionsDropdown>
  )
}
