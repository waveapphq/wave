/**
 * TypeChangeConfirmDialog - the one warning a type change asks before it clears a value:
 * a variable's in the variable window, a map entry's or a list item's in the list and map editors.
 */

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import type { VariableType } from '@/lib/variable-types'

/** What changes type, as the title names it. */
export type TypeChangeSubject = 'variable' | 'entry' | 'item'

export interface TypeChangeConfirmDialogProps {
  open: boolean
  subject: TypeChangeSubject
  prevType: VariableType
  nextType: VariableType
  currentLength: number
  onConfirm: () => void
  onCancel: () => void
}

const COMPLEX_TYPES = new Set<VariableType>(['array', 'map', 'table'])

function entryUnit(prevType: VariableType, count: number): string {
  // Collections clear "entry" / "entries"; scalars clear a single "value".
  if (COMPLEX_TYPES.has(prevType)) {
    return count === 1 ? 'entry' : 'entries'
  }
  return 'value'
}

/** What a change clears from a literal value: "3 existing array entries", "1 existing integer value". */
export function clearedValueText(prevType: VariableType, count: number): string {
  return `${count} existing ${prevType} ${entryUnit(prevType, count)}`
}

export function TypeChangeConfirmDialog({
  open,
  subject,
  prevType,
  nextType,
  currentLength,
  onConfirm,
  onCancel,
}: Readonly<TypeChangeConfirmDialogProps>) {
  const description = `Changing type to ${nextType} will clear ${clearedValueText(prevType, currentLength)}. This cannot be undone.`

  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      variant="overwrite"
      title={`Change ${subject} type?`}
      description={description}
      confirmLabel="Change type"
      cancelLabel="Cancel"
    />
  )
}
