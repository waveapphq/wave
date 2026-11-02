/**
 * GhostEdge Component Tests
 *
 * Tests for the GhostEdge component that renders a dashed SVG
 * line from source output handle to the current drag position.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GhostEdge } from '@/features/workbench/common/canvas/workflow-canvas/ghost-edge'

// ===========================================================================
// Mocks
// ===========================================================================

const mockFlowToScreen = vi.fn((p: { x: number; y: number }) => p)
let mockInternalNode: Record<string, unknown> | null = null

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ flowToScreenPosition: mockFlowToScreen }),
  useInternalNode: () => mockInternalNode,
}))

// ===========================================================================
// Tests
// ===========================================================================

describe('GhostEdge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowToScreen.mockImplementation((p: { x: number; y: number }) => p)
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 100, y: 200 },
        handleBounds: {
          source: [
            { id: 'default', x: 50, y: 40, width: 10, height: 10 },
          ],
        },
      },
      measured: { width: 120, height: 50 },
    }
  })

  it('returns null when internalNode is null', () => {
    mockInternalNode = null
    const { container } = render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 300, y: 400 }} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders SVG with correct path from handle position to target', () => {
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 300, y: 400 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    expect(svg).toBeDefined()
    expect(svg.tagName).toBe('svg')

    const path = svg.querySelector('path')
    expect(path).not.toBeNull()
    // Source position: nodePos(100,200) + handle(50,40) + handle.size/2(5,5) = (155, 245)
    // Target: (300, 400)
    // midY = (245 + 400) / 2 = 322.5
    expect(path!.getAttribute('d')).toBe('M 155 245 C 155 322.5, 300 322.5, 300 400')
    expect(path!.getAttribute('stroke')).toBe('#A1A1AA')
    expect(path!.getAttribute('stroke-dasharray')).toBe('6 4')
  })

  it('uses fallback dimensions when handle bounds are missing', () => {
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 0, y: 0 },
        handleBounds: { source: undefined },
      },
      measured: { width: 200, height: 80 },
    }
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 50, y: 100 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // Fallback: nodePos(0,0) + w/2(100), h(80) = (100, 80)
    // target: (50, 100), midY = (80 + 100) / 2 = 90
    expect(path!.getAttribute('d')).toBe('M 100 80 C 100 90, 50 90, 50 100')
  })

  it('uses default measured dimensions when measured is missing', () => {
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 0, y: 0 },
        handleBounds: {},
      },
      measured: undefined,
    }
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 60, y: 90 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // Default: w=120, h=50 -> (60, 50)
    // target: (60, 90), midY = (50 + 90) / 2 = 70
    expect(path!.getAttribute('d')).toBe('M 60 50 C 60 70, 60 70, 60 90')
  })

  it('accepts custom testId', () => {
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 50, y: 50 }} testId="custom-ghost" />
    )
    expect(screen.getByTestId('custom-ghost')).toBeDefined()
  })

  it('finds matching sourceHandleId from handle bounds', () => {
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 0, y: 0 },
        handleBounds: {
          source: [
            { id: 'pass', x: 20, y: 30, width: 10, height: 10 },
            { id: 'fail', x: 80, y: 30, width: 10, height: 10 },
          ],
        },
      },
      measured: { width: 120, height: 50 },
    }
    render(
      <GhostEdge sourceNodeId="node-1" sourceHandleId="fail" targetPos={{ x: 200, y: 200 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // 'fail' handle: nodePos(0,0) + handle(80,30) + size/2(5,5) = (85, 35)
    // target: (200, 200), midY = (35 + 200) / 2 = 117.5
    expect(path!.getAttribute('d')).toBe('M 85 35 C 85 117.5, 200 117.5, 200 200')
  })

  it('uses first handle as fallback when sourceHandleId does not match', () => {
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 0, y: 0 },
        handleBounds: {
          source: [
            { id: 'pass', x: 20, y: 30, width: 10, height: 10 },
          ],
        },
      },
      measured: { width: 120, height: 50 },
    }
    render(
      <GhostEdge sourceNodeId="node-1" sourceHandleId="nonexistent" targetPos={{ x: 100, y: 100 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // Falls back to first handle 'pass': (0+20+5, 0+30+5) = (25, 35)
    // target: (100, 100), midY = (35 + 100) / 2 = 67.5
    expect(path!.getAttribute('d')).toBe('M 25 35 C 25 67.5, 100 67.5, 100 100')
  })

  it('applies flowToScreenPosition transformation', () => {
    // Simulate a screen transform (2x scale, offset)
    mockFlowToScreen.mockImplementation((p: { x: number; y: number }) => ({
      x: p.x * 2 + 10,
      y: p.y * 2 + 20,
    }))
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 300, y: 400 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // Source flow: (155, 245) -> screen: (320, 510)
    // Target flow: (300, 400) -> screen: (610, 820)
    // midY = (510 + 820) / 2 = 665
    expect(path!.getAttribute('d')).toBe('M 320 510 C 320 665, 610 665, 610 820')
  })

  it('renders with correct SVG styling classes', () => {
    render(
      <GhostEdge sourceNodeId="node-1" targetPos={{ x: 50, y: 50 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    expect(svg.classList.contains('pointer-events-none')).toBe(true)
    expect(svg.classList.contains('fixed')).toBe(true)
    expect(svg.style.width).toBe('100vw')
    expect(svg.style.height).toBe('100vh')
  })

  it('uses first handle when sourceHandleId is null', () => {
    mockInternalNode = {
      internals: {
        positionAbsolute: { x: 10, y: 20 },
        handleBounds: {
          source: [
            { id: 'default', x: 50, y: 40, width: 10, height: 10 },
          ],
        },
      },
      measured: { width: 120, height: 50 },
    }
    render(
      <GhostEdge sourceNodeId="node-1" sourceHandleId={null} targetPos={{ x: 100, y: 200 }} />
    )
    const svg = screen.getByTestId('proximity-ghost-edge')
    const path = svg.querySelector('path')
    // nodePos(10,20) + handle(50,40) + size/2(5,5) = (65, 65)
    // target: (100, 200), midY = (65 + 200) / 2 = 132.5
    expect(path!.getAttribute('d')).toBe('M 65 65 C 65 132.5, 100 132.5, 100 200')
  })
})
