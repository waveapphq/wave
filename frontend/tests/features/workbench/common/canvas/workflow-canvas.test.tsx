/**
 * WorkflowCanvas Tests - REQ-3.1.1.1, REQ-3.1.1.2
 *
 * Tests WAVE-specific integration with React Flow:
 * - Drop data parsing (application/wave-block format)
 * - Node creation with correct data structure
 * - Viewport coordinate conversion (WAVE's math)
 * - Store integration (correct methods called)
 *
 * NOT tested here (React Flow internals):
 * - Pan/zoom gestures (React Flow)
 * - Node dragging (React Flow)
 * - Grid background rendering (React Flow)
 * - Edge rendering (React Flow)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock @xyflow/react
const mockScreenToFlowPosition = vi.fn((pos: { x: number; y: number }) => pos)
const mockFitView = vi.fn()

// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, onNodesChange, onEdgesChange, onConnect, onViewportChange, onPaneClick, onPaneContextMenu, onEdgeContextMenu, onEdgeClick, onNodeDragStart, onNodeDragStop, onNodeDoubleClick, nodeDragThreshold, style }: {
    children?: ReactNode
    nodes?: Array<{ id: string }>
    edges?: unknown[]
    nodeTypes?: Record<string, unknown>
    onNodesChange?: (changes: unknown[]) => void
    onEdgesChange?: (changes: unknown[]) => void
    onConnect?: (connection: unknown) => void
    onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
    onPaneClick?: (event: React.MouseEvent) => void
    onPaneContextMenu?: (event: MouseEvent | React.MouseEvent) => void
    onEdgeContextMenu?: (event: React.MouseEvent, edge: { id: string }) => void
    onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    onNodeDragStart?: (event: React.MouseEvent, node: { id: string }) => void
    onNodeDragStop?: (event: React.MouseEvent, node: { id: string }) => void
    onNodeDoubleClick?: (event: React.MouseEvent, node: { id: string; type?: string }) => void
    defaultViewport?: { x: number; y: number; zoom: number }
    fitView?: boolean
    proOptions?: { hideAttribution: boolean }
    style?: React.CSSProperties
    connectionLineStyle?: React.CSSProperties
    defaultEdgeOptions?: unknown
    selectNodesOnDrag?: boolean
    nodeDragThreshold?: number
  }) => {
    // Store callbacks for test access
    (globalThis as Record<string, unknown>).__reactFlowCallbacks = {
      onNodesChange,
      onEdgesChange,
      onConnect,
      onViewportChange,
      onPaneClick,
      onPaneContextMenu,
      onEdgeContextMenu,
      onEdgeClick,
      onNodeDragStart,
      onNodeDragStop,
      onNodeDoubleClick,
    }
    // Store nodes for test access (to call onboarding callbacks)
    ;(globalThis as Record<string, unknown>).__reactFlowNodes = nodes
    ;(globalThis as Record<string, unknown>).__reactFlowNodeDragThreshold = nodeDragThreshold
    return <div data-testid="react-flow-mock" style={style}>{children}</div>
  },
  ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="background-mock" />,
  Controls: () => <div data-testid="controls-mock" />,
  BackgroundVariant: { Dots: 'dots', Lines: 'lines', Cross: 'cross' },
  SelectionMode: { Partial: 'partial', Full: 'full' },
  useReactFlow: () => ({
    screenToFlowPosition: mockScreenToFlowPosition,
    flowToScreenPosition: (pos: { x: number; y: number }) => pos,
    fitView: mockFitView,
  }),
  useStoreApi: () => ({
    getState: () => ({ nodeLookup: new Map() }),
  }),
  useInternalNode: (id: string) => id ? ({
    id,
    measured: { width: 120, height: 50 },
    internals: {
      positionAbsolute: { x: 0, y: 0 },
      handleBounds: {
        source: [{ x: 52, y: 46, width: 16, height: 8 }],
        target: [{ x: 52, y: -4, width: 16, height: 8 }],
      },
    },
  }) : null,
  applyNodeChanges: vi.fn((_changes: unknown[], nodes: unknown[]) => nodes),
  applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
  useUpdateNodeInternals: () => vi.fn(),
  NodeResizer: () => null,
}))

// Mock workflow store
const mockWorkflowStore = {
  nodes: [] as Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  viewport: { x: 0, y: 0, zoom: 1 },
  addNode: vi.fn(),
  addEdge: vi.fn(),
  removeEdge: vi.fn(),
  relocateEdge: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  setViewport: vi.fn(),
  fitView: vi.fn(),
  fitViewRequested: false,
  fitViewOptions: null as { padding?: number } | null,
  acknowledgeFitView: vi.fn(),
  clearSelection: vi.fn(),
  selectedNodeIds: [] as string[],
  selectedEdgeIds: [] as string[],
  setSelectedNodes: vi.fn(),
  setSelectedEdges: vi.fn(),
  deleteSelected: vi.fn(),
  disconnectSelected: vi.fn(),
  openConfigNodeIds: [] as string[],
  dirtyConfigNodeIds: [] as string[],
  pendingDeleteNodeIds: null as string[] | null,
  pendingDrillAction: null as { run: () => void } | null,
  setConfigSheetDirty: vi.fn(),
  requestDeleteSelected: vi.fn(),
  confirmPendingDelete: vi.fn(),
  cancelPendingDelete: vi.fn(),
  // Pass-through by default (clean-sheet semantics); tests override per case.
  requestDrill: vi.fn((run: () => void) => run()),
  pushSharedDrill: vi.fn(),
  setDigInPending: vi.fn(),
  clearDigInPending: vi.fn(),
  digInPendingNodeId: null as string | null,
  confirmPendingDrill: vi.fn(),
  cancelPendingDrill: vi.fn(),
  pendingSecretPromotion: null as { names: string[]; save: () => void } | null,
  confirmSecretPromotion: vi.fn(),
  cancelSecretPromotion: vi.fn(),
  openConfigModal: vi.fn(),
  closeConfigModal: vi.fn(),
  updateNode: vi.fn(),
  // Context menu / disable / skip support
  paste: vi.fn(),
  selectAll: vi.fn(),
  requestFitView: vi.fn(),
  requestFocus: vi.fn(),
  unskipAll: vi.fn(),
  enableAll: vi.fn(),
  clearBreakpoints: vi.fn(),
  setDebugOptions: vi.fn(),
  breakpoints: new Set<string>(),
  debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
  clipboard: null as { nodes: unknown[]; edges: unknown[] } | null,
  skippedNodeIds: [] as string[],
  selectNode: vi.fn(),
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string }>,
  namespaceVariables: { system: [] as Array<{ name: string; type: string }>, suite: [] as Array<{ name: string; type: string }>, regression: [] as Array<{ name: string; type: string }> },
  addVariable: vi.fn(),
  clearPulseValidationNodeId: vi.fn(),
  // Synchronous transaction stub: callers wrap mutations in a transaction;
  // running the callback inline lets the mutation mocks observe each call.
  transaction: vi.fn((cb: () => void) => cb()),
  startDragOperation: vi.fn(),
  endDragOperation: vi.fn(),
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  clearDrill: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const hook = (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore
  hook.getState = () => mockWorkflowStore
  hook.setState = vi.fn()
  hook.subscribe = vi.fn(() => () => {})
  const storeApi = {
    getState: () => mockWorkflowStore,
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }
  return {
    useWorkflowStore: hook,
    useWorkflowStoreInstance: () => storeApi,
    MAX_OPEN_CONFIG_SHEETS: 10,
  }
})

// Quick-add fetches the published-Function list on open; never resolve by
// default so no state update fires outside act.
vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: vi.fn(() => new Promise(() => {})),
  getFunction: vi.fn(async () => ({
    definition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
  })),
  getFunctionVersion: vi.fn(async () => ({
    definition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] },
  })),
}))

vi.mock('@/design-system/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light' }),
}))

// Mock palette usage store (trackUsage is called on drop and quick-add)
vi.mock('@/features/workbench/stores/palette-usage-store', () => {
  const usageState = { trackUsage: vi.fn() }
  const hook = (selector?: (state: typeof usageState) => unknown) =>
    selector ? selector(usageState) : usageState
  hook.getState = () => usageState
  return { usePaletteUsageStore: hook }
})

// V-CANVAS-04: Mock execution store for execution state visualization
const mockExecutionStore = {
  activeExecutionId: null as string | null,
  executions: {} as Record<string, { id: string; testId: string; blocks: Record<string, { status: string }> }>,
}

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useExecutionStore: (selector?: (state: typeof mockExecutionStore) => unknown) =>
    selector ? selector({
      ...mockExecutionStore,
      activeExecutionId: mockExecutionStore.activeExecutionId,
      executions: mockExecutionStore.executions,
    }) : mockExecutionStore,
}))

// Stub the version read of a Shared Function Block window; a non-empty list keeps it out of the missing-function state.
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (functionId: string) => ({
    versions: functionId
      ? [{ version: '1.0.0', published_at: '2026-01-01', changelog: '', details: '', description: '', tags: [] }]
      : [],
    latest: functionId ? '1.0.0' : '',
    isLoading: false,
    failed: false,
    retry: () => {},
  }),
}))

// Helper to create drop events with WAVE's data format
function createWaveDropEvent(blockData: Record<string, unknown>, position: { x: number; y: number }) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.assign(event, {
    dataTransfer: {
      getData: (key: string) =>
        key === 'application/wave-block' ? JSON.stringify(blockData) : '',
      types: ['application/wave-block'],
    },
    clientX: position.x,
    clientY: position.y,
    preventDefault: vi.fn(),
  })
  return event
}


/** A config-save test changes the sheet first: nothing changed anywhere keeps Save disabled. */
function changeConfigDescription() {
  fireEvent.change(screen.getByTestId('element-description-input'), { target: { value: 'changed' } })
}

