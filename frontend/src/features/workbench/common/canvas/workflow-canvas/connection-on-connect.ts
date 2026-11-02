/**
 * onConnect Handler - New edge connection logic
 *
 * Handles new connections between handles, including:
 * - Convergence during relocation (multiple ingress edges)
 * - Dynamic ingress "+" handle connections
 * - Scope isolation validation
 * - Handle replacement semantics
 *
 * Extracted from use-canvas-connections.ts for modularity.
 */

import type { OnConnect } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type UpdateNodeInternals = ReturnType<typeof import('@xyflow/react').useUpdateNodeInternals>

interface RelocatingEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

interface CreateOnConnectParams {
  isExecuting: boolean
  relocatingEdgeRef: React.RefObject<RelocatingEdge | null>
  relocProximityTargetRef: React.RefObject<string | null>
  setRelocatingEdgeId: (id: string | null) => void
  setRelocDragPos: (pos: { x: number; y: number } | null) => void
  setRelocProximityTargetId: (id: string | null) => void
  validate: (connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => { valid?: boolean; reason?: string }
  addStoreEdge: (edge: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void
  relocateEdge: (oldId: string, newEdge: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void
  updateNodeInternals: UpdateNodeInternals
}

/** Clear the relocation refs/state after onConnect consumed the drop. */
function resetRelocationState(params: CreateOnConnectParams): void {
  params.relocatingEdgeRef.current = null
  params.setRelocatingEdgeId(null)
  params.setRelocDragPos(null)
  params.relocProximityTargetRef.current = null
  params.setRelocProximityTargetId(null)
}

/** True iff dropping ``oldEdge.source → targetNode`` would leave more than
 *  one same-source/same-target edge in place (ignoring the relocating edge
 *  itself and the REPLACE target). */
function wouldDuplicateAfterRelocation(
  edges: Array<{ id: string; source: string; target: string }>,
  oldEdge: { id: string; source: string },
  targetNode: string,
  existingOnHandleId: string | undefined,
): boolean {
  return edges.some(
    (e) =>
      e.id !== oldEdge.id &&
      e.id !== existingOnHandleId &&
      e.source === oldEdge.source &&
      e.target === targetNode,
  )
}

/** Schedule a rAF re-measurement for the snap target (and the relocated
 *  edge's previous target when different). */
function scheduleRelocationRerender(
  updateNodeInternals: UpdateNodeInternals,
  targetNode: string,
  oldEdgeTarget: string,
): void {
  requestAnimationFrame(() => {
    updateNodeInternals(targetNode)
    if (oldEdgeTarget !== targetNode) {
      updateNodeInternals(oldEdgeTarget)
    }
  })
}

/** Relocation-mode onConnect: REPLACE on occupied handle, CONVERGENCE on a
 *  new slot, or fall through for the snap-target relocation handler. */
function handleRelocationOnConnect(
  connection: { source: string; target: string; targetHandle: string | null },
  params: CreateOnConnectParams,
): void {
  const oldEdge = params.relocatingEdgeRef.current!
  const targetNode = connection.target
  const state = useWorkflowStore.getState()
  const droppedTargetHandle = connection.targetHandle ?? undefined

  const existingOnHandle = state.edges.find(
    (e) =>
      e.target === targetNode &&
      e.id !== oldEdge.id &&
      (e.targetHandle ?? undefined) === droppedTargetHandle,
  )
  const targetHasIngress = state.edges.some(
    (e) => e.target === targetNode && e.id !== oldEdge.id,
  )

  const relocScopeCheck = params.validate({
    source: oldEdge.source,
    target: targetNode,
    sourceHandle: oldEdge.sourceHandle,
  })
  if (relocScopeCheck.reason === 'cross-scope') return
  if (
    relocScopeCheck.reason === 'duplicate' &&
    wouldDuplicateAfterRelocation(state.edges, oldEdge, targetNode, existingOnHandle?.id)
  ) {
    return
  }

  if (existingOnHandle) {
    useWorkflowStore.getState().removeEdge(existingOnHandle.id)
    params.relocateEdge(oldEdge.id, {
      id: `edge-${oldEdge.source}-${targetNode}-${Date.now()}`,
      source: oldEdge.source,
      target: targetNode,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: droppedTargetHandle,
    })
    scheduleRelocationRerender(params.updateNodeInternals, targetNode, oldEdge.target)
    resetRelocationState(params)
    return
  }

  if (targetHasIngress) {
    params.relocateEdge(oldEdge.id, {
      id: `edge-${oldEdge.source}-${targetNode}-${Date.now()}`,
      source: oldEdge.source,
      target: targetNode,
      sourceHandle: oldEdge.sourceHandle,
      targetHandle: droppedTargetHandle,
    })
    scheduleRelocationRerender(params.updateNodeInternals, targetNode, oldEdge.target)
    resetRelocationState(params)
  }
  // Non-convergence relocation is finalized by handleConnectEnd
  // (snap-target relocation in connection-end-handler).
}

/** New-connection onConnect: drop on empty handle = add, drop on occupied
 *  handle = REPLACE (with duplicate-fallthrough exemption). */
function handleNewConnectionOnConnect(
  connection: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null },
  params: CreateOnConnectParams,
): void {
  const result = params.validate({
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  })

  const targetHandle = connection.targetHandle
  const state = useWorkflowStore.getState()
  const existingOnHandle = targetHandle
    ? state.edges.find(
        (e) => e.target === connection.target && e.targetHandle === targetHandle,
      )
    : state.edges.find(
        (e) => e.target === connection.target && !e.targetHandle,
      )

  if (!result.valid) {
    if (result.reason !== 'duplicate' || !existingOnHandle) return
    const remainingDup = state.edges.some(
      (e) =>
        e.id !== existingOnHandle.id &&
        e.source === connection.source &&
        e.target === connection.target,
    )
    if (remainingDup) return
    // Fall through to the REPLACE branch.
  }

  if (existingOnHandle) {
    params.relocateEdge(existingOnHandle.id, {
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: targetHandle ?? undefined,
    })
    return
  }

  params.addStoreEdge({
    id: `edge-${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
  })
}

/**
 * Create the onConnect callback for React Flow.
 *
 * Handles new connections (manual drag between handles).
 * During relocation, convergence cases are handled here;
 * non-convergence relocation is handled by handleConnectEnd.
 */
export function createOnConnectHandler(params: CreateOnConnectParams): OnConnect {
  return (connection) => {
    if (!connection.source || !connection.target) return
    if (params.isExecuting) return
    if (params.relocatingEdgeRef.current) {
      handleRelocationOnConnect(
        { source: connection.source, target: connection.target, targetHandle: connection.targetHandle },
        params,
      )
      return
    }
    handleNewConnectionOnConnect(
      {
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      },
      params,
    )
  }
}
