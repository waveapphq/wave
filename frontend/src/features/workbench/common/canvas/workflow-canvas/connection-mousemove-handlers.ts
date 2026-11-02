/**
 * Connection Mouse-Move Handler Factories
 *
 * Creates mousemove handlers for edge relocation and new connection
 * proximity tracking. These run during edge drag operations to provide
 * snap-to-handle and proximity feedback.
 *
 * Extracted from use-canvas-connections.ts for modularity.
 */

import type { ReactFlowState } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import {
  wouldCreateCycle,
  distToNodeBounds,
  EDGE_SNAP_THRESHOLD,
  BORDER_TRIGGER_RANGE,
} from './canvas-constants'

/** State setters passed to the relocation mousemove handler */
export interface RelocationHandlerSetters {
  relocatingEdgeRef: React.RefObject<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } | null>
  relocProximityTargetRef: React.RefObject<string | null>
  isOverDeleteXRef: React.RefObject<boolean>
  setRelocProximityTargetId: (id: string | null) => void
  setCycleDetectedNodeId: (id: string | null) => void
  setRelocDragPos: (pos: { x: number; y: number } | null) => void
  setIsSnappedToHandle: (v: boolean) => void
  setIsOverDeleteX: (v: boolean) => void
  setReplacementEdgeId: (id: string | null) => void
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
  rfStoreApi: { getState: () => ReactFlowState }
  validate: (connection: { source: string; target: string; sourceHandle?: string | null }) => { valid?: boolean; reason?: string }
}

interface FlowPos { x: number; y: number }

type SnappedHandle = { nodeId: string; handlePos: FlowPos; handleId: string | null }

interface NodeProximityResult {
  nearestNode: { id: string; borderDist: number } | null
  snappedHandle: SnappedHandle | null
}

interface SnapState {
  snappedHandle: SnappedHandle | null
  snappedDist: number
}

interface InternalNodeLike {
  internals: { positionAbsolute: FlowPos; handleBounds?: { target?: ReadonlyArray<{ id?: string | null; x: number; y: number; width: number; height: number }> | null } }
  measured?: { width?: number; height?: number }
}

/** Step 2: snap to any existing handle whose center is within EDGE_SNAP_THRESHOLD. */
function snapToExistingHandles(
  nodeId: string,
  nodeAbsPos: FlowPos,
  flowPos: FlowPos,
  internalNode: InternalNodeLike | undefined,
  snap: SnapState,
): SnapState {
  const handles = internalNode?.internals.handleBounds?.target ?? []
  let next = snap
  for (const h of handles) {
    const hx = nodeAbsPos.x + h.x + h.width / 2
    const hy = nodeAbsPos.y + h.y + h.height / 2
    const handleDist = Math.hypot(flowPos.x - hx, flowPos.y - hy)
    if (handleDist < EDGE_SNAP_THRESHOLD && handleDist < next.snappedDist) {
      next = {
        snappedHandle: { nodeId, handlePos: { x: hx, y: hy }, handleId: h.id ?? null },
        snappedDist: handleDist,
      }
    }
  }
  return next
}

/**
 * Step 3 (relocation only): snap to PROJECTED post-proximity handle positions.
 * The current `nodeLookup` carries the pre-proximity 50%-centered layout on the
 * very first mousemove that enters border-trigger range; the React re-render +
 * handleBounds update takes one tick to complete, but the cursor may already
 * be stationary at its drop position. Without this projection the snap would
 * miss until the user jitters the mouse, and the replacement-edge X marker
 * (which depends on `replacementEdgeId` being set) never appears.
 */
