/**
 * Canvas Constants, Utility Functions, and Shared Types
 *
 * Extracted from canvas.tsx for modularity.
 */

import { useTheme } from '@/design-system/theme-provider'
import { secureRandomId } from '@/lib/utils'

// Start node configuration
export const START_NODE_ID = 'start-node'
// Start node width ~100px, so offset by 50 to center at x=0
export const START_NODE_POSITION = { x: -50, y: 0 }

// Onboarding placeholder configuration
export const ONBOARDING_NODE_ID = 'onboarding-placeholder'
// x=-115 places the onboarding node so its center lines up with the
// Start node's center, keeping the connecting smoothstep edge a
// straight vertical line with no step-bend. See
// `empty-state/onboarding-node-flow.tsx` for the actual rendered width.
export const ONBOARDING_NODE_POSITION = { x: -115, y: 100 }
export const GHOST_EDGE_ID = 'ghost-edge'

// Distance for auto-connecting when dragging elements (palette drop, node drag proximity)
export const ELEMENT_PROXIMITY_THRESHOLD = 100
// Distance for snapping edge to a specific handle during edge drag
export const EDGE_SNAP_THRESHOLD = 15
// Distance from node border that triggers "+" ingress handle appearance (no snap)
export const BORDER_TRIGGER_RANGE = 30
// px per frame. React Flow's stock 15 outruns BORDER_TRIGGER_RANGE and pulls the target away.
export const AUTO_PAN_SPEED = 4
// Nominal block size, for deciding whether a placement clears the viewport edges
// before the node is measured.
export const BLOCK_FOOTPRINT = { width: 200, height: 80 }

interface Point {
  x: number
  y: number
}

/** Whether a block placed at `position` sits wholly inside the visible canvas.
 *  The whole block has to clear the edges, not just its top-left corner. */
export function isBlockFullyVisible(position: Point, topLeft: Point, bottomRight: Point): boolean {
  if (position.x < topLeft.x) return false
  if (position.y < topLeft.y) return false
  if (position.x + BLOCK_FOOTPRINT.width > bottomRight.x) return false
  return position.y + BLOCK_FOOTPRINT.height <= bottomRight.y
}

/**
 * Check if connecting source -> target would create a cycle.
 * BFS from target following existing edges to see if source is reachable.
 */
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

/**
 * Compute shortest distance from a point to a node's bounding rectangle.
 * Returns 0 if the point is inside the rectangle.
 */
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
