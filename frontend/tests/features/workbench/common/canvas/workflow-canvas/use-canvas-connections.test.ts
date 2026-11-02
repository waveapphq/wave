/**
 * useCanvasConnections Hook Tests
 *
 * Tests for the canvas connections hook that manages edge connection,
 * relocation, and validation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ===========================================================================
// Mock state
// ===========================================================================

const mockScreenToFlowPosition = vi.fn((p: { x: number; y: number }) => p)
const mockUpdateNodeInternals = vi.fn()
const mockRfStoreApi = { getState: () => ({ nodeLookup: new Map() }) }

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: mockScreenToFlowPosition }),
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
  useStoreApi: () => mockRfStoreApi,
}))

const mockSetDraggingEdge = vi.fn()
const mockAddEdge = vi.fn()
const mockRelocateEdge = vi.fn()
const mockSetEdges = vi.fn()
const mockValidate = vi.fn((): { valid: boolean; reason?: string } => ({ valid: true }))

interface MockStoreState {
  nodes: Array<{ id: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>
  addEdge: typeof mockAddEdge
  relocateEdge: typeof mockRelocateEdge
  setEdges: typeof mockSetEdges
  setDraggingEdge: typeof mockSetDraggingEdge
}

const mockStoreState: MockStoreState = {
  nodes: [],
  edges: [],
  addEdge: mockAddEdge,
  relocateEdge: mockRelocateEdge,
  setEdges: mockSetEdges,
  setDraggingEdge: mockSetDraggingEdge,
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: MockStoreState) => unknown) => selector(mockStoreState),
    { getState: () => mockStoreState },
  ),
}))

vi.mock('@/features/workbench/hooks/use-connection-validator', () => ({
  useConnectionValidator: () => ({ validate: mockValidate }),
}))

// Mock handler factories
const mockRelocMouseMoveHandler = vi.fn()
const mockNewConnMouseMoveHandler = vi.fn()
const mockProcessConnectEnd = vi.fn()
const mockOnConnectHandler = vi.fn()

vi.mock('@/features/workbench/common/canvas/workflow-canvas/connection-mousemove-handlers', () => ({
  createRelocationMouseMoveHandler: vi.fn(() => mockRelocMouseMoveHandler),
  createNewConnectionMouseMoveHandler: vi.fn(() => mockNewConnMouseMoveHandler),
}))
vi.mock('@/features/workbench/common/canvas/workflow-canvas/connection-end-handler', () => ({
  processConnectEnd: (...args: unknown[]) => mockProcessConnectEnd(...args),
}))
vi.mock('@/features/workbench/common/canvas/workflow-canvas/connection-on-connect', () => ({
  createOnConnectHandler: vi.fn(() => mockOnConnectHandler),
}))

import { useCanvasConnections } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-connections'
import { createRelocationMouseMoveHandler, createNewConnectionMouseMoveHandler } from '@/features/workbench/common/canvas/workflow-canvas/connection-mousemove-handlers'

// ===========================================================================
// Tests
// ===========================================================================

describe('useCanvasConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.nodes = []
    mockStoreState.edges = []
    mockValidate.mockReturnValue({ valid: true })
  })

  afterEach(() => {
    // Remove any leftover document listeners
    document.removeEventListener('mousemove', mockRelocMouseMoveHandler)
    document.removeEventListener('mousemove', mockNewConnMouseMoveHandler)
  })

  // =========================================================================
  // Return shape
  // =========================================================================

  describe('return values', () => {
    it('returns all expected state properties and handlers', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      expect(result.current.relocatingEdgeId).toBeNull()
      expect(result.current.relocDragPos).toBeNull()
      expect(result.current.relocatingEdgeRef).toBeDefined()
      expect(result.current.relocProximityTargetId).toBeNull()
      expect(result.current.newConnProximityTargetId).toBeNull()
      expect(result.current.cycleDetectedNodeId).toBeNull()
      expect(result.current.replacementEdgeId).toBeNull()
      expect(result.current.isSnappedToHandle).toBe(false)
      expect(result.current.isOverDeleteX).toBe(false)
      expect(typeof result.current.handleConnectStart).toBe('function')
      expect(typeof result.current.onConnect).toBe('function')
      expect(typeof result.current.handleConnectEnd).toBe('function')
      expect(typeof result.current.isValidConnection).toBe('function')
    })
  })

  // =========================================================================
  // handleConnectStart
  // =========================================================================

  describe('handleConnectStart', () => {
    it('does nothing when nodeId is null', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: null, handleType: 'source', handleId: null }
        )
      })

      expect(mockSetDraggingEdge).not.toHaveBeenCalled()
    })

    it('does nothing when handleType is null', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: null, handleId: null }
        )
      })

      expect(mockSetDraggingEdge).not.toHaveBeenCalled()
    })

    it('does nothing when isExecuting is true', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: true }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      expect(mockSetDraggingEdge).not.toHaveBeenCalled()
    })

    it('enters relocation mode when existing edge found on source handle (no handleId)', () => {
      mockStoreState.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      expect(mockSetDraggingEdge).toHaveBeenCalledWith(true, 'node-1')
      expect(createRelocationMouseMoveHandler).toHaveBeenCalled()
      expect(result.current.relocatingEdgeId).toBe('e1')
    })

    it('enters relocation mode when edge matches by sourceHandle', () => {
      mockStoreState.edges = [
        { id: 'e1', source: 'node-1', sourceHandle: 'pass', target: 'node-2' },
      ]

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: 'pass' }
        )
      })

      expect(result.current.relocatingEdgeId).toBe('e1')
    })

    it('enters relocation mode when edge found on target handle (no handleId)', () => {
      mockStoreState.edges = [
        { id: 'e1', source: 'node-2', target: 'node-1' },
      ]

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'target', handleId: null }
        )
      })

      expect(result.current.relocatingEdgeId).toBe('e1')
    })

    it('enters relocation mode when edge matches by targetHandle', () => {
      mockStoreState.edges = [
        { id: 'e1', source: 'node-2', target: 'node-1', targetHandle: 'ingress_1' },
      ]

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'target', handleId: 'ingress_1' }
        )
      })

      expect(result.current.relocatingEdgeId).toBe('e1')
    })

    it('creates new connection handler when no existing edge found', () => {
      mockStoreState.edges = []

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      expect(createNewConnectionMouseMoveHandler).toHaveBeenCalledWith(
        expect.objectContaining({ sourceNodeId: 'node-1' })
      )
      expect(result.current.relocatingEdgeId).toBeNull()
    })
  })

  // =========================================================================
  // handleConnectEnd
  // =========================================================================

  describe('handleConnectEnd', () => {
    it('calls processConnectEnd with all required parameters', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      act(() => {
        result.current.handleConnectEnd(new MouseEvent('mouseup') as unknown as MouseEvent | TouchEvent)
      })

      expect(mockProcessConnectEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          relocatingEdgeRef: expect.any(Object),
          relocProximityTargetRef: expect.any(Object),
          isOverDeleteXRef: expect.any(Object),
          relocMouseMoveRef: expect.any(Object),
          newConnMouseMoveRef: expect.any(Object),
          relocateEdge: mockRelocateEdge,
          updateNodeInternals: mockUpdateNodeInternals,
          validate: mockValidate,
        })
      )
    })
  })

  // =========================================================================
  // isValidConnection
  // =========================================================================

  describe('isValidConnection', () => {
    it('returns false when source is missing', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: '',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    it('returns false when target is missing', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: '',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    it('returns true when validation passes', () => {
      mockValidate.mockReturnValue({ valid: true })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(true)
    })

    it('rejects cross-scope connections even during relocation', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'cross-scope' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // Simulate relocation mode
      result.current.relocatingEdgeRef.current = { id: 'e1', source: 'a', target: 'b' }

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    it('allows has-egress during relocation (old edge will be swapped)', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'has-egress' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // Enter relocation mode
      result.current.relocatingEdgeRef.current = { id: 'e1', source: 'a', target: 'b' }

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(true)
    })

    it('allows has-ingress during relocation', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'has-ingress' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      result.current.relocatingEdgeRef.current = { id: 'e1', source: 'a', target: 'b' }

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(true)
    })

    it('rejects has-egress when not in relocation mode', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'has-egress' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    it('rejects has-ingress reason outside of relocation (no ingress_add bypass)', () => {
      // The dynamic "+" handle carries its FUTURE stable id (`ingress_${N}`), so the
      // connection validator's has-ingress rejection applies; only relocation bypasses it.
      mockValidate.mockReturnValue({ valid: false, reason: 'has-ingress' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_1',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(false)
    })

    it('returns false for other validation failures without special conditions', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    it('returns false for cycle reason without relocation', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'cycle' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        id: 'e1',
      } as unknown as import('@xyflow/react').Edge)

      expect(valid).toBe(false)
    })

    // =========================================================================
    // isValidConnection - REPLACE-on-occupied-handle exemption (lines 219-243)
    // =========================================================================

    it('allows duplicate when dropping on an occupied named ingress handle (REPLACE) and no surviving duplicate', () => {
      // Drop a->node-2 on ingress_1 which already has an edge from some other
      // source. REPLACE will absorb the duplicate so the post-swap state has
      // no surviving a->node-2 pair.
      mockStoreState.edges = [
        { id: 'occupying', source: 'other', target: 'node-2', targetHandle: 'ingress_1' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_1',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(true)
    })

    it('allows duplicate when dropping on the default handle (no targetHandle) and no surviving duplicate', () => {
      // The occupying edge has no targetHandle (default handle); the dropped
      // connection also has no targetHandle.
      mockStoreState.edges = [
        { id: 'occupying-default', source: 'other', target: 'node-2' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: null,
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(true)
    })

    it('rejects duplicate when REPLACE would leave another same-source/same-target edge surviving', () => {
      // Two existing edges from node-1 to node-2; one on the dropped handle
      // (would be replaced) and one elsewhere (would survive).
      mockStoreState.edges = [
        { id: 'occupying', source: 'node-1', target: 'node-2', targetHandle: 'ingress_1' },
        { id: 'surviving', source: 'node-1', target: 'node-2', targetHandle: 'ingress_2' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_1',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(false)
    })

    it('rejects duplicate when the dropped (named) handle is unoccupied', () => {
      // No edge sits on ingress_3, so existingOnHandle is undefined and the
      // exemption arm cannot fire - falls through to `return false`.
      mockStoreState.edges = [
        { id: 'elsewhere', source: 'node-1', target: 'node-2', targetHandle: 'ingress_1' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_3',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(false)
    })

    it('rejects duplicate when the default (no-id) handle is unoccupied', () => {
      // The occupying edges are on named handles only; the default handle is
      // empty.
      mockStoreState.edges = [
        { id: 'elsewhere', source: 'node-1', target: 'node-2', targetHandle: 'ingress_1' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: null,
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(false)
    })

    it('excludes the relocating edge from the occupied-handle lookup', () => {
      // The relocating edge sits on the dropped handle - it must be ignored
      // (e.id !== relocId), so existingOnHandle is undefined and the
      // exemption does NOT apply (return false).
      mockStoreState.edges = [
        { id: 'reloc-edge', source: 'node-1', target: 'node-2', targetHandle: 'ingress_1' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      result.current.relocatingEdgeRef.current = {
        id: 'reloc-edge',
        source: 'node-1',
        target: 'old-target',
      }

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_1',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(false)
    })

    it('excludes the relocating edge from the surviving-duplicate check (REPLACE exemption during relocation)', () => {
      // Reloc edge (a->node-2 on default handle) is being dragged onto ingress_1.
      // The handle is occupied by another a->node-2 edge. After REPLACE +
      // ignoring the relocating edge, no surviving duplicate.
      mockStoreState.edges = [
        { id: 'reloc-edge', source: 'node-1', target: 'node-2' },
        { id: 'occupying', source: 'node-1', target: 'node-2', targetHandle: 'ingress_1' },
      ]
      mockValidate.mockReturnValue({ valid: false, reason: 'duplicate' })
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      result.current.relocatingEdgeRef.current = {
        id: 'reloc-edge',
        source: 'node-1',
        target: 'node-2',
      }

      const valid = result.current.isValidConnection({
        source: 'node-1',
        target: 'node-2',
        targetHandle: 'ingress_1',
      } as unknown as import('@xyflow/react').Connection)

      expect(valid).toBe(true)
    })
  })

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  describe('cleanup', () => {
    it('removes mousemove listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      mockStoreState.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result, unmount } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // Trigger relocation to register a mousemove listener
      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', mockRelocMouseMoveHandler)
      removeEventListenerSpy.mockRestore()
    })

    it('removes new connection mousemove listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      mockStoreState.edges = []

      const { result, unmount } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // Trigger new connection to register a mousemove listener
      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', mockNewConnMouseMoveHandler)
      removeEventListenerSpy.mockRestore()
    })

    it('does not throw on unmount when no listeners registered', () => {
      const { unmount } = renderHook(() => useCanvasConnections({ isExecuting: false }))
      expect(() => unmount()).not.toThrow()
    })
  })

  // =========================================================================
  // onConnect
  // =========================================================================

  describe('onConnect', () => {
    it('delegates to createOnConnectHandler', () => {
      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // onConnect is the handler returned by createOnConnectHandler
      expect(result.current.onConnect).toBe(mockOnConnectHandler)
    })
  })

  // =========================================================================
  // setReplacementEdgeId callback (refs + state synchronized)
  // =========================================================================

  describe('setReplacementEdgeId callback', () => {
    it('updates both the replacementEdgeId state and its ref mirror', () => {
      mockStoreState.edges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]

      const { result } = renderHook(() => useCanvasConnections({ isExecuting: false }))

      // Enter relocation mode so the relocation handler factory is invoked
      // and we can recover the setters it was constructed with.
      act(() => {
        result.current.handleConnectStart(
          new MouseEvent('mousedown') as unknown as MouseEvent | TouchEvent,
          { nodeId: 'node-1', handleType: 'source', handleId: null }
        )
      })

      const setters = vi.mocked(createRelocationMouseMoveHandler).mock.calls.at(-1)?.[0]
      expect(setters).toBeDefined()

      act(() => {
        setters!.setReplacementEdgeId('occupying-edge-id')
      })

      // State reflects the new value (re-render delivers it via the hook return).
      expect(result.current.replacementEdgeId).toBe('occupying-edge-id')

      // And the ref mirror stays in sync so processConnectEnd (long-lived closure)
      // can read the CURRENT value rather than a stale one.
      act(() => {
        result.current.handleConnectEnd(new MouseEvent('mouseup') as unknown as MouseEvent | TouchEvent)
      })
      const endParams = mockProcessConnectEnd.mock.calls.at(-1)?.[0] as
        | { replacementEdgeIdRef: { current: string | null } }
        | undefined
      expect(endParams?.replacementEdgeIdRef.current).toBe('occupying-edge-id')

      // Clear back to null exercises the falsy branch of the same line.
      act(() => {
        setters!.setReplacementEdgeId(null)
      })
      expect(result.current.replacementEdgeId).toBeNull()
    })
  })
})
