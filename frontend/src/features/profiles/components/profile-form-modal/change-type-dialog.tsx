/**
 * ChangeTypeDialog - Confirms a profile type change that would discard entered parameters.
 */

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

export interface ChangeTypeDialogProps {
  open: boolean
  nextType: string
  onConfirm: () => void
  onCancel: () => void
}

export function ChangeTypeDialog({
  open,
  nextType,
  onConfirm,
  onCancel,
}: Readonly<ChangeTypeDialogProps>) {
  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      variant="overwrite"
      title="Change profile type?"
      description={`Switching to ${nextType} replaces the parameters below. Anything you entered will be lost.`}
      confirmLabel="Change type"
      cancelLabel="Cancel"
    />
  )
}
