/**
 * useCanvasFocus - centers the requested node in the viewport.
 *
 * Consumes the store focus request (focusRequested / focusNodeId) and pans the
 * canvas to center the node. The node position comes from the store's active
 * drill subtree (not a React Flow lookup), so a focus that follows a scope
 * switch centers on the correct node without racing React Flow's node sync. It
 * only recenters - no highlight. The default keeps the current zoom (a plain
 * pan); callers may override zoom/duration via focusOptions.
 */

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const FALLBACK_WIDTH = 120
const FALLBACK_HEIGHT = 50
const FOCUS_DURATION_MS = 400

export function useCanvasFocus(): void {
  const { setCenter, getViewport } = useReactFlow()
  const focusRequested = useWorkflowStore((state) => state.focusRequested)
  const focusNodeId = useWorkflowStore((state) => state.focusNodeId)
  const focusOptions = useWorkflowStore((state) => state.focusOptions)
  const acknowledgeFocus = useWorkflowStore((state) => state.acknowledgeFocus)

  useEffect(() => {
    if (!focusRequested) return
    const node = useWorkflowStore
      .getState()
      .getActiveNodes()
      .find((candidate) => candidate.id === focusNodeId)
    if (node) {
      const width = node.width ?? FALLBACK_WIDTH
      const height = node.height ?? FALLBACK_HEIGHT
      setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: focusOptions?.zoom ?? getViewport().zoom,
        duration: focusOptions?.duration ?? FOCUS_DURATION_MS,
      })
    }
    acknowledgeFocus()
  }, [focusRequested, focusNodeId, focusOptions, setCenter, getViewport, acknowledgeFocus])
}
