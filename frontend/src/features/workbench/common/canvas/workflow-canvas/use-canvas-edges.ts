/**
 * useCanvasEdges - Edge computation for the workflow canvas
 *
 * Computes the combined edge list (store + ghost), applying
 * selection styles, execution coloring, relocation styling,
 * and reachability-based dimming.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useExecutionStore } from '@/features/workbench/stores/execution-store'
import { useHistoricalBlockStatuses } from '@/features/workbench/common/canvas/historical-block-states-context'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { START_NODE_ID, GHOST_EDGE_ID, ONBOARDING_NODE_ID } from './canvas-constants'

interface UseCanvasEdgesParams {
  isEmptyCanvas: boolean
  proximitySourceId: string | null
  relocatingEdgeId: string | null
  replacementEdgeId: string | null
  isSnappedToHandle: boolean
  isOverDeleteX: boolean
}

type EdgeStyle = { stroke: string; strokeWidth: number; opacity?: number }

/** Dimmed style for edges that were not traversed or are unreachable */
const DIMMED_STYLE: EdgeStyle = { stroke: '#71717A', strokeWidth: 1, opacity: 0.3 }
/** Green style for traversed edges */
const TRAVERSED_STYLE: EdgeStyle = { stroke: '#22C55E', strokeWidth: 2 }
/** Red style for failed path edges */
const FAILED_STYLE: EdgeStyle = { stroke: '#EF4444', strokeWidth: 2 }

interface BlockStates {
  [key: string]: { status?: string } | undefined
}

// --- Execution coloring helpers ---

/* v8 ignore start - COV-BRANCH-178 */
/** Compute style for pass/fail (split-mode) edges */
function computePassFailStyle(
  edge: Edge,
  blockStates: BlockStates
): EdgeStyle | undefined {
  if (edge.sourceHandle !== 'pass' && edge.sourceHandle !== 'fail') return undefined

  const sourceExecuted = Boolean(blockStates[edge.source]?.status)
  if (!sourceExecuted) return undefined

  const targetExecuted = Boolean(blockStates[edge.target]?.status)
  if (!targetExecuted) return DIMMED_STYLE

  return edge.sourceHandle === 'pass' ? TRAVERSED_STYLE : FAILED_STYLE
}
/* v8 ignore stop */

/* v8 ignore start - COV-BRANCH-181 */
/** Compute style for if/else branch edges */
function computeBranchStyle(
  edge: Edge,
  blockStates: BlockStates
): EdgeStyle | undefined {
  if (!edge.sourceHandle?.startsWith('branch_')) return undefined

  const sourceExecuted = Boolean(blockStates[edge.source]?.status)
  if (!sourceExecuted) return undefined

  // A skipped target means the lane was NOT taken (an un-taken Switch case is
  // painted skipped so the canvas can dim it).
  const targetStatus = blockStates[edge.target]?.status
  return targetStatus && targetStatus !== 'skipped' ? TRAVERSED_STYLE : DIMMED_STYLE
}
/* v8 ignore stop */

/* v8 ignore start - COV-BRANCH-183 */
/** Compute style for try/catch/finally/then path edges */
function computeTryCatchStyle(
  edge: Edge,
  blockStates: BlockStates
): EdgeStyle | undefined {
  const tryCatchHandles = ['try', 'catch', 'finally', 'then']
  if (!edge.sourceHandle || !tryCatchHandles.includes(edge.sourceHandle)) return undefined

  const sourceExecuted = Boolean(blockStates[edge.source]?.status)
  if (!sourceExecuted) return undefined

  return blockStates[edge.target]?.status ? TRAVERSED_STYLE : DIMMED_STYLE
}
/* v8 ignore stop */

/** Compute style for for-loop body/then path edges */
function computeForLoopStyle(
  edge: Edge,
  blockStates: BlockStates
): EdgeStyle | undefined {
  const forLoopHandles = ['body']
  if (!edge.sourceHandle || !forLoopHandles.includes(edge.sourceHandle)) return undefined

  const sourceExecuted = Boolean(blockStates[edge.source]?.status)
  if (!sourceExecuted) return undefined

  return blockStates[edge.target]?.status ? TRAVERSED_STYLE : DIMMED_STYLE
}

