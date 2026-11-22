/** Canvas constants, utility functions and shared types. */

import { useTheme } from '@/design-system/theme-provider'
import { secureRandomId } from '@/lib/utils'

// Start node configuration
export const START_NODE_ID = 'start-node'
// Start is drawn at a fixed width so its center is x 0, the flow's main line (CANVAS-248).
export const START_NODE_WIDTH = 100
export const START_NODE_POSITION = { x: -START_NODE_WIDTH / 2, y: 0 }

// Onboarding placeholder configuration
export const ONBOARDING_NODE_ID = 'onboarding-placeholder'
// Centers the 220 px placeholder on x 0, under Start, so the edge between them is straight.
export const ONBOARDING_NODE_POSITION = { x: -110, y: 100 }
export const GHOST_EDGE_ID = 'ghost-edge'

// Distance for auto-connecting when dragging elements (palette drop, node drag proximity)
export const ELEMENT_PROXIMITY_THRESHOLD = 100
// Distance for snapping edge to a specific handle during edge drag
export const EDGE_SNAP_THRESHOLD = 15
// Distance from node border that triggers "+" ingress handle appearance (no snap)
export const BORDER_TRIGGER_RANGE = 30
// px per frame. React Flow's stock 15 outruns BORDER_TRIGGER_RANGE and pulls the target away.
export const AUTO_PAN_SPEED = 4
// Nominal block size, to check a placement against the viewport before the node is measured.
export const BLOCK_FOOTPRINT = { width: 200, height: 80 }

interface Point {
  x: number
  y: number
}

/** Whether a block placed at `position` sits wholly inside the visible canvas. */
export function isBlockFullyVisible(position: Point, topLeft: Point, bottomRight: Point): boolean {
  if (position.x < topLeft.x) return false
  if (position.y < topLeft.y) return false
  if (position.x + BLOCK_FOOTPRINT.width > bottomRight.x) return false
  return position.y + BLOCK_FOOTPRINT.height <= bottomRight.y
}

interface HandleBound {
  id?: string | null
  x: number
  y: number
  width: number
  height: number
}

/** The parts of a React Flow internal node that locate its source handles. */
export interface HandleMeasuredNode {
  internals: {
    positionAbsolute: Point
    handleBounds?: { source?: ReadonlyArray<HandleBound> | null } | null
  }
  measured?: { width?: number; height?: number }
}

/** Flow position of the named source handle, else the first one, else the node's bottom center. */
export function getSourceHandleCenter(node: HandleMeasuredNode, handleId?: string | null): Point {
  const nodePos = node.internals.positionAbsolute
  const handles = node.internals.handleBounds?.source
  const named = handleId ? handles?.find((h) => h.id === handleId) : undefined
  const handle = named ?? handles?.[0]
  if (handle) {
    return { x: nodePos.x + handle.x + handle.width / 2, y: nodePos.y + handle.y + handle.height / 2 }
  }
  const width = node.measured?.width ?? 120
  const height = node.measured?.height ?? 50
  return { x: nodePos.x + width / 2, y: nodePos.y + height }
}

/** Whether linking source to target would create a cycle. */
export function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  edges: Array<{ source: string; target: string; id?: string }>,
  excludeEdgeId?: string
): boolean {
  const visited = new Set<string>()
  const queue = [targetId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) {
      if (excludeEdgeId && edge.id === excludeEdgeId) continue
      if (edge.source === current) {
        queue.push(edge.target)
      }
    }
  }
  return false
}

/** Shortest distance from a point to a node's box; 0 inside it. */
export function distToNodeBounds(
  px: number, py: number,
  nodeX: number, nodeY: number, nodeW: number, nodeH: number
): number {
  const dx = Math.max(nodeX - px, 0, px - (nodeX + nodeW))
  const dy = Math.max(nodeY - py, 0, py - (nodeY + nodeH))
  return Math.hypot(dx, dy)
}

// Safe theme hook that handles missing ThemeProvider context
export function useThemeSafe(): { resolvedTheme: 'light' | 'dark' } {
  try {
    const theme = useTheme()
    return { resolvedTheme: theme.resolvedTheme }
    /* v8 ignore start - COV-JSDOM-004 */
  } catch {
    return { resolvedTheme: 'light' }
  }
  /* v8 ignore stop */
}

// Generate unique ID
export function generateNodeId(): string {
  return `node-${Date.now()}-${secureRandomId(7)}`
}

// Parse wave-block drop data
export interface WaveBlockData {
  id: string
  name: string
  type: 'plugin' | 'control'
}