describe('WorkflowCanvas - Drop Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.viewport = { x: 0, y: 0, zoom: 1 }
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.clipboard = null
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.selectedNodeIds = []
    // Configure screenToFlowPosition to apply viewport transformation
    mockScreenToFlowPosition.mockImplementation((pos: { x: number; y: number }) => ({
      x: (pos.x - mockWorkflowStore.viewport.x) / mockWorkflowStore.viewport.zoom,
      y: (pos.y - mockWorkflowStore.viewport.y) / mockWorkflowStore.viewport.zoom,
    }))
  })

  describe('Palette Block Drop (application/wave-block)', () => {
    it('parses application/wave-block data and calls addNode', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      const dropEvent = createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin', category: 'Core' },
        { x: 200, y: 200 }
      )

      fireEvent(canvas, dropEvent)

      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflowNode',
          data: expect.objectContaining({
            // Universal naming rule: the FIRST drop of a base name uses the
            // bare base (no _N suffix); subsequent drops bump to _1, _2, ...
            label: 'Shell Script',
            elementType: 'shell-script',
            nodeType: 'plugin',
          }),
        })
      )
    })

    it('creates node with unique ID', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')

      // Drop first block
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 100, y: 100 }
      ))

      // Drop second block
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 200, y: 200 }
      ))

      const calls = mockWorkflowStore.addNode.mock.calls
      expect(calls[0][0].id).not.toBe(calls[1][0].id)
    })

    it('ignores non-wave-block data types', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(event, {
        dataTransfer: {
          getData: () => 'some text',
          types: ['text/plain'],
        },
        clientX: 200,
        clientY: 200,
        preventDefault: vi.fn(),
      })

      fireEvent(canvas, event)

      expect(mockWorkflowStore.addNode).not.toHaveBeenCalled()
    })

    it('ignores malformed JSON in wave-block data', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(event, {
        dataTransfer: {
          getData: (key: string) =>
            key === 'application/wave-block' ? '{invalid json' : '',
          types: ['application/wave-block'],
        },
        clientX: 200,
        clientY: 200,
        preventDefault: vi.fn(),
      })

      fireEvent(canvas, event)

      expect(mockWorkflowStore.addNode).not.toHaveBeenCalled()
    })
  })

  describe('Drop Position Calculation', () => {
    it('uses client coordinates directly at zoom=1, pan=(0,0)', async () => {
      mockWorkflowStore.viewport = { x: 0, y: 0, zoom: 1 }

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 300, y: 400 }
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          position: { x: 300, y: 400 },
        })
      )
    })

    it('adjusts position for pan offset', async () => {
      mockWorkflowStore.viewport = { x: 100, y: 50, zoom: 1 }

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 300, y: 400 }
      ))

      // Position = (clientX - panX, clientY - panY)
      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          position: { x: 200, y: 350 },
        })
      )
    })

    it('adjusts position for zoom level', async () => {
      mockWorkflowStore.viewport = { x: 0, y: 0, zoom: 2 }

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 400, y: 200 }
      ))

      // Position = clientX / zoom, clientY / zoom
      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          position: { x: 200, y: 100 },
        })
      )
    })

    it('adjusts position for both pan and zoom', async () => {
      mockWorkflowStore.viewport = { x: 100, y: 100, zoom: 2 }

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 400, y: 400 }
      ))

      // Position = (clientX - panX) / zoom = (400 - 100) / 2 = 150
      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          position: { x: 150, y: 150 },
        })
      )
    })
  })

  describe('Auto-Connect on Drop', () => {
    it('auto-connects when dropping near Start node with free output', async () => {
      // Start node is at (-50, 0) with no outgoing edges
      mockWorkflowStore.nodes = []
      mockWorkflowStore.edges = []

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      // Drop close to Start node's output (below it, within 100px threshold)
      // Start node center ~x=10 (at -50 + 60), output at y=50
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 10, y: 80 }  // Close enough to trigger auto-connect
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalled()
      expect(mockWorkflowStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'start-node',
        })
      )
    })

    it('auto-connects when dropping near user node with free output', async () => {
      // User node at (100, 100) with no outgoing edge
      mockWorkflowStore.nodes = [
        { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1' } },
      ]
      mockWorkflowStore.edges = [
        // Start node has connection, so node-1 is the only free output
        { id: 'edge-start', source: 'start-node', target: 'node-1' },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      // Drop close to node-1's output (node center ~x=160, output at y=150)
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 160, y: 160 }  // Close enough to trigger auto-connect
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalled()
      expect(mockWorkflowStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'node-1',
        })
      )
    })

    it('does not auto-connect when dropping far from any free output', async () => {
      mockWorkflowStore.nodes = []
      mockWorkflowStore.edges = []

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      // Drop far away from Start node
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 500, y: 500 }  // Too far for auto-connect
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalled()
      expect(mockWorkflowStore.addEdge).not.toHaveBeenCalled()
    })

    it('auto-connects to closest node when multiple free outputs exist', async () => {
      // Two nodes with free outputs at different distances
      mockWorkflowStore.nodes = [
        { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1' } },
        { id: 'node-2', position: { x: 200, y: 100 }, data: { label: 'Block 2' } },
      ]
      mockWorkflowStore.edges = [
        // Start node has connection, both user nodes have free outputs
        { id: 'edge-start', source: 'start-node', target: 'node-1' },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      // Drop closer to node-2 (at x=200) than node-1 (at x=100)
      fireEvent(canvas, createWaveDropEvent(
        { id: 'shell-script', name: 'Shell Script', type: 'plugin' },
        { x: 250, y: 160 }  // Closer to node-2
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalled()
      expect(mockWorkflowStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'node-2',  // Should connect to closer node
        })
      )
    })
  })

  describe('Drag Over Handling', () => {
    it('allows drop by preventing default and setting dropEffect', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      const preventDefault = vi.fn()
      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      Object.assign(dragOverEvent, {
        preventDefault,
        dataTransfer: { dropEffect: '', types: [] },
      })

      fireEvent(canvas, dragOverEvent)

      expect(preventDefault).toHaveBeenCalled()
      expect((dragOverEvent as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('move')
    })
  })

  describe('Node Data Structure', () => {
    it('maps "type: plugin" to "nodeType: plugin"', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'http-client', name: 'HTTP Client', type: 'plugin' },
        { x: 100, y: 100 }
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nodeType: 'plugin',
          }),
        })
      )
    })

    it('maps "type: control" to "nodeType: control"', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'if-else', name: 'If / Else', type: 'control' },
        { x: 100, y: 100 }
      ))

      expect(mockWorkflowStore.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nodeType: 'control',
          }),
        })
      )
    })

    it('does not stamp the palette category onto the dropped block', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const canvas = screen.getByTestId('workflow-canvas')
      fireEvent(canvas, createWaveDropEvent(
        { id: 'sql', name: 'SQL Query', type: 'plugin', category: 'Data' },
        { x: 100, y: 100 }
      ))

      const [node] = mockWorkflowStore.addNode.mock.calls[0]
      expect(node.data).toMatchObject({ elementType: 'sql', nodeType: 'plugin' })
      expect(node.data).not.toHaveProperty('category')
    })
  })
})

