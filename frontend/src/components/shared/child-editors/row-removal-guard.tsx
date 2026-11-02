/**
 * The question asked before an action takes away a row whose editor holds unsaved changes.
 */

import { useCallback, useState } from 'react'

import { useChildEditorRegistry } from './child-editor-scope'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'

export interface RowRemovalGuard {
  /** Runs the action, asking first when an open editor of one of these rows has unsaved changes. */
  request: (rowLabels: readonly string[], run: () => void) => void
  pending: boolean
  keepEditing: () => void
  proceed: () => void
}

export function useRowRemovalGuard(): RowRemovalGuard {
  const registry = useChildEditorRegistry()
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const request = useCallback(
    (rowLabels: readonly string[], run: () => void) => {
      if (registry?.unsavedRows(rowLabels) === true) {
        setPendingAction(() => run)
        return
      }
      run()
    },
    [registry],
  )

  const keepEditing = useCallback(() => setPendingAction(null), [])

  const proceed = useCallback(() => {
    setPendingAction(null)
    pendingAction?.()
  }, [pendingAction])

  return { request, pending: pendingAction !== null, keepEditing, proceed }
}

/** The two-answer question the guard raises; Save is never offered, the row is going. */
export function RowRemovalQuestion({ guard }: Readonly<{ guard: RowRemovalGuard }>) {
  return (
    <UnsavedChangesDialog
      open={guard.pending}
      onKeepEditing={guard.keepEditing}
      onClose={guard.proceed}
    />
  )
}
