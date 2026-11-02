/**
 * useCanvasDrop - Drop handling for the workflow canvas
 *
 * Handles palette drag-and-drop, proximity feedback, and auto-connection
 * when dropping near free output handles.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { use, useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import { type Node, useReactFlow, useStoreApi } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { ToastContext } from '@/components/ui/toast'
import { useConnectionValidator } from '@/features/workbench/hooks/use-connection-validator'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import {
  findNodeDeepById,
  walkActiveSubtree,
} from '@/features/functions/canvas/inner-workflow'
import {
  START_NODE_ID,
  START_NODE_POSITION,
  ELEMENT_PROXIMITY_THRESHOLD,
  generateNodeId,
} from './canvas-constants'
import {
  buildLocalFunctionNode,
  buildPaletteNode,
  buildPublishedFunctionNode,
  getNodeOutputHandles,
  type DropPayload,
  type NewNode,
} from './node-builders'

function parseDropPayload(raw: string): DropPayload | null {
  try {
    return JSON.parse(raw) as DropPayload
  } catch {
    return null
  }
}

interface UseCanvasDropParams {
  isExecuting: boolean
}

/** One free egress lane at its own canvas position. */
interface FreeEgress {
  nodeId: string
  handle?: string
  pos: { x: number; y: number }
}

