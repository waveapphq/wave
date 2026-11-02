/**
 * RestoreOverwriteDialog - Confirms a restore that overwrites entities already in this WAVE (BACKUP-8).
 */

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

export interface RestoreOverwriteDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function RestoreOverwriteDialog({
  open,
  onConfirm,
  onCancel,
}: Readonly<RestoreOverwriteDialogProps>) {
  return (
    <ConfirmationDialog
      data-testid="restore-overwrite-dialog"
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      variant="overwrite"
      title="Overwrite conflicting entities?"
      description="The ones in this WAVE get the backup's content. This cannot be undone."
    />
  )
}