function snapToProjectedHandles(
  nodeId: string,
  nodeAbsPos: FlowPos,
  nodeW: number,
  flowPos: FlowPos,
  ingressCount: number,
  snap: SnapState,
): SnapState {
  const totalSlots = ingressCount + 1
  let next = snap
  for (let i = 0; i < ingressCount; i++) {
    const leftPct = (i + 1) / (totalSlots + 1)
    const hx = nodeAbsPos.x + nodeW * leftPct
    const hy = nodeAbsPos.y
    const handleDist = Math.hypot(flowPos.x - hx, flowPos.y - hy)
    if (handleDist < EDGE_SNAP_THRESHOLD && handleDist < next.snappedDist) {
      // First handle stays unnamed (default); rest are `ingress_N`.
      const projectedId = i === 0 ? null : `ingress_${i}`
      next = {
        snappedHandle: { nodeId, handlePos: { x: hx, y: hy }, handleId: projectedId },
        snappedDist: handleDist,
      }
    }
  }
  // The "+" handle takes the FUTURE-stable id `ingress_${ingressCount}`.
  const plusLeftPct = totalSlots / (totalSlots + 1)
  const plusHx = nodeAbsPos.x + nodeW * plusLeftPct
  const plusHy = nodeAbsPos.y
  const plusDist = Math.hypot(flowPos.x - plusHx, flowPos.y - plusHy)
  if (plusDist < EDGE_SNAP_THRESHOLD && plusDist < next.snappedDist) {
    next = {
      snappedHandle: {
        nodeId,
        handlePos: { x: plusHx, y: plusHy },
        handleId: `ingress_${ingressCount}`,
      },
      snappedDist: plusDist,
    }
  }
  return next
}

function countRemainingIngress(
  state: ReturnType<typeof useWorkflowStore.getState>,
  nodeId: string,
  relocEdgeId: string | undefined,
): number {
  let count = 0
  for (const e of state.edges) {
    if (e.target === nodeId && e.id !== relocEdgeId) count += 1
  }
  return count
}

/** Scan all nodes to find the nearest border-trigger node and any snapped handle */
function findRelocationProximity(
  flowPos: FlowPos,
  state: ReturnType<typeof useWorkflowStore.getState>,
  nodeLookup: ReactFlowState['nodeLookup'],
  relocEdge: { id?: string; source: string; target: string } | null
): NodeProximityResult {
  let nearestNode: { id: string; borderDist: number } | null = null
  let snap: SnapState = { snappedHandle: null, snappedDist: Infinity }

  for (const node of state.nodes) {
    // Skip current target and source node (no self-linking)
    if (relocEdge && (node.id === relocEdge.target || node.id === relocEdge.source)) continue

    const internalNode = nodeLookup.get(node.id) as InternalNodeLike | undefined
    const nodeAbsPos = internalNode?.internals.positionAbsolute ?? node.position
    const nodeW = internalNode?.measured?.width ?? 120
    const nodeH = internalNode?.measured?.height ?? 40

    // Step 1: nearest node within border-trigger range.
    const borderDist = distToNodeBounds(flowPos.x, flowPos.y, nodeAbsPos.x, nodeAbsPos.y, nodeW, nodeH)
    if (borderDist < BORDER_TRIGGER_RANGE && (!nearestNode || borderDist < nearestNode.borderDist)) {
      nearestNode = { id: node.id, borderDist }
    }

    // Step 2: snap to existing handles surfaced by React Flow's nodeLookup.
    snap = snapToExistingHandles(node.id, nodeAbsPos, flowPos, internalNode, snap)

    // Step 3 (relocation only): projected post-proximity handles.
    if (relocEdge && borderDist < BORDER_TRIGGER_RANGE) {
      const ingressCount = countRemainingIngress(state, node.id, relocEdge.id)
      if (ingressCount >= 1) {
        snap = snapToProjectedHandles(node.id, nodeAbsPos, nodeW, flowPos, ingressCount, snap)
      }
    }
  }

  return { nearestNode, snappedHandle: snap.snappedHandle }
}

