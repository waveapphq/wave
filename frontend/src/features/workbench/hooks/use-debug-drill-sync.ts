/** Drives "canvas follows execution" during a debug pause: drills into the paused Function and pops back on resume. */

import { useEffect, useRef } from 'react'

import { drillToPath } from '@/features/functions/canvas/use-drill-handler'
import {
  indexNodeAncestors,
  resolveNodeAncestors,
  type AncestorNode,
} from '@/features/functions/canvas/node-ancestors'
import { reportFunctionBodyFailure } from '@/features/functions/lib/function-body-report'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface UseDebugDrillSyncArgs {
  pausedNodeId: string | null
  isPaused: boolean
  /** Engine is actively running. Pop back to root only on resume, not on Stop. */
  isRunning: boolean
  /** Reports a library Function body that could not be loaded for the pause. */
  toastError?: (message: string, title?: string) => void
}

export function useDebugDrillSync({ pausedNodeId, isPaused, isRunning, toastError }: UseDebugDrillSyncArgs): void {
  const drilled = useRef(false)
  useEffect(() => {
    let current = true
    if (isPaused && pausedNodeId) {
      const nodes = useWorkflowStore.getState().nodes as unknown as AncestorNode[]
      const loaded = indexNodeAncestors(nodes).get(pausedNodeId)
      if (loaded) {
        drillToPath(loaded, pausedNodeId)
      } else {
        // The pause sits in a library body that is not loaded: open it the way dig-in does.
        void resolveNodeAncestors(nodes, pausedNodeId).then(
          (path) => {
            if (current && path) drillToPath(path, pausedNodeId)
          },
          (error: unknown) => {
            if (current && toastError) reportFunctionBodyFailure(toastError, error)
          },
        )
      }
      drilled.current = true
    } else if (drilled.current && isRunning) {
      // Pop back to root only when the engine RESUMES. On Stop / terminal, stay
      // where the user is so the stopped block stays visible in its Function.
      drillToPath([])
      drilled.current = false
    }
    return () => {
      current = false
    }
  }, [isPaused, pausedNodeId, isRunning, toastError])
}
