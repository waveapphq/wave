/**
 * useFollowChanges - the watch-mode "Follow Changes" toggle.
 *
 * While following, the canvas navigates to and recenters on each block change
 * streamed from the holder (the last changed node, at any Function depth). A
 * null change is a metadata/variable frame and must not move the viewport.
 * Engaging with nothing changed yet fits the whole test on screen. Following
 * persists until the user stops it or the mirror ends; panning does NOT drop it.
 */

import { useCallback, useEffect, useState } from 'react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { focusCurrentBlock } from '@/features/workbench/lib/focus-current'

export interface FollowChanges {
  following: boolean
  toggleFollow: () => void
}

export function useFollowChanges(isMirroring: boolean): FollowChanges {
  const [following, setFollowing] = useState(false)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const lastChangeNodeId = useWorkflowStore((state) => state.mirrorLastChangeNodeId)
  const changeTick = useWorkflowStore((state) => state.mirrorChangeTick)

  // Following is a watch-mode affordance: leave it when the mirror ends.
  useEffect(() => {
    if (!isMirroring) setFollowing(false)
  }, [isMirroring])

  // Recenter on every block change while following - the tick makes a repeated
  // change to the SAME block re-center too (ignore metadata/var frames).
  useEffect(() => {
    if (!following) return
    if (lastChangeNodeId !== null) focusCurrentBlock(lastChangeNodeId)
  }, [following, lastChangeNodeId, changeTick])

  const toggleFollow = useCallback(() => {
    setFollowing((prev) => {
      const next = !prev
      // Engaging with nothing changed yet fits the whole test on screen; when a
      // change already exists the recenter effect handles it.
      if (next && useWorkflowStore.getState().mirrorLastChangeNodeId === null) {
        requestFitView()
      }
      return next
    })
  }, [requestFitView])

  return { following, toggleFollow }
}
