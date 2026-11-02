/**
 * Quick-add insert semantics (REQ-4.2.5, CANVAS-225/226): executes the two
 * insert modes against the workflow store, reusing the promoted node
 * builders + egress connect helper so quick-add and palette drop share
 * construction and wiring.
 */

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePaletteUsageStore } from '@/features/workbench/stores/palette-usage-store'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import type { QuickAddItem } from '@/features/workbench/lib/quick-add-catalog'
import {
  generateNodeId,
  START_NODE_ID,
  START_NODE_POSITION,
} from '../workflow-canvas/canvas-constants'
import {
  buildLocalFunctionNode,
  buildPaletteNode,
  buildPublishedFunctionNode,
  connectFromFirstFreeEgress,
  type NewNode,
} from '../workflow-canvas/node-builders'
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
}

interface StoreSelectionSlice {
  lastInteractedNodeId: string | null
  selectedNodeIds: string[]
}

interface ActiveNode {
  id: string
  position: { x: number; y: number }
}

interface ResolvedAnchor {
  id: string
  position: { x: number; y: number }
}

/** Single selection -> last interacted -> end of the flow; a stale candidate
 *  is skipped rather than dropping to center, so Enter always has an anchor. */
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
  // End of the flow: the last terminal block; the Start block when the canvas
  // (or Function body) is empty - implicit inside a body, a real node at root.
  const sources = new Set(activeEdges.map((edge) => edge.source))
  const tail = activeNodes.findLast((node) => !sources.has(node.id))
  return tail ?? { id: START_NODE_ID, position: START_NODE_POSITION }
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

/** Insert `item` per the approved mode semantics; returns the new node id,
 *  or null when the insert is rejected (published-Function self-nesting). */
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
  const position = anchor
    ? { x: anchor.position.x, y: anchor.position.y + ANCHOR_VERTICAL_GAP }
    : deps.viewportCenter

  const newNodeId = generateNodeId()
  const newNode = buildNodeForItem(
    item,
    newNodeId,
    position,
    activeNodes as ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
  )
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
    // An empty Function body has no Start node to look up: its Start is
    // implicit, with a single always-free egress, so wire it directly.
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

  // The placed element is always selected, replacing any current selection,
  // and becomes the new "last interacted" block (via selectNode).
  store.selectNode(newNodeId)
  // An anchored insert can land past the edge of what the canvas is showing.
  if (deps.isPlacementVisible && !deps.isPlacementVisible(position)) {
    store.requestFocus(newNodeId)
  }
  return newNodeId
}
