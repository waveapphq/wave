/**
 * Tests for connection-end-handler.ts
 *
 * Covers processConnectEnd and all internal functions:
 * - computeNextIngressHandle
 * - scheduleConvergenceRerender
 * - relocateToSnapTarget
 * - processRelocatingEdge
 * - resetConnectionState
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock workflow store
const mockRemoveEdge = vi.fn()
const mockSetEdges = vi.fn()
const mockSetDraggingEdge = vi.fn()
let mockStoreState: {
  edges: Array<{ id: string; source: string; target: string; targetHandle?: string }>
  removeEdge: typeof mockRemoveEdge
  setEdges: typeof mockSetEdges
  setDraggingEdge: typeof mockSetDraggingEdge
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mockStoreState,
  },
}))

import { processConnectEnd } from '@/features/workbench/common/canvas/workflow-canvas/connection-end-handler'

// Helper to create default params
function createDefaultParams(overrides: Partial<Record<string, unknown>> = {}) {
  const relocatingEdgeRef = { current: null as { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } | null }
  const relocProximityTargetRef = { current: null as string | null }
  const replacementEdgeIdRef = { current: null as string | null }
  const isOverDeleteXRef = { current: false }
  const relocMouseMoveRef = { current: null as ((e: MouseEvent) => void) | null }
  const newConnMouseMoveRef = { current: null as ((e: MouseEvent) => void) | null }

  return {
    relocatingEdgeRef,
    relocProximityTargetRef,
    replacementEdgeIdRef,
    isOverDeleteXRef,
    relocMouseMoveRef,
    newConnMouseMoveRef,
    setRelocatingEdgeId: vi.fn(),
    setRelocDragPos: vi.fn(),
    setRelocProximityTargetId: vi.fn(),
    setIsSnappedToHandle: vi.fn(),
    setCycleDetectedNodeId: vi.fn(),
    setReplacementEdgeId: vi.fn(),
    setIsOverDeleteX: vi.fn(),
    setNewConnProximityTargetId: vi.fn(),
    relocateEdge: vi.fn(),
    updateNodeInternals: vi.fn(),
    validate: vi.fn().mockReturnValue({ valid: true }),
    ...overrides,
  }
}

describe('processConnectEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState = {
      edges: [],
      removeEdge: mockRemoveEdge,
      setEdges: mockSetEdges,
      setDraggingEdge: mockSetDraggingEdge,
    }
  })

  // ===========================================================================
  // resetConnectionState
  // ===========================================================================

  describe('resetConnectionState (via processConnectEnd)', () => {
    it('resets all connection state refs and setters to idle', () => {
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'e1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'some-node'
      params.isOverDeleteXRef.current = true

      processConnectEnd(params)

      expect(params.relocatingEdgeRef.current).toBeNull()
      expect(params.setRelocatingEdgeId).toHaveBeenCalledWith(null)
      expect(params.setRelocDragPos).toHaveBeenCalledWith(null)
      expect(params.relocProximityTargetRef.current).toBeNull()
      expect(params.setRelocProximityTargetId).toHaveBeenCalledWith(null)
      expect(params.setIsSnappedToHandle).toHaveBeenCalledWith(false)
      expect(params.setCycleDetectedNodeId).toHaveBeenCalledWith(null)
      expect(params.setReplacementEdgeId).toHaveBeenCalledWith(null)
      expect(params.setIsOverDeleteX).toHaveBeenCalledWith(false)
      expect(params.isOverDeleteXRef.current).toBe(false)
      expect(params.setNewConnProximityTargetId).toHaveBeenCalledWith(null)
      expect(mockSetDraggingEdge).toHaveBeenCalledWith(false)
    })

    it('removes new connection mousemove listener if active', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const handler = vi.fn()
      const params = createDefaultParams()
      params.newConnMouseMoveRef.current = handler

      processConnectEnd(params)

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', handler)
      expect(params.newConnMouseMoveRef.current).toBeNull()
      removeEventListenerSpy.mockRestore()
    })

    it('does not remove mousemove listener when newConnMouseMoveRef is null', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const params = createDefaultParams()
      params.newConnMouseMoveRef.current = null

      processConnectEnd(params)

      // removeEventListener called only for relocMouseMoveRef if it were set
      // but not for newConnMouseMoveRef since it's null
      const calls = removeEventListenerSpy.mock.calls.filter(
        ([type]) => type === 'mousemove'
      )
      expect(calls.length).toBe(0)
      removeEventListenerSpy.mockRestore()
    })
  })

  // ===========================================================================
  // Mouse tracking cleanup
  // ===========================================================================

  describe('mouse tracking cleanup', () => {
    it('removes relocation mousemove listener if active', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const handler = vi.fn()
      const params = createDefaultParams()
      params.relocMouseMoveRef.current = handler

      processConnectEnd(params)

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', handler)
      expect(params.relocMouseMoveRef.current).toBeNull()
      removeEventListenerSpy.mockRestore()
    })

    it('does not remove mousemove listener when relocMouseMoveRef is null', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const params = createDefaultParams()
      params.relocMouseMoveRef.current = null

      processConnectEnd(params)

      // No mousemove removal calls for reloc handler
      const calls = removeEventListenerSpy.mock.calls.filter(
        ([, fn]) => fn !== null
      )
      expect(calls.length).toBe(0)
      removeEventListenerSpy.mockRestore()
    })
  })

  // ===========================================================================
  // No relocating edge (idle drop)
  // ===========================================================================

  describe('no relocating edge', () => {
    it('only resets state when no edge is being relocated', () => {
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = null

      processConnectEnd(params)

      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(mockRemoveEdge).not.toHaveBeenCalled()
      // But resetConnectionState still runs
      expect(mockSetDraggingEdge).toHaveBeenCalledWith(false)
    })
  })

  // ===========================================================================
  // processRelocatingEdge - drop on delete X
  // ===========================================================================

  describe('drop on delete X', () => {
    it('removes the edge when dropped on X with no snap target', () => {
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = null
      params.isOverDeleteXRef.current = true

      processConnectEnd(params)

      expect(mockRemoveEdge).toHaveBeenCalledWith('edge-1')
      expect(params.relocateEdge).not.toHaveBeenCalled()
    })

    it('does not delete when snap target exists even if over delete X', () => {
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'
      params.isOverDeleteXRef.current = true

      processConnectEnd(params)

      // snapTarget is truthy, so it goes to relocateToSnapTarget instead of delete
      expect(mockRemoveEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // processRelocatingEdge - drop on empty canvas (preserve)
  // ===========================================================================

  describe('drop on empty canvas', () => {
    it('preserves original edge when no snap target and not over delete X', () => {
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = null
      params.isOverDeleteXRef.current = false

      processConnectEnd(params)

      expect(mockRemoveEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // relocateToSnapTarget - cross-scope rejection
  // ===========================================================================

  describe('relocateToSnapTarget - cross-scope', () => {
    it('does nothing when validation returns cross-scope', () => {
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'cross-scope' }),
      })
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      expect(params.relocateEdge).not.toHaveBeenCalled()
      // validate was called with the edge source/target/handle
      expect(params.validate).toHaveBeenCalledWith({
        source: 'a',
        target: 'node-c',
        sourceHandle: undefined,
      })
    })
  })

  // ===========================================================================
  // relocateToSnapTarget - simple relocation (no convergence)
  // ===========================================================================

  describe('simple relocation', () => {
    it('relocates edge to snap target without convergence', () => {
      mockStoreState.edges = []
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b', sourceHandle: 'output_0' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      expect(params.relocateEdge).toHaveBeenCalledWith('edge-1', {
        id: 'edge-a-node-c',
        source: 'a',
        target: 'node-c',
        sourceHandle: 'output_0',
      })
    })

    it('does not schedule convergence rerender for simple relocation', () => {
      mockStoreState.edges = []
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      // updateNodeInternals not called synchronously (no convergence)
      expect(params.updateNodeInternals).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // relocateToSnapTarget - convergence case
  // ===========================================================================

  describe('convergence relocation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('computes next ingress handle when target already has edges', () => {
      // Target node-c already has an edge from node-d (not the one being relocated)
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(12345)

      processConnectEnd(params)

      expect(params.relocateEdge).toHaveBeenCalledWith('edge-1', {
        id: 'edge-a-node-c-12345',
        source: 'a',
        target: 'node-c',
        sourceHandle: undefined,
        targetHandle: 'ingress_2',
      })

      dateSpy.mockRestore()
    })

    it('starts at ingress_1 when existing edges have no targetHandle', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      // No targetHandle matches ingress pattern, so maxIndex stays 0 -> ingress_1
      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_1')
    })

    it('handles non-ingress target handles (ignores them for max computation)', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'custom_handle' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_1')
    })

    it('computes correct ingress when multiple ingress edges exist', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
        { id: 'edge-e-c', source: 'e', target: 'node-c', targetHandle: 'ingress_3' },
        { id: 'edge-f-c', source: 'f', target: 'node-c', targetHandle: 'ingress_2' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      // Max is 3, so next is ingress_4
      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_4')
    })

    it('excludes the relocating edge itself from convergence check', () => {
      // Edge from edge-1 targets node-c, but it IS the relocating edge so it's excluded
      mockStoreState.edges = [
        { id: 'edge-1', source: 'a', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      // edge-1 is excluded from targetHasIngress check (e.id !== oldEdge.id), so no convergence
      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].id).toBe('edge-a-node-c') // no timestamp suffix = non-convergence
      expect(callArgs[1].targetHandle).toBeUndefined()
    })

    it('schedules convergence rerender with setTimeout and rAF', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      // Advance past the 100ms setTimeout
      vi.advanceTimersByTime(100)

      // updateNodeInternals called for snap target
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-c')
      // Also called for old target when different from snap target
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-old')
    })

    it('does not update old target internals when same as snap target', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      // Old target is same as snap target
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-c' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      vi.advanceTimersByTime(100)

      // Called once for snap target, NOT again for old target (same node)
      expect(params.updateNodeInternals).toHaveBeenCalledTimes(1)
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-c')
    })

    it('triggers edge re-render via double rAF after convergence', () => {
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'

      // Mock requestAnimationFrame to collect all callbacks in order
      const rafCallbacks: Array<FrameRequestCallback> = []
      const originalRaf = globalThis.requestAnimationFrame
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb)
        return 0
      }

      processConnectEnd(params)

      vi.advanceTimersByTime(100)

      // First rAF callback queued by setTimeout
      expect(rafCallbacks.length).toBe(1)
      rafCallbacks[0](0)

      // Second rAF callback (nested inside the first)
      expect(rafCallbacks.length).toBe(2)
      rafCallbacks[1](0)

      // setEdges called with spread copy and skipDirty
      expect(mockSetEdges).toHaveBeenCalledWith(expect.any(Array), { skipDirty: true })

      globalThis.requestAnimationFrame = originalRaf
    })
  })

  // ===========================================================================
  // REPLACE branch: drop on an OCCUPIED handle (replacementEdgeId set)
  // ===========================================================================

  describe('relocateToSnapTarget - REPLACE branch', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('deletes the occupying edge and rebinds onto its handle when replacementEdgeId resolves', () => {
      // The snap-target has an existing edge on `ingress_1`; user dropped on that handle.
      mockStoreState.edges = [
        { id: 'occupying-edge', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old', sourceHandle: 'out' }
      params.relocProximityTargetRef.current = 'node-c'
      params.replacementEdgeIdRef.current = 'occupying-edge'

      vi.spyOn(Date, 'now').mockReturnValue(9999)

      processConnectEnd(params)

      // Occupying edge removed; dragged edge rebound to the SAME targetHandle.
      expect(mockRemoveEdge).toHaveBeenCalledWith('occupying-edge')
      expect(params.relocateEdge).toHaveBeenCalledWith('edge-1', {
        id: 'edge-a-node-c-9999',
        source: 'a',
        target: 'node-c',
        sourceHandle: 'out',
        targetHandle: 'ingress_1',
      })

      // Convergence rerender is scheduled for snap target + old target.
      vi.advanceTimersByTime(100)
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-c')
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-old')
    })

    it('falls through to convergence path when replacementEdgeId no longer resolves to a live edge', () => {
      // The pointed-at edge was already removed in the same tick; replacementEdgeId
      // is set but the store no longer has it. Code path must NOT crash and MUST
      // continue down the convergence branch instead of taking the REPLACE path.
      mockStoreState.edges = [
        { id: 'edge-d-c', source: 'd', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'
      params.replacementEdgeIdRef.current = 'phantom-edge-id'

      processConnectEnd(params)

      // No removeEdge call (the phantom id didn't resolve), but convergence handle assigned.
      expect(mockRemoveEdge).not.toHaveBeenCalled()
      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_2')
    })
  })

  // ===========================================================================
  // relocateToSnapTarget - same-source duplicate rejection (lines 104-115)
  // ===========================================================================

  describe('relocateToSnapTarget - same-source duplicate rejection', () => {
    // The REPLACE-exemption case schedules a convergence rerender (rAF +
    // setTimeout inside scheduleConvergenceRerender); fake timers prevent
    // the deferred callback from firing after the test environment has torn
    // down (which would throw ReferenceError: requestAnimationFrame).
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('aborts relocation when a same-source edge already targets the snap target', () => {
      // Store already has source 'a' -> 'node-c' on a different edge. Dragging
      // 'edge-1' (also from 'a') onto 'node-c' would create a second a->node-c
      // edge: the duplicate guard must short-circuit.
      mockStoreState.edges = [
        { id: 'existing-a-c', source: 'a', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(mockRemoveEdge).not.toHaveBeenCalled()
    })

    it('proceeds with relocation when no other same-source edge targets the snap target', () => {
      // The store carries no a->node-c edge yet. Validate flags 'duplicate'
      // (e.g., because the validator returns it for the previous self-targeting
      // edge), but the .some() returns false so relocation continues.
      mockStoreState.edges = [
        { id: 'edge-1', source: 'a', target: 'node-old' }, // The relocating edge itself
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      expect(params.relocateEdge).toHaveBeenCalled()
    })

    it('exempts the relocating edge itself from duplicate detection', () => {
      // The only same-source edge to node-c IS the one being relocated.
      // The e.id !== oldEdge.id guard must drop it, leaving no duplicate.
      mockStoreState.edges = [
        { id: 'edge-1', source: 'a', target: 'node-c' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'node-old' }
      params.relocProximityTargetRef.current = 'node-c'

      processConnectEnd(params)

      expect(params.relocateEdge).toHaveBeenCalled()
    })

    it('exempts the replacement edge from duplicate detection (REPLACE path)', () => {
      // The same-source edge to node-c is the REPLACE target. It's about to be
      // removed, so the e.id !== replacementEdgeId guard drops it - leaving
      // no surviving duplicate.
      mockStoreState.edges = [
        { id: 'occupying-edge', source: 'a', target: 'node-c', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = {
        id: 'edge-1',
        source: 'a',
        target: 'node-old',
        sourceHandle: 'out',
      }
      params.relocProximityTargetRef.current = 'node-c'
      params.replacementEdgeIdRef.current = 'occupying-edge'

      processConnectEnd(params)

      // Replacement path runs: the occupying edge is removed and the
      // dragged edge gets relocated onto the freed handle.
      expect(mockRemoveEdge).toHaveBeenCalledWith('occupying-edge')
      expect(params.relocateEdge).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Full flow integration
  // ===========================================================================

  describe('full flow', () => {
    it('cleans up mouse listener, processes edge, then resets state', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const mouseMoveHandler = vi.fn()
      const params = createDefaultParams()
      params.relocMouseMoveRef.current = mouseMoveHandler
      params.relocatingEdgeRef.current = { id: 'edge-1', source: 'a', target: 'b' }
      params.isOverDeleteXRef.current = true

      processConnectEnd(params)

      // 1. Mouse listener cleaned up
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', mouseMoveHandler)
      // 2. Edge deleted (no snap target + over delete X)
      expect(mockRemoveEdge).toHaveBeenCalledWith('edge-1')
      // 3. State reset
      expect(params.setRelocatingEdgeId).toHaveBeenCalledWith(null)
      expect(mockSetDraggingEdge).toHaveBeenCalledWith(false)

      removeEventListenerSpy.mockRestore()
    })
  })
})
