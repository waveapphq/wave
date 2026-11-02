/**
 * Connection End Handler - Edge relocation finalization
 *
 * Handles the end of an edge connection drag: relocates the edge to the
 * snapped target, deletes if dropped on the X label, or preserves the
 * original edge if dropped on empty canvas.
 *
 * Extracted from use-canvas-connections.ts for modularity.
 */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type UpdateNodeInternals = ReturnType<typeof import('@xyflow/react').useUpdateNodeInternals>

interface RelocatingEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

interface HandleConnectEndParams {
  relocatingEdgeRef: React.RefObject<RelocatingEdge | null>
  relocProximityTargetRef: React.RefObject<string | null>
  /** The edge to be replaced if the cursor was over an occupied handle on
   *  the snap target at drop time. The mousemove handler keeps this ref in
   *  sync. When non-null, the snap-target relocate becomes REPLACE: the
   *  pointed-at edge is deleted and the dragged edge takes its handle. */
  replacementEdgeIdRef: React.RefObject<string | null>
  isOverDeleteXRef: React.RefObject<boolean>
  relocMouseMoveRef: React.RefObject<((e: MouseEvent) => void) | null>
  newConnMouseMoveRef: React.RefObject<((e: MouseEvent) => void) | null>
  setRelocatingEdgeId: (id: string | null) => void
  setRelocDragPos: (pos: { x: number; y: number } | null) => void
  setRelocProximityTargetId: (id: string | null) => void
  setIsSnappedToHandle: (v: boolean) => void
  setCycleDetectedNodeId: (id: string | null) => void
  setReplacementEdgeId: (id: string | null) => void
  setIsOverDeleteX: (v: boolean) => void
  setNewConnProximityTargetId: (id: string | null) => void
  relocateEdge: (oldId: string, newEdge: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void
  updateNodeInternals: UpdateNodeInternals
  validate: (connection: { source: string; target: string; sourceHandle?: string | null }) => { valid?: boolean; reason?: string }
}

/** Compute the next ingress handle name for convergence edges */
function computeNextIngressHandle(snapTarget: string): string {
  const state = useWorkflowStore.getState()
  const targetEdges = state.edges.filter((e) => e.target === snapTarget)
  const maxIndex = targetEdges.reduce((max, e) => {
    if (!e.targetHandle) return max
    const match = /^ingress_(\d+)$/.exec(e.targetHandle)
    return match ? Math.max(max, Number.parseInt(match[1])) : max
  }, 0)
  return `ingress_${maxIndex + 1}`
}

/** Schedule node internals update and edge re-render after convergence relocation */
function scheduleConvergenceRerender(
  snapTarget: string,
  oldTarget: string,
  updateNodeInternals: UpdateNodeInternals
): void {
  setTimeout(() => {
    updateNodeInternals(snapTarget)
    if (oldTarget !== snapTarget) {
      updateNodeInternals(oldTarget)
    }
    // After internals update, trigger edge re-render with a new edges reference
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const s = useWorkflowStore.getState()
        s.setEdges([...s.edges], { skipDirty: true })
      })
    })
  }, 100)
}

/** Handle relocation to a valid snap target */
function relocateToSnapTarget(
  oldEdge: RelocatingEdge,
  snapTarget: string,
  replacementEdgeId: string | null,
  relocateEdge: HandleConnectEndParams['relocateEdge'],
  updateNodeInternals: UpdateNodeInternals,
  validate: HandleConnectEndParams['validate']
): void {
  // Validate scope isolation before relocating
  const relocResult = validate({
    source: oldEdge.source,
    target: snapTarget,
    sourceHandle: oldEdge.sourceHandle,
  })
  if (relocResult.reason === 'cross-scope') return
  // Reject if relocating would land a SECOND edge with the same
  // (source, target) as an existing one - same-source convergence on the
  // SAME target is structurally redundant and degrades to a runtime no-op
  // (non-matching branch's skip cascade marks the shared target skipped
  // before the matching branch can enqueue it). Self-relocation (re-drop
  // on the original target) is exempt, and so is the REPLACE case below
  // (where the drop landed on an OCCUPIED ingress handle - that edge is
  // about to be removed, so it doesn't count as a surviving duplicate).
  if (relocResult.reason === 'duplicate') {
    const wouldDuplicate = useWorkflowStore
      .getState()
      .edges.some(
        (e) =>
          e.id !== oldEdge.id &&
          e.id !== replacementEdgeId &&
          e.source === oldEdge.source &&
          e.target === snapTarget,
      )
    if (wouldDuplicate) return
  }

  const state = useWorkflowStore.getState()
  const replacedEdge = replacementEdgeId
    ? state.edges.find((e) => e.id === replacementEdgeId)
    : undefined

  if (replacedEdge) {
    // REPLACE: the drop landed on an OCCUPIED handle on the snap target.
    // Delete the previously-occupying edge and relocate the dragged edge
    // onto the SAME handle (preserving the handle id so React Flow's
    // handleBounds map continues to map cleanly).
    useWorkflowStore.getState().removeEdge(replacedEdge.id)
    relocateEdge(oldEdge.id, {
      id: `edge-${oldEdge.source}-${snapTarget}-${Date.now()}`,
      source: oldEdge.source,
      target: snapTarget,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: replacedEdge.targetHandle,
    })
    scheduleConvergenceRerender(snapTarget, oldEdge.target, updateNodeInternals)
    return
  }

  // Check if target node already has an ingress edge on OTHER handles
  // (convergence case - we dropped on an empty slot near a populated node).
  const targetHasIngress = state.edges.some(
    (e) => e.target === snapTarget && e.id !== oldEdge.id
  )

  if (targetHasIngress) {
    const newTargetHandle = computeNextIngressHandle(snapTarget)
    relocateEdge(oldEdge.id, {
      id: `edge-${oldEdge.source}-${snapTarget}-${Date.now()}`,
      source: oldEdge.source,
      target: snapTarget,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: newTargetHandle,
    })
    scheduleConvergenceRerender(snapTarget, oldEdge.target, updateNodeInternals)
  } else {
    // Simple relocation - target has no other ingress
    relocateEdge(oldEdge.id, {
      id: `edge-${oldEdge.source}-${snapTarget}`,
      source: oldEdge.source,
      target: snapTarget,
      sourceHandle: oldEdge.sourceHandle,
    })
  }
}

