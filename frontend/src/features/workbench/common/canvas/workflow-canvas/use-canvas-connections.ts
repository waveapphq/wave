/**
 * useCanvasConnections - Edge connection and relocation logic
 *
 * Handles connect start/end, edge relocation via handle drag,
 * proximity snap to input handles, cycle detection, and scope
 * validation during edge operations.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type OnConnect,
  type Connection,
  type Edge,
  useReactFlow,
  useUpdateNodeInternals,
  useStoreApi,
} from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useConnectionValidator } from '@/features/workbench/hooks/use-connection-validator'
import {
  createRelocationMouseMoveHandler,
  createNewConnectionMouseMoveHandler,
} from './connection-mousemove-handlers'
import { processConnectEnd } from './connection-end-handler'
import { createOnConnectHandler } from './connection-on-connect'

interface UseCanvasConnectionsParams {
  isExecuting: boolean
}

export function useCanvasConnections({ isExecuting }: UseCanvasConnectionsParams) {
  const { screenToFlowPosition } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const rfStoreApi = useStoreApi()
  const storeNodes = useWorkflowStore((state) => state.nodes)
  const storeEdges = useWorkflowStore((state) => state.edges)
  const addStoreEdge = useWorkflowStore((state) => state.addEdge)
  const relocateEdge = useWorkflowStore((state) => state.relocateEdge)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const { validate } = useConnectionValidator({ edges: storeEdges, nodes: storeNodes })

  // Edge relocation state - tracks edge being dragged from handle for reconnection
  const [relocatingEdgeId, setRelocatingEdgeId] = useState<string | null>(null)
  // Track cursor position for ghost edge (from source's egress to cursor/snap target)
  const [relocDragPos, setRelocDragPos] = useState<{ x: number; y: number } | null>(null)
  // Ref for relocation proximity target - always current (avoids stale closure in handleConnectEnd)
  const relocProximityTargetRef = useRef<string | null>(null)
  // State for rendering proximity glow on target node's input handle
  const [relocProximityTargetId, setRelocProximityTargetId] = useState<string | null>(null)
  // Whether edge is snapped to a specific handle (vs just near a node border)
  const [isSnappedToHandle, setIsSnappedToHandle] = useState(false)
  // Cycle detection - node ID where connecting would create a cycle
  const [cycleDetectedNodeId, setCycleDetectedNodeId] = useState<string | null>(null)
  // Edge that will be replaced if user drops on its occupied handle. We keep
  // a ref mirror alongside the state because the connection-end-handler (which
  // runs in a callback wired into the long-lived `handleConnectEnd` closure)
  // needs the CURRENT value, not whatever the state was at handler creation.
  const [replacementEdgeId, setReplacementEdgeId] = useState<string | null>(null)
  const replacementEdgeIdRef = useRef<string | null>(null)
  const syncReplacementEdgeId = useCallback((id: string | null) => {
    replacementEdgeIdRef.current = id
    setReplacementEdgeId(id)
  }, [])
  // Whether cursor is hovering over the ghost edge's X label (drop = delete)
  const [isOverDeleteX, setIsOverDeleteX] = useState(false)
  const isOverDeleteXRef = useRef(false)
  // New connection proximity - tracks nearest target during new edge drags (not relocation)
  const [newConnProximityTargetId, setNewConnProximityTargetId] = useState<string | null>(null)
  const newConnMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null)

  // Detect occupied handle drag - enter edge relocation mode
  const relocatingEdgeRef = useRef<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } | null>(null)
  const relocMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null)

  // Clean up mousemove listeners on unmount
  useEffect(() => {
    return () => {
      if (relocMouseMoveRef.current) {
        document.removeEventListener('mousemove', relocMouseMoveRef.current)
        relocMouseMoveRef.current = null
      }
      if (newConnMouseMoveRef.current) {
        document.removeEventListener('mousemove', newConnMouseMoveRef.current)
        newConnMouseMoveRef.current = null
      }
    }
  }, [])

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleType: 'source' | 'target' | null; handleId: string | null }) => {
      if (!params.nodeId || !params.handleType) return
      if (isExecuting) return

      // Set dragging edge state for dynamic ingress "+" handle
      useWorkflowStore.getState().setDraggingEdge(true, params.nodeId)

      // Find existing edge on this handle
      // For branching controls, match by sourceHandle to relocate the correct branch edge
      let existingEdge
      if (params.handleType === 'source') {
        existingEdge = params.handleId
          ? storeEdges.find((e) => e.source === params.nodeId && e.sourceHandle === params.handleId)
          : storeEdges.find((e) => e.source === params.nodeId && !e.sourceHandle)
      } else {
        existingEdge = params.handleId
          ? storeEdges.find((e) => e.target === params.nodeId && e.targetHandle === params.handleId)
          : storeEdges.find((e) => e.target === params.nodeId && !e.targetHandle)
      }

      if (existingEdge) {
        relocatingEdgeRef.current = { id: existingEdge.id, source: existingEdge.source, target: existingEdge.target, sourceHandle: existingEdge.sourceHandle, targetHandle: existingEdge.targetHandle }
        setRelocatingEdgeId(existingEdge.id)

        const handler = createRelocationMouseMoveHandler({
          relocatingEdgeRef,
          relocProximityTargetRef,
          isOverDeleteXRef,
          setRelocProximityTargetId,
          setCycleDetectedNodeId,
          setRelocDragPos,
          setIsSnappedToHandle,
          setIsOverDeleteX,
          setReplacementEdgeId: syncReplacementEdgeId,
          screenToFlowPosition,
          rfStoreApi,
          validate,
        })
        relocMouseMoveRef.current = handler
        document.addEventListener('mousemove', handler)
      } else {
        const handler = createNewConnectionMouseMoveHandler({
          sourceNodeId: params.nodeId,
          setNewConnProximityTargetId,
          setCycleDetectedNodeId,
          setReplacementEdgeId: syncReplacementEdgeId,
          screenToFlowPosition,
          rfStoreApi,
          validate,
        })
        newConnMouseMoveRef.current = handler
        document.addEventListener('mousemove', handler)
      }
    },
    [storeEdges, screenToFlowPosition, rfStoreApi, isExecuting, validate]
  )

  // Handle new connections (manual drag between handles)
  // During relocation, this is ignored - handleConnectEnd handles reconnection via snap ref
  const onConnect: OnConnect = useCallback(
    createOnConnectHandler({
      isExecuting,
      relocatingEdgeRef,
      relocProximityTargetRef,
      setRelocatingEdgeId,
      setRelocDragPos,
      setRelocProximityTargetId,
      validate,
      addStoreEdge,
      relocateEdge,
      updateNodeInternals,
    }),
    [validate, addStoreEdge, relocateEdge, setEdges, isExecuting]
  )

  // Handle connect end - unified relocation logic for both ingress and egress drags
  const handleConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent) => {
      processConnectEnd({
        relocatingEdgeRef,
        relocProximityTargetRef,
        replacementEdgeIdRef,
        isOverDeleteXRef,
        relocMouseMoveRef,
        newConnMouseMoveRef,
        setRelocatingEdgeId,
        setRelocDragPos,
        setRelocProximityTargetId,
        setIsSnappedToHandle,
        setCycleDetectedNodeId,
        setReplacementEdgeId: syncReplacementEdgeId,
        setIsOverDeleteX,
        setNewConnProximityTargetId,
        relocateEdge,
        updateNodeInternals,
        validate,
      })
    },
    [relocateEdge, addStoreEdge, updateNodeInternals, validate, syncReplacementEdgeId]
  )

  // isValidConnection: during relocation, allow connections that would normally be rejected
  // by has-egress (since the old edge is being replaced)
  // Uses ref (not state) because React Flow captures this callback before state propagates
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target) return false
      const result = validate(connection)
      if (result.valid) return true
      // Cross-scope is always rejected - no exceptions, no bypasses
      if (result.reason === 'cross-scope') return false
      // During relocation, allow has-egress/has-ingress (old edge will be swapped)
      if (relocatingEdgeRef.current && (result.reason === 'has-egress' || result.reason === 'has-ingress')) {
        return true
      }
      // Allow 'duplicate' iff the drop is on an OCCUPIED ingress handle -
      // that edge will be removed by the REPLACE flow, so the resulting
      // state has no surviving same-source-same-target pair. Both
      // relocation (drag an existing edge end) and a fresh new connection
      // (drag from an unwired source handle) take this exception.
      // Convergence onto a NEW slot (no existing edge on the dropped
      // handle) stays rejected because it would leave a structural duplicate.
      if (result.reason === 'duplicate') {
        const droppedTargetHandle = (connection as Connection).targetHandle ?? undefined
        const state = useWorkflowStore.getState()
        const relocId = relocatingEdgeRef.current?.id
        const existingOnHandle = droppedTargetHandle
          ? state.edges.find(
              (e) =>
                e.target === connection.target &&
                e.targetHandle === droppedTargetHandle &&
                e.id !== relocId,
            )
          : state.edges.find(
              (e) =>
                e.target === connection.target &&
                !e.targetHandle &&
                e.id !== relocId,
            )
        if (existingOnHandle) {
          // After REPLACE, both the relocated edge (if any) AND
          // existingOnHandle are accounted for. Allow only if no other
          // same-source/same-target edge survives.
          const remainingDup = state.edges.some(
            (e) =>
              e.id !== relocId &&
              e.id !== existingOnHandle.id &&
              e.source === connection.source &&
              e.target === connection.target,
          )
          if (!remainingDup) return true
        }
      }
      return false
    },
    [validate]
  )

  return {
    relocatingEdgeId,
    relocDragPos,
    relocatingEdgeRef,
    relocProximityTargetId,
    newConnProximityTargetId,
    cycleDetectedNodeId,
    replacementEdgeId,
    isSnappedToHandle,
    isOverDeleteX,
    handleConnectStart,
    onConnect,
    handleConnectEnd,
    isValidConnection,
  }
}
