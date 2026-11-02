/**
 * Opening a Function block's body - the one path behind the dig-in glyph, the
 * kebab's Open entry and the Ctrl+Enter key. A Local body travels with the
 * block; a Shared instance's body has to be resolved from the pinned version
 * first, which is why the keyboard cannot simply drill by id.
 */

import { useCallback } from 'react'

import { useDrillHandler } from '@/features/functions/canvas/use-drill-handler'
import { fetchSharedBody, sharedDraftBody } from '@/features/functions/canvas/shared-function-body'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import { reportFunctionBodyFailure } from '@/features/functions/lib/function-body-report'

export type OpenFunctionBody = (id: string, data: Record<string, unknown>) => void

export function useFunctionDrill(): OpenFunctionBody {
  const { pushDrill } = useDrillHandler()
  const pushSharedDrill = useWorkflowStore((state) => state.pushSharedDrill)
  const requestDrill = useWorkflowStore((state) => state.requestDrill)
  const setDigInPending = useWorkflowStore((state) => state.setDigInPending)
  const clearDigInPending = useWorkflowStore((state) => state.clearDigInPending)
  const { error: toastError } = useToast()

  return useCallback(
    (id: string, data: Record<string, unknown>) => {
      if (data.functionLifecycle !== 'shared') {
        // Routed through the dirty-sheet drill guard inside useDrillHandler.
        pushDrill(id)
        return
      }
      const functionId = data.functionId as string | undefined
      if (!functionId) return
      // Scope changes reset sheet form state - a dirty sheet defers the
      // drill (including the version resolve) to the confirmation dialog.
      requestDrill(() => {
        // An in-Test edit-mode draft IS what the user is editing: never refetch
        // the now-stale library copy over it.
        const draftBody = sharedDraftBody(data)
        if (draftBody) {
          pushSharedDrill(id, draftBody)
          return
        }
        // In-flight lock: ignore stacked opens while a resolve is pending.
        if (useWorkflowStore.getState().digInPendingNodeId === id) return
        setDigInPending(id)
        void fetchSharedBody(functionId, data.functionVersion as string | undefined)
          .then((body) => {
            clearDigInPending()
            pushSharedDrill(id, body)
          })
          .catch((err: unknown) => {
            // The glyph stops resolving and the toast carries the reason; the
            // parent canvas the user is still on is untouched.
            clearDigInPending()
            reportFunctionBodyFailure(toastError, err)
          })
      })
    },
    [
      pushDrill,
      pushSharedDrill,
      requestDrill,
      setDigInPending,
      clearDigInPending,
      toastError,
    ],
  )
}
