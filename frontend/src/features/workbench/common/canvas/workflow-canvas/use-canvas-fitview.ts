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
import { useReactFlow } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

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
  const { fitView: reactFlowFitView } = useReactFlow()
  const fitViewRequested = useWorkflowStore((state) => state.fitViewRequested)
  const fitViewOptions = useWorkflowStore((state) => state.fitViewOptions)
  const acknowledgeFitView = useWorkflowStore((state) => state.acknowledgeFitView)
  const setCanvasReady = useWorkflowStore((state) => state.setCanvasReady)

  const executeFitView = useCallback(() => {
    /* v8 ignore start - COV-REACT-008 */
    reactFlowFitView({
      padding: fitViewOptions?.padding ?? 0.2,
      duration: fitViewOptions?.duration ?? 200,
    })
    acknowledgeFitView()
    setCanvasReady(true)
    /* v8 ignore stop */
  }, [reactFlowFitView, fitViewOptions, acknowledgeFitView, setCanvasReady])

  useEffect(() => {
    /* v8 ignore next - COV-DEF-042 */
    if (!fitViewRequested) return

    /* v8 ignore next - COV-REACT-008 */
    scheduleAfterPaint(executeFitView)
  }, [fitViewRequested, executeFitView])
}