describe('WorkflowCanvas - React Flow Callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1' } },
      { id: 'node-2', position: { x: 100, y: 200 }, data: { label: 'Block 2' } },
    ]
    mockWorkflowStore.edges = []
    mockWorkflowStore.setNodes = vi.fn()
    mockWorkflowStore.setEdges = vi.fn()
  })

  describe('onNodesChange', () => {
    it('applies node position changes to user nodes', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodesChange: (changes: unknown[]) => void
      }

      // Simulate a position change on node-1
      callbacks.onNodesChange([
        { id: 'node-1', type: 'position', position: { x: 150, y: 150 } },
      ])

      expect(mockWorkflowStore.setNodes).toHaveBeenCalled()
    })

    it('filters out changes to start node', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodesChange: (changes: unknown[]) => void
      }

      // Simulate a change on start-node (should be filtered)
      callbacks.onNodesChange([
        { id: 'start-node', type: 'position', position: { x: 50, y: 50 } },
      ])

      // setNodes should not be called for start-node only changes
      expect(mockWorkflowStore.setNodes).not.toHaveBeenCalled()
    })

    it('filters out changes to onboarding node', async () => {
      mockWorkflowStore.nodes = [] // Empty canvas shows onboarding node

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodesChange: (changes: unknown[]) => void
      }

      // Simulate a change on onboarding node (should be filtered)
      callbacks.onNodesChange([
        { id: 'onboarding-placeholder', type: 'select', selected: true },
      ])

      expect(mockWorkflowStore.setNodes).not.toHaveBeenCalled()
    })

    it('handles changes without id property', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodesChange: (changes: unknown[]) => void
      }

      // Simulate a change without id (e.g., reset)
      callbacks.onNodesChange([
        { type: 'reset' },
      ])

      expect(mockWorkflowStore.setNodes).toHaveBeenCalled()
    })
  })

  describe('onEdgesChange', () => {
    it('applies edge changes to user edges', async () => {
      mockWorkflowStore.edges = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onEdgesChange: (changes: unknown[]) => void
      }

      // Simulate edge removal
      callbacks.onEdgesChange([
        { id: 'edge-1', type: 'remove' },
      ])

      expect(mockWorkflowStore.setEdges).toHaveBeenCalled()
    })

    it('filters out changes to ghost edge', async () => {
      mockWorkflowStore.nodes = [] // Empty canvas has ghost edge

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onEdgesChange: (changes: unknown[]) => void
      }

      // Simulate a change on ghost edge (should be filtered)
      callbacks.onEdgesChange([
        { id: 'ghost-edge', type: 'select', selected: true },
      ])

      expect(mockWorkflowStore.setEdges).not.toHaveBeenCalled()
    })

    it('handles changes without id property', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onEdgesChange: (changes: unknown[]) => void
      }

      // Simulate a change without id
      callbacks.onEdgesChange([
        { type: 'reset' },
      ])

      expect(mockWorkflowStore.setEdges).toHaveBeenCalled()
    })
  })

  describe('Node drag lifecycle (history bracketing)', () => {
    // The post-state baseline model relies on startDragOperation +
    // endDragOperation bracketing the position deltas so the drag is one
    // history entry. The canvas wires onNodeDragStart -> startDragOperation
    // and composes onNodeDragStop = handleNodeDragStop (proximity auto-
    // connect) followed by endDragOperation.
    it('onNodeDragStart calls startDragOperation', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodeDragStart: (event: React.MouseEvent, node: { id: string }) => void
      }

      callbacks.onNodeDragStart(
        {} as unknown as React.MouseEvent,
        { id: 'node-1' },
      )

      expect(mockWorkflowStore.startDragOperation).toHaveBeenCalledTimes(1)
    })

    it('onNodeDragStop calls endDragOperation after proximity handler runs', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodeDragStop: (event: React.MouseEvent, node: { id: string }) => void
      }

      callbacks.onNodeDragStop(
        {} as unknown as React.MouseEvent,
        { id: 'node-1' },
      )

      expect(mockWorkflowStore.endDragOperation).toHaveBeenCalledTimes(1)
    })
  })

  describe('onConnect', () => {
    it('creates edge for valid new connection', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void
      }

      callbacks.onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(mockWorkflowStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'node-1',
          target: 'node-2',
        })
      )
    })

    it('rejects self-loop connection', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string; target: string }) => void
      }

      callbacks.onConnect({
        source: 'node-1',
        target: 'node-1',
      })

      expect(mockWorkflowStore.addEdge).not.toHaveBeenCalled()
    })

    it('rejects duplicate connection', async () => {
      mockWorkflowStore.edges = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string; target: string }) => void
      }

      callbacks.onConnect({
        source: 'node-1',
        target: 'node-2',
      })

      expect(mockWorkflowStore.addEdge).not.toHaveBeenCalled()
    })

    it('ignores connection with missing source', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string | null; target: string | null }) => void
      }

      callbacks.onConnect({
        source: null,
        target: 'node-2',
      })

      expect(mockWorkflowStore.addEdge).not.toHaveBeenCalled()
    })

    it('ignores connection with missing target', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string | null; target: string | null }) => void
      }

      callbacks.onConnect({
        source: 'node-1',
        target: null,
      })

      expect(mockWorkflowStore.addEdge).not.toHaveBeenCalled()
    })

    it('handles null sourceHandle and targetHandle', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onConnect: (connection: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void
      }

      callbacks.onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      })

      expect(mockWorkflowStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'node-1',
          target: 'node-2',
          sourceHandle: undefined,
          targetHandle: undefined,
        })
      )
    })
  })

  describe('onViewportChange', () => {
    it('updates viewport in store', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void
      }

      callbacks.onViewportChange({ x: 100, y: 50, zoom: 1.5 })

      expect(mockWorkflowStore.setViewport).toHaveBeenCalledWith({ x: 100, y: 50, zoom: 1.5 })
    })
  })
})

describe('WorkflowCanvas - Canvas States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows start node connected state when there are user nodes', async () => {
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1' } },
    ]
    mockWorkflowStore.edges = []

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    // Canvas renders without throwing
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
  })

  it('shows start node connected state when start has outgoing edge', async () => {
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1' } },
    ]
    mockWorkflowStore.edges = [
      { id: 'edge-1', source: 'start-node', target: 'node-1' },
    ]

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
  })

  it('creates an onboarding node on an empty canvas', async () => {
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const nodes = (globalThis as Record<string, unknown>).__reactFlowNodes as Array<{
      id: string
    }>

    const onboardingNode = nodes?.find((n) => n.id === 'onboarding-placeholder')
    expect(onboardingNode).toBeDefined()
  })
})

describe('WorkflowCanvas - Theme Variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
  })

  it('applies dark theme colors when theme is dark', async () => {
    // Override theme mock for this test
    vi.doMock('@/design-system/theme-provider', () => ({
      useTheme: () => ({ theme: 'dark', resolvedTheme: 'dark' }),
    }))

    // Re-import to get fresh module with dark theme
    vi.resetModules()
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
  })

  it('falls back to light theme when useTheme throws', async () => {
    // Override theme mock to throw
    vi.doMock('@/design-system/theme-provider', () => ({
      useTheme: () => {
        throw new Error('No ThemeProvider')
      },
    }))

    // Re-import to get fresh module with throwing theme hook
    vi.resetModules()
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    // Should render without crashing, using light theme fallback
    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()
  })

  it('applies className when provided', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas className="custom-class" />)

    expect(screen.getByTestId('workflow-canvas')).toHaveClass('custom-class')
  })
})

