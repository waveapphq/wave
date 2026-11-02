/**
 * ExecutionsBulkActions Component
 *
 * Bulk action dropdown for selected executions (Export + Delete). Delete is
 * gated behind a confirmation warning that the removal also permanently
 * deletes the executions' artifacts and reports.
 */

import { useState } from 'react'
import { BulkActionsDropdown } from '@/components/shared/actions/bulk-actions-dropdown'
import { DropdownItem } from '@/components/ui/dropdown'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Icon } from '@/components/ui/icon'
import { Download, Trash } from 'lucide-react'

export interface ExecutionsBulkActionsProps {
  selectedCount: number
  totalCount: number
  selectionModeActive: boolean
  onExport: () => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
}

export function ExecutionsBulkActions({
  selectedCount,
  totalCount,
  selectionModeActive,
  onExport,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
}: Readonly<ExecutionsBulkActionsProps>) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isDisabled = selectedCount === 0
  const isAllSelected = selectedCount === totalCount && totalCount > 0

  const selectionLabel = isAllSelected
    ? `All ${selectedCount} selected`
    : `${selectedCount} selected`

  const noun = selectedCount === 1 ? 'execution' : 'executions'

  return (
    <BulkActionsDropdown
      selectedCount={selectedCount}
      selectionModeActive={selectionModeActive}
      selectionLabel={selectionLabel}
      onEnterSelectionMode={onEnterSelectionMode}
      onExitSelectionMode={onExitSelectionMode}
      extraContent={
        <ConfirmationDialog
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false)
            onDelete()
          }}
          variant="delete"
          title={`Delete ${selectedCount} ${noun}?`}
          description={`This permanently removes ${selectedCount} ${noun} and all of their artifacts and reports. This action cannot be undone.`}
          confirmLabel="Delete"
        />
      }
    >
      <DropdownItem
        disabled={isDisabled}
        onSelect={() => { if (!isDisabled) onExport() }}
        data-testid="bulk-action-export"
        className={isDisabled ? 'text-muted' : ''}
      >
        <Icon icon={Download} size="sm" className="mr-2" />
        Export
      </DropdownItem>
      <DropdownItem
        disabled={isDisabled}
        onSelect={() => { if (!isDisabled) setConfirmOpen(true) }}
        data-testid="bulk-action-delete"
        className={`text-error ${isDisabled ? 'opacity-50' : ''}`}
      >
        <Icon icon={Trash} size="sm" className="mr-2" />
        Delete
      </DropdownItem>
    </BulkActionsDropdown>
  )
}