export function useCanvasDrop({ isExecuting }: UseCanvasDropParams) {
  const { screenToFlowPosition } = useReactFlow()
  const rfStoreApi = useStoreApi()
  // Use the active subtree (deepest drilled Function) for node lookups,
  // naming, and connection validation. Otherwise drops inside a drilled-in
  // Function name the new node based on root siblings (breaking the
  // per-scope counter) and connection validation runs against the wrong
  // sibling set.
  const rootNodes = useWorkflowStore((state) => state.nodes)
  const rootEdges = useWorkflowStore((state) => state.edges)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const { storeNodes, storeEdges } = useMemo(() => {
    const active = walkActiveSubtree(rootNodes, rootEdges, [], drillPath)
    return { storeNodes: active.nodes, storeEdges: active.edges }
  }, [rootNodes, rootEdges, drillPath])
  const toast = use(ToastContext)
  // The functionIds of every Function the user is currently drilled into.
  // Dropping one of these into the body would nest a Function inside itself.
  const drilledFunctionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of drillPath) {
      const node = findNodeDeepById(
        rootNodes as unknown as Array<{ id: string; data?: Record<string, unknown> }>,
        entry.nodeId,
      )
      const fid = (node?.data as { functionId?: string } | undefined)?.functionId
      if (typeof fid === 'string' && fid) ids.add(fid)
    }
    return ids
  }, [rootNodes, drillPath])
  const addNode = useWorkflowStore((state) => state.addNode)
  const addStoreEdge = useWorkflowStore((state) => state.addEdge)
  const trackUsage = usePaletteUsageStore((state) => state.trackUsage)
  const { validate } = useConnectionValidator({ edges: storeEdges, nodes: storeNodes })

  // Drag proximity feedback state - shows ghost edge when dragging near a free output
  const [proximitySourceId, setProximitySourceId] = useState<string | null>(null)
  // The exact lane the ghost edge leaves from and the drop will wire to
  const [proximitySourceHandle, setProximitySourceHandle] = useState<string | undefined>(undefined)
  // Track the current drag target position for ghost edge rendering
  const [proximityTargetPos, setProximityTargetPos] = useState<{ x: number; y: number } | null>(null)

  // Every free egress lane, each at its own position, so proximity can pick the
  // lane the pointer is under rather than the node as a whole.
  const findFreeEgressPoints = useCallback((): FreeEgress[] => {
    const points: FreeEgress[] = []
    const nodeLookup = rfStoreApi.getState().nodeLookup

    const collect = (id: string, position: { x: number; y: number }, handles: string[] | null) => {
      const internalNode = nodeLookup.get(id)
      const width = internalNode?.measured?.width ?? 120
      const height = internalNode?.measured?.height ?? 50
      // Where the handles have not been measured yet, every lane collapses onto
      // the node's bottom center and the first free one wins, as before.
      const fallback = { x: position.x + width / 2, y: position.y + height }
      const bounds = internalNode?.internals?.handleBounds?.source
      if (!handles) {
        points.push({ nodeId: id, pos: fallback })
        return
      }
      for (const handle of handles) {
        const bound = bounds?.find((b) => b.id === handle)
        points.push({
          nodeId: id,
          handle,
          pos: bound
            ? {
                x: position.x + bound.x + bound.width / 2,
                y: position.y + bound.y + bound.height / 2,
              }
            : fallback,
        })
      }
    }

    // Include Start node if it has no outgoing edge
    const startHasOutgoing = storeEdges.some((e) => e.source === START_NODE_ID)
    if (!startHasOutgoing) {
      collect(START_NODE_ID, START_NODE_POSITION, null)
    }

    for (const node of storeNodes) {
      const handles = getNodeOutputHandles(node)
      const usedHandles = new Set(
        storeEdges.filter((e) => e.source === node.id).map((e) => e.sourceHandle)
      )
      if (handles) {
        const free = handles.filter((h) => !usedHandles.has(h))
        if (free.length > 0) collect(node.id, node.position, free)
      } else if (usedHandles.size === 0) {
        collect(node.id, node.position, null)
      }
    }

    return points
  }, [storeEdges, storeNodes, rfStoreApi])

  // Closest free lane to a given position, or null when none is in reach
  const findClosestFreeEgress = useCallback(
    (dropPosition: { x: number; y: number }) => {
      let closest: { nodeId: string; handle?: string; distance: number } | null = null

      for (const point of findFreeEgressPoints()) {
        const dy = dropPosition.y - point.pos.y
        const distance = Math.hypot(dropPosition.x - point.pos.x, dy)

        // Only consider if drop is BELOW the lane and within threshold
        if (dy > -20 && distance < ELEMENT_PROXIMITY_THRESHOLD) {
          if (!closest || distance < closest.distance) {
            closest = { nodeId: point.nodeId, handle: point.handle, distance }
          }
        }
      }

      return closest
    },
    [findFreeEgressPoints]
  )

  // Find closest node with free output to a given position
  const findClosestFreeOutput = useCallback(
    (dropPosition: { x: number; y: number }) => findClosestFreeEgress(dropPosition)?.nodeId ?? null,
    [findClosestFreeEgress]
  )

  const connectFromEgress = useCallback(
    (egress: { nodeId: string; handle?: string }, targetId: string) => {
      const { nodeId, handle } = egress
      if (!validate({ source: nodeId, target: targetId, sourceHandle: handle }).valid) return
      const newEdge: { id: string; source: string; target: string; sourceHandle?: string } = {
        id: `edge-${nodeId}-${targetId}`,
        source: nodeId,
        target: targetId,
      }
      if (handle) newEdge.sourceHandle = handle
      addStoreEdge(newEdge)
    },
    [validate, addStoreEdge],
  )

  const tryAutoConnect = useCallback(
    (newNodeId: string, position: { x: number; y: number }) => {
      const egress = findClosestFreeEgress(position)
      if (egress) connectFromEgress(egress, newNodeId)
    },
    [findClosestFreeEgress, connectFromEgress],
  )

  const buildNodeForPayload = useCallback(
    (newNodeId: string, position: { x: number; y: number }, payload: DropPayload): NewNode => {
      if (payload.type === 'function-new-local') {
        return buildLocalFunctionNode(newNodeId, position, storeNodes)
      }
      if (payload.type === 'function-published') {
        return buildPublishedFunctionNode(newNodeId, position, payload, storeNodes)
      }
      return buildPaletteNode(newNodeId, position, payload, storeNodes)
    },
    [storeNodes],
  )

  // Handle drop from palette
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setProximitySourceId(null)
      setProximitySourceHandle(undefined)
      setProximityTargetPos(null)

      if (isExecuting) return
      if (!event.dataTransfer.types.includes('application/wave-block')) return

      const payload = parseDropPayload(event.dataTransfer.getData('application/wave-block'))
      if (!payload) return

      // Reject nesting a Function inside itself (dropping a published
      // instance whose functionId matches a Function the user is drilled into).
      if (payload.type === 'function-published' && drilledFunctionIds.has(payload.functionId)) {
        toast?.error('A Function cannot be nested inside itself')
        return
      }

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const newNodeId = generateNodeId()
      const newNode = buildNodeForPayload(newNodeId, position, payload)
      addNode(newNode)

      // Palette-usage tracking only fires for palette-sourced drops. Function
      // drops come from the "+" handle or the Library modal - separate
      // surfaces that are not tracked.
      if (payload.type !== 'function-new-local' && payload.type !== 'function-published') {
        trackUsage(payload.id)
      }

      tryAutoConnect(newNodeId, position)
    },
    [
      screenToFlowPosition,
      addNode,
      trackUsage,
      isExecuting,
      buildNodeForPayload,
      tryAutoConnect,
      drilledFunctionIds,
      toast,
    ],
  )

  // Allow drop + proximity feedback (throttled to avoid jank on large workflows)
  const lastDragOverRef = useRef(0)
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    // Block drag feedback while workflow is executing
    if (isExecuting) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    // Only show proximity feedback for wave-block drags
    if (!event.dataTransfer.types.includes('application/wave-block')) {
      setProximitySourceId(null)
      setProximitySourceHandle(undefined)
      setProximityTargetPos(null)
      return
    }

    // Throttle proximity checks (~30fps) - dragover fires at ~60fps
    const now = Date.now()
    if (now - lastDragOverRef.current < 32) return
    lastDragOverRef.current = now

    // Check proximity to free outputs (including Start node on empty canvas)
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const egress = findClosestFreeEgress(flowPos)
    setProximitySourceId(egress?.nodeId ?? null)
    setProximitySourceHandle(egress?.handle)
    setProximityTargetPos(egress ? flowPos : null)
  }, [screenToFlowPosition, findClosestFreeEgress, isExecuting])

  // Clear proximity state when drag leaves canvas (canceled drag, ESC, etc.)
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // Only clear when truly leaving the canvas - ignore child element transitions
    const related = event.relatedTarget as HTMLElement | null
    if (!related || !event.currentTarget.contains(related)) {
      setProximitySourceId(null)
      setProximitySourceHandle(undefined)
      setProximityTargetPos(null)
    }
  }, [])

  // Handle existing node drag - proximity feedback for unlinked nodes
  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Only show proximity for nodes without an incoming edge (unlinked)
      const hasIngress = storeEdges.some((e) => e.target === node.id)
      if (hasIngress) {
        setProximitySourceId(null)
        setProximitySourceHandle(undefined)
        setProximityTargetPos(null)
        return
      }

      // Use the node's top-center as the "input" position
      const nodeWidth = node.measured?.width ?? 120
      const nodeTopCenter = { x: node.position.x + nodeWidth / 2, y: node.position.y }
      const egress = findClosestFreeEgress(nodeTopCenter)
      // Don't show proximity to self
      const finalEgress = egress && egress.nodeId !== node.id ? egress : null
      setProximitySourceId(finalEgress?.nodeId ?? null)
      setProximitySourceHandle(finalEgress?.handle)
      setProximityTargetPos(finalEgress ? nodeTopCenter : null)
    },
    [storeEdges, findClosestFreeEgress]
  )

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Auto-connect if proximity was active
      if (proximitySourceId && proximitySourceId !== node.id) {
        connectFromEgress({ nodeId: proximitySourceId, handle: proximitySourceHandle }, node.id)
      }
      setProximitySourceId(null)
      setProximitySourceHandle(undefined)
      setProximityTargetPos(null)
    },
    [proximitySourceId, proximitySourceHandle, connectFromEgress]
  )

  return {
    proximitySourceId,
    proximitySourceHandle,
    proximityTargetPos,
    setProximitySourceId,
    setProximityTargetPos,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleNodeDrag,
    handleNodeDragStop,
    findClosestFreeOutput,
    // Shared with quick-add (CANVAS-226 drop-path parity)
    validate,
    drilledFunctionIds,
  }
}
