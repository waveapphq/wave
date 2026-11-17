/**
 * useCanvasFitView - Fit view effect for the workflow canvas
 *
 * Handles fitView requests from the store (triggered by loadTest).
 * Uses nested requestAnimationFrame to ensure React Flow is fully
 * rendered before fitting.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { useEffect, useCallback } from 'react'
import { useReactFlow, useStoreApi, type ReactFlowInstance, type Rect } from '@xyflow/react'
import { useWorkflowStore, type FitViewOptions } from '@/features/workbench/stores/workflow-store'
import { fitsCanvas, topFrame, unionRect, type CanvasSize } from '@/features/workbench/lib/build-view'

export const CANVAS_FIT_PADDING = 0.2
const FIT_DURATION_MS = 200

type RenderedFlow = Pick<ReactFlowInstance, 'getNodes' | 'getNodesBounds'>
type FitFlow = RenderedFlow & Pick<ReactFlowInstance, 'fitView' | 'fitBounds' | 'setViewport'>

/** A watched build's finished bounds with what the canvas already shows, and that shown part. */
export function buildTarget(flow: RenderedFlow, bounds: Rect): { target: Rect; shown: Rect } {
  const rendered = flow.getNodes()
  if (rendered.length === 0) return { target: bounds, shown: bounds }
  const shown = flow.getNodesBounds(rendered)
  return { target: unionRect(bounds, shown), shown }
}

/** Fit the rendered nodes, or a build's finished test: whole when it fits, else its top at the smallest zoom. */
export function fitCanvas(flow: FitFlow, size: CanvasSize, options: FitViewOptions | null): void {
  const padding = options?.padding ?? CANVAS_FIT_PADDING
  const duration = options?.duration ?? FIT_DURATION_MS
  if (!options?.bounds) {
    void flow.fitView({ padding, duration })
    return
  }
  const { target, shown } = buildTarget(flow, options.bounds)
  if (fitsCanvas(target, size, padding)) {
    void flow.fitBounds(target, { padding, duration })
  } else {
    void flow.setViewport(topFrame(target, shown, size, padding), { duration })
  }
}

/**
 * Schedule a callback after three animation frames.
 * This ensures React reconciliation and React Flow layout are complete:
 * - First rAF: React has scheduled the update
 * - Second rAF: Browser has painted the new nodes
 * - Third rAF: React Flow's internal state is synchronized
 */
/* v8 ignore next 8 - COV-REACT-008 */
function scheduleAfterPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(callback)
    })
  })
}

export function useCanvasFitView() {
  const flow = useReactFlow()
  const flowStore = useStoreApi()
  const fitViewRequested = useWorkflowStore((state) => state.fitViewRequested)
  const fitViewOptions = useWorkflowStore((state) => state.fitViewOptions)
  const acknowledgeFitView = useWorkflowStore((state) => state.acknowledgeFitView)
  const setCanvasReady = useWorkflowStore((state) => state.setCanvasReady)

  const executeFitView = useCallback(() => {
    /* v8 ignore start - COV-REACT-008 */
    fitCanvas(flow, flowStore.getState(), fitViewOptions)
    acknowledgeFitView()
    setCanvasReady(true)
    /* v8 ignore stop */
  }, [flow, flowStore, fitViewOptions, acknowledgeFitView, setCanvasReady])

  useEffect(() => {
    /* v8 ignore next - COV-DEF-042 */
    if (!fitViewRequested) return

    /* v8 ignore next - COV-REACT-008 */
    scheduleAfterPaint(executeFitView)
  }, [fitViewRequested, executeFitView])
}