describe('useConnectionValidator - WAVE Business Logic', () => {
  describe('Self-Loop Detection', () => {
    it('rejects connection where source === target', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      const { result } = renderHook(() => useConnectionValidator({ edges: [] }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-1',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('self-loop')
    })
  })

  describe('Duplicate Detection', () => {
    it('rejects connection that already exists', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('duplicate')
    })

    it('rejects connection in reverse direction as cycle', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // B→A when A→B exists creates cycle A→B→A
      const validation = result.current.validate({
        source: 'node-2',
        target: 'node-1',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('cycle')
    })

    it('handles diamond graph without false cycle detection', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // Diamond: A→B, A→C, B→D, C→D - BFS from target reaches D through two paths
      const diamondEdges = [
        { id: 'e1', source: 'A', target: 'B' },
        { id: 'e2', source: 'A', target: 'C' },
        { id: 'e3', source: 'B', target: 'D' },
        { id: 'e4', source: 'C', target: 'D' },
      ]
      const { result } = renderHook(() => useConnectionValidator({ edges: diamondEdges }))

      // E→A: BFS from A reaches D twice (via B and C), triggering visited dedup
      const validation = result.current.validate({
        source: 'E',
        target: 'A',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(validation.valid).toBe(true)
    })
  })

  describe('Valid Connections', () => {
    it('allows new connection between different nodes', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      const { result } = renderHook(() => useConnectionValidator({ edges: [] }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(validation.valid).toBe(true)
    })
  })

  // ==========================================================================
  // Single Ingress/Egress Enforcement (REQ-3.1.1.2)
  // ==========================================================================
  describe('Per-Handle Ingress Enforcement (branch convergence)', () => {
    it('allows connection to occupied default handle (replacement semantics)', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-2 already has incoming edge on default handle
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // node-3 connects to node-2 on default handle (replacement handled by onConnect)
      const validation = result.current.validate({
        source: 'node-3',
        target: 'node-2',
      })

      expect(validation.valid).toBe(true)
    })

    it('allows connection when target has no incoming edge', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-2 has outgoing edge but no incoming
      const existingEdges = [{ id: 'e1', source: 'node-2', target: 'node-3' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-2',
      })

      expect(validation.valid).toBe(true)
    })

    it('allows convergence via different named target handles', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-3 has incoming on ingress_0
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-3', targetHandle: 'ingress_0' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // node-2 connects to node-3 on ingress_1 (different handle - valid convergence)
      const validation = result.current.validate({
        source: 'node-2',
        target: 'node-3',
        targetHandle: 'ingress_1',
      })

      expect(validation.valid).toBe(true)
    })

    it('allows connection to occupied named target handle (replacement semantics)', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-3 has incoming on ingress_0
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-3', targetHandle: 'ingress_0' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // node-2 connects to node-3 on same ingress_0 (replacement handled by onConnect)
      const validation = result.current.validate({
        source: 'node-2',
        target: 'node-3',
        targetHandle: 'ingress_0',
      })

      expect(validation.valid).toBe(true)
    })
  })

  describe('Single Egress Enforcement', () => {
    it('rejects connection when source already has outgoing edge', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 already has outgoing edge to node-2
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // Try to connect node-1 → node-3 (node-1 already has egress)
      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-3',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('has-egress')
    })

    it('allows connection when source has no outgoing edge', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 has incoming edge but no outgoing
      const existingEdges = [{ id: 'e1', source: 'node-2', target: 'node-1' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-3',
      })

      expect(validation.valid).toBe(true)
    })

    it('rejects to different target from same source with existing egress', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 has outgoing to node-2
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // node-1 trying to connect to node-4 - but node-1 already has egress to node-2
      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-4',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('has-egress')
    })
  })

  describe('Validation Priority', () => {
    it('checks self-loop before egress check', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-2 already has egress AND we try a self-loop
      const existingEdges = [{ id: 'e1', source: 'node-2', target: 'node-3' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      const validation = result.current.validate({
        source: 'node-2',
        target: 'node-2', // Self-loop AND node-2 has egress
      })

      // Self-loop should take priority
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('self-loop')
    })

    it('checks duplicate before egress check', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // Exact duplicate of existing edge
      const existingEdges = [{ id: 'e1', source: 'node-1', target: 'node-2' }]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-2', // Duplicate AND node-1 has egress
      })

      // Duplicate should take priority over has-egress
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('duplicate')
    })
  })

  // ==========================================================================
  // Branching Egress Support (per-handle egress for if-else/assert split)
  // ==========================================================================
  describe('Branching Egress (per-handle)', () => {
    it('allows multiple edges from same source with different sourceHandles', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 has an edge from handle branch_0 to node-2
      const existingEdges = [
        { id: 'e1', source: 'node-1', target: 'node-2', sourceHandle: 'branch_0' },
      ]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // Connect node-1 (branch_1) to node-3 - different handle, should be valid
      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-3',
        sourceHandle: 'branch_1',
      })

      expect(validation.valid).toBe(true)
    })

    it('rejects second edge from same sourceHandle', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 has an edge from handle branch_0 to node-2
      const existingEdges = [
        { id: 'e1', source: 'node-1', target: 'node-2', sourceHandle: 'branch_0' },
      ]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // Try to connect node-1 (branch_0) to node-3 - same handle, should be rejected
      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-3',
        sourceHandle: 'branch_0',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('has-egress')
    })

    it('non-branching source still enforces whole-node egress check', async () => {
      const { useConnectionValidator } = await import('@/features/workbench/hooks/use-connection-validator')
      const { renderHook } = await import('@testing-library/react')

      // node-1 has an outgoing edge (no sourceHandle)
      const existingEdges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
      ]
      const { result } = renderHook(() => useConnectionValidator({ edges: existingEdges }))

      // Try to connect node-1 to node-3 (no sourceHandle) - should be rejected
      const validation = result.current.validate({
        source: 'node-1',
        target: 'node-3',
      })

      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('has-egress')
    })
  })
})

describe('WorkflowCanvas - Selection Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
  })

  describe('Pane Click Selection', () => {
    it('clears selection on left-click (button 0)', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      // Get the stored onPaneClick callback from the mock
      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onPaneClick?: (event: React.MouseEvent) => void
      }

      // Invoke onPaneClick with left-click (button 0)
      await act(async () => {
        callbacks.onPaneClick?.({ button: 0 } as React.MouseEvent)
      })

      // clearSelection should have been called
      expect(mockWorkflowStore.clearSelection).toHaveBeenCalled()
    })

    it('does not clear selection on right-click (button 2)', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      // Get the stored onPaneClick callback from the mock
      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onPaneClick?: (event: React.MouseEvent) => void
      }

      // Clear mock before test
      mockWorkflowStore.clearSelection.mockClear()

      // Invoke onPaneClick with right-click (button 2)
      await act(async () => {
        callbacks.onPaneClick?.({ button: 2 } as React.MouseEvent)
      })

      // clearSelection should NOT have been called
      expect(mockWorkflowStore.clearSelection).not.toHaveBeenCalled()
    })

    it('does not clear selection on Shift+left-click (no-op for chain select)', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onPaneClick?: (event: React.MouseEvent) => void
      }

      mockWorkflowStore.clearSelection.mockClear()

      // Invoke onPaneClick with Shift+left-click
      await act(async () => {
        callbacks.onPaneClick?.({ button: 0, shiftKey: true } as React.MouseEvent)
      })

      // clearSelection should NOT be called (Shift+click on pane is no-op)
      expect(mockWorkflowStore.clearSelection).not.toHaveBeenCalled()
    })
  })

  describe('Chain Select via native pointerup', () => {
    it('calls chainSelect on Shift+pointerup over a node element', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      const { container } = render(<WorkflowCanvas />)

      // Create a fake node element with data-id inside the wrapper
      const wrapper = container.querySelector('[data-testid="workflow-canvas"]')!
      const fakeNode = document.createElement('div')
      fakeNode.setAttribute('data-id', 'test-node-1')
      wrapper.appendChild(fakeNode)

      mockWorkflowStore.chainSelect.mockClear()
      mockWorkflowStore.setSelectedNodes.mockClear()
      mockWorkflowStore.selectedNodeIds = ['existing-node']

      // Dispatch native pointerup with Shift on the fake node
      const event = new PointerEvent('pointerup', {
        bubbles: true,
        shiftKey: true,
        button: 0,
      })
      fakeNode.dispatchEvent(event)

      // chainSelect is deferred via requestAnimationFrame
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

      // Should restore pre-click selection and call chainSelect
      expect(mockWorkflowStore.setSelectedNodes).toHaveBeenCalledWith(['existing-node'])
      expect(mockWorkflowStore.chainSelect).toHaveBeenCalledWith('test-node-1')

      // Cleanup
      wrapper.removeChild(fakeNode)
    })

    it('does not call chainSelect on pointerup without Shift', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      const { container } = render(<WorkflowCanvas />)

      const wrapper = container.querySelector('[data-testid="workflow-canvas"]')!
      const fakeNode = document.createElement('div')
      fakeNode.setAttribute('data-id', 'test-node-2')
      wrapper.appendChild(fakeNode)

      mockWorkflowStore.chainSelect.mockClear()

      // Dispatch pointerup WITHOUT Shift
      const event = new PointerEvent('pointerup', {
        bubbles: true,
        shiftKey: false,
        button: 0,
      })
      fakeNode.dispatchEvent(event)

      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

      expect(mockWorkflowStore.chainSelect).not.toHaveBeenCalled()
      wrapper.removeChild(fakeNode)
    })

    it('does not call chainSelect on Shift+pointerup over non-node element', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      const { container } = render(<WorkflowCanvas />)

      const wrapper = container.querySelector('[data-testid="workflow-canvas"]')!
      mockWorkflowStore.chainSelect.mockClear()

      // Dispatch Shift+pointerup on the wrapper itself (no data-id)
      const event = new PointerEvent('pointerup', {
        bubbles: true,
        shiftKey: true,
        button: 0,
      })
      wrapper.dispatchEvent(event)

      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

      expect(mockWorkflowStore.chainSelect).not.toHaveBeenCalled()
    })

    it('skips start-node on Shift+pointerup', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      const { container } = render(<WorkflowCanvas />)

      const wrapper = container.querySelector('[data-testid="workflow-canvas"]')!
      const fakeNode = document.createElement('div')
      fakeNode.setAttribute('data-id', 'start-node')
      wrapper.appendChild(fakeNode)

      mockWorkflowStore.chainSelect.mockClear()

      const event = new PointerEvent('pointerup', {
        bubbles: true,
        shiftKey: true,
        button: 0,
      })
      fakeNode.dispatchEvent(event)

      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

      expect(mockWorkflowStore.chainSelect).not.toHaveBeenCalled()
      wrapper.removeChild(fakeNode)
    })
  })

  describe('Pane Context Menu', () => {
    it('stores flow position on pane right-click', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onPaneContextMenu?: (event: MouseEvent | React.MouseEvent) => void
      }

      const preventDefault = vi.fn()

      await act(async () => {
        callbacks.onPaneContextMenu?.({
          preventDefault,
          clientX: 400,
          clientY: 500,
        } as unknown as MouseEvent)
      })

      expect(preventDefault).toHaveBeenCalled()
      expect(mockScreenToFlowPosition).toHaveBeenCalledWith({ x: 400, y: 500 })
    })
  })

  describe('Edge Context Menu', () => {
    it('stores edge ID on edge right-click', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onEdgeContextMenu?: (event: React.MouseEvent, edge: { id: string }) => void
      }

      const preventDefault = vi.fn()

      await act(async () => {
        callbacks.onEdgeContextMenu?.(
          { preventDefault, clientX: 200, clientY: 300 } as unknown as React.MouseEvent,
          { id: 'edge-1' }
        )
      })

      expect(preventDefault).toHaveBeenCalled()
    })
  })
})

