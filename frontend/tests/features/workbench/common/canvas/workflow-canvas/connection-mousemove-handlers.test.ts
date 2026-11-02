/**
 * Tests for connection-mousemove-handlers.ts
 *
 * Covers:
 * - createRelocationMouseMoveHandler (throttle, proximity, cycle, cross-scope, snap, delete X)
 * - createNewConnectionMouseMoveHandler (throttle, proximity, cycle, cross-scope, replacement)
 * - Internal pure functions via the handler factories
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock workflow store
let mockStoreState: {
  nodes: Array<{ id: string; position: { x: number; y: number } }>
  edges: Array<{ id: string; source: string; target: string; targetHandle?: string }>
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mockStoreState,
  },
}))

import {
  createRelocationMouseMoveHandler,
  createNewConnectionMouseMoveHandler,
  type RelocationHandlerSetters,
  type NewConnectionHandlerSetters,
} from '@/features/workbench/common/canvas/workflow-canvas/connection-mousemove-handlers'

// Helper to create a node lookup map entry
function createNodeLookupEntry(
  id: string,
  posX: number,
  posY: number,
  width: number,
  height: number,
  targetHandles: Array<{ id?: string; x: number; y: number; width: number; height: number }> = []
) {
  return [id, {
    internals: {
      positionAbsolute: { x: posX, y: posY },
      handleBounds: { target: targetHandles },
    },
    measured: { width, height },
  }] as const
}

// Helper to create relocation handler setters
function createRelocationSetters(overrides: Partial<RelocationHandlerSetters> = {}): RelocationHandlerSetters {
  return {
    relocatingEdgeRef: { current: null },
    relocProximityTargetRef: { current: null },
    isOverDeleteXRef: { current: false },
    setRelocProximityTargetId: vi.fn(),
    setCycleDetectedNodeId: vi.fn(),
    setRelocDragPos: vi.fn(),
    setIsSnappedToHandle: vi.fn(),
    setIsOverDeleteX: vi.fn(),
    setReplacementEdgeId: vi.fn(),
    screenToFlowPosition: vi.fn().mockImplementation((pos) => pos),
    rfStoreApi: { getState: () => ({ nodeLookup: new Map() }) as never },
    validate: vi.fn().mockReturnValue({ valid: true }),
    ...overrides,
  }
}

// Helper to create new connection handler setters
function createNewConnSetters(overrides: Partial<NewConnectionHandlerSetters> = {}): NewConnectionHandlerSetters {
  return {
    sourceNodeId: 'source-node',
    setNewConnProximityTargetId: vi.fn(),
    setCycleDetectedNodeId: vi.fn(),
    setReplacementEdgeId: vi.fn(),
    screenToFlowPosition: vi.fn().mockImplementation((pos) => pos),
    rfStoreApi: { getState: () => ({ nodeLookup: new Map() }) as never },
    validate: vi.fn().mockReturnValue({ valid: true }),
    ...overrides,
  }
}

// Helper to create a mouse event
function createMouseEvent(clientX: number, clientY: number): MouseEvent {
  return { clientX, clientY } as MouseEvent
}

describe('createRelocationMouseMoveHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState = { nodes: [], edges: [] }
  })

  // ===========================================================================
  // Throttling
  // ===========================================================================

  describe('throttling', () => {
    it('throttles at ~30fps (32ms interval)', () => {
      const setters = createRelocationSetters()
      const handler = createRelocationMouseMoveHandler(setters)

      // Mock Date.now to control throttle
      let currentTime = 1000
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      // First call should work
      handler(createMouseEvent(100, 100))
      expect(setters.setRelocDragPos).toHaveBeenCalledTimes(1)

      // Call within 32ms should be throttled
      currentTime = 1020
      handler(createMouseEvent(110, 110))
      expect(setters.setRelocDragPos).toHaveBeenCalledTimes(1)

      // Call after 32ms should work
      currentTime = 1040
      handler(createMouseEvent(120, 120))
      expect(setters.setRelocDragPos).toHaveBeenCalledTimes(2)

      vi.restoreAllMocks()
    })
  })

  // ===========================================================================
  // findRelocationProximity - no nodes nearby
  // ===========================================================================

  describe('no nodes nearby', () => {
    it('sets drag position without proximity target', () => {
      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 500, y: 500 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]

      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(500, 500))

      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
      expect(setters.setRelocDragPos).toHaveBeenCalledWith({ x: 500, y: 500 })
      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(false)
    })
  })

  // ===========================================================================
  // findRelocationProximity - nearest node within BORDER_TRIGGER_RANGE
  // ===========================================================================

  describe('node within border trigger range', () => {
    it('sets proximity target when near a valid node', () => {
      // Cursor at (310, 130) is within 30px of node at (100,100) w=200,h=60 -> right edge at 300
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 310, y: 130 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(310, 130))

      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith('node-1')
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
    })

    it('skips the source node of the relocating edge', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'node-1', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 105, y: 105 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(105, 105))

      // node-1 is source, so it should be skipped
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
    })

    it('skips the current target node of the relocating edge', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'node-1' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 105, y: 105 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(105, 105))

      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
    })

    it('picks the nearest node when multiple nodes are in range', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 215, y: 130 }),
      })
      mockStoreState.nodes = [
        { id: 'node-far', position: { x: 100, y: 100 } },
        { id: 'node-close', position: { x: 200, y: 100 } },
      ]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-far', 100, 100, 100, 60),   // right edge at 200, dist = 15
        createNodeLookupEntry('node-close', 200, 100, 100, 60), // left edge at 200, dist = 15 but inside
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(215, 130))

      // node-close is closer (cursor is inside it)
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith('node-close')
    })
  })

  // ===========================================================================
  // Node without nodeLookup entry (fallback to node.position and defaults)
  // ===========================================================================

  describe('fallback when node is not in nodeLookup', () => {
    it('uses node.position and default dimensions', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        // Inside the node using default dims (120x40): node at (100,100), dims 120x40
        // so inside means x in [100,220], y in [100,140]
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // Empty nodeLookup - node-1 not found
      setters.rfStoreApi = { getState: () => ({ nodeLookup: new Map() }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // Falls back to node.position and 120x40 defaults, cursor is inside = dist 0
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith('node-1')
    })
  })

  // ===========================================================================
  // Handle snapping (EDGE_SNAP_THRESHOLD = 15)
  // ===========================================================================

  describe('handle snapping', () => {
    it('snaps to a handle within EDGE_SNAP_THRESHOLD', () => {
      // Handle at center (100 + 0 + 5, 100 + 20 + 5) = (105, 125)
      // Cursor at (108, 128) -> dist = hypot(3,3) ~ 4.24 < 15
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 108, y: 128 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(108, 128))

      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(true)
      expect(setters.setRelocDragPos).toHaveBeenCalledWith({ x: 105, y: 125 })
    })

    it('does not snap when handle is outside EDGE_SNAP_THRESHOLD', () => {
      // Handle center at (105, 125), cursor at (200, 200) -> way too far
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 200, y: 200 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(200, 200))

      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(false)
    })

    // -----------------------------------------------------------------------
    // Step 3: projected post-proximity handle snap during relocation.
    // The target node will gain a "+" handle once `proximityTarget` flips on,
    // but the current `nodeLookup` still holds the pre-proximity 50%-centered
    // layout. These tests exercise the projection branch that fills the gap.
    // -----------------------------------------------------------------------
    it('snaps to projected first ingress handle (handleId null) when target node already has one ingress', () => {
      // Node-1 at (100,100), 200x60. Existing edge -> node-1 (ingressCount=1).
      // totalSlots = 2 -> projected handle at leftPct=1/3 -> hx = 100 + 200/3 = ~166.67.
      // Cursor at (167, 100) is within EDGE_SNAP_THRESHOLD of the projected position.
      mockStoreState.edges = [
        { id: 'e-existing', source: 'upstream', target: 'node-1' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e-reloc', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 167, y: 100 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // No Step-2 target handles, so the projection branch is the only one that fires.
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(167, 100))

      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(true)
      // First projected handle is the unnamed default - snap pos lands on the
      // computed (hx, hy) tuple. Note hy collapses to the node top (y=100).
      const dragPosCalls = (setters.setRelocDragPos as ReturnType<typeof vi.fn>).mock.calls
      const snapPos = dragPosCalls.at(-1)?.[0] as { x: number; y: number }
      expect(snapPos.x).toBeCloseTo(166.666, 2)
      expect(snapPos.y).toBe(100)
    })

    it("snaps to projected ingress_N handle for i>0 when target has multiple ingress edges", () => {
      // ingressCount=2 -> totalSlots=3.
      // i=1 projection: leftPct = 2/4 = 0.5 -> hx = 100 + 200*0.5 = 200, hy = 100.
      mockStoreState.edges = [
        { id: 'e-a', source: 'upstream-a', target: 'node-1' },
        { id: 'e-b', source: 'upstream-b', target: 'node-1' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e-reloc', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 200, y: 100 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(200, 100))

      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(true)
      const dragPosCalls = (setters.setRelocDragPos as ReturnType<typeof vi.fn>).mock.calls
      const snapPos = dragPosCalls.at(-1)?.[0] as { x: number; y: number }
      expect(snapPos.x).toBe(200)
      expect(snapPos.y).toBe(100)
    })

    it('snaps to the projected "+" handle (handleId ingress_N) when cursor is closest to the appended slot', () => {
      // ingressCount=1 -> totalSlots=2.
      // "+" projection: plusLeftPct = 2/3 -> plusHx = 100 + 200*2/3 = ~233.33, plusHy = 100.
      // Cursor at (233, 100) snaps to the "+" handle whose id will be `ingress_1`.
      mockStoreState.edges = [
        { id: 'e-existing', source: 'upstream', target: 'node-1' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e-reloc', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 233, y: 100 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(233, 100))

      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(true)
      const dragPosCalls = (setters.setRelocDragPos as ReturnType<typeof vi.fn>).mock.calls
      const snapPos = dragPosCalls.at(-1)?.[0] as { x: number; y: number }
      expect(snapPos.x).toBeCloseTo(233.333, 2)
      expect(snapPos.y).toBe(100)
    })
  })

  // ===========================================================================
  // Cycle detection
  // ===========================================================================

  describe('cycle detection', () => {
    it('shows cycle indicator when connection would create a cycle', () => {
      // Edge: src -> old-tgt. Node-1 -> src exists. Connecting src -> node-1 would cycle.
      mockStoreState.edges = [
        { id: 'e-existing', source: 'node-1', target: 'src' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith('node-1')
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
    })

    it('clears snap when cycle is detected', () => {
      // Cycle case: even if handle is in range, snap should be cleared
      mockStoreState.edges = [
        { id: 'e-existing', source: 'node-1', target: 'src' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 108, y: 128 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(108, 128))

      // Snap should be cleared (shouldClearSnap = true)
      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(false)
      // Drag pos should follow cursor, not snap to handle
      expect(setters.setRelocDragPos).toHaveBeenCalledWith({ x: 108, y: 128 })
    })
  })

  // ===========================================================================
  // Cross-scope detection
  // ===========================================================================

  describe('cross-scope detection', () => {
    it('shows cycle indicator for cross-scope violation', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
        validate: vi.fn().mockReturnValue({ reason: 'cross-scope' }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith('node-1')
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // checkDeleteXHover
  // ===========================================================================

  describe('delete X hover', () => {
    it('detects when cursor is over the delete X label', () => {
      // Create a mock element with getBoundingClientRect
      const mockElement = document.createElement('div')
      mockElement.className = 'react-flow__edge-text'
      mockElement.getBoundingClientRect = () => ({
        left: 100,
        right: 150,
        top: 200,
        bottom: 230,
        width: 50,
        height: 30,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      })
      document.body.appendChild(mockElement)

      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 500, y: 500 }),
      })

      const handler = createRelocationMouseMoveHandler(setters)
      // Cursor at (125, 215) is inside the X label rect (with 8px padding)
      handler(createMouseEvent(125, 215))

      expect(setters.setIsOverDeleteX).toHaveBeenCalledWith(true)
      expect(setters.isOverDeleteXRef.current).toBe(true)

      document.body.removeChild(mockElement)
    })

    it('detects when cursor is within padding of the X label', () => {
      const mockElement = document.createElement('div')
      mockElement.className = 'react-flow__edge-text'
      mockElement.getBoundingClientRect = () => ({
        left: 100,
        right: 150,
        top: 200,
        bottom: 230,
        width: 50,
        height: 30,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      })
      document.body.appendChild(mockElement)

      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 500, y: 500 }),
      })

      const handler = createRelocationMouseMoveHandler(setters)
      // Cursor at (93, 193) is within 8px padding of left and top
      handler(createMouseEvent(93, 193))

      expect(setters.setIsOverDeleteX).toHaveBeenCalledWith(true)

      document.body.removeChild(mockElement)
    })

    it('does not detect delete X when cursor is outside', () => {
      const mockElement = document.createElement('div')
      mockElement.className = 'react-flow__edge-text'
      mockElement.getBoundingClientRect = () => ({
        left: 100,
        right: 150,
        top: 200,
        bottom: 230,
        width: 50,
        height: 30,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      })
      document.body.appendChild(mockElement)

      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 500, y: 500 }),
      })

      const handler = createRelocationMouseMoveHandler(setters)
      // Cursor at (50, 50) is far outside the X label
      handler(createMouseEvent(50, 50))

      expect(setters.setIsOverDeleteX).toHaveBeenCalledWith(false)

      document.body.removeChild(mockElement)
    })

    it('returns false when no X label element exists', () => {
      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 500, y: 500 }),
      })

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(125, 215))

      expect(setters.setIsOverDeleteX).toHaveBeenCalledWith(false)
    })

    it('clears delete X hover when snapped to a handle', () => {
      // Create X label element
      const mockElement = document.createElement('div')
      mockElement.className = 'react-flow__edge-text'
      mockElement.getBoundingClientRect = () => ({
        left: 100, right: 120, top: 100, bottom: 120,
        width: 20, height: 20, x: 100, y: 100, toJSON: () => ({}),
      })
      document.body.appendChild(mockElement)

      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 105, y: 125 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(105, 125))

      // Snapped to handle takes priority - delete X should be false
      expect(setters.setIsOverDeleteX).toHaveBeenCalledWith(false)
      expect(setters.isOverDeleteXRef.current).toBe(false)

      document.body.removeChild(mockElement)
    })
  })

  // ===========================================================================
  // relocatingEdgeRef null (sourceId defaults to empty string)
  // ===========================================================================

  describe('relocatingEdgeRef null', () => {
    it('uses empty string as sourceId when relocatingEdgeRef is null', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: null },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // No source/target filtering happens (relocEdge is null)
      // Node should be in proximity
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith('node-1')
    })
  })

  // ===========================================================================
  // applyProximityTarget - no nearestNode
  // ===========================================================================

  describe('no nearest node', () => {
    it('clears all proximity state when no node is nearby', () => {
      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 1000, y: 1000 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(1000, 1000))

      expect(setters.relocProximityTargetRef.current).toBeNull()
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // checkProximityValidity - no nearestNode (returns false/false)
  // ===========================================================================

  describe('checkProximityValidity with no nearest node', () => {
    it('returns no cycle and no cross-scope when nearest node is null', () => {
      // No nodes at all -> nearestNode will be null
      const setters = createRelocationSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      })
      mockStoreState.nodes = []
      setters.rfStoreApi = { getState: () => ({ nodeLookup: new Map() }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(0, 0))

      // With no nearest node, both are false, shouldClearSnap is false
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Snapped handle sets relocProximityTargetRef
  // ===========================================================================

  describe('snapped handle proximity override', () => {
    it('overrides relocProximityTargetRef when snapped to handle', () => {
      const relocProximityTargetRef = { current: null as string | null }
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        relocProximityTargetRef,
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 105, y: 125 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(105, 125))

      // applyDragPosition sets the ref to the snapped handle's nodeId
      expect(relocProximityTargetRef.current).toBe('node-1')
    })
  })

  // ===========================================================================
  // Occupied-handle replacement detection
  // ===========================================================================

  describe('relocation snap onto occupied handle', () => {
    it('surfaces the occupying edge id as the replacement target', () => {
      // Handle at (105, 125) gets snapped; an existing edge already occupies it.
      mockStoreState.edges = [
        { id: 'occupying-edge', source: 'other', target: 'node-1', targetHandle: 'handle-1' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'reloc-edge', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 108, y: 128 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(108, 128))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith('occupying-edge')
    })

    it('excludes the relocating edge itself when scanning for occupiers', () => {
      // The only edge on the snapped handle IS the edge being relocated - must not self-replace.
      mockStoreState.edges = [
        { id: 'reloc-edge', source: 'src', target: 'node-1', targetHandle: 'handle-1' },
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'reloc-edge', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 108, y: 128 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(108, 128))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })

    it('matches default (no targetHandle) edge when snapped handle has no id', () => {
      mockStoreState.edges = [
        { id: 'edge-default', source: 'other', target: 'node-1' }, // no targetHandle
      ]
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'reloc-edge', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 108, y: 128 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          // Handle without id - treated as default
          { x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(108, 128))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith('edge-default')
    })
  })

  // ===========================================================================
  // handles without target handleBounds
  // ===========================================================================

  describe('node without handle bounds', () => {
    it('treats nodes with no handleBounds as having no handles', () => {
      const setters = createRelocationSetters({
        relocatingEdgeRef: { current: { id: 'e1', source: 'src', target: 'old-tgt' } },
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // nodeLookup entry without handleBounds
      const nodeLookup = new Map([
        ['node-1', {
          internals: {
            positionAbsolute: { x: 100, y: 100 },
            handleBounds: {},
          },
          measured: { width: 200, height: 60 },
        }],
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createRelocationMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // Node is in range but no handles to snap to -> proximity target set, not snapped
      expect(setters.setRelocProximityTargetId).toHaveBeenCalledWith('node-1')
      expect(setters.setIsSnappedToHandle).toHaveBeenCalledWith(false)
    })
  })
})

// =============================================================================
// createNewConnectionMouseMoveHandler
// =============================================================================

describe('createNewConnectionMouseMoveHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState = { nodes: [], edges: [] }
  })

  // ===========================================================================
  // Throttling
  // ===========================================================================

  describe('throttling', () => {
    it('throttles at ~30fps (32ms interval)', () => {
      const setters = createNewConnSetters()
      const handler = createNewConnectionMouseMoveHandler(setters)

      let currentTime = 1000
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      handler(createMouseEvent(100, 100))
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledTimes(1)

      currentTime = 1020
      handler(createMouseEvent(110, 110))
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledTimes(1)

      currentTime = 1040
      handler(createMouseEvent(120, 120))
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledTimes(2)

      vi.restoreAllMocks()
    })
  })

  // ===========================================================================
  // No nodes nearby
  // ===========================================================================

  describe('no nodes nearby', () => {
    it('clears all proximity state when no node is nearby', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 1000, y: 1000 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(1000, 1000))

      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Node within border trigger range
  // ===========================================================================

  describe('node in range - valid connection', () => {
    it('sets proximity target for valid connection', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith('node-1')
      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Skip source node
  // ===========================================================================

  describe('skip source node', () => {
    it('skips the source node', () => {
      const setters = createNewConnSetters({
        sourceNodeId: 'node-1',
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Cycle detection
  // ===========================================================================

  describe('cycle detection', () => {
    it('detects cycle and sets cycle node id', () => {
      mockStoreState.edges = [
        { id: 'e-existing', source: 'node-1', target: 'source-node' },
      ]
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith('node-1')
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Cross-scope detection
  // ===========================================================================

  describe('cross-scope detection', () => {
    it('detects cross-scope and sets cycle node id', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
        validate: vi.fn().mockReturnValue({ reason: 'cross-scope' }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      expect(setters.setCycleDetectedNodeId).toHaveBeenCalledWith('node-1')
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith(null)
      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // findNearestHandleEdge - occupied handle detection
  // ===========================================================================

  describe('handle replacement detection', () => {
    it('sets replacement edge id when nearest handle is occupied', () => {
      mockStoreState.edges = [
        { id: 'edge-on-handle', source: 'other', target: 'node-1', targetHandle: 'handle-1' },
      ]
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 125 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 125))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith('edge-on-handle')
    })

    it('sets replacement edge id to null when nearest handle is unoccupied', () => {
      mockStoreState.edges = []
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 125 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 125))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })

    it('finds edge on default handle (no targetHandle) when nearest handle has no id', () => {
      mockStoreState.edges = [
        { id: 'edge-default', source: 'other', target: 'node-1' }, // no targetHandle
      ]
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 125 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { x: 0, y: 20, width: 10, height: 10 }, // no id on handle
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 125))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith('edge-default')
    })

    it('returns null when no handles are within BORDER_TRIGGER_RANGE', () => {
      mockStoreState.edges = [
        { id: 'edge-on-handle', source: 'other', target: 'node-1', targetHandle: 'handle-1' },
      ]
      const setters = createNewConnSetters({
        // Cursor close to node border but handles are far from cursor within node
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 320, y: 130 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // Node right edge at 300, cursor at 320, so dist = 20 < BORDER_TRIGGER_RANGE=30
      // But handle is at (105, 125), dist from (320,130) = hypot(215,5) ~ 215 > 30
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 60, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(320, 130))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Fallback when node not in nodeLookup
  // ===========================================================================

  describe('node not in nodeLookup', () => {
    it('uses node.position and default dimensions', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // Empty nodeLookup
      setters.rfStoreApi = { getState: () => ({ nodeLookup: new Map() }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // Falls back to node.position and 120x40 defaults
      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith('node-1')
    })
  })

  // ===========================================================================
  // Picks nearest among multiple nodes
  // ===========================================================================

  describe('multiple nodes', () => {
    it('picks the nearest node when multiple are in range', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 215, y: 130 }),
      })
      mockStoreState.nodes = [
        { id: 'node-far', position: { x: 100, y: 100 } },
        { id: 'node-close', position: { x: 200, y: 100 } },
      ]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-far', 100, 100, 100, 60),
        createNodeLookupEntry('node-close', 200, 100, 100, 60),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(215, 130))

      expect(setters.setNewConnProximityTargetId).toHaveBeenCalledWith('node-close')
    })
  })

  // ===========================================================================
  // Node without handleBounds in findNearestHandleEdge
  // ===========================================================================

  describe('node without handle bounds in findNearestHandleEdge', () => {
    it('returns null when node has no handle bounds', () => {
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        ['node-1', {
          internals: {
            positionAbsolute: { x: 100, y: 100 },
            handleBounds: {},
          },
          measured: { width: 200, height: 60 },
        }],
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // Node is nearby but has no handles -> nearestHandleEdge is null
      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // findNearestHandleEdge - node not in lookup (fallback)
  // ===========================================================================

  describe('findNearestHandleEdge with node not in lookup', () => {
    it('uses node.position fallback and empty handles', () => {
      mockStoreState.edges = [
        { id: 'edge-1', source: 'other', target: 'node-1' },
      ]
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 110 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      // Node not in nodeLookup
      setters.rfStoreApi = { getState: () => ({ nodeLookup: new Map() }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 110))

      // Node is nearby (using fallback) but no handles -> no replacement edge
      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith(null)
    })
  })

  // ===========================================================================
  // Multiple handles - picks nearest one
  // ===========================================================================

  describe('multiple handles', () => {
    it('picks the nearest handle for edge lookup', () => {
      // Two handles: handle-1 at (105, 125) and handle-2 at (105, 145)
      // Cursor at (110, 143) is closer to handle-2
      mockStoreState.edges = [
        { id: 'edge-on-h2', source: 'other', target: 'node-1', targetHandle: 'handle-2' },
      ]
      const setters = createNewConnSetters({
        screenToFlowPosition: vi.fn().mockReturnValue({ x: 110, y: 143 }),
      })
      mockStoreState.nodes = [{ id: 'node-1', position: { x: 100, y: 100 } }]
      const nodeLookup = new Map([
        createNodeLookupEntry('node-1', 100, 100, 200, 80, [
          { id: 'handle-1', x: 0, y: 20, width: 10, height: 10 },
          { id: 'handle-2', x: 0, y: 40, width: 10, height: 10 },
        ]),
      ])
      setters.rfStoreApi = { getState: () => ({ nodeLookup }) as never }

      const handler = createNewConnectionMouseMoveHandler(setters)
      handler(createMouseEvent(110, 143))

      expect(setters.setReplacementEdgeId).toHaveBeenCalledWith('edge-on-h2')
    })
  })
})
