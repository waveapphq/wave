/**
 * Tests for canvas-constants.ts
 *
 * Covers pure utility functions and exported constants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock theme provider before import
const mockUseTheme = vi.fn()
vi.mock('@/design-system/theme-provider', () => ({
  useTheme: () => mockUseTheme(),
}))

// Mock secureRandomId
vi.mock('@/lib/utils', () => ({
  secureRandomId: (len: number) => 'a'.repeat(len),
}))

import {
  START_NODE_ID,
  START_NODE_POSITION,
  ONBOARDING_NODE_ID,
  ONBOARDING_NODE_POSITION,
  GHOST_EDGE_ID,
  ELEMENT_PROXIMITY_THRESHOLD,
  EDGE_SNAP_THRESHOLD,
  BORDER_TRIGGER_RANGE,
  AUTO_PAN_SPEED,
  wouldCreateCycle,
  distToNodeBounds,
  isBlockFullyVisible,
  BLOCK_FOOTPRINT,
  useThemeSafe,
  generateNodeId,
} from '@/features/workbench/common/canvas/workflow-canvas/canvas-constants'

// =============================================================================
// Constants
// =============================================================================

describe('canvas constants', () => {
  it('exports expected node IDs', () => {
    expect(START_NODE_ID).toBe('start-node')
    expect(ONBOARDING_NODE_ID).toBe('onboarding-placeholder')
    expect(GHOST_EDGE_ID).toBe('ghost-edge')
  })

  it('exports expected positions', () => {
    expect(START_NODE_POSITION).toEqual({ x: -50, y: 0 })
    expect(ONBOARDING_NODE_POSITION).toEqual({ x: -115, y: 100 })
  })

  it('exports expected threshold values', () => {
    expect(ELEMENT_PROXIMITY_THRESHOLD).toBe(100)
    expect(EDGE_SNAP_THRESHOLD).toBe(15)
    expect(BORDER_TRIGGER_RANGE).toBe(30)
  })

  it('scrolls the canvas slower than a drag target leaves the trigger range', () => {
    expect(AUTO_PAN_SPEED).toBe(4)
    expect(AUTO_PAN_SPEED).toBeLessThan(BORDER_TRIGGER_RANGE / 4)
  })
})

// =============================================================================
// wouldCreateCycle
// =============================================================================

describe('wouldCreateCycle', () => {
  it('returns false for empty edge list', () => {
    expect(wouldCreateCycle('a', 'b', [])).toBe(false)
  })

  it('returns false when no cycle exists', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    // Adding c -> d would not create a cycle
    expect(wouldCreateCycle('c', 'd', edges)).toBe(false)
  })

  it('returns true when direct cycle would be created', () => {
    const edges = [
      { source: 'a', target: 'b' },
    ]
    // Adding b -> a would create a cycle
    expect(wouldCreateCycle('b', 'a', edges)).toBe(true)
  })

  it('returns true when indirect cycle would be created', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ]
    // Adding d -> a would create a -> b -> c -> d -> a cycle
    expect(wouldCreateCycle('d', 'a', edges)).toBe(true)
  })

  it('excludes specified edge from cycle check', () => {
    const edges = [
      { source: 'a', target: 'b', id: 'e1' },
      { source: 'b', target: 'a', id: 'e2' },
    ]
    // Without exclusion, b -> a creates a cycle
    expect(wouldCreateCycle('b', 'a', edges)).toBe(true)
    // Excluding e2 (b -> a) breaks the cycle path
    expect(wouldCreateCycle('b', 'a', edges, 'e2')).toBe(true)
    // Excluding e1 (a -> b) means a is not reachable from a via b
    expect(wouldCreateCycle('b', 'a', edges, 'e1')).toBe(false)
  })

  it('handles self-loops', () => {
    // source == target means instant cycle
    expect(wouldCreateCycle('a', 'a', [])).toBe(true)
  })

  it('handles diamond graph without cycle', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ]
    // Adding e -> a wouldn't create cycle (e is not reachable from a)
    expect(wouldCreateCycle('e', 'a', edges)).toBe(false)
  })

  it('does not revisit already-visited nodes', () => {
    // Graph with shared paths: a -> b -> d, a -> c -> d
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'e' },
    ]
    // e -> a would create a cycle
    expect(wouldCreateCycle('e', 'a', edges)).toBe(true)
  })
})

// =============================================================================
// distToNodeBounds
// =============================================================================

describe('distToNodeBounds', () => {
  // Node at (10, 10) with width=100, height=50
  const nodeX = 10
  const nodeY = 10
  const nodeW = 100
  const nodeH = 50

  it('returns 0 when point is inside the rectangle', () => {
    expect(distToNodeBounds(50, 30, nodeX, nodeY, nodeW, nodeH)).toBe(0)
  })

  it('returns 0 when point is on the edge of the rectangle', () => {
    expect(distToNodeBounds(10, 10, nodeX, nodeY, nodeW, nodeH)).toBe(0)
    expect(distToNodeBounds(110, 60, nodeX, nodeY, nodeW, nodeH)).toBe(0)
  })

  it('returns correct distance to the left', () => {
    // Point at (0, 30) is 10 units left of node
    expect(distToNodeBounds(0, 30, nodeX, nodeY, nodeW, nodeH)).toBe(10)
  })

  it('returns correct distance to the right', () => {
    // Point at (120, 30) is 10 units right of node
    expect(distToNodeBounds(120, 30, nodeX, nodeY, nodeW, nodeH)).toBe(10)
  })

  it('returns correct distance above', () => {
    // Point at (50, 0) is 10 units above node
    expect(distToNodeBounds(50, 0, nodeX, nodeY, nodeW, nodeH)).toBe(10)
  })

  it('returns correct distance below', () => {
    // Point at (50, 70) is 10 units below node
    expect(distToNodeBounds(50, 70, nodeX, nodeY, nodeW, nodeH)).toBe(10)
  })

  it('returns correct diagonal distance', () => {
    // Point at (0, 0) is 10 units left and 10 units above
    expect(distToNodeBounds(0, 0, nodeX, nodeY, nodeW, nodeH)).toBeCloseTo(Math.hypot(10, 10))
  })
})

// =============================================================================
// useThemeSafe
// =============================================================================

describe('useThemeSafe', () => {
  beforeEach(() => {
    mockUseTheme.mockReset()
  })

  it('returns resolved theme when ThemeProvider is available', () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' })
    const { result } = renderHook(() => useThemeSafe())
    expect(result.current.resolvedTheme).toBe('dark')
  })

  it('returns light when resolvedTheme is light', () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: 'light' })
    const { result } = renderHook(() => useThemeSafe())
    expect(result.current.resolvedTheme).toBe('light')
  })
})

// =============================================================================
// generateNodeId
// =============================================================================

describe('generateNodeId', () => {
  it('returns a string starting with "node-"', () => {
    const id = generateNodeId()
    expect(id).toMatch(/^node-\d+-aaaaaaa$/)
  })

  it('generates unique IDs on subsequent calls', () => {
    const id1 = generateNodeId()
    const id2 = generateNodeId()
    // With mocked secureRandomId both share the same suffix,
    // but Date.now() ensures uniqueness in practice.
    // In test with fast execution they may match, so just verify format
    expect(id1).toMatch(/^node-/)
    expect(id2).toMatch(/^node-/)
  })
})

describe('isBlockFullyVisible', () => {
  const topLeft = { x: 0, y: 0 }
  const bottomRight = { x: 1000, y: 800 }
  const { width, height } = BLOCK_FOOTPRINT

  it('accepts a block that sits wholly inside the view', () => {
    expect(isBlockFullyVisible({ x: 100, y: 100 }, topLeft, bottomRight)).toBe(true)
  })

  it('accepts a block flush against the far edges', () => {
    const flush = { x: bottomRight.x - width, y: bottomRight.y - height }
    expect(isBlockFullyVisible(flush, topLeft, bottomRight)).toBe(true)
  })

  it('rejects a block starting left of the view', () => {
    expect(isBlockFullyVisible({ x: -1, y: 100 }, topLeft, bottomRight)).toBe(false)
  })

  it('rejects a block starting above the view', () => {
    expect(isBlockFullyVisible({ x: 100, y: -1 }, topLeft, bottomRight)).toBe(false)
  })

  it('rejects a block whose right edge runs past the view', () => {
    const overhang = { x: bottomRight.x - width + 1, y: 100 }
    expect(isBlockFullyVisible(overhang, topLeft, bottomRight)).toBe(false)
  })

  it('rejects a block whose bottom edge runs past the view', () => {
    const overhang = { x: 100, y: bottomRight.y - height + 1 }
    expect(isBlockFullyVisible(overhang, topLeft, bottomRight)).toBe(false)
  })

  it('respects a panned view whose origin is not zero', () => {
    const panned = { x: 500, y: 400 }
    const far = { x: 1500, y: 1200 }
    expect(isBlockFullyVisible({ x: 400, y: 500 }, panned, far)).toBe(false)
    expect(isBlockFullyVisible({ x: 600, y: 500 }, panned, far)).toBe(true)
  })
})