describe('WorkflowCanvas - Config Modal Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = [
      {
        id: 'node-1',
        position: { x: 100, y: 100 },
        data: {
          label: 'HTTP Client',
          elementType: 'http-client',
          version: '1.0',
          displayName: '',
          config: { values: {}, outputBindings: {} },
        },
      },
    ]
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = ['node-1']
  })

  describe('Config Modal Node Not Found', () => {
    it('does not render modal when openConfigNodeIds refers to non-existent node', async () => {
      // Set openConfigNodeIds to a node that doesn't exist in nodes
      mockWorkflowStore.openConfigNodeIds = ['non-existent-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should not be rendered
      expect(screen.queryByRole('heading', { name: 'HTTP Client' })).not.toBeInTheDocument()
    })
  })

  describe('Config Modal Fallback Values', () => {
    it('uses fallback values for minimal node data', async () => {
      // Node with minimal data to trigger fallbacks
      mockWorkflowStore.nodes = [
        {
          id: 'minimal-node',
          position: { x: 100, y: 100 },
          data: {
            // No version, no label, no config
            elementType: 'shell-script',
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['minimal-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should render with elementType as name fallback
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('uses Unknown fallback when both label and elementType are missing', async () => {
      // Node with no label and no elementType to trigger || 'Unknown' fallbacks
      mockWorkflowStore.nodes = [
        {
          id: 'unknown-node',
          position: { x: 100, y: 100 },
          data: {
            // Empty data object - no label, no elementType
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['unknown-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should render with 'Unknown' fallback name
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })
  })

  describe('Config Modal Rendering', () => {
    it('renders config modal when openConfigNodeIds is set', async () => {
      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      // The modal should be rendered when openConfigNodeIds is set
      // Wait for the modal to appear
      await act(async () => {
        // Allow React to process the render
        await new Promise((r) => setTimeout(r, 0))
      })

      // The ElementConfigModal should be in the DOM
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('uses controlVersions for controls with metadata (Delay control)', async () => {
      // Use a real control type that has metadata in CONTROL_METADATA
      // This tests the controlVersions.map() branch (line 150)
      mockWorkflowStore.nodes = [
        {
          id: 'delay-node',
          position: { x: 100, y: 100 },
          data: {
            label: 'Delay',
            elementType: 'delay', // This exists in CONTROL_METADATA with versions
            version: '1.0.0',
            displayName: '',
            config: { values: {}, outputBindings: {} },
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['delay-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should render with Delay control
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('matches version prefix (e.g., "1.0" matches "1.0.0")', async () => {
      // Test the version normalization: stored "1.0" matches metadata "1.0.0"
      // This tests line 134's startsWith branch
      mockWorkflowStore.nodes = [
        {
          id: 'delay-prefix-node',
          position: { x: 100, y: 100 },
          data: {
            label: 'Delay',
            elementType: 'delay',
            version: '1.0', // Short version - should match 1.0.0 via startsWith
            displayName: '',
            config: { values: {}, outputBindings: {} },
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['delay-prefix-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('falls back to first version when no version matches', async () => {
      // Test line 136 fallback: when stored version doesn't match any metadata version
      mockWorkflowStore.nodes = [
        {
          id: 'delay-invalid-version-node',
          position: { x: 100, y: 100 },
          data: {
            label: 'Delay',
            elementType: 'delay',
            version: '99.99.99', // Non-existent version
            displayName: '',
            config: { values: {}, outputBindings: {} },
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['delay-invalid-version-node']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should still render (using first available version)
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()
    })

    it('calls updateNode and closeConfigModal when modal saves', async () => {
      // Set up node with pre-filled valid config so form validation passes
      mockWorkflowStore.nodes = [
        {
          id: 'node-1',
          position: { x: 100, y: 100 },
          data: {
            label: 'HTTP Client',
            elementType: 'http-client',
            version: '1.0',
            displayName: '',
            config: {
              values: { url: 'https://test.com', method: 'GET' },
              outputBindings: {},
            },
          },
        },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Click save - form should be valid with pre-filled config
      // Tests the wiring: onSave → updateNode + closeConfigModal
      // Nothing changed anywhere keeps Save disabled.
      changeConfigDescription()
      const saveBtn = screen.getByRole('button', { name: /save/i })
      fireEvent.click(saveBtn)

      expect(mockWorkflowStore.updateNode).toHaveBeenCalled()
      expect(mockWorkflowStore.closeConfigModal).toHaveBeenCalled()
    })

    it('calls clearPulseValidationNodeId for the saved node ID on config save', async () => {
      mockWorkflowStore.nodes = [
        {
          id: 'node-1',
          position: { x: 100, y: 100 },
          data: {
            label: 'HTTP Client',
            elementType: 'http-client',
            version: '1.0',
            displayName: '',
            config: {
              values: { url: 'https://test.com', method: 'GET' },
              outputBindings: {},
            },
          },
        },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Nothing changed anywhere keeps Save disabled.
      changeConfigDescription()
      const saveBtn = screen.getByRole('button', { name: /save/i })
      fireEvent.click(saveBtn)

      expect(mockWorkflowStore.clearPulseValidationNodeId).toHaveBeenCalledWith('node-1')
    })

    it('persists profileBindings to node config on save', async () => {
      // Set up node with profileBindings in config
      const savedBindings = [
        { profileId: 'p1', profileName: 'Time Server', profileType: 'http', alias: 'time_server', fields: [{ name: 'host', type: 'string' }] },
      ]
      mockWorkflowStore.nodes = [
        {
          id: 'node-1',
          position: { x: 100, y: 100 },
          data: {
            label: 'HTTP Client',
            elementType: 'http-client',
            version: '1.0',
            displayName: '',
            config: {
              values: { url: 'https://test.com', method: 'GET' },
              outputBindings: {},
              profileBindings: savedBindings,
            },
          },
        },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Click save - profileBindings should be persisted
      // Nothing changed anywhere keeps Save disabled.
      changeConfigDescription()
      const saveBtn = screen.getByRole('button', { name: /save/i })
      fireEvent.click(saveBtn)

      expect(mockWorkflowStore.updateNode).toHaveBeenCalled()
      const updateCall = mockWorkflowStore.updateNode.mock.calls[0]
      const savedConfig = updateCall[1].data.config
      expect(savedConfig.profileBindings).toEqual(savedBindings)
    })

    it('loads profileBindings from node config into config modal element', async () => {
      // Set up node with saved profileBindings
      const savedBindings = [
        { profileId: 'p2', profileName: 'DB Server', profileType: 'ssh', alias: 'db', fields: [] },
      ]
      mockWorkflowStore.nodes = [
        {
          id: 'node-1',
          position: { x: 100, y: 100 },
          data: {
            label: 'HTTP Client',
            elementType: 'http-client',
            version: '1.0',
            displayName: '',
            config: {
              values: { url: 'https://test.com', method: 'GET' },
              outputBindings: {},
              profileBindings: savedBindings,
            },
          },
        },
      ]

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      // Modal should render - verify it loaded (heading present)
      expect(screen.getByRole('heading', { name: /edit config/i })).toBeInTheDocument()

      // The Profiles button should be present (proves modal received the element with profileBindings)
      expect(screen.getByRole('button', { name: /profiles/i })).toBeInTheDocument()
    })

    it('opens a Local Function Block in the shared Block window with its lifecycle chrome (CANVAS-207)', async () => {
      mockWorkflowStore.nodes = [
        {
          id: 'fn-1',
          position: { x: 100, y: 100 },
          data: {
            label: 'Function_1',
            nodeType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              name: 'Function_1',
              description: '',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: { nodes: [], edges: [] },
            },
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['fn-1']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      const sheet = screen.getByTestId('element-config-sheet')
      expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
      // The Function name field is the window's name slot, in place of the Block name field.
      expect(within(sheet).getByTestId('function-name-input')).toBeInTheDocument()
      expect(screen.queryByTestId('element-name-input')).toBeNull()
      // A Local Function has no versions, so the window shows no version list (CANVAS-208).
      expect(screen.queryByTestId('version-selector')).toBeNull()
      expect(screen.queryByTestId('version-dropdown-trigger')).toBeNull()
    })

    it('opens a Shared Function Block in the shared Block window with its lifecycle chrome (CANVAS-207)', async () => {
      mockWorkflowStore.nodes = [
        {
          id: 'fn-shared',
          position: { x: 100, y: 100 },
          data: {
            label: 'SharedFn',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: 'lib-fn-42',
          },
        },
      ]
      mockWorkflowStore.openConfigNodeIds = ['fn-shared']

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      const sheet = screen.getByTestId('element-config-sheet')
      expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
      expect(within(sheet).getByTestId('function-name-input')).toBeInTheDocument()
      expect(screen.queryByTestId('element-name-input')).toBeNull()
      // The version list is the Function's own, never the plugin version picker (CANVAS-209).
      expect(within(sheet).getByTestId('version-dropdown-trigger')).toBeInTheDocument()
      expect(screen.queryByTestId('version-selector')).toBeNull()
    })
  })

  // ===========================================================================
  // V-CANVAS-04: Execution State Visualization
  // Per-node store subscriptions: executionStatus is NOT injected into node data.
  // Each WorkflowNode subscribes directly via useBlockExecutionStatus.
  // ===========================================================================
  describe('Execution State Visualization (V-CANVAS-04)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockWorkflowStore.nodes = [
        { id: 'node-1', position: { x: 100, y: 100 }, data: { label: 'Block 1', elementType: 'shell-script' } },
        { id: 'node-2', position: { x: 200, y: 200 }, data: { label: 'Block 2', elementType: 'log' } },
      ]
      mockWorkflowStore.edges = []
      mockWorkflowStore.selectedNodeIds = []
      // Reset execution store
      mockExecutionStore.activeExecutionId = null
      mockExecutionStore.executions = {}
    })

    it('does not inject executionStatus into node data (per-node subscriptions handle it)', async () => {
      // Set up active execution with block states
      const executionId = 'exec-123'
      mockExecutionStore.activeExecutionId = executionId
      mockExecutionStore.executions = {
        [executionId]: {
          id: executionId,
          testId: 'test-1',
          blocks: {
            'node-1': { status: 'success' },
            'node-2': { status: 'running' },
          },
        },
      }

      const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
      render(<WorkflowCanvas />)

      // Canvas should render
      expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument()

      // Nodes are passed to ReactFlow WITHOUT executionStatus in data
      // (each WorkflowNode subscribes directly via useBlockExecutionStatus)
      const nodes = (globalThis as Record<string, unknown>).__reactFlowNodes as Array<{ id: string; data: { executionStatus?: string } }>
      const userNodes = nodes.filter(n => n.id !== 'start')

      // No executionStatus in data - nodes subscribe directly to their own block status
      expect(userNodes.find(n => n.id === 'node-1')?.data.executionStatus).toBeUndefined()
      expect(userNodes.find(n => n.id === 'node-2')?.data.executionStatus).toBeUndefined()
    })
  })
})

// =============================================================================
// Edge Click Selection
// =============================================================================
describe('WorkflowCanvas - Edge Click Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
      { id: 'node-2', position: { x: 100, y: 100 }, data: { label: 'Node 2' } },
    ]
    mockWorkflowStore.edges = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.selectedNodeIds = []
    mockScreenToFlowPosition.mockImplementation((pos: { x: number; y: number }) => pos)
  })

  it('calls setSelectedEdges with edge ID on edge click', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    }

    await act(async () => {
      callbacks.onEdgeClick?.(
        { ctrlKey: false, metaKey: false } as React.MouseEvent,
        { id: 'edge-1' }
      )
    })

    expect(mockWorkflowStore.setSelectedEdges).toHaveBeenCalledWith(['edge-1'])
  })

  it('adds edge to selection on Ctrl+click', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-existing']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    }

    await act(async () => {
      callbacks.onEdgeClick?.(
        { ctrlKey: true, metaKey: false } as React.MouseEvent,
        { id: 'edge-1' }
      )
    })

    expect(mockWorkflowStore.setSelectedEdges).toHaveBeenCalledWith(['edge-existing', 'edge-1'])
  })

  it('adds edge to selection on Meta+click (Mac)', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-existing']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    }

    await act(async () => {
      callbacks.onEdgeClick?.(
        { ctrlKey: false, metaKey: true } as React.MouseEvent,
        { id: 'edge-1' }
      )
    })

    expect(mockWorkflowStore.setSelectedEdges).toHaveBeenCalledWith(['edge-existing', 'edge-1'])
  })

  it('deselects nodes when edge is clicked (mutual exclusivity)', async () => {
    mockWorkflowStore.selectedNodeIds = ['node-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    }

    await act(async () => {
      callbacks.onEdgeClick?.(
        { ctrlKey: false, metaKey: false } as React.MouseEvent,
        { id: 'edge-1' }
      )
    })

    expect(mockWorkflowStore.setSelectedNodes).toHaveBeenCalledWith([])
  })

  it('replaces edge selection on single click (no modifier)', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-existing']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onEdgeClick?: (event: React.MouseEvent, edge: { id: string }) => void
    }

    await act(async () => {
      callbacks.onEdgeClick?.(
        { ctrlKey: false, metaKey: false } as React.MouseEvent,
        { id: 'edge-1' }
      )
    })

    // Without modifier, selection replaces (not appends)
    expect(mockWorkflowStore.setSelectedEdges).toHaveBeenCalledWith(['edge-1'])
  })
})

// =============================================================================
// Keyboard Deletion
// =============================================================================
describe('WorkflowCanvas - Keyboard Deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
    ]
    mockWorkflowStore.edges = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.selectedNodeIds = []
    mockScreenToFlowPosition.mockImplementation((pos: { x: number; y: number }) => pos)
  })

  // Delete routes through requestDeleteSelected so a dirty config
  // sheet can intercept with a confirmation before the store delete runs.
  it('calls requestDeleteSelected on Delete key press when edges are selected', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Delete' })

    expect(mockWorkflowStore.requestDeleteSelected).toHaveBeenCalledTimes(1)
  })

  it('calls requestDeleteSelected on Delete key press when nodes are selected', async () => {
    mockWorkflowStore.selectedNodeIds = ['node-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Delete' })

    expect(mockWorkflowStore.requestDeleteSelected).toHaveBeenCalledTimes(1)
  })

  it('calls disconnectSelected on Backspace key press when nodes are selected', async () => {
    mockWorkflowStore.selectedNodeIds = ['node-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Backspace' })

    expect(mockWorkflowStore.disconnectSelected).toHaveBeenCalledTimes(1)
  })

  it('calls disconnectSelected on Backspace key press when edges are selected', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Backspace' })

    expect(mockWorkflowStore.disconnectSelected).toHaveBeenCalledTimes(1)
  })

  it('does not fire when there is no selection', async () => {
    // Both selections empty
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Delete' })
    fireEvent.keyDown(canvas, { key: 'Backspace' })

    expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
    expect(mockWorkflowStore.disconnectSelected).not.toHaveBeenCalled()
  })

  it('drills into the selected node on Cmd/Ctrl+Enter when it is a local Function', async () => {
    mockWorkflowStore.selectedNodeIds = ['fn-1']
    mockWorkflowStore.nodes = [
      {
        id: 'fn-1',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [],
          },
        },
      },
    ]

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Enter', ctrlKey: true })

    expect(mockWorkflowStore.pushDrill).toHaveBeenCalledWith('fn-1')
  })

  it('does NOT drill on Cmd/Ctrl+Enter when more than one node is selected', async () => {
    mockWorkflowStore.selectedNodeIds = ['fn-1', 'fn-2']
    mockWorkflowStore.nodes = []

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Enter', ctrlKey: true })

    expect(mockWorkflowStore.pushDrill).not.toHaveBeenCalled()
  })

  // Ctrl+Enter opens a Shared Function too - but a Shared instance carries
  // no body, so the key takes the resolve-then-drill path rather than drilling
  // by id (which reached nothing).
  it('resolves the body on Cmd/Ctrl+Enter when the selected node is a shared Function', async () => {
    mockWorkflowStore.selectedNodeIds = ['fn-shared']
    mockWorkflowStore.nodes = [
      {
        id: 'fn-shared',
        position: { x: 0, y: 0 },
        data: {
          label: 'PublishedFn',
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '1.0.0',
        },
      },
    ]

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Enter', ctrlKey: true })

    expect(mockWorkflowStore.requestDrill).toHaveBeenCalled()
    expect(mockWorkflowStore.setDigInPending).toHaveBeenCalledWith('fn-shared')
    expect(mockWorkflowStore.pushDrill).not.toHaveBeenCalled()
  })

  it('ignores non-deletion keys', async () => {
    mockWorkflowStore.selectedEdgeIds = ['edge-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    fireEvent.keyDown(canvas, { key: 'Enter' })
    fireEvent.keyDown(canvas, { key: 'Escape' })
    fireEvent.keyDown(canvas, { key: 'a' })

    expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
    expect(mockWorkflowStore.disconnectSelected).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Drag Proximity Feedback
// =============================================================================
describe('WorkflowCanvas - Drag Proximity Feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Place a node with free output (no outgoing edge)
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
    ]
    mockWorkflowStore.edges = [] // node-1 has free output
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.selectedNodeIds = []
    mockScreenToFlowPosition.mockImplementation((pos: { x: number; y: number }) => pos)
  })

  it('renders proximity ghost edge when dragging within threshold of free output', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')

    // Simulate drag-over near node-1's output handle
    // node-1 at (0,0), output handle at ~(60, 50), threshold 100px
    // Position (60, 80) is 30px from output handle - within threshold
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragEvent, {
      clientX: 60,
      clientY: 80,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['application/wave-block'],
        dropEffect: '',
      },
    })

    await act(async () => {
      fireEvent(canvas, dragEvent)
    })

    // Proximity ghost edge element should appear
    expect(screen.queryByTestId('proximity-ghost-edge')).toBeInTheDocument()
  })

  it('does not render proximity ghost edge when dragging beyond threshold', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')

    // Simulate drag-over far from any node (500, 500 is way beyond 100px threshold)
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragEvent, {
      clientX: 500,
      clientY: 500,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['application/wave-block'],
        dropEffect: '',
      },
    })

    await act(async () => {
      fireEvent(canvas, dragEvent)
    })

    expect(screen.queryByTestId('proximity-ghost-edge')).not.toBeInTheDocument()
  })

  it('clears proximity ghost edge when drag position moves beyond threshold', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')

    // First drag near node-1 (within threshold)
    const nearEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(nearEvent, {
      clientX: 60,
      clientY: 80,
      preventDefault: vi.fn(),
      dataTransfer: { types: ['application/wave-block'], dropEffect: '' },
    })

    await act(async () => {
      fireEvent(canvas, nearEvent)
    })

    expect(screen.queryByTestId('proximity-ghost-edge')).toBeInTheDocument()

    // Advance Date.now past the 32ms dragover throttle so the next event is processed
    const originalNow = Date.now
    Date.now = () => originalNow() + 50

    // Then drag far away (beyond threshold)
    const farEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(farEvent, {
      clientX: 500,
      clientY: 500,
      preventDefault: vi.fn(),
      dataTransfer: { types: ['application/wave-block'], dropEffect: '' },
    })

    await act(async () => {
      fireEvent(canvas, farEvent)
    })

    Date.now = originalNow

    // Ghost edge should disappear
    expect(screen.queryByTestId('proximity-ghost-edge')).not.toBeInTheDocument()
  })

  it('does not show proximity feedback when no free outputs exist', async () => {
    // All nodes (including Start) have outgoing edges - no free outputs
    mockWorkflowStore.edges = [
      { id: 'edge-start', source: 'start-node', target: 'node-1' },
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ]

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')

    // Drag near node-1 but it has no free output
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragEvent, {
      clientX: 60,
      clientY: 80,
      preventDefault: vi.fn(),
      dataTransfer: { types: ['application/wave-block'], dropEffect: '' },
    })

    await act(async () => {
      fireEvent(canvas, dragEvent)
    })

    expect(screen.queryByTestId('proximity-ghost-edge')).not.toBeInTheDocument()
  })

  it('does not show proximity feedback for non-wave-block drag', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')

    // Drag event without application/wave-block type
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragEvent, {
      clientX: 60,
      clientY: 80,
      preventDefault: vi.fn(),
      dataTransfer: { types: ['text/plain'], dropEffect: '' },
    })

    await act(async () => {
      fireEvent(canvas, dragEvent)
    })

    expect(screen.queryByTestId('proximity-ghost-edge')).not.toBeInTheDocument()
  })
})

