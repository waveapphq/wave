/**
 * useCanvasDrop Hook Tests
 *
 * Tests for the canvas drop hook that handles palette drag-and-drop,
 * proximity feedback, and auto-connection when dropping near free outputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Node } from '@xyflow/react'

// ===========================================================================
// Mock state
// ===========================================================================

const mockScreenToFlowPosition = vi.fn((p: { x: number; y: number }) => p)
interface MockInternalNode {
  measured?: { width?: number; height?: number }
  internals?: {
    handleBounds?: {
      source?: Array<{ id: string; x: number; y: number; width: number; height: number }>
    }
  }
}
const mockNodeLookup = new Map<string, MockInternalNode>()
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

// Mock generateNodeId to return deterministic values
let nodeIdCounter = 0
vi.mock('@/features/workbench/common/canvas/workflow-canvas/canvas-constants', async () => {
  const actual = await vi.importActual('@/features/workbench/common/canvas/workflow-canvas/canvas-constants')
  return {
    ...(actual as Record<string, unknown>),
    generateNodeId: () => `test-node-${++nodeIdCounter}`,
  }
})

import { useCanvasDrop } from '@/features/workbench/common/canvas/workflow-canvas/use-canvas-drop'
import { START_NODE_ID, START_NODE_POSITION } from '@/features/workbench/common/canvas/workflow-canvas/canvas-constants'

// ===========================================================================
// Helpers
// ===========================================================================

function createDragEvent(overrides: Partial<DragEvent> = {}): DragEvent {
  const types: string[] = overrides.dataTransfer
    ? (overrides.dataTransfer as unknown as { types: string[] }).types ?? ['application/wave-block']
    : ['application/wave-block']

  const blockData = JSON.stringify({ id: 'shell-script', name: 'Shell Script', type: 'plugin', category: 'core' })

  return {
    preventDefault: vi.fn(),
    clientX: 500,
    clientY: 300,
    currentTarget: document.createElement('div'),
    relatedTarget: null,
    dataTransfer: {
      types,
      getData: vi.fn(() => blockData),
      dropEffect: 'none',
    },
    ...overrides,
  } as unknown as DragEvent
}

function createReactDragEvent(overrides: Partial<DragEvent> = {}): React.DragEvent<HTMLDivElement> {
  return createDragEvent(overrides) as unknown as React.DragEvent<HTMLDivElement>
}

// ===========================================================================
// Tests
// ===========================================================================

describe('useCanvasDrop', () => {
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

  // =========================================================================
  // Return shape
  // =========================================================================

  describe('return values', () => {
    it('returns all expected properties', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
      expect(typeof result.current.setProximitySourceId).toBe('function')
      expect(typeof result.current.setProximityTargetPos).toBe('function')
      expect(typeof result.current.handleDrop).toBe('function')
      expect(typeof result.current.handleDragOver).toBe('function')
      expect(typeof result.current.handleDragLeave).toBe('function')
      expect(typeof result.current.handleNodeDrag).toBe('function')
      expect(typeof result.current.handleNodeDragStop).toBe('function')
      expect(typeof result.current.findClosestFreeOutput).toBe('function')
    })
  })

  // =========================================================================
  // findNodesWithFreeOutput (tested via findClosestFreeOutput)
  // =========================================================================

  describe('findClosestFreeOutput', () => {
    it('includes start node when it has no outgoing edge', () => {
      // No edges, so start node has free output
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Drop position below and near the start node
      const closest = result.current.findClosestFreeOutput({
        x: START_NODE_POSITION.x + 60, // ~center
        y: START_NODE_POSITION.y + 60,  // below
      })

      expect(closest).toBe(START_NODE_ID)
    })

    it('does not include start node when it has an outgoing edge', () => {
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'node-1' }]
      mockStoreState.nodes = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const closest = result.current.findClosestFreeOutput({
        x: START_NODE_POSITION.x + 60,
        y: START_NODE_POSITION.y + 60,
      })

      expect(closest).toBeNull()
    })

    it('returns closest free node below drop position', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', position: { x: 0, y: 200 }, data: {} },
      ]
      // n1 has outgoing, n2 is free
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'n1' },
        { id: 'e2', source: 'n1', target: 'x' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Position below n2 (n2 is at y=200, default height=50, bottom=250)
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 260 })
      expect(closest).toBe('n2')
    })

    it('returns null when no free nodes are within threshold', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'n1' },
        { id: 'e2', source: 'n1', target: 'x' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Far away from any node
      const closest = result.current.findClosestFreeOutput({ x: 9999, y: 9999 })
      expect(closest).toBeNull()
    })

    it('uses measured dimensions from React Flow nodeLookup', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'z' }]
      mockNodeLookup.set('n1', { measured: { width: 200, height: 100 } })

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // n1 with measured: bottom = 0 + 100 = 100, center = 0 + 200/2 = 100
      // Position just below: (100, 110)
      const closest = result.current.findClosestFreeOutput({ x: 100, y: 110 })
      expect(closest).toBe('n1')
    })

    it('uses default dimensions when nodeLookup entry has no measured data', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'z' }]
      // nodeLookup entry exists but no measured
      mockNodeLookup.set('n1', {})

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Default: w=120, h=50, bottom=50, center=60
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('n1')
    })

    it('picks the closest node when multiple free nodes are nearby', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', position: { x: 0, y: 70 }, data: {} },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'z' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // n1 bottom = 50, n2 bottom = 120. Drop at y=115 is closer to n2
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 115 })
      expect(closest).toBe('n2')
    })

    it('allows drops slightly above node bottom (dy > -20)', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'z' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // node bottom at y=50, drop at y=35 means dy = 35-50 = -15 > -20, within threshold
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 35 })
      expect(closest).toBe('n1')
    })

    it('rejects drops too far above node bottom (dy <= -20)', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 100 }, data: {} },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'z' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // node bottom at y=150, drop at y=100 means dy = 100-150 = -50 < -20
      // BUT we need the distance to also be within ELEMENT_PROXIMITY_THRESHOLD
      // distance = hypot(0, -50) = 50 < 100 threshold, but dy < -20
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 100 })
      expect(closest).toBeNull()
    })
  })

  // =========================================================================
  // Multi-handle node support (For Loop, ForEach, Try/Catch)
  // =========================================================================

  // =========================================================================
  // Proximity resolves to the nearest FREE lane, not the first one.
  // =========================================================================

  describe('nearest free lane on a wide multi-handle node', () => {
    const LANE_Y = 100

    /** A Switch 320px wide whose four lanes sit 64px apart along the bottom. */
    function seedWideSwitch(usedHandles: string[] = []) {
      mockStoreState.nodes = [
        {
          id: 'sw1',
          position: { x: 0, y: 0 },
          data: {
            elementType: 'switch-case',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'case' },
                  { id: 'branch_1', type: 'case' },
                  { id: 'branch_2', type: 'case' },
                ],
              },
            },
          },
        },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'sw1' },
        ...usedHandles.map((h, i) => ({
          id: `used-${i}`,
          source: 'sw1',
          target: `t${i}`,
          sourceHandle: h,
        })),
      ]
      mockNodeLookup.set('sw1', {
        measured: { width: 320, height: LANE_Y },
        internals: {
          handleBounds: {
            source: [
              { id: 'branch_0', x: 40, y: LANE_Y, width: 16, height: 8 },
              { id: 'branch_1', x: 104, y: LANE_Y, width: 16, height: 8 },
              { id: 'branch_2', x: 168, y: LANE_Y, width: 16, height: 8 },
              { id: 'then', x: 232, y: LANE_Y, width: 16, height: 8 },
            ],
          },
        },
      })
    }

    it('picks the lane the pointer is actually under', () => {
      seedWideSwitch()

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      // Straight under lane 3 (its center sits at x=176).
      mockScreenToFlowPosition.mockReturnValue({ x: 176, y: 140 })

      act(() => {
        result.current.handleDragOver(
          createReactDragEvent() as unknown as React.DragEvent<HTMLDivElement>,
        )
      })

      expect(result.current.proximitySourceId).toBe('sw1')
      expect(result.current.proximitySourceHandle).toBe('branch_2')
    })

    it('skips a lane that is already wired and offers the next free one', () => {
      seedWideSwitch(['branch_2'])

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      // Nearest lane is the wired branch_2, so the free `then` beside it wins.
      mockScreenToFlowPosition.mockReturnValue({ x: 210, y: 140 })

      act(() => {
        result.current.handleDragOver(
          createReactDragEvent() as unknown as React.DragEvent<HTMLDivElement>,
        )
      })

      expect(result.current.proximitySourceHandle).toBe('then')
    })

    it('reaches a far lane that is out of range of the node center', () => {
      seedWideSwitch()

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      // Far outside the 100px radius the node's bottom center, but
      // right under the `then` lane.
      const probe = { x: 300, y: 150 }

      expect(result.current.findClosestFreeOutput(probe)).toBe('sw1')
    })

    it('connects the dropped block to the lane it was dropped under', () => {
      seedWideSwitch()

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      mockScreenToFlowPosition.mockReturnValue({ x: 300, y: 150 })

      act(() => {
        result.current.handleDrop(
          createReactDragEvent() as unknown as React.DragEvent<HTMLDivElement>,
        )
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'sw1', sourceHandle: 'then' }),
      )
    })

    it('attaches a dragged node to the lane it was released under', () => {
      seedWideSwitch()

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const dragged = {
        id: 'free-node',
        position: { x: 116, y: 160 },
        measured: { width: 120, height: 50 },
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, dragged)
      })
      expect(result.current.proximitySourceHandle).toBe('branch_2')

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, dragged)
      })
      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'sw1', target: 'free-node', sourceHandle: 'branch_2' }),
      )
    })

    it('falls back to the first free lane before the handles are measured', () => {
      seedWideSwitch()
      mockNodeLookup.set('sw1', { measured: { width: 320, height: LANE_Y } })

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      mockScreenToFlowPosition.mockReturnValue({ x: 160, y: 140 })

      act(() => {
        result.current.handleDrop(
          createReactDragEvent() as unknown as React.DragEvent<HTMLDivElement>,
        )
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'sw1', sourceHandle: 'branch_0' }),
      )
    })
  })

  describe('multi-handle nodes', () => {
    it('includes For Loop with free body handle in free output list', () => {
      mockStoreState.nodes = [
        { id: 'for1', position: { x: 0, y: 0 }, data: { elementType: 'for' } },
      ]
      // "then" handle is connected but "body" is free
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'for1' },
        { id: 'e2', source: 'for1', target: 'after', sourceHandle: 'then' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('for1')
    })

    it('excludes For Loop when all handles are connected', () => {
      mockStoreState.nodes = [
        { id: 'for1', position: { x: 0, y: 0 }, data: { elementType: 'for' } },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'for1' },
        { id: 'e2', source: 'for1', target: 'body-node', sourceHandle: 'body' },
        { id: 'e3', source: 'for1', target: 'then-node', sourceHandle: 'then' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBeNull()
    })

    it('includes ForEach with free handles', () => {
      mockStoreState.nodes = [
        { id: 'fe1', position: { x: 0, y: 0 }, data: { elementType: 'for-each' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'fe1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('fe1')
    })

    it('includes Try/Catch with free handles', () => {
      mockStoreState.nodes = [
        { id: 'tc1', position: { x: 0, y: 0 }, data: { elementType: 'try-catch-finally', config: { values: { enable_catch: true, enable_finally: true } } } },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'tc1' },
        { id: 'e2', source: 'tc1', target: 'try-node', sourceHandle: 'try' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('tc1')
    })

    it('auto-connect sets sourceHandle=try for Try/Catch drop', () => {
      mockStoreState.nodes = [
        { id: 'tc1', position: { x: 0, y: 0 }, data: { elementType: 'try-catch-finally', config: { values: { enable_catch: true, enable_finally: false } } } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'tc1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      mockScreenToFlowPosition.mockReturnValue({ x: 60, y: 55 })

      act(() => {
        result.current.handleDrop(event as unknown as React.DragEvent<HTMLDivElement>)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'tc1', sourceHandle: 'try' })
      )
    })

    it('includes Try/Catch with default config (no config set)', () => {
      mockStoreState.nodes = [
        { id: 'tc2', position: { x: 0, y: 0 }, data: { elementType: 'try-catch-finally' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'tc2' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('tc2')
    })

    it('excludes halt nodes (no output handles)', () => {
      mockStoreState.nodes = [
        { id: 'h1', position: { x: 0, y: 0 }, data: { elementType: 'halt' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'h1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBeNull()
    })

    it('auto-connect sets sourceHandle=body for For Loop drop', () => {
      mockStoreState.nodes = [
        { id: 'for1', position: { x: 0, y: 0 }, data: { elementType: 'for' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'for1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      mockScreenToFlowPosition.mockReturnValue({ x: 60, y: 55 })

      act(() => {
        result.current.handleDrop(event as unknown as React.DragEvent<HTMLDivElement>)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'for1', sourceHandle: 'body' })
      )
    })

    it('auto-connect sets sourceHandle=then when body is already connected', () => {
      mockStoreState.nodes = [
        { id: 'for1', position: { x: 0, y: 0 }, data: { elementType: 'for' } },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'for1' },
        { id: 'e2', source: 'for1', target: 'existing', sourceHandle: 'body' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      mockScreenToFlowPosition.mockReturnValue({ x: 60, y: 55 })

      act(() => {
        result.current.handleDrop(event as unknown as React.DragEvent<HTMLDivElement>)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'for1', sourceHandle: 'then' })
      )
    })

    it('auto-connect omits sourceHandle for single-handle nodes', () => {
      // log1 is a single-handle node with a free output
      mockStoreState.nodes = [
        { id: 'log1', position: { x: 0, y: 0 }, data: { elementType: 'log' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'log1' }]

      const { result: result2 } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      // Drop position near log1 (at 0,0 with default height 50, bottom center = 60,55)
      mockScreenToFlowPosition.mockReturnValue({ x: 60, y: 55 })

      act(() => {
        result2.current.handleDrop(event as unknown as React.DragEvent<HTMLDivElement>)
      })

      const edgeArg = mockAddStoreEdge.mock.calls[0]?.[0]
      expect(edgeArg).toBeDefined()
      expect(edgeArg.source).toBe('log1')
      expect(edgeArg.sourceHandle).toBeUndefined()
    })

    it('includes Assert (explicit split mode) with free pass/fail handles', () => {
      mockStoreState.nodes = [
        {
          id: 'as1',
          position: { x: 0, y: 0 },
          data: { elementType: 'assert', config: { values: { mode: 'split' } } },
        },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'as1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('as1')
    })

    it('includes Assert with default split mode (no config)', () => {
      mockStoreState.nodes = [
        { id: 'as2', position: { x: 0, y: 0 }, data: { elementType: 'assert' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'as2' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('as2')
    })

    it('treats Assert in single mode as single-handle node (free when no outgoing edge)', () => {
      // Assert single-mode returns null from getNodeOutputHandles, falling
      // through to the single-handle path - free only if no outgoing edge.
      mockStoreState.nodes = [
        {
          id: 'as3',
          position: { x: 0, y: 0 },
          data: { elementType: 'assert', config: { values: { mode: 'single' } } },
        },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'as3' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBe('as3')
    })

    it('treats Assert in single mode as single-handle node (not free when outgoing edge exists)', () => {
      mockStoreState.nodes = [
        {
          id: 'as4',
          position: { x: 0, y: 0 },
          data: { elementType: 'assert', config: { values: { mode: 'single' } } },
        },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'as4' },
        { id: 'e2', source: 'as4', target: 'next' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))
      const closest = result.current.findClosestFreeOutput({ x: 60, y: 55 })
      expect(closest).toBeNull()
    })

    it('auto-connect sets sourceHandle=pass for Assert split mode drop', () => {
      mockStoreState.nodes = [
        {
          id: 'as5',
          position: { x: 0, y: 0 },
          data: { elementType: 'assert', config: { values: { mode: 'split' } } },
        },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'as5' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      mockScreenToFlowPosition.mockReturnValue({ x: 60, y: 55 })

      act(() => {
        result.current.handleDrop(event as unknown as React.DragEvent<HTMLDivElement>)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'as5', sourceHandle: 'pass' })
      )
    })
  })

  // =========================================================================
  // handleDrop
  // =========================================================================

  describe('handleDrop', () => {
    it('creates a node and auto-connects when near a free output', () => {
      mockStoreState.edges = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent()
      act(() => {
        result.current.handleDrop(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-node-1',
          type: 'workflowNode',
          data: expect.objectContaining({
            // Universal auto-naming rule: the FIRST instance of a base name
            // (e.g. "Shell Script") uses the bare base; subsequent instances get
            // `_N` suffixes (Shell Script_1, Shell Script_2, ...). Applies uniformly to
            // plugins, controls, and Function instances.
            label: 'Shell Script',
            elementType: 'shell-script',
            nodeType: 'plugin',
            version: '1.0.0',
          }),
        })
      )
      expect(mockTrackUsage).toHaveBeenCalledWith('shell-script')
    })

    it('blocks drops while workflow is executing', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: true }))

      act(() => {
        result.current.handleDrop(createReactDragEvent())
      })

      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('ignores drops without wave-block data type', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent({
        dataTransfer: {
          types: ['text/plain'],
          getData: vi.fn(() => ''),
          dropEffect: 'none',
        } as unknown as DataTransfer,
      })

      act(() => {
        result.current.handleDrop(event)
      })

      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('ignores drops with invalid JSON data', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent({
        dataTransfer: {
          types: ['application/wave-block'],
          getData: vi.fn(() => 'not-json{{{'),
          dropEffect: 'none',
        } as unknown as DataTransfer,
      })

      act(() => {
        result.current.handleDrop(event)
      })

      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('auto-connects to closest free output when validation passes', () => {
      // Start node has no outgoing edge, so it's free
      mockStoreState.edges = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Drop near start node
      const event = createReactDragEvent({
        clientX: START_NODE_POSITION.x + 60,
        clientY: START_NODE_POSITION.y + 60,
      } as unknown as DragEvent)

      act(() => {
        result.current.handleDrop(event)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: START_NODE_ID,
          target: 'test-node-1',
        })
      )
    })

    it('does not auto-connect when validation fails', () => {
      mockStoreState.edges = []
      mockValidate.mockReturnValue({ valid: false, reason: 'cycle' })

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.handleDrop(createReactDragEvent({
          clientX: START_NODE_POSITION.x + 60,
          clientY: START_NODE_POSITION.y + 60,
        } as unknown as DragEvent))
      })

      expect(mockAddNode).toHaveBeenCalled()
      expect(mockAddStoreEdge).not.toHaveBeenCalled()
    })

    it('does not auto-connect when no free output is nearby', () => {
      // All nodes have outgoing edges
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'n1' },
      ]
      mockStoreState.nodes = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.handleDrop(createReactDragEvent({
          clientX: 9999,
          clientY: 9999,
        } as unknown as DragEvent))
      })

      expect(mockAddNode).toHaveBeenCalled()
      expect(mockAddStoreEdge).not.toHaveBeenCalled()
    })

    it('creates note node type for note blocks', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const noteData = JSON.stringify({ id: 'note', name: 'Note', type: 'control' })
      const event = createReactDragEvent({
        dataTransfer: {
          types: ['application/wave-block'],
          getData: vi.fn(() => noteData),
          dropEffect: 'none',
        } as unknown as DataTransfer,
      })

      act(() => {
        result.current.handleDrop(event)
      })

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'noteNode',
          data: expect.objectContaining({
            elementType: 'note',
            config: { text: '', color: 'slate' },
          }),
        })
      )
    })

    it('uses fallback version when no control versions exist', () => {
      mockGetControlVersions.mockReturnValue([])

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.handleDrop(createReactDragEvent())
      })

      expect(mockAddNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '1.0.0' }),
        })
      )
    })

    it('clears proximity state on drop', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Set some proximity state first
      act(() => {
        result.current.setProximitySourceId('some-node')
        result.current.setProximityTargetPos({ x: 100, y: 200 })
      })

      expect(result.current.proximitySourceId).toBe('some-node')

      act(() => {
        result.current.handleDrop(createReactDragEvent())
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })
  })

  // =========================================================================
  // handleDragOver
  // =========================================================================

  describe('handleDragOver', () => {
    it('blocks drag feedback while executing', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: true }))

      const event = createReactDragEvent()

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
      expect((event.dataTransfer as unknown as { dropEffect: string }).dropEffect).toBe('none')
    })

    it('sets dropEffect to move and checks proximity for wave-block drags', () => {
      mockStoreState.edges = []
      // Need to ensure throttle doesn't block - mock Date.now to control timing
      vi.spyOn(Date, 'now').mockReturnValue(100000)

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent({
        clientX: START_NODE_POSITION.x + 60,
        clientY: START_NODE_POSITION.y + 60,
      } as unknown as DragEvent)

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(event.preventDefault).toHaveBeenCalled()
      expect((event.dataTransfer as unknown as { dropEffect: string }).dropEffect).toBe('move')
      expect(result.current.proximitySourceId).toBe(START_NODE_ID)
      expect(result.current.proximityTargetPos).not.toBeNull()

      vi.restoreAllMocks()
    })

    it('clears proximity for non-wave-block drags', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Set some initial proximity
      act(() => {
        result.current.setProximitySourceId('some-node')
        result.current.setProximityTargetPos({ x: 1, y: 2 })
      })

      const event = createReactDragEvent({
        dataTransfer: {
          types: ['text/plain'],
          getData: vi.fn(() => ''),
          dropEffect: 'none',
        } as unknown as DataTransfer,
      })

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })

    it('throttles proximity checks (skips if called within 32ms)', () => {
      const nowSpy = vi.spyOn(Date, 'now')
      nowSpy.mockReturnValue(1000)

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // First call passes throttle
      act(() => {
        result.current.handleDragOver(createReactDragEvent())
      })

      // Second call within 32ms should be throttled
      nowSpy.mockReturnValue(1020)

      act(() => {
        result.current.handleDragOver(createReactDragEvent())
      })

      // Third call after 32ms should pass
      nowSpy.mockReturnValue(1050)
      act(() => {
        result.current.handleDragOver(createReactDragEvent())
      })

      // Throttling allows 1st and 3rd calls but skips 2nd
      // (proximity state should reflect the 3rd call's position)
      expect(mockScreenToFlowPosition).toHaveBeenCalled()

      nowSpy.mockRestore()
    })

    it('sets proximityTargetPos to null when no source found', () => {
      vi.spyOn(Date, 'now').mockReturnValue(100000)

      // All nodes have outgoing edges
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'n1' }]
      mockStoreState.nodes = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const event = createReactDragEvent({
        clientX: 9999,
        clientY: 9999,
      } as unknown as DragEvent)

      act(() => {
        result.current.handleDragOver(event)
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()

      vi.restoreAllMocks()
    })
  })

  // =========================================================================
  // handleDragLeave
  // =========================================================================

  describe('handleDragLeave', () => {
    it('clears proximity when truly leaving canvas (no related target)', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('node-1')
        result.current.setProximityTargetPos({ x: 1, y: 2 })
      })

      const container = document.createElement('div')
      const event = {
        relatedTarget: null,
        currentTarget: container,
      } as unknown as React.DragEvent<HTMLDivElement>

      act(() => {
        result.current.handleDragLeave(event)
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })

    it('clears proximity when related target is outside canvas', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('node-1')
      })

      const container = document.createElement('div')
      const outsideElement = document.createElement('div')
      const event = {
        relatedTarget: outsideElement,
        currentTarget: container,
      } as unknown as React.DragEvent<HTMLDivElement>

      act(() => {
        result.current.handleDragLeave(event)
      })

      expect(result.current.proximitySourceId).toBeNull()
    })

    it('does not clear proximity when related target is inside canvas', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('node-1')
      })

      const container = document.createElement('div')
      const child = document.createElement('div')
      container.appendChild(child)

      const event = {
        relatedTarget: child,
        currentTarget: container,
      } as unknown as React.DragEvent<HTMLDivElement>

      act(() => {
        result.current.handleDragLeave(event)
      })

      expect(result.current.proximitySourceId).toBe('node-1')
    })
  })

  // =========================================================================
  // handleNodeDrag
  // =========================================================================

  describe('handleNodeDrag', () => {
    it('shows proximity for unlinked node near free output', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', position: { x: 0, y: 80 }, data: {} },
      ]
      mockStoreState.edges = []

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const draggedNode = {
        id: 'n2',
        position: { x: 0, y: 80 },
        measured: { width: 120 },
        data: {},
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })

      // n2 top center: (60, 80). Check proximity to n1's output (bottom=50, center=60).
      // START_NODE is also free. Closest should be found.
      expect(result.current.proximitySourceId).not.toBeNull()
    })

    it('clears proximity when dragged node has incoming edge (is linked)', () => {
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', position: { x: 0, y: 80 }, data: {} },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: 'n1', target: 'n2' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('some-node')
      })

      const draggedNode = {
        id: 'n2',
        position: { x: 0, y: 80 },
        measured: { width: 120 },
        data: {},
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })

    it('does not show proximity to self', () => {
      // Only the dragged node itself is a free output (n1 has no outgoing edge)
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'z' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Position the drag so n1's top-center lands right below n1's own output
      // n1 is at (0,0), default size 120x50, bottom at y=50, center x=60
      // Node top-center at (60, 55) -> dy = 55-50 = 5 > -20, within threshold
      const draggedNode = {
        id: 'n1',
        position: { x: 0, y: 55 },
        measured: { width: 120 },
        data: {},
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })

      // findClosestFreeOutput returns 'n1', but self-check filters it out
      expect(result.current.proximitySourceId).toBeNull()
    })

    it('sets null proximity when no free output is nearby', () => {
      // All nodes have outgoing edges, no free outputs
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'z' },
        { id: 'e2', source: 'n1', target: 'z2' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const draggedNode = {
        id: 'n2',
        position: { x: 9999, y: 9999 },
        measured: { width: 120 },
        data: {},
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })

      // sourceId is null -> finalId is null (not self-check, just no match)
      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })

    it('uses default width when measured is missing', () => {
      // n1 is a free output source, n2 is the dragged (unlinked) node
      mockStoreState.nodes = [
        { id: 'n1', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', position: { x: 0, y: 80 }, data: {} },
      ]
      mockStoreState.edges = [
        { id: 'e1', source: START_NODE_ID, target: 'z' },
      ]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const draggedNode = {
        id: 'n2',
        position: { x: 0, y: 80 },
        // measured is undefined - should use default width 120
        data: {},
      } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })

      // n2 top center at (60, 80), n1 bottom at (60, 50) - should find n1
      expect(result.current.proximitySourceId).toBe('n1')
    })
  })

  // =========================================================================
  // handleNodeDragStop
  // =========================================================================

  describe('handleNodeDragStop', () => {
    it('auto-connects on drop when proximity is active and validation passes', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      // Set proximity state
      act(() => {
        result.current.setProximitySourceId('source-node')
      })

      const draggedNode = { id: 'target-node', position: { x: 0, y: 0 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(mockValidate).toHaveBeenCalledWith({
        source: 'source-node',
        target: 'target-node',
      })
      expect(mockAddStoreEdge).toHaveBeenCalledWith({
        id: 'edge-source-node-target-node',
        source: 'source-node',
        target: 'target-node',
      })
    })

    it('auto-connects with sourceHandle for multi-handle source on node drag stop', () => {
      mockStoreState.nodes = [
        { id: 'for1', position: { x: 0, y: 0 }, data: { elementType: 'for' } },
      ]
      mockStoreState.edges = [{ id: 'e1', source: START_NODE_ID, target: 'for1' }]

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const draggedNode = { id: 'target-node', position: { x: 0, y: 60 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDrag({} as React.MouseEvent, draggedNode)
      })
      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(mockAddStoreEdge).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'for1', sourceHandle: 'body' })
      )
    })

    it('does not auto-connect when proximity source equals dragged node', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('same-node')
      })

      const draggedNode = { id: 'same-node', position: { x: 0, y: 0 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(mockAddStoreEdge).not.toHaveBeenCalled()
    })

    it('does not auto-connect when validation fails', () => {
      mockValidate.mockReturnValue({ valid: false, reason: 'cycle' })

      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('source-node')
      })

      const draggedNode = { id: 'target-node', position: { x: 0, y: 0 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(mockAddStoreEdge).not.toHaveBeenCalled()
    })

    it('does not auto-connect when no proximity source is active', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      const draggedNode = { id: 'target-node', position: { x: 0, y: 0 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(mockAddStoreEdge).not.toHaveBeenCalled()
    })

    it('clears proximity state after drag stop', () => {
      const { result } = renderHook(() => useCanvasDrop({ isExecuting: false }))

      act(() => {
        result.current.setProximitySourceId('source-node')
        result.current.setProximityTargetPos({ x: 100, y: 200 })
      })

      const draggedNode = { id: 'target-node', position: { x: 0, y: 0 }, data: {} } as unknown as Node

      act(() => {
        result.current.handleNodeDragStop({} as React.MouseEvent, draggedNode)
      })

      expect(result.current.proximitySourceId).toBeNull()
      expect(result.current.proximityTargetPos).toBeNull()
    })
  })
})