/** Check if the nearest node would create a cycle or cross-scope violation */
function checkProximityValidity(
  nearestNode: { id: string } | null,
  sourceId: string,
  edges: ReturnType<typeof useWorkflowStore.getState>['edges'],
  relocEdgeId: string | undefined,
  validate: RelocationHandlerSetters['validate'],
  sourceHandle: string | undefined
): { isCycle: boolean; isCrossScope: boolean } {
  if (!nearestNode) return { isCycle: false, isCrossScope: false }

  const isCycle = wouldCreateCycle(sourceId, nearestNode.id, edges, relocEdgeId)
  const isCrossScope = !isCycle &&
    validate({ source: sourceId, target: nearestNode.id, sourceHandle }).reason === 'cross-scope'

  return { isCycle, isCrossScope }
}

/** Apply proximity target state based on validation results, returns whether snap should be cleared */
function applyProximityTarget(
  nearestNode: { id: string } | null,
  isCycle: boolean,
  isCrossScope: boolean,
  relocProximityTargetRef: React.RefObject<string | null>,
  setRelocProximityTargetId: (id: string | null) => void,
  setCycleDetectedNodeId: (id: string | null) => void
): boolean {
  if (nearestNode && !isCycle && !isCrossScope) {
    relocProximityTargetRef.current = nearestNode.id
    setRelocProximityTargetId(nearestNode.id)
    setCycleDetectedNodeId(null)
    return false
  }

  if (nearestNode && (isCycle || isCrossScope)) {
    // Near a node but invalid - show red indicator, don't set as snap target
    relocProximityTargetRef.current = null
    setRelocProximityTargetId(null)
    setCycleDetectedNodeId(nearestNode.id)
    return true // clear snap
  }

  relocProximityTargetRef.current = null
  setRelocProximityTargetId(null)
  setCycleDetectedNodeId(null)
  return false
}

/** Check if cursor is over the ghost edge's X label (delete action) */
function checkDeleteXHover(clientX: number, clientY: number): boolean {
  const xLabel = document.querySelector('.react-flow__edge-text')
  if (!xLabel) return false

  const rect = xLabel.getBoundingClientRect()
  const pad = 8
  return clientX >= rect.left - pad && clientX <= rect.right + pad &&
         clientY >= rect.top - pad && clientY <= rect.bottom + pad
}

interface ApplyDragPositionParams {
  snappedHandle: { nodeId: string; handlePos: FlowPos } | null
  flowPos: FlowPos
  clientX: number
  clientY: number
  relocProximityTargetRef: React.RefObject<string | null>
  setRelocDragPos: (pos: FlowPos) => void
  setIsSnappedToHandle: (v: boolean) => void
  setIsOverDeleteX: (v: boolean) => void
  isOverDeleteXRef: React.RefObject<boolean>
}

/** Apply drag position state: snap to handle or follow cursor */
function applyDragPosition({
  snappedHandle,
  flowPos,
  clientX,
  clientY,
  relocProximityTargetRef,
  setRelocDragPos,
  setIsSnappedToHandle,
  setIsOverDeleteX,
  isOverDeleteXRef,
}: ApplyDragPositionParams): void {
  if (snappedHandle) {
    setRelocDragPos(snappedHandle.handlePos)
    relocProximityTargetRef.current = snappedHandle.nodeId
    setIsSnappedToHandle(true)
    setIsOverDeleteX(false); isOverDeleteXRef.current = false
    return
  }

  setRelocDragPos(flowPos)
  setIsSnappedToHandle(false)

  const overX = checkDeleteXHover(clientX, clientY)
  setIsOverDeleteX(overX); isOverDeleteXRef.current = overX
}

/**
 * Create a mousemove handler for edge relocation.
 *
 * Tracks cursor position, snaps to free input handles, detects cycles,
 * and updates proximity/drag state for ghost edge rendering.
 */