describe('WorkflowCanvas - readOnly mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
  })

  it('stamps data-readonly on the canvas root so history can be diagnosed', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas readOnly />)

    const canvas = screen.getByTestId('workflow-canvas')
    expect(canvas).toHaveAttribute('data-readonly', 'true')
  })

  it('does not stamp data-readonly on the default (live) canvas', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    const canvas = screen.getByTestId('workflow-canvas')
    expect(canvas).not.toHaveAttribute('data-readonly')
  })

  it('uses a concrete (finite) drag threshold when editable so dragging survives a read-only -> editable transition', async () => {
    // Must NOT be `undefined`. React Flow ignores undefined threshold
    // updates, so drilling read-only then entering edit mode would leave a stale
    // MAX_SAFE_INTEGER and silently disable node dragging.
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    expect((globalThis as Record<string, unknown>).__reactFlowNodeDragThreshold).toBe(1)
  })

  it('disables the drag threshold (MAX_SAFE_INTEGER) in read-only mode', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas readOnly />)
    expect((globalThis as Record<string, unknown>).__reactFlowNodeDragThreshold).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('does not pass connect, drop, context-menu, or double-click handlers to ReactFlow', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas readOnly />)

    const callbacks = (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
      onConnect?: unknown
      onPaneContextMenu?: unknown
      onEdgeContextMenu?: unknown
    }

    expect(callbacks.onConnect).toBeUndefined()
    expect(callbacks.onPaneContextMenu).toBeUndefined()
    expect(callbacks.onEdgeContextMenu).toBeUndefined()
  })
})

