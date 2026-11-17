/**
 * useCanvasBringIntoView - keeps a watched build's new Block in view (WATCH-8).
 *
 * Consumes the store request (bringIntoViewRequested / bringIntoViewNodeId).
 * While the finished test does not fit the canvas even at its smallest zoom, the
 * view pans just enough to show a new Block that would land off screen, keeping
 * the zoom. A build that fits keeps its still view. The Block's place comes from
 * the store, sized by its stored width and the nominal Block footprint, since it
 * is not measured yet.
 */

import { useEffect } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { BLOCK_FOOTPRINT } from '@/features/workbench/common/canvas/workflow-canvas/canvas-constants'
import {
  CANVAS_FIT_PADDING,
  buildTarget,
} from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-fitview'
import { fitsCanvas, panIntoView } from '@/features/workbench/lib/build-view'

export function useCanvasBringIntoView(): void {
  const { getViewport, setViewport, getNodes, getNodesBounds } = useReactFlow()
  const flowStore = useStoreApi()
  const requested = useWorkflowStore((state) => state.bringIntoViewRequested)
  const nodeId = useWorkflowStore((state) => state.bringIntoViewNodeId)
  const acknowledge = useWorkflowStore((state) => state.acknowledgeBringIntoView)

  useEffect(() => {
    if (!requested) return
    const state = useWorkflowStore.getState()
    const bounds = state.mirrorBuildBounds
    const node = state.getActiveNodes().find((candidate) => candidate.id === nodeId)
    if (bounds !== null && node) {
      const size = flowStore.getState()
      const { target } = buildTarget({ getNodes, getNodesBounds }, bounds)
      const block = {
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? BLOCK_FOOTPRINT.width,
        height: BLOCK_FOOTPRINT.height,
      }
      const next = fitsCanvas(target, size, CANVAS_FIT_PADDING)
        ? null
        : panIntoView(getViewport(), block, size, CANVAS_FIT_PADDING)
      if (next) void setViewport(next, { duration: 0 })
    }
    acknowledge()
  }, [requested, nodeId, getViewport, setViewport, getNodes, getNodesBounds, flowStore, acknowledge])
}