export function createRelocationMouseMoveHandler(setters: RelocationHandlerSetters): (e: MouseEvent) => void {
  let lastMoveTime = 0
  const {
    relocatingEdgeRef,
    relocProximityTargetRef,
    isOverDeleteXRef,
    setRelocProximityTargetId,
    setCycleDetectedNodeId,
    setRelocDragPos,
    setIsSnappedToHandle,
    setIsOverDeleteX,
    setReplacementEdgeId,
    screenToFlowPosition,
    rfStoreApi,
    validate,
  } = setters

  return (e: MouseEvent) => {
    // Throttle proximity checks (~30fps)
    const now = Date.now()
    if (now - lastMoveTime < 32) return
    lastMoveTime = now

    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const state = useWorkflowStore.getState()
    const relocEdge = relocatingEdgeRef.current
    const nodeLookup = rfStoreApi.getState().nodeLookup

    const { nearestNode, snappedHandle } = findRelocationProximity(
      flowPos, state, nodeLookup, relocEdge
    )

    // Check for cycles and cross-scope before setting proximity
    const sourceId = relocEdge?.source ?? ''
    const { isCycle, isCrossScope } = checkProximityValidity(
      nearestNode, sourceId, state.edges, relocEdge?.id, validate, relocEdge?.sourceHandle
    )

    const shouldClearSnap = applyProximityTarget(
      nearestNode, isCycle, isCrossScope,
      relocProximityTargetRef, setRelocProximityTargetId, setCycleDetectedNodeId
    )

    const effectiveSnap = shouldClearSnap ? null : snappedHandle

    // If the snap landed on an OCCUPIED handle (excluding the relocating
    // edge itself), surface that edge as the replacement target so the UI
    // renders its red-X ghost. Drop will delete that edge per the replace
    // semantics in connection-on-connect.ts.
    let occupyingEdgeId: string | null = null
    if (effectiveSnap) {
      const handleId = effectiveSnap.handleId ?? undefined
      const existing = state.edges.find((edge) =>
        edge.target === effectiveSnap.nodeId &&
        edge.id !== relocEdge?.id &&
        (edge.targetHandle ?? undefined) === handleId,
      )
      occupyingEdgeId = existing?.id ?? null
    }
    setReplacementEdgeId(occupyingEdgeId)

    applyDragPosition({
      snappedHandle: effectiveSnap,
      flowPos,
      clientX: e.clientX,
      clientY: e.clientY,
      relocProximityTargetRef,
      setRelocDragPos,
      setIsSnappedToHandle,
      setIsOverDeleteX,
      isOverDeleteXRef,
    })
  }
}

/** State setters passed to the new connection mousemove handler */
export interface NewConnectionHandlerSetters {
  sourceNodeId: string
  setNewConnProximityTargetId: (id: string | null) => void
  setCycleDetectedNodeId: (id: string | null) => void
  setReplacementEdgeId: (id: string | null) => void
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
  rfStoreApi: { getState: () => ReactFlowState }
  validate: (connection: { source: string; target: string }) => { valid?: boolean; reason?: string }
}

interface NewConnProximityResult {
  closest: { id: string; distance: number } | null
  nearestHandleEdge: string | null
}

/** Find the nearest handle and any edge occupying that handle */
function findNearestHandleEdge(
  node: ReturnType<typeof useWorkflowStore.getState>['nodes'][number],
  nodeLookup: ReactFlowState['nodeLookup'],
  flowPos: FlowPos,
  edges: ReturnType<typeof useWorkflowStore.getState>['edges']
): string | null {
  const internalNode = nodeLookup.get(node.id)
  const nodeAbsPos = internalNode?.internals.positionAbsolute ?? node.position
  const handles = internalNode?.internals.handleBounds?.target ?? []

  let nearestHandleDist = Infinity
  let nearestHandleId: string | undefined
  for (const h of handles) {
    const hx = nodeAbsPos.x + h.x + h.width / 2
    const hy = nodeAbsPos.y + h.y + h.height / 2
    const hDist = Math.hypot(flowPos.x - hx, flowPos.y - hy)
    if (hDist < nearestHandleDist) {
      nearestHandleDist = hDist
      nearestHandleId = h.id ?? undefined
    }
  }

  if (nearestHandleDist >= BORDER_TRIGGER_RANGE) return null

  const edgeOnHandle = nearestHandleId
    ? edges.find((e) => e.target === node.id && e.targetHandle === nearestHandleId)
    : edges.find((e) => e.target === node.id && !e.targetHandle)
  return edgeOnHandle?.id ?? null
}

