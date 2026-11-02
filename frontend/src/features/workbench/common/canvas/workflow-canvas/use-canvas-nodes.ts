/**
 * useCanvasNodes - Node computation for the workflow canvas
 *
 * Computes the combined node list (start + user + onboarding),
 * applying selection, execution status, and proximity state.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import {
  START_NODE_ID,
  START_NODE_POSITION,
  ONBOARDING_NODE_ID,
  ONBOARDING_NODE_POSITION,
} from './canvas-constants'

interface UseCanvasNodesParams {
  proximitySourceId: string | null
  relocProximityTargetId: string | null
  newConnProximityTargetId: string | null
  cycleDetectedNodeId: string | null
  isExecuting: boolean
}

export function useCanvasNodes({
  proximitySourceId,
  relocProximityTargetId,
  newConnProximityTargetId,
  cycleDetectedNodeId,
  isExecuting,
}: UseCanvasNodesParams) {
  const rootNodes = useWorkflowStore((state) => state.nodes)
  const rootEdges = useWorkflowStore((state) => state.edges)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const selectedNodeIds = useWorkflowStore((state) => state.selectedNodeIds)

  // Active subtree: root tree at top level, deepest Function's localDefinition
  // when drilled in. Recomputed when nodes/edges/drillPath change.
  const { storeNodes, storeEdges } = useMemo(() => {
    const active = walkActiveSubtree(rootNodes, rootEdges, [], drillPath)
    return { storeNodes: active.nodes, storeEdges: active.edges }
  }, [rootNodes, rootEdges, drillPath])

  // Check if Start node has an outgoing connection
  const startHasConnection = useMemo(() => {
    return storeEdges.some((edge) => edge.source === START_NODE_ID)
  }, [storeEdges])

  // Check if canvas is "empty" (only Start node, no user nodes)
  const isEmptyCanvas = storeNodes.length === 0

  // Create the Start node (always present)
  const startNode: Node = useMemo(
    () => ({
      id: START_NODE_ID,
      type: 'startNode',
      position: START_NODE_POSITION,
      data: {
        hasConnection: startHasConnection || !isEmptyCanvas,
        proximitySource: proximitySourceId === START_NODE_ID,
      },
      draggable: false,
      selectable: false,
    }),
    [startHasConnection, isEmptyCanvas, proximitySourceId]
  )

  // Create the onboarding placeholder node (only when empty, hidden during proximity drag)
  const onboardingNode: Node | null = useMemo(
    () =>
      isEmptyCanvas && proximitySourceId !== START_NODE_ID
        ? {
            id: ONBOARDING_NODE_ID,
            type: 'onboardingNode',
            position: ONBOARDING_NODE_POSITION,
            data: {},
            draggable: false,
            selectable: false,
          }
        : null,
    [isEmptyCanvas, proximitySourceId]
  )

  // Combine Start node with user nodes (and onboarding if empty)
  // Set selected property based on selectedNodeIds from store
  // Note: executionStatus is NOT injected here - each WorkflowNode subscribes directly
  // to its own block status via useBlockExecutionStatus (avoids O(N) re-renders per event)
  const allNodes = useMemo(() => {
    /* v8 ignore next - COV-DEF-041 */
    const selectedIds = selectedNodeIds ?? []

    const userNodes = storeNodes.map((node) => {
      return {
        ...node,
        selected: selectedIds.includes(node.id),
        data: {
          ...node.data,
          // Workflow-level executing flag for readonly enforcement
          /* v8 ignore next 7 - COV-BRANCH-135 */
          ...(isExecuting ? { isExecuting: true } : {}),
          // Proximity glow on output handle during drag
          ...(proximitySourceId === node.id ? { proximitySource: true } : {}),
          // Proximity glow on input handle during edge relocation or new connection
          ...((relocProximityTargetId === node.id || newConnProximityTargetId === node.id) ? { proximityTarget: true } : {}),
          // Cycle detection indicator
          ...(cycleDetectedNodeId === node.id ? { proximityCycleDetected: true } : {}),
        },
      }
    }) as Node[]

    const nodes: Node[] = [startNode, ...userNodes]
    if (onboardingNode) {
      nodes.push(onboardingNode)
    }
    return nodes
  }, [startNode, storeNodes, onboardingNode, selectedNodeIds, proximitySourceId, relocProximityTargetId, newConnProximityTargetId, cycleDetectedNodeId, isExecuting])

  return { allNodes, isEmptyCanvas, startHasConnection }
}
