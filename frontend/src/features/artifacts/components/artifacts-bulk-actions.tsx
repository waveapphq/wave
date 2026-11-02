/**
 * Mass actions for the selected executions: Download (.zip) + Delete artifacts.
 * The destructive delete is gated behind the shared type-to-confirm dialog.
 */

import { useState } from 'react'
import { Download, Trash } from 'lucide-react'
import { BulkActionsDropdown } from '@/components/shared/actions/bulk-actions-dropdown'
import { DropdownItem, DropdownDivider } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { formatBytes } from '@/lib/format-bytes'

const CONFIRM_PHRASE = 'delete'

export interface ArtifactsBulkActionsProps {
  selectedCount: number
  totalCount: number
  selectedSizeBytes: number
  selectionModeActive: boolean
  onDownloadZip: () => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
}

export function ArtifactsBulkActions({
  selectedCount,
  totalCount,
  selectedSizeBytes,
  selectionModeActive,
  onDownloadZip,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
}: Readonly<ArtifactsBulkActionsProps>) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <BulkActionsDropdown
      selectedCount={selectedCount}
      selectionModeActive={selectionModeActive}
      selectionLabel={`${selectedCount} of ${totalCount} · ${formatBytes(selectedSizeBytes)}`}
      onEnterSelectionMode={onEnterSelectionMode}
      onExitSelectionMode={onExitSelectionMode}
      extraContent={
        <ConfirmationDialog
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={onDelete}
          variant="delete"
          requireConfirmation={CONFIRM_PHRASE}
          title="Delete artifacts of the selected executions?"
          description="This soft-deletes every artifact of the selected executions. Removed artifacts stay as an audit record and cannot be restored."
          confirmLabel="Delete artifacts"
        />
      }
    >
      <DropdownItem onSelect={onDownloadZip} data-testid="artifact-bulk-download">
        <Icon icon={Download} size="sm" className="mr-2" />
        Download (.zip)
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem
        onSelect={() => setConfirmOpen(true)}
        data-testid="artifact-bulk-delete"
        className="text-error"
      >
        <Icon icon={Trash} size="sm" className="mr-2" />
        Delete artifacts
      </DropdownItem>
    </BulkActionsDropdown>
  )
}