/** Process the relocating edge: delete, relocate, or preserve */
function processRelocatingEdge(
  oldEdge: RelocatingEdge,
  snapTarget: string | null,
  replacementEdgeId: string | null,
  isOverDeleteX: boolean,
  relocateEdge: HandleConnectEndParams['relocateEdge'],
  updateNodeInternals: UpdateNodeInternals,
  validate: HandleConnectEndParams['validate']
): void {
  // Drop on X label = delete the edge
  if (!snapTarget && isOverDeleteX) {
    const removeEdge = useWorkflowStore.getState().removeEdge
    removeEdge(oldEdge.id)
    return
  }

  // Relocate to snap target
  if (snapTarget) {
    relocateToSnapTarget(oldEdge, snapTarget, replacementEdgeId, relocateEdge, updateNodeInternals, validate)
  }

  // else: dropped on empty canvas - original edge preserved
}

/** Reset all connection state to idle */
function resetConnectionState(params: HandleConnectEndParams): void {
  const {
    relocatingEdgeRef,
    relocProximityTargetRef,
    isOverDeleteXRef,
    newConnMouseMoveRef,
    setRelocatingEdgeId,
    setRelocDragPos,
    setRelocProximityTargetId,
    setIsSnappedToHandle,
    setCycleDetectedNodeId,
    setReplacementEdgeId,
    setIsOverDeleteX,
    setNewConnProximityTargetId,
  } = params

  relocatingEdgeRef.current = null
  setRelocatingEdgeId(null)
  setRelocDragPos(null)
  relocProximityTargetRef.current = null
  setRelocProximityTargetId(null)
  setIsSnappedToHandle(false)
  setCycleDetectedNodeId(null)
  setReplacementEdgeId(null)
  setIsOverDeleteX(false); isOverDeleteXRef.current = false
  // Clean up new connection proximity handler
  if (newConnMouseMoveRef.current) {
    document.removeEventListener('mousemove', newConnMouseMoveRef.current)
    newConnMouseMoveRef.current = null
  }
  setNewConnProximityTargetId(null)
  // Clear dragging edge state for dynamic ingress "+" handle
  useWorkflowStore.getState().setDraggingEdge(false)
}

/**
 * Process the end of a connect/drag operation.
 * Called from handleConnectEnd callback.
 */
export function processConnectEnd(params: HandleConnectEndParams): void {
  const {
    relocatingEdgeRef,
    relocProximityTargetRef,
    replacementEdgeIdRef,
    isOverDeleteXRef,
    relocMouseMoveRef,
    relocateEdge,
    updateNodeInternals,
    validate,
  } = params

  // Clean up mouse tracking
  if (relocMouseMoveRef.current) {
    document.removeEventListener('mousemove', relocMouseMoveRef.current)
    relocMouseMoveRef.current = null
  }

  // Relocate edge to snap target, or delete if dropped on X
  if (relocatingEdgeRef.current) {
    processRelocatingEdge(
      relocatingEdgeRef.current,
      relocProximityTargetRef.current,
      replacementEdgeIdRef.current,
      isOverDeleteXRef.current,
      relocateEdge,
      updateNodeInternals,
      validate
    )
  }

  resetConnectionState(params)
}