// ===========================================================================
// Quick-add wiring, sheet cap / duplicate-open focus, dirty-delete
// ===========================================================================

describe('WorkflowCanvas - Quick Add (REQ-4.2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.openConfigNodeIds = []
    mockWorkflowStore.pendingDeleteNodeIds = null
  })

  it('opens the window on Ctrl+Space and inserts on Enter', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    expect(screen.queryByTestId('quick-add-popover')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })
    expect(screen.getByTestId('quick-add-popover')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })

    expect(mockWorkflowStore.addNode).toHaveBeenCalledTimes(1)
    expect(mockWorkflowStore.selectNode).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('quick-add-popover')).not.toBeInTheDocument()
  })

  it('does not open the window in read-only mode', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas readOnly />)
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })
    expect(screen.queryByTestId('quick-add-popover')).not.toBeInTheDocument()
  })

  // The footer names the anchor currently in force, so the canvas has to
  // tell the window whether exactly one block is selected.
  it('tells the window there is no selection to anchor on', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })

    const win = screen.getByTestId('quick-add-popover')
    expect(within(win).getByText(/add after last block/i)).toBeInTheDocument()
  })

  it('tells the window when exactly one block is selected', async () => {
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'HTTP', elementType: 'http-client' } },
    ]
    mockWorkflowStore.selectedNodeIds = ['node-1']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })

    const win = screen.getByTestId('quick-add-popover')
    expect(within(win).getByText(/add after selection/i)).toBeInTheDocument()
  })

  it('treats a multi-selection as no anchor selection', async () => {
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'HTTP', elementType: 'http-client' } },
      { id: 'node-2', position: { x: 0, y: 0 }, data: { label: 'Log', elementType: 'log' } },
    ]
    mockWorkflowStore.selectedNodeIds = ['node-1', 'node-2']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })

    const win = screen.getByTestId('quick-add-popover')
    expect(within(win).getByText(/add after last block/i)).toBeInTheDocument()
  })

  it('no longer offers the removed Alt+Enter insert mode', async () => {
    // One block selected must not enable Alt+Enter.
    mockWorkflowStore.nodes = [
      { id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'HTTP', elementType: 'http-client' } },
    ]
    mockWorkflowStore.selectedNodeIds = ['node-1']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    fireEvent.keyDown(document, { key: ' ', ctrlKey: true })

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', altKey: true })

    expect(mockWorkflowStore.addNode).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-add-popover')).toBeInTheDocument()
  })
})