/** Compute style for general (non-handled) edges based on execution state */
function computeGeneralExecutionStyle(
  edge: Edge,
  blockStates: BlockStates,
  passThroughNodes: Set<string>
): EdgeStyle | undefined {
  // Only applies to edges without sourceHandle and without prior styling
  /* v8 ignore next - COV-BRANCH-184 */
  if (edge.sourceHandle) return undefined

  const sourceStatus = (edge.source === 'start-node' || passThroughNodes.has(edge.source))
    ? 'success'
    : blockStates[edge.source]?.status
  /* v8 ignore next 3 - COV-BRANCH-138 */
  const targetStatus = passThroughNodes.has(edge.target)
    ? 'success'
    : blockStates[edge.target]?.status

  /* v8 ignore next 2 - COV-BRANCH-139 */
  if (sourceStatus && targetStatus) return TRAVERSED_STYLE
  if (sourceStatus || targetStatus) return DIMMED_STYLE

  /* v8 ignore next 2 - COV-BRANCH-167 */
  return undefined
}

/** Compute the execution-based style for an edge, checking each category */
function computeExecutionStyle(
  edge: Edge,
  blockStates: BlockStates,
  passThroughNodes: Set<string>
): EdgeStyle | undefined {
  // Edge between two skipped nodes: execution never flowed through it
  // (cascade-from-parent or paired runtime skip), so dim instead of
  // showing the green traversed style. Without this, the body sub-graph
  // of a single-egress parent that was skip-blocked at pause would render
  // every internal edge in green even though no plugin actually ran.
  const sourceStatus = blockStates[edge.source]?.status
  const targetStatus = blockStates[edge.target]?.status
  if (sourceStatus === 'skipped' && targetStatus === 'skipped') {
    return DIMMED_STYLE
  }

  return computePassFailStyle(edge, blockStates)
    ?? computeBranchStyle(edge, blockStates)
    ?? computeTryCatchStyle(edge, blockStates)
    ?? computeForLoopStyle(edge, blockStates)
    ?? computeGeneralExecutionStyle(edge, blockStates, passThroughNodes)
}

// --- Overlay style helpers ---

/** Compute relocation overlay style (muted dashed + X label) */
function computeRelocationOverlay(
  edgeId: string,
  relocatingEdgeId: string | null,
  replacementEdgeId: string | null,
  isSnappedToHandle: boolean,
  isOverDeleteX: boolean
): Partial<Edge> {
  /* v8 ignore next - COV-BRANCH-185 */
  if (relocatingEdgeId !== edgeId && replacementEdgeId !== edgeId) return {}

  /* v8 ignore next 2 - COV-BRANCH-186 */
  const isHighlighted = isSnappedToHandle || replacementEdgeId === edgeId || isOverDeleteX
  const accentColor = isHighlighted ? '#EF4444' : '#71717A'

  return {
    style: { stroke: '#71717A', strokeWidth: 2, strokeDasharray: '6 4', opacity: 0.4 },
    label: '\u2715',
    labelStyle: { fill: accentColor, fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: '#27272A', stroke: accentColor, strokeWidth: 1 },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 99,
  }
}

/** Compute selection overlay style */
function computeSelectionOverlay(
  edgeId: string,
  selectedEdgeIdSet: Set<string>,
  relocatingEdgeId: string | null
): Partial<Edge> {
  if (!selectedEdgeIdSet.has(edgeId) || relocatingEdgeId === edgeId) return {}
  return { style: { stroke: '#A1A1AA', strokeWidth: 3 } }
}

/** Compute design-time dimming for unreachable edges */
function computeReachabilityDimming(
  edge: Edge,
  reachable: Set<string>,
  hasExecutionStyle: boolean,
  relocatingEdgeId: string | null,
  selectedEdgeIdSet: Set<string>
): Partial<Edge> {
  /* v8 ignore next 4 - COV-BRANCH-140 */
  if (hasExecutionStyle) return {}
  if (relocatingEdgeId === edge.id) return {}
  if (selectedEdgeIdSet.has(edge.id)) return {}
  if (reachable.has(edge.source)) return {}

  return { style: DIMMED_STYLE }
}

// --- Pre-computation helpers ---

/** Build the set of pass-through (Note) node IDs */
function buildPassThroughNodes(nodes: ReturnType<typeof useWorkflowStore.getState>['nodes']): Set<string> {
  const result = new Set<string>()
  for (const node of nodes) {
    /* v8 ignore next 3 - COV-BRANCH-179 */
    if ((node.data as Record<string, unknown>)?.elementType === 'note') {
      result.add(node.id)
    }
  }
  return result
}

/** Compute reachable node set from start-node via BFS */
function computeReachableNodes(edges: readonly Edge[]): Set<string> {
  const reachable = new Set<string>(['start-node'])
  const bfsQueue = ['start-node']
  while (bfsQueue.length > 0) {
    const nid = bfsQueue.shift()!
    for (const e of edges) {
      if (e.source === nid && !reachable.has(e.target)) {
        reachable.add(e.target)
        bfsQueue.push(e.target)
      }
    }
  }
  return reachable
}

