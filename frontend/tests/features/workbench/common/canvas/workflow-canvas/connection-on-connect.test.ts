/**
 * Tests for connection-on-connect.ts
 *
 * Covers createOnConnectHandler and all its branches:
 * - Early return when source/target missing
 * - Early return when isExecuting
 * - Relocation with convergence (target has ingress)
 * - Relocation with cross-scope rejection
 * - Relocation without convergence (fall through, return)
 * - Dynamic ingress "+" handle (id is `ingress_${N}` directly)
 * - Cross-scope rejection on ingress_N drop
 * - Handle replacement semantics
 * - Normal connection (valid)
 * - Normal connection rejected (invalid)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock workflow store
let mockStoreState: {
  edges: Array<{ id: string; source: string; target: string; targetHandle?: string }>
  removeEdge: ReturnType<typeof vi.fn>
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mockStoreState,
  },
}))

vi.mock('@/lib/utils', () => ({
  secureRandomId: () => 'abcd',
}))

import { createOnConnectHandler } from '@/features/workbench/common/canvas/workflow-canvas/connection-on-connect'

// Helper to create default params
function createDefaultParams(overrides: Partial<Record<string, unknown>> = {}) {
  const relocatingEdgeRef = { current: null as { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } | null }
  const relocProximityTargetRef = { current: null as string | null }

  return {
    isExecuting: false,
    relocatingEdgeRef,
    relocProximityTargetRef,
    setRelocatingEdgeId: vi.fn(),
    setRelocDragPos: vi.fn(),
    setRelocProximityTargetId: vi.fn(),
    validate: vi.fn().mockReturnValue({ valid: true }),
    addStoreEdge: vi.fn(),
    relocateEdge: vi.fn(),
    updateNodeInternals: vi.fn(),
    ...overrides,
  }
}

describe('createOnConnectHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState = { edges: [], removeEdge: vi.fn() }
  })

  // ===========================================================================
  // Early returns
  // ===========================================================================

  describe('early returns', () => {
    it('returns early when source is missing', () => {
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: null as unknown as string,
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).not.toHaveBeenCalled()
    })

    it('returns early when target is missing', () => {
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: null as unknown as string,
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).not.toHaveBeenCalled()
    })

    it('returns early when both source and target are missing', () => {
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: null as unknown as string,
        target: null as unknown as string,
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
    })

    it('returns early when isExecuting is true', () => {
      const params = createDefaultParams({ isExecuting: true })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(params.validate).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Relocation with convergence
  // ===========================================================================

  describe('relocation with convergence', () => {
    it('handles convergence by passing through the dropped targetHandle', () => {
      // Target node-b already has an edge from node-d on the default handle.
      // The "+" handle's DOM id IS the future stable id (e.g.,
      // `ingress_1` when ingressCount=1), so connection.targetHandle is
      // already correct on drop - the convergence path passes it through.
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target', sourceHandle: 'out_0' }

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(99999)
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: 'ingress_1',
      })

      expect(params.relocateEdge).toHaveBeenCalledWith('edge-old', {
        id: 'edge-a-node-b-99999',
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: 'ingress_1',
      })

      dateSpy.mockRestore()
    })

    it('schedules rAF to update node internals after convergence', () => {
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      // Capture rAF callbacks
      const rafCallbacks: Array<() => void> = []
      const originalRaf = globalThis.requestAnimationFrame
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb as unknown as () => void)
        return 0
      }

      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_1',
      })

      // Execute rAF callback
      expect(rafCallbacks.length).toBe(1)
      rafCallbacks[0]()

      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-b')
      // Old target is different from new target
      expect(params.updateNodeInternals).toHaveBeenCalledWith('old-target')

      globalThis.requestAnimationFrame = originalRaf
    })

    it('does not update old target internals when same as new target', () => {
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]
      const params = createDefaultParams()
      // Old target same as new connection target
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'node-b' }

      const rafCallbacks: Array<() => void> = []
      const originalRaf = globalThis.requestAnimationFrame
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb as unknown as () => void)
        return 0
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_1',
      })

      rafCallbacks[0]()
      expect(params.updateNodeInternals).toHaveBeenCalledTimes(1)
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-b')

      globalThis.requestAnimationFrame = originalRaf
    })

    it('cleans up relocation state after convergence', () => {
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }
      params.relocProximityTargetRef.current = 'node-b'

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.relocatingEdgeRef.current).toBeNull()
      expect(params.setRelocatingEdgeId).toHaveBeenCalledWith(null)
      expect(params.setRelocDragPos).toHaveBeenCalledWith(null)
      expect(params.relocProximityTargetRef.current).toBeNull()
      expect(params.setRelocProximityTargetId).toHaveBeenCalledWith(null)
    })

    it('rejects convergence relocation for cross-scope violation', () => {
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'cross-scope' }),
      })
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_1',
      })

      expect(params.relocateEdge).not.toHaveBeenCalled()
    })

    it('REPLACEs the existing edge when the drop lands on its handle', () => {
      // User drops the relocated edge ON an occupied handle. The replace
      // path deletes the previously-occupying edge AND relocates the
      // dragged edge to that same handle.
      mockStoreState.edges = [
        { id: 'edge-b-c', source: 'b', target: 'node-b' }, // occupies default handle
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target', sourceHandle: 'out_0' }

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(33333)
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: null, // dropped on the default (no-id) handle
      })

      // Existing edge on default handle is removed.
      expect(mockStoreState.removeEdge).toHaveBeenCalledWith('edge-b-c')
      // Dragged edge is relocated onto the same (default) handle.
      expect(params.relocateEdge).toHaveBeenCalledWith('edge-old', {
        id: 'edge-a-node-b-33333',
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: undefined,
      })

      dateSpy.mockRestore()
    })

    it('REPLACEs the existing edge on a named handle (ingress_N)', () => {
      mockStoreState.edges = [
        { id: 'edge-b-c-named', source: 'b', target: 'node-b', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_1', // drop on the occupied named handle
      })

      expect(mockStoreState.removeEdge).toHaveBeenCalledWith('edge-b-c-named')
      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_1')
    })

    it('schedules rAF to update node internals after REPLACE (different targets)', () => {
      mockStoreState.edges = [
        { id: 'edge-b-c', source: 'b', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      const rafCallbacks: Array<() => void> = []
      const originalRaf = globalThis.requestAnimationFrame
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb as unknown as () => void)
        return 0
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(rafCallbacks.length).toBe(1)
      rafCallbacks[0]()

      // Snap target and the dragged edge's previous target both re-measured.
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-b')
      expect(params.updateNodeInternals).toHaveBeenCalledWith('old-target')

      globalThis.requestAnimationFrame = originalRaf
    })

    it('does not re-measure the old target after REPLACE when it equals the new target', () => {
      // Old target == new target - only one updateNodeInternals call.
      mockStoreState.edges = [
        { id: 'edge-b-c', source: 'b', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'node-b' }

      const rafCallbacks: Array<() => void> = []
      const originalRaf = globalThis.requestAnimationFrame
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb as unknown as () => void)
        return 0
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      rafCallbacks[0]()
      expect(params.updateNodeInternals).toHaveBeenCalledTimes(1)
      expect(params.updateNodeInternals).toHaveBeenCalledWith('node-b')

      globalThis.requestAnimationFrame = originalRaf
    })

    it('passes targetHandle through verbatim from the drop event', () => {
      // The convergence path does not compute the next ingress id
      // internally; it trusts the connection.targetHandle that the user
      // dropped on (the "+" handle's DOM id IS the future stable id).
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
        { id: 'edge-e-b', source: 'e', target: 'node-b', targetHandle: 'ingress_2' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        // The user drops on the "+" handle whose id reflects the current
        // ingressCount; the convergence path forwards that id unchanged.
        targetHandle: 'ingress_3',
      })

      const callArgs = params.relocateEdge.mock.calls[0]
      expect(callArgs[1].targetHandle).toBe('ingress_3')
    })
  })

  // ===========================================================================
  // Relocation without convergence (non-convergence path)
  // ===========================================================================

  describe('relocation without convergence', () => {
    it('returns early when relocating but target has no other ingress', () => {
      // The relocating edge IS the only edge to node-b (itself excluded from check)
      mockStoreState.edges = [
        { id: 'edge-old', source: 'a', target: 'node-b' },
      ]
      const params = createDefaultParams()
      params.relocatingEdgeRef.current = { id: 'edge-old', source: 'a', target: 'old-target' }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      // Non-convergence: just returns - handleConnectEnd handles the actual relocation
      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(params.addStoreEdge).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Dynamic ingress "+" handle - carries the FUTURE stable id
  // (`ingress_${ingressCount}`) instead of a transient `ingress_add` token,
  // so the standard new-connection path adds the edge directly.
  // ===========================================================================

  describe('ingress "+" handle (stable id pass-through)', () => {
    it('creates new edge with the provided ingress_N targetHandle', () => {
      mockStoreState.edges = [
        // existing ingress edge on the default handle - ingressCount = 1 → "+" id = 'ingress_1'
        { id: 'edge-d-b', source: 'd', target: 'node-b' },
      ]

      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'output_0',
        targetHandle: 'ingress_1',
      })

      const callArgs = params.addStoreEdge.mock.calls[0][0]
      expect(callArgs.target).toBe('node-b')
      expect(callArgs.targetHandle).toBe('ingress_1')
      expect(callArgs.sourceHandle).toBe('output_0')
    })

    it('passes through ingress_N targetHandle when the node already has named ingress handles', () => {
      mockStoreState.edges = [
        { id: 'edge-1', source: 'x', target: 'node-b', targetHandle: 'ingress_1' },
        { id: 'edge-2', source: 'y', target: 'node-b', targetHandle: 'ingress_2' },
      ]
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        // ingressCount = 2 → "+" id = 'ingress_2' from InputHandles. But the
        // example above has 2 ingress edges (1 + 2) with ingressCount 2. The
        // "+" handle id for the NEXT slot would be `ingress_${ingressCount}` = 'ingress_2',
        // which conflicts with an existing edge. The standard
        // path's existingOnHandle check catches this and triggers replacement
        // semantics; this test asserts the targetHandle is passed through.
        targetHandle: 'ingress_3',
      })

      const callArgs = params.addStoreEdge.mock.calls[0][0]
      expect(callArgs.targetHandle).toBe('ingress_3')
      expect(callArgs.sourceHandle).toBeUndefined()
    })

    it('rejects an ingress_N connection for cross-scope violation', () => {
      mockStoreState.edges = []
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'cross-scope' }),
      })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'ingress_1',
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Handle replacement
  // ===========================================================================

  describe('handle replacement', () => {
    it('replaces existing edge on occupied target handle', () => {
      mockStoreState.edges = [
        { id: 'existing-edge', source: 'old-source', target: 'node-b', targetHandle: 'input_0' },
      ]
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(77777)
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'output_0',
        targetHandle: 'input_0',
      })

      expect(params.relocateEdge).toHaveBeenCalledWith('existing-edge', {
        id: 'edge-node-a-node-b-77777',
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'output_0',
        targetHandle: 'input_0',
      })
      expect(params.addStoreEdge).not.toHaveBeenCalled()

      dateSpy.mockRestore()
    })

    it('replaces existing edge on default (no targetHandle) handle', () => {
      mockStoreState.edges = [
        { id: 'existing-edge', source: 'old-source', target: 'node-b' },
      ]
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.relocateEdge).toHaveBeenCalledWith('existing-edge', expect.objectContaining({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: undefined,
        targetHandle: undefined,
      }))
    })
  })

  // ===========================================================================
  // Relocation - same-source duplicate rejection (lines 98-106)
  // ===========================================================================

  describe('relocation - same-source duplicate rejection', () => {
    it('aborts convergence when validate=duplicate and another same-source edge already reaches the target', () => {
      // Convergence path: target node-b already has an ingress on `ingress_1`
      // (from 'd'). It ALSO has an existing edge from source 'a' to 'node-b'
      // on a different handle. Dragging 'edge-old' (also from 'a') onto
      // 'ingress_2' would leave a stale a->node-b edge surviving.
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b', targetHandle: 'ingress_1' },
        { id: 'edge-a-b-other', source: 'a', target: 'node-b', targetHandle: 'ingress_2' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = {
        id: 'edge-old',
        source: 'a',
        target: 'old-target',
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_3',
      })

      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(mockStoreState.removeEdge).not.toHaveBeenCalled()
    })

    it('proceeds with convergence when validate=duplicate but the relocating edge is the only same-source edge', () => {
      // The only same-source edge to node-b IS the relocating edge itself,
      // so e.id !== oldEdge.id drops it and .some() returns false.
      mockStoreState.edges = [
        { id: 'edge-d-b', source: 'd', target: 'node-b' }, // other ingress
        { id: 'edge-old', source: 'a', target: 'node-b' }, // the relocating edge
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = {
        id: 'edge-old',
        source: 'a',
        target: 'old-target',
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: 'ingress_2',
      })

      expect(params.relocateEdge).toHaveBeenCalled()
    })

    it('proceeds with REPLACE when validate=duplicate but the duplicate edge IS the REPLACE target', () => {
      // The same-source edge to node-b is the one being REPLACED (occupies
      // the dropped handle). The e.id !== existingOnHandle?.id guard drops
      // it - no surviving duplicate.
      mockStoreState.edges = [
        // The existing edge on the dropped handle - same source as the relocating edge.
        { id: 'edge-a-b-occupying', source: 'a', target: 'node-b', targetHandle: 'ingress_1' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ reason: 'duplicate' }),
      })
      params.relocatingEdgeRef.current = {
        id: 'edge-old',
        source: 'a',
        target: 'old-target',
        sourceHandle: 'out',
      }

      const onConnect = createOnConnectHandler(params)
      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'ingress_1',
      })

      // REPLACE: occupying edge removed, dragged edge takes the handle.
      expect(mockStoreState.removeEdge).toHaveBeenCalledWith('edge-a-b-occupying')
      expect(params.relocateEdge).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // New connection - duplicate fallthrough to REPLACE (lines 188-200)
  // ===========================================================================

  describe('new connection - duplicate-on-handle REPLACE exemption', () => {
    it('falls through to REPLACE when validate=duplicate but the occupying edge will absorb the swap', () => {
      // No relocation in progress. User drops a new connection a->b on a
      // handle already occupied by a->b. validate returns 'duplicate', but
      // the REPLACE path is allowed because removing the existing edge
      // leaves no surviving duplicate.
      mockStoreState.edges = [
        { id: 'existing-a-b', source: 'a', target: 'node-b', targetHandle: 'in_1' },
      ]
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(55555)
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ valid: false, reason: 'duplicate' }),
      })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'in_1',
      })

      expect(params.relocateEdge).toHaveBeenCalledWith('existing-a-b', {
        id: 'edge-a-node-b-55555',
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'in_1',
      })
      expect(params.addStoreEdge).not.toHaveBeenCalled()

      dateSpy.mockRestore()
    })

    it('rejects the connection when validate=duplicate and another same-source edge would survive the REPLACE', () => {
      // Two existing a->b edges on different handles. User drops a third
      // a->b on handle 'in_1'. Even after replacing the in_1 occupant the
      // in_2 occupant remains - still a duplicate.
      mockStoreState.edges = [
        { id: 'existing-a-b-1', source: 'a', target: 'node-b', targetHandle: 'in_1' },
        { id: 'existing-a-b-2', source: 'a', target: 'node-b', targetHandle: 'in_2' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ valid: false, reason: 'duplicate' }),
      })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'in_1',
      })

      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(params.addStoreEdge).not.toHaveBeenCalled()
    })

    it('rejects the connection when validate=duplicate but no existing edge sits on the dropped handle', () => {
      // No edge on the dropped handle, so existingOnHandle is undefined and
      // the duplicate-exemption arm cannot kick in - falls into the plain
      // else { return } branch.
      mockStoreState.edges = [
        { id: 'edge-a-b-elsewhere', source: 'a', target: 'node-b', targetHandle: 'in_2' },
      ]
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ valid: false, reason: 'duplicate' }),
      })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'a',
        target: 'node-b',
        sourceHandle: 'out',
        targetHandle: 'in_1', // unoccupied
      })

      expect(params.relocateEdge).not.toHaveBeenCalled()
      expect(params.addStoreEdge).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Normal connection
  // ===========================================================================

  describe('normal connection', () => {
    it('adds a new edge for valid connection', () => {
      mockStoreState.edges = []
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'output_0',
        targetHandle: 'input_0',
      })

      expect(params.addStoreEdge).toHaveBeenCalledWith({
        id: 'edge-node-a-node-b',
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'output_0',
        targetHandle: 'input_0',
      })
    })

    it('coalesces null sourceHandle and targetHandle to undefined', () => {
      mockStoreState.edges = []
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).toHaveBeenCalledWith({
        id: 'edge-node-a-node-b',
        source: 'node-a',
        target: 'node-b',
        sourceHandle: undefined,
        targetHandle: undefined,
      })
    })

    it('does not add edge when validation fails', () => {
      mockStoreState.edges = []
      const params = createDefaultParams({
        validate: vi.fn().mockReturnValue({ valid: false }),
      })
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(params.addStoreEdge).not.toHaveBeenCalled()
      expect(params.relocateEdge).not.toHaveBeenCalled()
    })

    it('validates with all connection parameters', () => {
      mockStoreState.edges = []
      const params = createDefaultParams()
      const onConnect = createOnConnectHandler(params)

      onConnect({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: 'in_0',
      })

      expect(params.validate).toHaveBeenCalledWith({
        source: 'node-a',
        target: 'node-b',
        sourceHandle: 'out_0',
        targetHandle: 'in_0',
      })
    })
  })
})