describe('WorkflowCanvas - config sheet cap and duplicate open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = [
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        data: { label: 'HTTP', elementType: 'http-client' },
      },
    ]
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
    mockWorkflowStore.pendingDeleteNodeIds = null
  })

  function getDoubleClick() {
    return (
      (globalThis as Record<string, unknown>).__reactFlowCallbacks as {
        onNodeDoubleClick: (e: unknown, node: { id: string; type?: string }) => void
      }
    ).onNodeDoubleClick
  }

  it('opens the config sheet on double-click below the cap', async () => {
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    act(() => {
      getDoubleClick()({}, { id: 'node-1', type: 'workflowNode' })
    })
    expect(mockWorkflowStore.openConfigModal).toHaveBeenCalledWith('node-1')
  })

  it('focuses the existing sheet instead of duplicating when the node is already open', async () => {
    mockWorkflowStore.openConfigNodeIds = ['node-1']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    act(() => {
      getDoubleClick()({}, { id: 'node-1', type: 'workflowNode' })
    })
    expect(mockWorkflowStore.openConfigModal).not.toHaveBeenCalled()
  })

  it('refuses the 11th sheet with the cap toast', async () => {
    mockWorkflowStore.openConfigNodeIds = Array.from({ length: 10 }, (_, i) => `open-${i}`)
    const errorToast = vi.fn()
    const toastValue = {
      toasts: [],
      toast: vi.fn(),
      success: vi.fn(),
      error: errorToast,
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    }
    const { ToastContext } = await import('@/components/ui/toast')
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(
      <ToastContext.Provider value={toastValue as never}>
        <WorkflowCanvas />
      </ToastContext.Provider>,
    )
    act(() => {
      getDoubleClick()({}, { id: 'node-1', type: 'workflowNode' })
    })
    expect(errorToast).toHaveBeenCalledWith(
      '10 config sheets open. Close one to open another.',
    )
    expect(mockWorkflowStore.openConfigModal).not.toHaveBeenCalled()
  })
})

describe('WorkflowCanvas - dirty-sheet delete confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
  })

  it('renders the confirmation and Close continues the intercepted delete', async () => {
    mockWorkflowStore.pendingDeleteNodeIds = ['node-1']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    expect(screen.getByText('Delete with unsaved changes?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(mockWorkflowStore.confirmPendingDelete).toHaveBeenCalledTimes(1)
  })

  it('Keep Editing cancels the intercepted delete', async () => {
    mockWorkflowStore.pendingDeleteNodeIds = ['node-1']
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    fireEvent.click(screen.getByRole('button', { name: /^keep editing$/i }))
    expect(mockWorkflowStore.cancelPendingDelete).toHaveBeenCalledTimes(1)
  })
})

describe('WorkflowCanvas - dirty-sheet drill confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
    mockWorkflowStore.pendingDeleteNodeIds = null
    mockWorkflowStore.pendingDrillAction = null
  })

  afterEach(() => {
    mockWorkflowStore.pendingDrillAction = null
  })

  it('renders the confirmation and confirms the intercepted drill', async () => {
    mockWorkflowStore.pendingDrillAction = { run: vi.fn() }
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    expect(screen.getByText('Navigate with unsaved changes?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /discard and continue/i }))
    expect(mockWorkflowStore.confirmPendingDrill).toHaveBeenCalledTimes(1)
  })

  it('cancels the intercepted drill', async () => {
    mockWorkflowStore.pendingDrillAction = { run: vi.fn() }
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockWorkflowStore.cancelPendingDrill).toHaveBeenCalledTimes(1)
  })
})

describe('WorkflowCanvas - scope read-only sheets (persist across drill)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.edges = []
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.selectedEdgeIds = []
    mockWorkflowStore.pendingDeleteNodeIds = null
    mockWorkflowStore.drillPath = []
  })

  it('keeps an out-of-scope sheet open as read-only while drilled into a Function', async () => {
    mockWorkflowStore.nodes = [
      {
        id: 'fn-1',
        position: { x: 0, y: 0 },
        data: {
          label: 'Function_1',
          nodeType: 'function',
          functionLifecycle: 'local',
          localDefinition: {
            workflow: { nodes: [], edges: [] },
            inputs: [],
            outputs: [],
            variables: [],
          },
        },
      },
      {
        id: 'root-http',
        position: { x: 0, y: 0 },
        data: {
          label: 'HTTP Client',
          elementType: 'http-client',
          version: '1.0',
          config: { values: {}, outputBindings: {} },
        },
      },
    ]
    mockWorkflowStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    mockWorkflowStore.openConfigNodeIds = ['root-http']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // The sheet persisted (node resolved outside the active scope) and froze.
    expect(screen.getByTestId('element-config-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('element-config-read-only-pill')).toBeInTheDocument()
    expect(screen.getByTestId('element-name-input')).toBeDisabled()
  })

  it('renders sheets read-only with the pill on a read-only (historical) canvas', async () => {
    mockWorkflowStore.nodes = [
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        data: {
          label: 'HTTP Client',
          elementType: 'http-client',
          version: '1.0',
          config: { values: {}, outputBindings: {} },
        },
      },
    ]
    mockWorkflowStore.openConfigNodeIds = ['node-1']

    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas readOnly />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(screen.getByTestId('element-config-read-only-pill')).toBeInTheDocument()
  })
})

describe('WorkflowCanvas - Save warning before a plain variable turns secret (SECUI-12, REQ-4.5.20)', () => {
  const ONE_BODY =
    'Saving makes the plain variable api_token a secret. Its value is masked from then on. Making it plain again clears its value.'
  const MANY_BODY =
    'Saving makes these plain variables secrets. Their values are masked from then on. Making them plain again clears their values.'

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
    mockWorkflowStore.pendingDeleteNodeIds = null
    mockWorkflowStore.pendingDrillAction = null
    mockWorkflowStore.drillPath = []
  })

  afterEach(() => {
    mockWorkflowStore.pendingSecretPromotion = null
  })

  async function renderCanvasWithHeldSave(names: string[] | null) {
    mockWorkflowStore.pendingSecretPromotion = names === null ? null : { names, save: vi.fn() }
    const { WorkflowCanvas } = await import('@/features/workbench/common/canvas/workflow-canvas')
    render(<WorkflowCanvas />)
  }

  it('shows no warning while no Save waits for an answer', async () => {
    await renderCanvasWithHeldSave(null)
    expect(screen.queryByTestId('secret-promote-dialog')).not.toBeInTheDocument()
  })

  it('one variable: the warning names it inline in the body and draws no list', async () => {
    await renderCanvasWithHeldSave(['api_token'])

    const dialog = screen.getByTestId('secret-promote-dialog')
    expect(dialog).toHaveAccessibleName('Make this variable secret?')
    expect(dialog).toHaveAccessibleDescription(ONE_BODY)
    expect(within(dialog).getByText('api_token', { selector: 'code' })).toBeInTheDocument()
    expect(dialog.querySelector('[data-item-list]')).not.toBeInTheDocument()
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
  })

  it.each([[2], [3], [15]])(
    '%i variables: the warning counts them and lists every name',
    async (count) => {
      const names = Array.from({ length: count }, (_, i) => `secret_var_${i + 1}`)
      await renderCanvasWithHeldSave(names)

      const dialog = screen.getByTestId('secret-promote-dialog')
      expect(dialog).toHaveAccessibleName(`Make ${count} variables secret?`)
      expect(dialog).toHaveAccessibleDescription(MANY_BODY)
      expect(dialog.querySelector('[data-item-list]')).toBeInTheDocument()
      expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual(names)
    },
  )

  it('uses the make-secret look: warning triangle, Cancel and a red "Make secret and save"', async () => {
    await renderCanvasWithHeldSave(['api_token'])

    const dialog = screen.getByTestId('secret-promote-dialog')
    expect(dialog.querySelector('[data-confirmation-icon]')).toHaveAttribute('data-icon', 'alert-triangle')
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Cancel',
      'Make secret and save',
    ])
    expect(within(dialog).getByRole('button', { name: 'Make secret and save' })).toHaveClass('btn-danger')
  })

  it('"Make secret and save" confirms the held Save through the store', async () => {
    await renderCanvasWithHeldSave(['api_token', 'session_id'])

    fireEvent.click(
      within(screen.getByTestId('secret-promote-dialog')).getByRole('button', { name: 'Make secret and save' }),
    )

    expect(mockWorkflowStore.confirmSecretPromotion).toHaveBeenCalledTimes(1)
  })

  it('Cancel drops the held Save through the store and never confirms it', async () => {
    await renderCanvasWithHeldSave(['api_token'])
    const heldSave = mockWorkflowStore.pendingSecretPromotion?.save

    fireEvent.click(within(screen.getByTestId('secret-promote-dialog')).getByRole('button', { name: 'Cancel' }))

    expect(mockWorkflowStore.cancelSecretPromotion).toHaveBeenCalledTimes(1)
    expect(mockWorkflowStore.confirmSecretPromotion).not.toHaveBeenCalled()
    expect(heldSave).not.toHaveBeenCalled()
  })
})
