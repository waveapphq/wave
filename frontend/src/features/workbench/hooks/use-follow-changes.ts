/**
 * useFollowChanges - the watch-mode "Follow Changes" toggle and the watched build view.
 *
 * While following, the canvas navigates to and recenters on each block change
 * streamed from the holder (the last changed node, at any Function depth). A
 * null change is a metadata/variable frame and must not move the viewport.
 * Engaging with nothing changed yet fits the whole test on screen. Following
 * persists until the user stops it or the mirror ends; panning does NOT drop it.
 * Not following, a watched build is framed as its finished test when it starts,
 * and each later Block is kept in view (WATCH-8).
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useWorkflowStore, type Rect } from '@/features/workbench/stores/workflow-store'
import { focusCurrentBlock } from '@/features/workbench/lib/focus-current'

export interface FollowChanges {
  following: boolean
  toggleFollow: () => void
}

export function useFollowChanges(isMirroring: boolean): FollowChanges {
  const [following, setFollowing] = useState(false)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const requestBringIntoView = useWorkflowStore((state) => state.requestBringIntoView)
  const lastChangeNodeId = useWorkflowStore((state) => state.mirrorLastChangeNodeId)
  const changeTick = useWorkflowStore((state) => state.mirrorChangeTick)
  const buildBounds = useWorkflowStore((state) => state.mirrorBuildBounds)
  const seenBuildRef = useRef<Rect | null>(null)

  // Following is a watch-mode affordance: leave it when the mirror ends.
  useEffect(() => {
    if (!isMirroring) setFollowing(false)
  }, [isMirroring])

  // A build is seen even while following, so turning Follow off mid-build never reframes it.
  const watchBuild = useEffectEvent((bounds: Rect | null, nodeId: string | null) => {
    const starting = bounds !== seenBuildRef.current
    seenBuildRef.current = bounds
    if (following || bounds === null) return
    if (starting) {
      requestFitView({ padding: 0.2, duration: 0, bounds })
    } else if (nodeId !== null) {
      requestBringIntoView(nodeId)
    }
  })

  useEffect(() => {
    watchBuild(buildBounds, lastChangeNodeId)
  }, [buildBounds, lastChangeNodeId, changeTick])

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
