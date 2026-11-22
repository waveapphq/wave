/** Quick Insert placement (REQ-4.2.5, CANVAS-225, CANVAS-226, CANVAS-249), shared with palette drop. */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import type { QuickAddItem } from '@/features/workbench/lib/quick-add-catalog'
import {
  generateNodeId,
  START_NODE_ID,
  START_NODE_POSITION,
  START_NODE_WIDTH,
} from '../workflow-canvas/canvas-constants'
import {
  buildLocalFunctionNode,
  buildPaletteNode,
  buildPublishedFunctionNode,
  connectFromFirstFreeEgress,
  findFirstFreeEgress,
  type NewNode,
} from '../workflow-canvas/node-builders'
import { computeFreshNodeWidth } from '../workflow-node/node-width'
import type { QuickAddInsertMode } from './quick-add-popover'

/** Anchored inserts place the new node one row below the anchor. */
const ANCHOR_VERTICAL_GAP = 140

export interface QuickAddInsertDeps {
  validate: (params: {
    source: string
    target: string
    sourceHandle?: string
  }) => { valid: boolean }
  toast: { error: (message: string) => void } | null
  viewportCenter: { x: number; y: number }
  drilledFunctionIds: ReadonlySet<string>
  /** Whether a placed block would sit fully inside the visible canvas. */
  isPlacementVisible?: (position: { x: number; y: number }) => boolean
  /** Flow center of a drawn node's source handle, or of the node with no handle named; null when not drawn. */
  resolveHandleCenter: (nodeId: string, sourceHandle?: string) => { x: number; y: number } | null
}

interface StoreSelectionSlice {
  lastInteractedNodeId: string | null
  selectedNodeIds: string[]
}

interface ActiveNode {
  id: string
  type: NewNode['type']
  position: { x: number; y: number }
  data: NewNode['data']
}

interface ResolvedAnchor {
  id: string
  position: { x: number; y: number }
}

/** Single selection, else last interacted, else end of flow; a stale candidate is skipped. */
function resolveAnchor(
  store: StoreSelectionSlice,
  activeNodes: ReadonlyArray<ActiveNode>,
  activeEdges: ReadonlyArray<{ source: string }>,
): ResolvedAnchor {
  const findActive = (id: string | null) =>
    id ? activeNodes.find((node) => node.id === id) : undefined
  const selected =
    store.selectedNodeIds.length === 1 ? findActive(store.selectedNodeIds[0]) : undefined
  if (selected) return selected
  const lastInteracted = findActive(store.lastInteractedNodeId)
  if (lastInteracted) return lastInteracted
  // End of the flow: the last terminal block, else Start (implicit in a Function body).
  const sources = new Set(activeEdges.map((edge) => edge.source))
  const tail = activeNodes.findLast((node) => !sources.has(node.id))
  return tail ?? { id: START_NODE_ID, position: START_NODE_POSITION }
}

/** The x of the anchor's first free egress, else its center (CANVAS-248, CANVAS-249). */
function resolveEgressCenterX(
  anchor: ResolvedAnchor,
  activeNodes: ReadonlyArray<ActiveNode>,
  activeEdges: ReadonlyArray<{ id: string; source: string; target: string; sourceHandle?: string }>,
  resolveHandleCenter: QuickAddInsertDeps['resolveHandleCenter'],
): number {
  const anchorNode = activeNodes.find((node) => node.id === anchor.id)
  const egress = anchorNode ? findFirstFreeEgress(anchorNode, activeEdges) : { free: false }
  const center = resolveHandleCenter(anchor.id, egress.free ? egress.sourceHandle : undefined)
  if (center) return center.x
  // Only Start is drawn without a store node.
  if (!anchorNode) return START_NODE_POSITION.x + START_NODE_WIDTH / 2
  return anchor.position.x + computeFreshNodeWidth(anchorNode) / 2
}

