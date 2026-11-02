/** Holds a run / resume behind the warning dialog while an open Edit window holds an unsaved change (VMGR-64). */

import { useCallback, useMemo, useRef, useState } from 'react'

import { SaveCanceledError, usePendingCurrentEdits } from './pending-current-edits'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

/** One open Edit window holding an unsaved change: its variable and scope (node ids). */
export interface RunConflictEntry {
  name: string
  functionPath?: string[] | null
  definitionChanged?: boolean
}

export interface RunConflictGuard {
  /** Wrap a run/resume action so an Edit window's unsaved change holds it behind the warning dialog. */
  guard: <A extends unknown[]>(action: (...args: A) => void | Promise<void>) => (...args: A) => void
  isOpen: boolean
  entries: RunConflictEntry[]
  isSaving: boolean
  onCancel: () => void
  onDrop: () => void
  onSave: () => void
}

export function useRunConflictGuard(): RunConflictGuard {
  const pending = usePendingCurrentEdits((state) => state.pending)
  const clearAll = usePendingCurrentEdits((state) => state.clearAll)
  const { error: toastError } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const stashedRef = useRef<null | (() => void | Promise<void>)>(null)

  // A run-control action reports its own failure; one that does not still has
  // to reach the user, because the gesture looked like it started.
  const reportFailure = useCallback(
    (err: unknown) => {
      toastError(toFailureDetail(err).message, 'Run Control Failed')
    },
    [toastError]
  )

  const guard = useCallback(
    <A extends unknown[]>(action: (...args: A) => void | Promise<void>) =>
      (...args: A) => {
        if (usePendingCurrentEdits.getState().pending.size > 0) {
          stashedRef.current = () => action(...args)
          setIsOpen(true)
          return
        }
        Promise.resolve(action(...args)).catch(reportFailure)
      },
    [reportFailure]
  )

  const runStashed = useCallback(() => {
    const action = stashedRef.current
    stashedRef.current = null
    setIsOpen(false)
    if (action) Promise.resolve(action()).catch(reportFailure)
  }, [reportFailure])

  const onCancel = useCallback(() => {
    stashedRef.current = null
    setIsOpen(false)
  }, [])

  const onDrop = useCallback(() => {
    for (const edit of usePendingCurrentEdits.getState().pending.values()) edit.drop()
    clearAll()
    runStashed()
  }, [clearAll, runStashed])

  // One window at a time, so its confirms are asked one by one; a canceled confirm ends like Cancel.
  const onSave = useCallback(() => {
    const edits = [...usePendingCurrentEdits.getState().pending.values()]
    setIsSaving(true)
    const saveWindows = async (): Promise<void> => {
      const failures: unknown[] = []
      for (const edit of edits) {
        try {
          await edit.save()
        } catch (error) {
          if (error instanceof SaveCanceledError) {
            setIsSaving(false)
            onCancel()
            return
          }
          failures.push(error)
        }
      }
      setIsSaving(false)
      // A window that cannot save holds the run; it stays registered so Save can be pressed again.
      if (failures.length > 0) {
        toastError(`The run did not start: ${toFailureDetail(failures[0]).message}`, 'Current Value Not Saved')
        return
      }
      clearAll()
      runStashed()
    }
    saveWindows().catch(reportFailure)
  }, [clearAll, runStashed, onCancel, toastError, reportFailure])

  const entries = useMemo(
    () =>
      [...pending.values()].map(({ name, functionPath, definitionChanged }) => ({
        name,
        functionPath,
        definitionChanged,
      })),
    [pending],
  )

  return { guard, isOpen, entries, isSaving, onCancel, onDrop, onSave }
}
