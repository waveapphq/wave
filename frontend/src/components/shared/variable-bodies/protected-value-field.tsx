/**
 * ProtectedValueField - the masked stored-secret control with its own
 * "Edit Protected Value?" confirm, and useProtectedValueConfirm - the same
 * confirm for a host that opens it from a control of its own.
 *
 * REQ-3.1.3.5: Secret variable masking
 */

import { useState, type ReactNode } from 'react'

import { EditProtectedValueDialog } from '@/components/shared/dialogs/edit-protected-value-dialog'
import {
  MaskedSecretControl,
  type MaskedSecretControlProps,
} from '@/components/shared/variable-bodies/value-field'

export interface ProtectedValueConfirm {
  /** Asks the confirm; "Delete & Edit" then runs `onCleared` once. */
  open: (onCleared: () => void) => void
  /** The confirm, rendered once by the host. */
  dialog: ReactNode
}

export function useProtectedValueConfirm(): ProtectedValueConfirm {
  // Boxed, because setState would call a bare function as an updater.
  const [pending, setPending] = useState<{ onCleared: () => void } | null>(null)
  const close = () => setPending(null)
  return {
    open: (onCleared) => setPending({ onCleared }),
    dialog: (
      <EditProtectedValueDialog
        open={pending !== null}
        onCancel={close}
        onConfirm={() => {
          close()
          pending?.onCleared()
        }}
      />
    ),
  }
}

export interface ProtectedValueFieldProps extends Omit<MaskedSecretControlProps, 'onClick'> {
  /** Runs once after "Delete & Edit"; the host then shows its empty editor. */
  onCleared: () => void
}

export function ProtectedValueField({
  onCleared,
  ...control
}: Readonly<ProtectedValueFieldProps>) {
  const confirm = useProtectedValueConfirm()
  return (
    <>
      <MaskedSecretControl {...control} onClick={() => confirm.open(onCleared)} />
      {confirm.dialog}
    </>
  )
}
