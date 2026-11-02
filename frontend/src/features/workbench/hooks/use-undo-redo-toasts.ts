/**
 * useUndoRedoToasts - Mirror the workflow store's `lastAnnouncement` to a
 * subtle, stack-collapsing toast so a sighted user can see what their last
 * undo or redo did.
 *
 * Subscribes to `announcementSeq` (a monotonic counter that ticks on every
 * fired undo/redo, regardless of message content) so consecutive operations
 * with the same description still trigger a toast update. Repeats render as
 * "Undone: Add block (×3)" so the user can count how many times the same
 * operation rolled back without watching the canvas.
 *
 * The accessibility live-region announcement (`lastAnnouncement`) is
 * untouched - that string still goes verbatim to screen readers.
 */

import { useEffect, useRef } from 'react'
import { useWorkflowStoreInstance } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'

const TOAST_ID = 'workbench-undo-redo'
const TOAST_DURATION_MS = 3500

export function useUndoRedoToasts(): void {
  const storeApi = useWorkflowStoreInstance()
  const { toast, dismiss } = useToast()
  const previousMessageRef = useRef<string>('')
  const consecutiveCountRef = useRef(0)

  useEffect(() => {
    return storeApi.subscribe((state, prevState) => {
      // `reset()` zeroes the seq. Without this, the count refs would
      // persist across canvas sessions (e.g., Discard and Close, then
      // start over) and a fresh undo would inherit the previous run's
      // count. Clear the local tracking state and bail.
      if (state.announcementSeq < prevState.announcementSeq) {
        previousMessageRef.current = ''
        consecutiveCountRef.current = 0
        return
      }
      if (state.announcementSeq === prevState.announcementSeq) return

      const message = state.lastAnnouncement
      if (!message) return

      if (message === previousMessageRef.current) {
        consecutiveCountRef.current += 1
      } else {
        previousMessageRef.current = message
        consecutiveCountRef.current = 1
      }

      const count = consecutiveCountRef.current
      const display = count > 1 ? `${message} (×${count})` : message

      // Stack-collapse: clear any prior undo/redo toast first so rapid
      // clicks replace rather than queue.
      dismiss(TOAST_ID)
      toast({
        id: TOAST_ID,
        message: display,
        variant: 'info',
        duration: TOAST_DURATION_MS,
      })
    })
  }, [storeApi, toast, dismiss])
}