interface StyleEdgeParams {
  edge: Edge
  executionStyle: EdgeStyle | undefined
  relocatingEdgeId: string | null
  replacementEdgeId: string | null
  isSnappedToHandle: boolean
  isOverDeleteX: boolean
  selectedEdgeIdSet: Set<string>
  reachable: Set<string>
}

/** Apply all styling layers to a single edge */
function styleEdge({
  edge,
  executionStyle,
  relocatingEdgeId,
  replacementEdgeId,
  isSnappedToHandle,
  isOverDeleteX,
  selectedEdgeIdSet,
  reachable,
}: StyleEdgeParams): Edge {
  return {
    ...edge,
    // Execution coloring (lowest priority - overridden by relocation/selection)
    ...(executionStyle ? { style: executionStyle } : {}),
    // Relocation overlay
    ...computeRelocationOverlay(edge.id, relocatingEdgeId, replacementEdgeId, isSnappedToHandle, isOverDeleteX),
    // Selection overlay
    ...computeSelectionOverlay(edge.id, selectedEdgeIdSet, relocatingEdgeId),
    // Reachability dimming (lowest priority)
    ...computeReachabilityDimming(edge, reachable, !!executionStyle, relocatingEdgeId, selectedEdgeIdSet),
  }
}

export function useCanvasEdges({
  isEmptyCanvas,
  proximitySourceId,
  relocatingEdgeId,
  replacementEdgeId,
  isSnappedToHandle,
  isOverDeleteX,
}: UseCanvasEdgesParams) {
  const rootNodes = useWorkflowStore((state) => state.nodes)
  const rootEdges = useWorkflowStore((state) => state.edges)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const selectedEdgeIds = useWorkflowStore((state) => state.selectedEdgeIds)

  // Active subtree: root tree at top level, deepest Function's localDefinition
  // when drilled in.
  const { storeNodes, storeEdges } = useMemo(() => {
    const active = walkActiveSubtree(rootNodes, rootEdges, [], drillPath)
    return { storeNodes: active.nodes, storeEdges: active.edges }
  }, [rootNodes, rootEdges, drillPath])

  // Historical block states (from the painted-replay context) take precedence
  // over the live execution store when present, so history canvases stay
  // insulated from the singleton store used by the live workbench.
  const historical = useHistoricalBlockStatuses()
  const liveBlockStates = useExecutionStore((state) => {
    if (!state.activeExecutionId) return null
    return state.executions[state.activeExecutionId]?.blocks ?? null
  })
  const blockStates: BlockStates | null = useMemo(() => {
    if (historical) {
      const out: BlockStates = {}
      for (const [id, status] of Object.entries(historical)) {
        out[id] = { status }
      }
      return out
    }
    return liveBlockStates as BlockStates | null
  }, [historical, liveBlockStates])

  // Ghost edge connecting Start to onboarding placeholder (only when empty, hidden during proximity drag)
  const ghostEdge: Edge | null = useMemo(
    () =>
      isEmptyCanvas && proximitySourceId !== START_NODE_ID
        ? {
            id: GHOST_EDGE_ID,
            source: START_NODE_ID,
            target: ONBOARDING_NODE_ID,
            type: 'smoothstep',
            style: {
              stroke: '#71717A',
              strokeWidth: 2,
              strokeDasharray: '6 4',
            },
            animated: false,
          }
        : null,
    [isEmptyCanvas, proximitySourceId]
  )

  // Combine store edges with ghost edge, apply selection styles
  const selectedEdgeIdSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds])
  const allEdges = useMemo(() => {
    const blockMap: BlockStates = blockStates ?? {}
    const passThroughNodes = buildPassThroughNodes(storeNodes)
    const reachable = computeReachableNodes(storeEdges as Edge[])

    const edges: Edge[] = (storeEdges as Edge[]).map((edge) => {
      const executionStyle = blockStates
        ? computeExecutionStyle(edge, blockMap, passThroughNodes)
        : undefined

      return styleEdge({
        edge,
        executionStyle,
        relocatingEdgeId,
        replacementEdgeId,
        isSnappedToHandle,
        isOverDeleteX,
        selectedEdgeIdSet,
        reachable,
      })
    })

    if (ghostEdge) {
      edges.push(ghostEdge)
    }
    return edges
  }, [storeEdges, storeNodes, ghostEdge, selectedEdgeIdSet, relocatingEdgeId, replacementEdgeId, isSnappedToHandle, isOverDeleteX, blockStates])

  return { allEdges }
}
