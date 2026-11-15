/**
 * TypeChangeConfirmDialog - the one warning a type change asks before it clears a value:
 * a variable's in the variable window, a map entry's or a list item's in the list and map editors,
 * and, worded for the operator, a condition row's compare value when a new operator takes none.
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
  /** An operator change clears the value: the new operator as its list shows it. */
  operator?: string
  onConfirm: () => void
  onCancel: () => void
}

const COMPLEX_TYPES = new Set<VariableType>(['array', 'map', 'table'])

function entryUnit(prevType: VariableType, count: number): string {
  // Collections clear "entry" / "entries"; scalars clear one "value", or several "entries".
  if (COMPLEX_TYPES.has(prevType)) {
    return count === 1 ? 'entry' : 'entries'
  }
  return count > 1 ? 'entries' : 'value'
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
  operator,
  onConfirm,
  onCancel,
}: Readonly<TypeChangeConfirmDialogProps>) {
  const cleared = clearedValueText(prevType, currentLength)
  const wording =
    operator === undefined
      ? { title: `Change ${subject} type?`, change: `type to ${nextType}`, confirm: 'Change type' }
      : { title: 'Change operator?', change: `operator to ${operator}`, confirm: 'Change operator' }

  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      variant="overwrite"
      title={wording.title}
      description={`Changing ${wording.change} will clear ${cleared}. This cannot be undone.`}
      confirmLabel={wording.confirm}
      cancelLabel="Cancel"
    />
  )
}