function buildNodeForItem(
  item: QuickAddItem,
  newNodeId: string,
  position: { x: number; y: number },
  existingNodes: ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
): NewNode {
  if (item.type === 'new-function') {
    return buildLocalFunctionNode(newNodeId, position, existingNodes)
  }
  if (item.type === 'function') {
    return buildPublishedFunctionNode(
      newNodeId,
      position,
      {
        functionId: item.functionId as string,
        name: item.name,
        version: item.version,
      },
      existingNodes,
    )
  }
  return buildPaletteNode(
    newNodeId,
    position,
    { id: item.id, name: item.name, type: item.type },
    existingNodes,
  )
}

/** Insert `item`; returns the new node id, or null when it is refused (Function self-nesting). */
export function performQuickAddInsert(
  item: QuickAddItem,
  mode: QuickAddInsertMode,
  deps: QuickAddInsertDeps,
): string | null {
  // Drop-path parity: a published Function cannot nest inside itself.
  if (
    item.type === 'function' &&
    deps.drilledFunctionIds.has(item.functionId as string)
  ) {
    deps.toast?.error('A Function cannot be nested inside itself')
    return null
  }

  const store = useWorkflowStore.getState()
  const active = walkActiveSubtree(
    store.nodes,
    store.edges,
    store.variables,
    store.drillPath,
  )
  const activeNodes = active.nodes
  const activeEdges = active.edges

  const anchor =
    mode === 'anchor'
      ? resolveAnchor(
          store,
          activeNodes as ReadonlyArray<ActiveNode>,
          activeEdges as ReadonlyArray<{ source: string }>,
        )
      : null
  const newNodeId = generateNodeId()
  const built = buildNodeForItem(
    item,
    newNodeId,
    deps.viewportCenter,
    activeNodes as ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
  )
  // Enter centers the new block under the egress it links from (CANVAS-249).
  const position = anchor
    ? {
        x:
          resolveEgressCenterX(
            anchor,
            activeNodes as ReadonlyArray<ActiveNode>,
            activeEdges as ReadonlyArray<{ id: string; source: string; target: string; sourceHandle?: string }>,
            deps.resolveHandleCenter,
          ) -
          computeFreshNodeWidth(built) / 2,
        y: anchor.position.y + ANCHOR_VERTICAL_GAP,
      }
    : deps.viewportCenter
  const newNode: NewNode = { ...built, position }
  store.addNode(newNode as unknown as Parameters<typeof store.addNode>[0])

  if (anchor) {
    const connected = connectFromFirstFreeEgress({
      anchorId: anchor.id,
      newNodeId,
      nodes: activeNodes as unknown as Parameters<
        typeof connectFromFirstFreeEgress
      >[0]['nodes'],
      edges: activeEdges as unknown as Parameters<
        typeof connectFromFirstFreeEgress
      >[0]['edges'],
      validate: deps.validate,
      addEdge: store.addEdge as unknown as Parameters<
        typeof connectFromFirstFreeEgress
      >[0]['addEdge'],
    })
    // An empty Function body's Start is implicit with one free egress, so wire it directly.
    if (
      !connected &&
      anchor.id === START_NODE_ID &&
      !activeNodes.some((node) => node.id === START_NODE_ID) &&
      deps.validate({ source: anchor.id, target: newNodeId }).valid
    ) {
      store.addEdge({
        id: `edge-${anchor.id}-${newNodeId}`,
        source: anchor.id,
        target: newNodeId,
      } as unknown as Parameters<typeof store.addEdge>[0])
    }
  }

  // Palette-usage tracking only fires for palette-sourced kinds (drop parity).
  if (item.type !== 'function' && item.type !== 'new-function') {
    usePaletteUsageStore.getState().trackUsage(item.id)
  }

  // The placed element becomes the only selection and the last interacted block.
  store.selectNode(newNodeId)
  // An anchored insert can land past the edge of what the canvas is showing.
  if (deps.isPlacementVisible && !deps.isPlacementVisible(position)) {
    store.requestFocus(newNodeId)
  }
  return newNodeId
}
