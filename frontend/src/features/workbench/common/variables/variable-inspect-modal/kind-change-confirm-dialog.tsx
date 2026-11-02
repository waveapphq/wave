import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import type { VariableType } from '@/lib/variable-types'
import { clearedValueText } from '@/components/shared/dialogs/type-change-confirm-dialog'
import type { VariableCreateKind } from './use-inspect-create'

export interface KindChangeConfirmDialogProps {
  open: boolean
  prevKind: VariableCreateKind
  nextKind: VariableCreateKind
  type: VariableType
  currentLength: number
  onConfirm: () => void
  onCancel: () => void
}

export function KindChangeConfirmDialog({
  open,
  prevKind,
  nextKind,
  type,
  currentLength,
  onConfirm,
  onCancel,
}: Readonly<KindChangeConfirmDialogProps>) {
  const cleared = prevKind === 'literal' ? clearedValueText(type, currentLength) : `the existing ${prevKind}`
  const description = `Changing kind to ${nextKind} will clear ${cleared}. This cannot be undone.`

  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      variant="overwrite"
      title="Change variable kind?"
      description={description}
      confirmLabel="Change kind"
      cancelLabel="Cancel"
    />
  )
}
