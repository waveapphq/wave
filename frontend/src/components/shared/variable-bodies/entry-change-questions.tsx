/**
 * The questions a list item or map entry asks before a type change, or a switch into or
 * out of {x}, clears what it holds: the shared type change warning and the Block field's
 * switch warning (FIELD-7). An entry that holds nothing changes at once.
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 * REQ-3.1.3.19: Declared element types
 */

import { useState } from 'react'

import { SwitchModeDialog, type SwitchModeDirection } from '@/components/shared/dialogs/switch-mode-dialog'
import {
  TypeChangeConfirmDialog,
  type TypeChangeSubject,
} from '@/components/shared/dialogs/type-change-confirm-dialog'
import {
  clearedCount,
  emptyExpressionText,
  expressionIsHeld,
  hasEmptyValue,
  plainValueIsHeld,
} from '@/lib/value-loss'
import type { ValueType } from '@/lib/variable-validation'

interface TypeAsk {
  prev: ValueType
  next: ValueType
  count: number
  apply: () => void
}

/** How a switch leaves the entry: cleared, or holding its type's empty value as the expression. */
export type SwitchClear = 'clear' | 'clear-empty'

interface SwitchAsk {
  direction: SwitchModeDirection
  offersEmpty: boolean
  apply: (clear: SwitchClear) => void
}

export interface EntryChange {
  /** Changes an entry's type, asking first when its value would be lost. */
  requestType: (prev: ValueType, next: ValueType, value: unknown, apply: () => void) => void
  /** Switches an entry into or out of {x}, asking first when its value would be lost. */
  requestSwitch: (pressed: boolean, type: ValueType, value: unknown, apply: (clear: SwitchClear) => void) => void
  typeAsk: TypeAsk | null
  switchAsk: SwitchAsk | null
  closeType: () => void
  closeSwitch: () => void
}

/** What an entry holds as it goes into {x}: nothing, or on Clear & Empty its type's empty value. */
export function expressionStart(type: ValueType, clear: SwitchClear): string {
  return clear === 'clear-empty' ? emptyExpressionText(type) : ''
}

/** The pending question of a list or map editor; `emptyEntry` is the host's own empty entry, when it has one. */
export function useEntryChange(emptyEntry?: () => unknown): EntryChange {
  const [typeAsk, setTypeAsk] = useState<TypeAsk | null>(null)
  const [switchAsk, setSwitchAsk] = useState<SwitchAsk | null>(null)

  const requestType: EntryChange['requestType'] = (prev, next, value, apply) => {
    if (plainValueIsHeld(value, prev, emptyEntry?.())) setTypeAsk({ prev, next, count: clearedCount(value, prev), apply })
    else apply()
  }

  const requestSwitch: EntryChange['requestSwitch'] = (pressed, type, value, apply) => {
    const held = pressed ? plainValueIsHeld(value, type, emptyEntry?.()) : expressionIsHeld(value)
    if (!held) {
      apply('clear')
      return
    }
    // Leaving {x} always clears to the type default, so only going in offers the empty value.
    setSwitchAsk({ direction: pressed ? 'to-expression' : 'to-plain', offersEmpty: pressed && hasEmptyValue(type), apply })
  }

  return {
    requestType,
    requestSwitch,
    typeAsk,
    switchAsk,
    closeType: () => setTypeAsk(null),
    closeSwitch: () => setSwitchAsk(null),
  }
}

/** The open question, if any: Cancel keeps the entry as it is. */
export function EntryChangeQuestions({ change, subject }: Readonly<{ change: EntryChange; subject: TypeChangeSubject }>) {
  const { typeAsk, switchAsk } = change
  return (
    <>
      {typeAsk && (
        <TypeChangeConfirmDialog
          open
          subject={subject}
          prevType={typeAsk.prev}
          nextType={typeAsk.next}
          currentLength={typeAsk.count}
          onConfirm={() => {
            change.closeType()
            typeAsk.apply()
          }}
          onCancel={change.closeType}
        />
      )}
      {switchAsk && (
        <SwitchModeDialog
          open
          direction={switchAsk.direction}
          hasDefault={false}
          offersEmpty={switchAsk.offersEmpty}
          onCancel={change.closeSwitch}
          onClearDefault={() => {
            change.closeSwitch()
            switchAsk.apply('clear')
          }}
          onClearEmpty={() => {
            change.closeSwitch()
            switchAsk.apply('clear-empty')
          }}
        />
      )}
    </>
  )
}
