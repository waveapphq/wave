/**
 * Holder-side approval modal (SESS-5..8), on ConfirmationDialog. The wrapper
 * exists so a Hand over click never also fires the deny path (the underlying
 * dialog calls onConfirm then onClose on confirm).
 */

import { useRef } from 'react'

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

export interface TakeOverApprovalDialogProps {
  open: boolean
  onHandOver: () => void
  onDeny: () => void
}

export function TakeOverApprovalDialog({
  open,
  onHandOver,
  onDeny,
}: Readonly<TakeOverApprovalDialogProps>) {
  const confirmedRef = useRef(false)

  const handleConfirm = () => {
    confirmedRef.current = true
    onHandOver()
  }

  const handleClose = () => {
    if (confirmedRef.current) {
      confirmedRef.current = false
      return
    }
    onDeny()
  }

  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={handleClose}
      onConfirm={handleConfirm}
      variant="move"
      title="Another session wants to take over"
      description="Another session takes over editing this draft. You switch to watching, read-only."
      confirmLabel="Hand over"
      cancelLabel="Deny"
    />
  )
}
