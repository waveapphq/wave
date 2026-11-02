/**
 * useCanvasFocus Hook Tests (watch-mode).
 *
 * The focus hook pans the viewport to center the requested node, reading the
 * node position from the store's active drill subtree (so a focus after a scope
 * switch centers correctly), and always acknowledges the request. No highlight.
 * The default keeps the current zoom; focusOptions can override it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// ===========================================================================
// Mock state
// ===========================================================================

const mockSetCenter = vi.fn()
const mockGetViewport = vi.fn()

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter: mockSetCenter, getViewport: mockGetViewport }),
}))

const mockAcknowledgeFocus = vi.fn()
const mockGetActiveNodes = vi.fn()

const mockStoreState = {
  focusRequested: false,
  focusNodeId: null as string | null,
  focusOptions: null as { zoom?: number; duration?: number } | null,
  acknowledgeFocus: mockAcknowledgeFocus,
  getActiveNodes: mockGetActiveNodes,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
    { getState: () => mockStoreState },
  ),
}))

import { useCanvasFocus } from '@/features/workbench/hooks/use-canvas-focus'

// ===========================================================================
// Tests
// ===========================================================================

describe('useCanvasFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.focusRequested = false
    mockStoreState.focusNodeId = null
    mockStoreState.focusOptions = null
    mockGetActiveNodes.mockReturnValue([])
    mockGetViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.8 })
  })

  it('pans to center the node at the current zoom when no options are given', () => {
    mockGetActiveNodes.mockReturnValue([
      { id: 'node-1', position: { x: 100, y: 200 }, width: 160, height: 60 },
    ])

    const { rerender } = renderHook(() => useCanvasFocus())
    mockStoreState.focusRequested = true
    mockStoreState.focusNodeId = 'node-1'
    rerender()

    expect(mockSetCenter).toHaveBeenCalledWith(180, 230, { zoom: 0.8, duration: 400 })
    expect(mockAcknowledgeFocus).toHaveBeenCalled()
  })

  it('honors an explicit zoom and duration from focusOptions', () => {
    mockGetActiveNodes.mockReturnValue([
      { id: 'node-1', position: { x: 100, y: 200 }, width: 160, height: 60 },
    ])

    const { rerender } = renderHook(() => useCanvasFocus())
    mockStoreState.focusRequested = true
    mockStoreState.focusNodeId = 'node-1'
    mockStoreState.focusOptions = { zoom: 1.5, duration: 200 }
    rerender()

    expect(mockSetCenter).toHaveBeenCalledWith(180, 230, { zoom: 1.5, duration: 200 })
  })

  it('uses the fallback node size when width/height are absent', () => {
    mockGetActiveNodes.mockReturnValue([{ id: 'node-1', position: { x: 0, y: 0 } }])

    const { rerender } = renderHook(() => useCanvasFocus())
    mockStoreState.focusRequested = true
    mockStoreState.focusNodeId = 'node-1'
    rerender()

    expect(mockSetCenter).toHaveBeenCalledWith(60, 25, { zoom: 0.8, duration: 400 })
  })

  it('acknowledges without centering when the node is not in the active view', () => {
    mockGetActiveNodes.mockReturnValue([{ id: 'other', position: { x: 0, y: 0 } }])

    const { rerender } = renderHook(() => useCanvasFocus())
    mockStoreState.focusRequested = true
    mockStoreState.focusNodeId = 'gone'

    expect(() => rerender()).not.toThrow()

    expect(mockSetCenter).not.toHaveBeenCalled()
    expect(mockAcknowledgeFocus).toHaveBeenCalled()
  })

  it('does nothing while no focus is requested', () => {
    mockGetActiveNodes.mockReturnValue([
      { id: 'node-1', position: { x: 0, y: 0 }, width: 160, height: 60 },
    ])

    renderHook(() => useCanvasFocus())

    expect(mockSetCenter).not.toHaveBeenCalled()
    expect(mockAcknowledgeFocus).not.toHaveBeenCalled()
  })
})