/** Scan all nodes to find the closest border-trigger node for a new connection */
function findNewConnectionProximity(
  flowPos: FlowPos,
  state: ReturnType<typeof useWorkflowStore.getState>,
  nodeLookup: ReactFlowState['nodeLookup'],
  sourceNodeId: string
): NewConnProximityResult {
  let closest: { id: string; distance: number } | null = null
  let nearestHandleEdge: string | null = null

  for (const node of state.nodes) {
    if (node.id === sourceNodeId) continue

    const internalNode = nodeLookup.get(node.id)
    const nodeAbsPos = internalNode?.internals.positionAbsolute ?? node.position
    const nodeW = internalNode?.measured?.width ?? 120
    const nodeH = internalNode?.measured?.height ?? 40

    const distance = distToNodeBounds(flowPos.x, flowPos.y, nodeAbsPos.x, nodeAbsPos.y, nodeW, nodeH)

    if (distance < BORDER_TRIGGER_RANGE && (!closest || distance < closest.distance)) {
      closest = { id: node.id, distance }
      nearestHandleEdge = findNearestHandleEdge(node, nodeLookup, flowPos, state.edges)
    }
  }

  return { closest, nearestHandleEdge }
}

interface ApplyNewConnectionProximityParams {
  closest: { id: string } | null
  nearestHandleEdge: string | null
  sourceNodeId: string
  edges: ReturnType<typeof useWorkflowStore.getState>['edges']
  validate: NewConnectionHandlerSetters['validate']
  setNewConnProximityTargetId: (id: string | null) => void
  setCycleDetectedNodeId: (id: string | null) => void
  setReplacementEdgeId: (id: string | null) => void
}

/** Apply new connection proximity state based on validation results */
function applyNewConnectionProximity({
  closest,
  nearestHandleEdge,
  sourceNodeId,
  edges,
  validate,
  setNewConnProximityTargetId,
  setCycleDetectedNodeId,
  setReplacementEdgeId,
}: ApplyNewConnectionProximityParams): void {
  if (!closest) {
    setNewConnProximityTargetId(null)
    setCycleDetectedNodeId(null)
    setReplacementEdgeId(null)
    return
  }

  const isCycle = wouldCreateCycle(sourceNodeId, closest.id, edges)
  const isCrossScope = !isCycle &&
    validate({ source: sourceNodeId, target: closest.id }).reason === 'cross-scope'

  if (isCycle || isCrossScope) {
    setNewConnProximityTargetId(null)
    setCycleDetectedNodeId(closest.id)
    setReplacementEdgeId(null)
    return
  }

  setNewConnProximityTargetId(closest.id)
  setCycleDetectedNodeId(null)
  setReplacementEdgeId(nearestHandleEdge)
}

/**
 * Create a mousemove handler for new connection proximity.
 *
 * Tracks cursor position near target nodes, shows dynamic "+" handle,
 * detects cycles/cross-scope, and identifies occupied handles for replacement.
 */
export function createNewConnectionMouseMoveHandler(setters: NewConnectionHandlerSetters): (e: MouseEvent) => void {
  let lastMoveTime = 0
  const {
    sourceNodeId,
    setNewConnProximityTargetId,
    setCycleDetectedNodeId,
    setReplacementEdgeId,
    screenToFlowPosition,
    rfStoreApi,
    validate,
  } = setters

  return (e: MouseEvent) => {
    const now = Date.now()
    if (now - lastMoveTime < 32) return
    lastMoveTime = now

    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const state = useWorkflowStore.getState()
    const nodeLookup = rfStoreApi.getState().nodeLookup

    const { closest, nearestHandleEdge } = findNewConnectionProximity(
      flowPos, state, nodeLookup, sourceNodeId
    )

    applyNewConnectionProximity({
      closest,
      nearestHandleEdge,
      sourceNodeId,
      edges: state.edges,
      validate,
      setNewConnProximityTargetId,
      setCycleDetectedNodeId,
      setReplacementEdgeId,
    })
  }
}
