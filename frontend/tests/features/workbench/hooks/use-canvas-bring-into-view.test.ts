/**
 * useCanvasBringIntoView Hook Tests (WATCH-8).
 *
 * A watched build whose finished test does not fit the canvas even at its
 * smallest zoom keeps each new Block in view: the view pans just enough to show
 * a Block that would land off screen. A build that fits keeps its still view.
 * The request is always acknowledged.
 *
 * Canvas: 1000 x 600 px at zoom 0.5, viewport offset (500, 50).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockGetViewport = vi.fn()
const mockSetViewport = vi.fn()
const mockGetNodes = vi.fn()
const mockGetNodesBounds = vi.fn()

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => ({
    getViewport: mockGetViewport,
    setViewport: mockSetViewport,
    getNodes: mockGetNodes,
    getNodesBounds: mockGetNodesBounds,
  }),
  useStoreApi: () => ({
    getState: () => ({ width: 1000, height: 600, minZoom: 0.5, maxZoom: 2 }),
  }),
}))

const mockAcknowledge = vi.fn()
const mockGetActiveNodes = vi.fn()

const TALL_BUILD = { x: -80, y: 140, width: 160, height: 2860 }
const SHORT_BUILD = { x: -80, y: 140, width: 160, height: 353 }

const mockStoreState = {
  bringIntoViewRequested: false,
  bringIntoViewNodeId: null as string | null,
  mirrorBuildBounds: null as typeof TALL_BUILD | null,
  acknowledgeBringIntoView: mockAcknowledge,
  getActiveNodes: mockGetActiveNodes,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
    { getState: () => mockStoreState },
  ),
}))

import { useCanvasBringIntoView } from '@/features/workbench/hooks/use-canvas-bring-into-view'

function requestFor(nodeId: string) {
  const { rerender } = renderHook(() => useCanvasBringIntoView())
  mockStoreState.bringIntoViewRequested = true
  mockStoreState.bringIntoViewNodeId = nodeId
  rerender()
}

describe('useCanvasBringIntoView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.bringIntoViewRequested = false
    mockStoreState.bringIntoViewNodeId = null
    mockStoreState.mirrorBuildBounds = TALL_BUILD
    mockGetViewport.mockReturnValue({ x: 500, y: 50, zoom: 0.5 })
    mockGetNodes.mockReturnValue([{ id: 'start-node' }])
    mockGetNodesBounds.mockReturnValue({ x: -50, y: 0, width: 100, height: 44 })
    mockGetActiveNodes.mockReturnValue([
      { id: 'top', position: { x: -80, y: 140 }, width: 160 },
      { id: 'below', position: { x: -80, y: 1200 }, width: 160 },
      { id: 'unsized', position: { x: -100, y: 1200 } },
    ])
  })

  it('moves down just enough to show a new Block below a test too tall to fit', () => {
    requestFor('below')

    expect(mockSetViewport).toHaveBeenCalledWith({ x: 500, y: -90, zoom: 0.5 }, { duration: 0 })
    expect(mockAcknowledge).toHaveBeenCalled()
  })

  it('sizes a Block the canvas has not measured with the nominal Block footprint', () => {
    requestFor('unsized')

    expect(mockSetViewport).toHaveBeenCalledWith({ x: 500, y: -90, zoom: 0.5 }, { duration: 0 })
  })

  it('leaves the view alone for a Block already in view', () => {
    requestFor('top')

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockAcknowledge).toHaveBeenCalled()
  })

  it('keeps the still view of a build that fits, even for a Block off screen', () => {
    mockStoreState.mirrorBuildBounds = SHORT_BUILD

    requestFor('below')

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockAcknowledge).toHaveBeenCalled()
  })

  it('does nothing once no build is in progress', () => {
    mockStoreState.mirrorBuildBounds = null

    requestFor('below')

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockAcknowledge).toHaveBeenCalled()
  })

  it('acknowledges without moving when the Block is not in the active view', () => {
    requestFor('gone')

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockAcknowledge).toHaveBeenCalled()
  })

  it('does nothing while nothing is requested', () => {
    renderHook(() => useCanvasBringIntoView())

    expect(mockSetViewport).not.toHaveBeenCalled()
    expect(mockAcknowledge).not.toHaveBeenCalled()
  })
})
