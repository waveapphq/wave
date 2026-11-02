/**
 * The floating sheets one field opens - its Edit value sheet and its file picker - open one at a time.
 */

import { useRef, useState } from 'react'

import {
  useChildEditorRegistry,
  type ChildEditorRegistry,
} from '@/components/shared/child-editors/child-editor-scope'
import type { UnsavedChangesDialogProps } from '@/components/shared/child-editors/unsaved-changes-dialog'
import {
  openOrRefocus,
  refocusHandle,
  type SheetHandle,
  type SheetOpener,
} from '@/components/shared/draggable-sheet'
import { saveBlockedNote } from '@/lib/child-editors'

type FieldSheet = 'value' | 'picker'

type Pending =
  | { kind: 'switch'; to: FieldSheet; registry: ChildEditorRegistry }
  | { kind: 'take-away'; run: () => void }

export interface FieldSheets {
  value: SheetOpener
  picker: SheetOpener
  /** Runs an action that takes the field's editors away, asking first while they hold unsaved changes. */
  takeAway: (run: () => void) => void
  /** Keep Editing / Close, plus Save when the question comes from opening the other sheet. */
  question: UnsavedChangesDialogProps
}

export function useFieldSheets(label: string): FieldSheets {
  const registry = useChildEditorRegistry()
  const [active, setActive] = useState<FieldSheet | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const valueRef = useRef<SheetHandle>(null)
  const pickerRef = useRef<SheetHandle>(null)
  const refOf = (sheet: FieldSheet) => (sheet === 'value' ? valueRef : pickerRef)
  // The registry holding this field's unsaved editors, or null when nothing would be lost.
  const holdingChanges = () => (registry?.unsavedRows([label]) === true ? registry : null)

  const show = (sheet: FieldSheet) => {
    if (active === null || active === sheet) {
      openOrRefocus(active === sheet, refOf(sheet), () => setActive(sheet))
      return
    }
    const holder = holdingChanges()
    if (holder) {
      setPending({ kind: 'switch', to: sheet, registry: holder })
      return
    }
    setActive(sheet)
  }

  const opener = (sheet: FieldSheet): SheetOpener => ({
    open: active === sheet,
    ref: refOf(sheet),
    show: () => show(sheet),
    hide: () => setActive(null),
  })

  const takeAway = (run: () => void) => {
    const go = () => {
      setActive(null)
      run()
    }
    if (holdingChanges()) {
      setPending({ kind: 'take-away', run: go })
      return
    }
    go()
  }

  const carryOut = (action: Pending) => {
    setPending(null)
    if (action.kind === 'switch') {
      setActive(action.to)
    } else {
      action.run()
    }
  }

  const switching = pending?.kind === 'switch' ? pending : null

  return {
    value: opener('value'),
    picker: opener('picker'),
    takeAway,
    question: {
      open: pending !== null,
      onKeepEditing: () => {
        setPending(null)
        if (active !== null) refocusHandle(refOf(active))
      },
      onClose: () => carryOut(pending as Pending),
      onSave: switching
        ? () => {
            switching.registry.saveRows([label])
            carryOut(switching)
          }
        : undefined,
      saveBlockedNote: switching ? saveBlockedNote(null, switching.registry.rowEditors([label])) : null,
    },
  }
}
