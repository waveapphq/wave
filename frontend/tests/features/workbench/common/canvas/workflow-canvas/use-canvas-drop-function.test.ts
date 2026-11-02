/**
 * Tests for the Function payload paths in `useCanvasDrop`.
 *
 * The drop hook is extended to recognize two Function-flavored drag payloads:
 *
 *   1. `{ type: 'function-new-local' }` from the palette's "+" handle.
 *      Creates a new local Function node with:
 *        - `type: 'workflowNode'`
 *        - `data.nodeType: 'function'`
 *        - `data.elementType: 'function'`
 *        - `data.functionLifecycle: 'local'`
 *        - `data.label` auto-generated as `Function_N` per
 *          `getNextLocalFunctionName`
 *        - `data.localDefinition` set to an empty workflow with empty
 *          input/output param lists
 *
 *   2. `{ type: 'function-published', functionId, name, source: 'library-modal' }`
 *      from the library modal.
 *      Creates a shared Function reference node with:
 *        - `data.nodeType: 'function'`
 *        - `data.elementType: 'function'`
 *        - `data.functionLifecycle: 'shared'`
 *        - `data.label` = the library Function's name
 *        - `data.functionId` = the library Function's UUID
 *
 * All canvas-drop mocks follow the pattern in `use-canvas-drop.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ToastContext } from '@/components/ui/toast'

// ===========================================================================
// Mock state (mirrors use-canvas-drop.test.ts)
// ===========================================================================

const mockScreenToFlowPosition = vi.fn((p: { x: number; y: number }) => p)
const mockNodeLookup = new Map<string, { measured?: { width?: number; height?: number } }>()
const mockRfStoreApi = { getState: () => ({ nodeLookup: mockNodeLookup }) }

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: mockScreenToFlowPosition }),
  useStoreApi: () => mockRfStoreApi,
}))

const mockAddNode = vi.fn()
const mockAddStoreEdge = vi.fn()
const mockValidate = vi.fn((): { valid: boolean; reason?: string } => ({ valid: true }))
const mockTrackUsage = vi.fn()

interface StoreState {
  nodes: Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>
  addNode: typeof mockAddNode
  addEdge: typeof mockAddStoreEdge
  drillPath: Array<{ nodeId: string; label: string }>
}

const mockStoreState: StoreState = {
  nodes: [],
  edges: [],
  addNode: mockAddNode,
  addEdge: mockAddStoreEdge,
  drillPath: [],
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector: (state: StoreState) => unknown) => selector(mockStoreState),
}))

vi.mock('@/features/workbench/hooks/use-connection-validator', () => ({
  useConnectionValidator: () => ({ validate: mockValidate }),
}))

vi.mock('@/features/workbench/stores/palette-usage-store', () => ({
  usePaletteUsageStore: (selector: (state: { trackUsage: typeof mockTrackUsage }) => unknown) =>
    selector({ trackUsage: mockTrackUsage }),
}))

const mockGetControlVersions = vi.fn((_type?: string) => [{ version: '1.0.0' }])
vi.mock('@/features/workbench/docs/_loader', () => ({
  getControlVersions: (type: string) => mockGetControlVersions(type),
}))

let nodeIdCounter = 0
vi.mock('@/features/workbench/common/canvas/workflow-canvas/canvas-constants', async () => {
  const actual = await vi.importActual<typeof import(
    '@/features/workbench/common/canvas/workflow-canvas/canvas-constants'
  )>(
    '@/features/workbench/common/canvas/workflow-canvas/canvas-constants',
  )
  return {
    ...actual,
    generateNodeId: () => `test-node-${++nodeIdCounter}`,
  }
})

import { useCanvasDrop } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-drop'

// ===========================================================================
// Helpers
// ===========================================================================

function dragEventWith(payload: object): React.DragEvent<HTMLDivElement> {
  const json = JSON.stringify(payload)
  return {
    preventDefault: vi.fn(),
    clientX: 500,
    clientY: 300,
    currentTarget: document.createElement('div'),
    relatedTarget: null,
    dataTransfer: {
      types: ['application/wave-block'],
      getData: vi.fn(() => json),
      dropEffect: 'none',
    },
  } as unknown as React.DragEvent<HTMLDivElement>
}

// ===========================================================================
// Tests
// ===========================================================================

describe('useCanvasDrop - Function payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodeIdCounter = 0
    mockStoreState.nodes = []
    mockStoreState.edges = []
    mockNodeLookup.clear()
    mockValidate.mockReturnValue({ valid: true })
    mockGetControlVersions.mockReturnValue([{ version: '1.0.0' }])
    mockScreenToFlowPosition.mockImplementation((p: { x: number; y: number }) => p)
  })

  // -----------------------------------------------------------------------
  // function-new-local
  // -----------------------------------------------------------------------

  describe('function-new-local payload', () => {
    it('creates a workflowNode with nodeType=function and functionLifecycle=local', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const event = dragEventWith({ type: 'function-new-local' })
      act(() => {
        result.current.handleDrop(event)
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflowNode',
          data: expect.objectContaining({
            nodeType: 'function',
            elementType: 'function',
            functionLifecycle: 'local',
          }),
        }),
      )
    })

    it('auto-names the local Function "Function" on an empty canvas (no _N suffix on first)', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ label: 'Function' }),
        }),
      )
    })

    it('skips taken Function names when auto-naming subsequent instances', () => {
      // Existing canvas already has the bare "Function" and "Function_2".
      // The next drop must bump to "Function_1" (lowest free suffix).
      mockStoreState.nodes = [
        {
          id: 'a',
          position: { x: 0, y: 0 },
          data: { label: 'Function', nodeType: 'function', functionLifecycle: 'local' },
        },
        {
          id: 'b',
          position: { x: 0, y: 100 },
          data: { label: 'Function_2', nodeType: 'function', functionLifecycle: 'shared' },
        },
      ]
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ label: 'Function_1' }),
        }),
      )
    })

    it('seeds an empty localDefinition (workflow + inputs + outputs) on the new node', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      const call = mockAddNode.mock.calls[0]?.[0]
      const localDef = (call?.data as Record<string, unknown> | undefined)?.localDefinition as
        | { workflow?: { nodes?: unknown[]; edges?: unknown[] }; inputs?: unknown[]; outputs?: unknown[] }
        | undefined
      expect(localDef).toBeDefined()
      expect(localDef!.workflow).toEqual({ nodes: [], edges: [] })
      expect(localDef!.inputs).toEqual([])
      expect(localDef!.outputs).toEqual([])
    })

    it('does NOT set data.functionId for local Function instances', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      const call = mockAddNode.mock.calls[0]?.[0]
      const data = call?.data as Record<string, unknown> | undefined
      expect(data?.functionId).toBeUndefined()
    })

    it('places the new node at the drop position (screen-to-flow conversion)', () => {
      mockScreenToFlowPosition.mockReturnValue({ x: 250, y: 175 })
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({ position: { x: 250, y: 175 } }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // function-published
  // -----------------------------------------------------------------------

  describe('function-published payload', () => {
    const PUBLISHED = {
      type: 'function-published',
      functionId: 'fn-abc-123',
      name: 'parse_csv',
      source: 'library-modal',
    }

    it('creates a workflowNode with nodeType=function and functionLifecycle=shared', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith(PUBLISHED))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflowNode',
          data: expect.objectContaining({
            nodeType: 'function',
            elementType: 'function',
            functionLifecycle: 'shared',
          }),
        }),
      )
    })

    it('uses the library name as the bare label on first drop AND stores it as originalLibraryName', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith(PUBLISHED))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'parse_csv',
            originalLibraryName: 'parse_csv',
          }),
        }),
      )
    })

    it('stores the library functionId on the new node', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith(PUBLISHED))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ functionId: 'fn-abc-123' }),
        }),
      )
    })

    it('does NOT seed a localDefinition for shared Function references', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith(PUBLISHED))
      })
      const call = mockAddNode.mock.calls[0]?.[0]
      const data = call?.data as Record<string, unknown> | undefined
      expect(data?.localDefinition).toBeUndefined()
    })

    it('auto-names shared Function instances by appending _N to the library name on collision', () => {
      // A previous drop already created the bare "parse_csv" node; the next
      // drop of the same library function must bump to "parse_csv_1".
      mockStoreState.nodes = [
        {
          id: 'a',
          position: { x: 0, y: 0 },
          data: { label: 'parse_csv', nodeType: 'function', functionLifecycle: 'shared' },
        },
      ]
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith(PUBLISHED))
      })
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'parse_csv_1',
            originalLibraryName: 'parse_csv',
          }),
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // Cross-cutting
  // -----------------------------------------------------------------------

  describe('cross-cutting', () => {
    it('blocks Function drops while workflow is executing', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: true }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('does NOT track palette usage for Function drops (Functions are not palette items)', () => {
      // Palette usage tracking exists for control/plugin discovery surfacing. The
      // Functions Library is a separate surface; the shared usage store should
      // not be touched.
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      act(() => {
        result.current.handleDrop(dragEventWith({ type: 'function-new-local' }))
      })
      expect(mockTrackUsage).not.toHaveBeenCalled()
    })
  })
})


// A Function cannot be nested inside itself. When the user is
// drilled into a Function body and drops the SAME Function (a published
// instance whose functionId matches the drilled-in body), the drop is rejected
// rather than creating a self-referential nesting.
describe('useCanvasDrop - self-reference drop guard', () => {
  const drilledIntoSelf = {
    id: 'fnode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Selfie',
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'shared',
      functionId: 'F-lib',
      // Drilled-in body (pushSharedDrill stamps a localDefinition); empty here.
      localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    nodeIdCounter = 0
    mockNodeLookup.clear()
    mockValidate.mockReturnValue({ valid: true })
    mockScreenToFlowPosition.mockImplementation((p: { x: number; y: number }) => p)
    mockStoreState.nodes = [drilledIntoSelf]
    mockStoreState.edges = []
    mockStoreState.drillPath = [{ nodeId: 'fnode', label: 'Selfie' }]
  })

  it('rejects dropping a Function into itself (same functionId as the drilled-in body)', () => {
    const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
    act(() => {
      result.current.handleDrop(
        dragEventWith({ type: 'function-published', functionId: 'F-lib', name: 'Selfie' }),
      )
    })
    expect(mockAddNode).not.toHaveBeenCalled()
  })

  it('allows dropping a different Function into the body (no self-reference)', () => {
    const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
    act(() => {
      result.current.handleDrop(
        dragEventWith({ type: 'function-published', functionId: 'OTHER-lib', name: 'Other' }),
      )
    })
    expect(mockAddNode).toHaveBeenCalled()
  })

  it('rejects self-drop when the drilled-in body is nested inside a Local function', () => {
    // drillPath: outer Local -> inner shared (drilled). The drilled 'inner' lives
    // inside outer's localDefinition, so resolving its functionId recurses the
    // node tree. The sibling nodes before it (a plugin with no localDefinition,
    // and an empty-bodied Local) exercise the recursion's no-body + miss paths.
    const inner = {
      id: 'inner',
      position: { x: 0, y: 0 },
      data: {
        label: 'Selfie',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'F-lib',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
      },
    }
    const pluginSibling = {
      id: 'sib-plugin',
      position: { x: 0, y: 0 },
      data: { label: 'Log', nodeType: 'plugin', elementType: 'log' },
    }
    const emptyLocalSibling = {
      id: 'sib-local',
      position: { x: 0, y: 0 },
      data: {
        label: 'Empty',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
      },
    }
    mockStoreState.nodes = [
      {
        id: 'outer',
        position: { x: 0, y: 0 },
        data: {
          label: 'Outer',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [pluginSibling, emptyLocalSibling, inner], edges: [] },
            inputs: [],
            outputs: [],
          },
        },
      },
    ]
    mockStoreState.drillPath = [
      { nodeId: 'outer', label: 'Outer' },
      { nodeId: 'inner', label: 'Selfie' },
    ]
    const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
    act(() => {
      result.current.handleDrop(
        dragEventWith({ type: 'function-published', functionId: 'F-lib', name: 'Selfie' }),
      )
    })
    expect(mockAddNode).not.toHaveBeenCalled()
  })

  it('surfaces a toast when a self-drop is rejected', () => {
    const toastErrorSpy = vi.fn()
    const fakeToast = {
      toast: vi.fn(),
      dismiss: vi.fn(),
      success: vi.fn(),
      error: toastErrorSpy,
      warning: vi.fn(),
      info: vi.fn(),
    }
    const toastWrapper = ({ children }: { children: ReactNode }) =>
      createElement(ToastContext.Provider, { value: fakeToast as never }, children)
    const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }), {
      wrapper: toastWrapper,
    })
    act(() => {
      result.current.handleDrop(
        dragEventWith({ type: 'function-published', functionId: 'F-lib', name: 'Selfie' }),
      )
    })
    expect(mockAddNode).not.toHaveBeenCalled()
    expect(toastErrorSpy).toHaveBeenCalled()
  })
})
