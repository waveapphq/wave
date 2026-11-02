/**
 * Drop Changes confirmation for the edit-mode lifecycle.
 *
 * Wraps the shared ``ConfirmationDialog`` (variant="discard") so destructive
 * dialog policy (no ESC / no backdrop dismiss) is enforced consistently with
 * the rest of the canvas lifecycle dialogs.
 */

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'


export interface DropChangesDialogProps {
  isOpen: boolean
  functionName: string
  sourceVersion: string
  onClose: () => void
  onConfirm: () => void
  isLoading?: boolean
  error?: string
}


export function DropChangesDialog({
  isOpen,
  functionName,
  sourceVersion,
  onClose,
  onConfirm,
  isLoading,
  error,
}: Readonly<DropChangesDialogProps>) {
  const description = `Discard the unpublished draft on '${functionName}' and revert this instance to v${sourceVersion}. The library entry is unchanged.`

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Drop changes"
      description={description}
      confirmLabel="Drop changes"
      variant="discard"
      isLoading={isLoading}
      error={error}
    />
  )
}
