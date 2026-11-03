/**
 * Workflow Store Tests - REQ-5.2.1.5 Zustand state management stores
 *
 * Tests for the workflow state management store that maintains canvas state
 * including node positions, selections, and undo history.
 *
 * Contract:
 * - Workflow store maintains canvas state including node positions, selections, and undo history
 *
 * Design system:
 * - Canvas specifications: grid pattern, zoom levels, node styles
 * - Node specifications: min/max width, states, execution colors
 * - Connection specifications: stroke width, arrow style, animations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Type definitions for workflow state
interface Position {
  x: number
  y: number
}

interface NodeType {
  id: string
  type: 'block' | 'control' | 'parallel' | 'error-handler'
  position: Position
  data: {
    label: string
    elementType?: string
    config?: Record<string, unknown>
    expressionFields?: string[]
  }
  width?: number
  height?: number
}

interface EdgeType {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  animated?: boolean
  label?: string
}

interface HistoryEntry {
  nodes: NodeType[]
  edges: EdgeType[]
  timestamp: number
  // Post-state baseline model: every entry can carry a description and the
  // baseline entry seeded by markSaved/reset/loadTest carries isInitialState.
  isInitialState?: boolean
  operationDescription?: string
}

describe('Workflow Store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('starts with empty nodes', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [] })

      expect(useWorkflowStore.getState().nodes).toEqual([])
    })

    it('starts with empty edges', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [] })

      expect(useWorkflowStore.getState().edges).toEqual([])
    })

    it('starts with default viewport', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const state = useWorkflowStore.getState()

      expect(state.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    })

    it('getSavedVariables returns the baseline variables, else the empty fallback', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      // No baseline entry -> the stable empty fallback.
      useWorkflowStore.setState({ history: [] })
      expect(useWorkflowStore.getState().getSavedVariables()).toEqual([])
      // A baseline entry with variables -> those variables.
      const variables = [{ id: 'v1', name: 'x', value: '1', type: 'integer', scope: 'test' }]
      useWorkflowStore.setState({
        history: [{ nodes: [], edges: [], timestamp: 0, isInitialState: true, variables }],
      } as never)
      expect(useWorkflowStore.getState().getSavedVariables()).toEqual(variables)
    })

    it('getSavedNodes returns the baseline nodes (Local Function bodies in them), else the empty fallback', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ history: [] })
      expect(useWorkflowStore.getState().getSavedNodes()).toEqual([])
      const nodes = [{ id: 'fn-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Fn' } }]
      useWorkflowStore.setState({
        history: [{ nodes, edges: [], timestamp: 0, isInitialState: true, variables: [] }],
      } as never)
      expect(useWorkflowStore.getState().getSavedNodes()).toBe(nodes)
    })

    it('setNodeTree replaces the whole tree while drilled; setNodes replaces only the drilled body', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const body = (nodes: unknown[]) => ({ workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] })
      const inner = { id: 'inner', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Inner' } }
      const fn = { id: 'fn-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Fn', nodeType: 'function', functionLifecycle: 'local', localDefinition: body([inner]) } }
      const root = { id: 'root', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Root' } }
      useWorkflowStore.setState({ nodes: [root, fn] as never, drillPath: [{ nodeId: 'fn-1', label: 'Fn' }] })

      const patchedFn = { ...fn, data: { ...fn.data, localDefinition: body([{ ...inner, data: { label: 'Inner2' } }]) } }
      useWorkflowStore.getState().setNodeTree([root, patchedFn] as never, { skipDirty: true })
      expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual(['root', 'fn-1'])
      const fnBody = useWorkflowStore.getState().nodes[1].data.localDefinition as { workflow: { nodes: Array<{ id: string }> } }
      expect(fnBody.workflow.nodes.map((node) => node.id)).toEqual(['inner'])

      useWorkflowStore.getState().setNodes([inner] as never, { skipDirty: true })
      expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual(['root', 'fn-1'])
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })

    it('setNodeTree marks the Test changed unless told to skip it', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const root = { id: 'root', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Root' } }
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [], isDirty: false })
      useWorkflowStore.getState().setNodeTree([root] as never, { skipDirty: true })
      expect(useWorkflowStore.getState().isDirty).toBe(false)
      useWorkflowStore.getState().setNodeTree([root] as never)
      expect(useWorkflowStore.getState().isDirty).toBe(true)
      useWorkflowStore.setState({ nodes: [] as never, isDirty: false })
    })

    it('keeps the library View baseline until the View is left or the canvas is reset', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const body = { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] }
      useWorkflowStore.getState().setFunctionViewBaseline({ nodeId: 'view-root', body })
      expect(useWorkflowStore.getState().functionViewBaseline).toEqual({ nodeId: 'view-root', body })
      useWorkflowStore.getState().exitFunctionView()
      expect(useWorkflowStore.getState().functionViewBaseline).toBeNull()
      useWorkflowStore.getState().setFunctionViewBaseline({ nodeId: 'view-root', body })
      useWorkflowStore.getState().reset()
      expect(useWorkflowStore.getState().functionViewBaseline).toBeNull()
    })

    it('starts with no selection', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const state = useWorkflowStore.getState()

      expect(state.selectedNodeIds).toEqual([])
      expect(state.selectedEdgeIds).toEqual([])
    })

    it('starts with a single isInitialState baseline at index 0', async () => {
      // Post-state baseline model: the live store ships with one
      // isInitialState entry so the canvas-equals-history[index] invariant
      // holds before any mutation, and so the very first user edit can be
      // undone back to the empty starting canvas.
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const state = useWorkflowStore.getState()

      expect(state.history).toHaveLength(1)
      expect(state.history[0].isInitialState).toBe(true)
      expect(state.history[0].nodes).toEqual([])
      expect(state.history[0].edges).toEqual([])
      expect(state.historyIndex).toBe(0)
      expect(state.canUndo()).toBe(false)
      expect(state.canRedo()).toBe(false)
    })

    it('starts with no clipboard content', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const state = useWorkflowStore.getState()

      expect(state.clipboard).toBeNull()
    })

    it('starts in clean state', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const state = useWorkflowStore.getState()

      expect(state.isDirty).toBe(false)
    })
  })

  describe('Node Operations', () => {
    describe('setNodes', () => {
      it('sets all nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [] })

        const nodes: NodeType[] = [
          {
            id: 'node-1',
            type: 'block',
            position: { x: 100, y: 100 },
            data: { label: 'Node 1' },
          },
          {
            id: 'node-2',
            type: 'block',
            position: { x: 200, y: 100 },
            data: { label: 'Node 2' },
          },
        ]

        useWorkflowStore.getState().setNodes(nodes)

        expect(useWorkflowStore.getState().nodes).toEqual(nodes)
      })

      it('marks state as dirty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        useWorkflowStore.getState().setNodes([
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ])

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('does not mark state as dirty when skipDirty is true', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        useWorkflowStore.getState().setNodes(
          [{ id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } }],
          { skipDirty: true }
        )

        expect(useWorkflowStore.getState().isDirty).toBe(false)
        expect(useWorkflowStore.getState().nodes).toHaveLength(1)
      })
    })

    describe('addNode', () => {
      it('adds a new node', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 100, y: 100 },
          data: { label: 'New Node' },
        }

        useWorkflowStore.getState().addNode(node)

        expect(useWorkflowStore.getState().nodes).toContainEqual(node)
      })

      it('preserves existing nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const existingNode: NodeType = {
          id: 'existing',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Existing' },
        }

        useWorkflowStore.setState({ nodes: [existingNode], edges: [], isDirty: false })

        const newNode: NodeType = {
          id: 'new',
          type: 'block',
          position: { x: 100, y: 100 },
          data: { label: 'New' },
        }

        useWorkflowStore.getState().addNode(newNode)

        expect(useWorkflowStore.getState().nodes).toHaveLength(2)
        expect(useWorkflowStore.getState().nodes).toContainEqual(existingNode)
      })

      it('stores expressionFields in node data', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: {
            label: 'HTTP Client',
            expressionFields: ['url', 'headers'],
          },
        }

        useWorkflowStore.getState().addNode(node)

        const stored = useWorkflowStore.getState().nodes.find((n) => n.id === 'node-1')
        expect(stored?.data.expressionFields).toEqual(['url', 'headers'])
      })
    })

    describe('updateNode', () => {
      it('updates node position', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node' },
        }

        useWorkflowStore.setState({ nodes: [node], edges: [], isDirty: false })

        useWorkflowStore.getState().updateNode('node-1', {
          position: { x: 200, y: 300 },
        })

        const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'node-1')
        expect(updated?.position).toEqual({ x: 200, y: 300 })
      })

      it('updates node data', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Original' },
        }

        useWorkflowStore.setState({ nodes: [node], edges: [], isDirty: false })

        useWorkflowStore.getState().updateNode('node-1', {
          data: { label: 'Updated', elementType: 'http' },
        })

        const updated = useWorkflowStore.getState().nodes.find((n) => n.id === 'node-1')
        expect(updated?.data.label).toBe('Updated')
        expect(updated?.data.elementType).toBe('http')
      })

      it('does nothing if node not found', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        expect(() =>
          useWorkflowStore.getState().updateNode('non-existent', { position: { x: 0, y: 0 } })
        ).not.toThrow()
      })
    })

    describe('removeNode', () => {
      it('removes node by id', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node' },
        }

        useWorkflowStore.setState({ nodes: [node], edges: [], isDirty: false })

        useWorkflowStore.getState().removeNode('node-1')

        expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      })

      it('removes connected edges when node is source', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]

        useWorkflowStore.setState({ nodes, edges, isDirty: false })

        useWorkflowStore.getState().removeNode('node-1')

        expect(useWorkflowStore.getState().edges).toHaveLength(0)
      })

      it('removes connected edges when node is target', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]

        useWorkflowStore.setState({ nodes, edges, isDirty: false })

        // Remove the target node
        useWorkflowStore.getState().removeNode('node-2')

        expect(useWorkflowStore.getState().edges).toHaveLength(0)
      })

      it('removes from selection', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node: NodeType = {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node' },
        }

        useWorkflowStore.setState({
          nodes: [node],
          edges: [],
          selectedNodeIds: ['node-1'],
          isDirty: false,
        })

        useWorkflowStore.getState().removeNode('node-1')

        expect(useWorkflowStore.getState().selectedNodeIds).not.toContain('node-1')
      })
    })
  })

  describe('Edge Operations', () => {
    describe('addEdge', () => {
      it('adds a new edge', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        const edge: EdgeType = {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        }

        useWorkflowStore.getState().addEdge(edge)

        expect(useWorkflowStore.getState().edges).toContainEqual(edge)
      })

      it('prevents duplicate edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const edge: EdgeType = {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        }

        useWorkflowStore.setState({ nodes: [], edges: [edge], isDirty: false })

        // Adding same edge should not duplicate
        useWorkflowStore.getState().addEdge(edge)

        expect(useWorkflowStore.getState().edges).toHaveLength(1)
      })

      it('preserves sourceHandle on added edge (split mode handles)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        const passEdge: EdgeType = {
          id: 'edge-pass',
          source: 'assert-1',
          target: 'node-pass',
          sourceHandle: 'pass',
        }
        const failEdge: EdgeType = {
          id: 'edge-fail',
          source: 'assert-1',
          target: 'node-fail',
          sourceHandle: 'fail',
        }

        useWorkflowStore.getState().addEdge(passEdge)
        useWorkflowStore.getState().addEdge(failEdge)

        const edges = useWorkflowStore.getState().edges
        expect(edges).toHaveLength(2)
        expect(edges.find((e) => e.id === 'edge-pass')?.sourceHandle).toBe('pass')
        expect(edges.find((e) => e.id === 'edge-fail')?.sourceHandle).toBe('fail')
      })
    })

    describe('removeEdge', () => {
      it('removes edge by id', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const edge: EdgeType = {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        }

        useWorkflowStore.setState({ nodes: [], edges: [edge], isDirty: false })

        useWorkflowStore.getState().removeEdge('edge-1')

        expect(useWorkflowStore.getState().edges).toHaveLength(0)
      })

      it('migrates ingress handles: clears targetHandle when only one ingress remains', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Two edges targeting the same node - e2 has a targetHandle
        // Also include an unrelated edge (e3) to test the "not targeting nodeId" path
        const edges: EdgeType[] = [
          { id: 'e1', source: 'A', target: 'X' },
          { id: 'e2', source: 'B', target: 'X', targetHandle: 'ingress_1' },
          { id: 'e3', source: 'C', target: 'Y' },
        ]

        useWorkflowStore.setState({ nodes: [], edges, isDirty: false, history: [], historyIndex: -1 })

        // Remove e1 - only e2 remains targeting X, so its targetHandle should be cleared
        // e3 (targeting Y) should be unchanged
        useWorkflowStore.getState().removeEdge('e1')

        const remaining = useWorkflowStore.getState().edges
        expect(remaining).toHaveLength(2)
        const edgeToX = remaining.find((e) => e.target === 'X')
        expect(edgeToX).toBeDefined()
        expect(edgeToX!.id).toBe('e2')
        expect(edgeToX!.targetHandle).toBeUndefined()
        // Unrelated edge should be unchanged
        const edgeToY = remaining.find((e) => e.target === 'Y')
        expect(edgeToY).toBeDefined()
        expect(edgeToY!.id).toBe('e3')
      })

      it('migrates ingress handles: leaves edges without targetHandle unchanged when single remains', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Two edges targeting X - e1 has no targetHandle (already default)
        const edges: EdgeType[] = [
          { id: 'e1', source: 'A', target: 'X' },
          { id: 'e2', source: 'B', target: 'X', targetHandle: 'ingress_1' },
        ]

        useWorkflowStore.setState({ nodes: [], edges, isDirty: false, history: [], historyIndex: -1 })

        // Remove e2 - only e1 remains targeting X, and e1 already has no targetHandle
        useWorkflowStore.getState().removeEdge('e2')

        const remaining = useWorkflowStore.getState().edges
        expect(remaining).toHaveLength(1)
        expect(remaining[0].id).toBe('e1')
        expect(remaining[0].targetHandle).toBeUndefined()
      })

      it('migrates ingress handles: compacts sequential handles when multiple remain', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Three edges targeting X - remove the middle one
        const edges: EdgeType[] = [
          { id: 'e1', source: 'A', target: 'X' },
          { id: 'e2', source: 'B', target: 'X', targetHandle: 'ingress_1' },
          { id: 'e3', source: 'C', target: 'X', targetHandle: 'ingress_2' },
        ]

        useWorkflowStore.setState({ nodes: [], edges, isDirty: false, history: [], historyIndex: -1 })

        // Remove e2 - e1 and e3 remain. Should be compacted: e1 gets undefined, e3 gets ingress_1
        useWorkflowStore.getState().removeEdge('e2')

        const remaining = useWorkflowStore.getState().edges
        expect(remaining).toHaveLength(2)
        const edgesToX = remaining.filter((e) => e.target === 'X')
        expect(edgesToX).toHaveLength(2)
        // First edge should have no targetHandle
        expect(edgesToX[0].targetHandle).toBeUndefined()
        // Second edge should have ingress_1
        expect(edgesToX[1].targetHandle).toBe('ingress_1')
      })

      it('migrates ingress handles: skips edges already at correct handle position', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Three edges targeting X with already-compact handles, remove the last one
        const edges: EdgeType[] = [
          { id: 'e1', source: 'A', target: 'X' },
          { id: 'e2', source: 'B', target: 'X', targetHandle: 'ingress_1' },
          { id: 'e3', source: 'C', target: 'X', targetHandle: 'ingress_2' },
          { id: 'e4', source: 'D', target: 'Y' },
        ]

        useWorkflowStore.setState({ nodes: [], edges, isDirty: false, history: [], historyIndex: -1 })

        // Remove e3 - e1 and e2 remain with already correct handles
        // e1: undefined (correct for index 0), e2: ingress_1 (correct for index 1)
        useWorkflowStore.getState().removeEdge('e3')

        const remaining = useWorkflowStore.getState().edges
        expect(remaining).toHaveLength(3) // e1, e2, e4
        const edgesToX = remaining.filter((e) => e.target === 'X')
        expect(edgesToX).toHaveLength(2)
        // Handles should remain unchanged (already compact)
        expect(edgesToX[0].targetHandle).toBeUndefined()
        expect(edgesToX[1].targetHandle).toBe('ingress_1')
        // Unrelated edge preserved
        expect(remaining.find((e) => e.target === 'Y')).toBeDefined()
      })
    })

    describe('setDraggingEdge', () => {
      it('sets isDraggingEdge and draggingEdgeSourceId', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ isDraggingEdge: false, draggingEdgeSourceId: null })

        useWorkflowStore.getState().setDraggingEdge(true, 'node-1')

        const state = useWorkflowStore.getState()
        expect(state.isDraggingEdge).toBe(true)
        expect(state.draggingEdgeSourceId).toBe('node-1')
      })

      it('clears dragging state with defaults', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ isDraggingEdge: true, draggingEdgeSourceId: 'node-1' })

        useWorkflowStore.getState().setDraggingEdge(false)

        const state = useWorkflowStore.getState()
        expect(state.isDraggingEdge).toBe(false)
        expect(state.draggingEdgeSourceId).toBeNull()
      })
    })

    describe('relocateEdge', () => {
      it('atomically removes old edge and adds new edge', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const oldEdge: EdgeType = { id: 'old-edge', source: 'A', target: 'B' }
        const newEdge: EdgeType = { id: 'new-edge', source: 'A', target: 'C' }

        useWorkflowStore.setState({ edges: [oldEdge], selectedEdgeIds: ['old-edge'], isDirty: false })

        useWorkflowStore.getState().relocateEdge('old-edge', newEdge)

        const state = useWorkflowStore.getState()
        expect(state.edges).toHaveLength(1)
        expect(state.edges[0]).toEqual(newEdge)
        expect(state.selectedEdgeIds).toEqual([])
        expect(state.isDirty).toBe(true)
      })

      it('pushes history entry for undo support', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const oldEdge: EdgeType = { id: 'e1', source: 'A', target: 'B' }
        const newEdge: EdgeType = { id: 'e2', source: 'A', target: 'D' }

        // Post-state baseline model: seed a baseline holding the old edge so
        // the post-relocate commit lands at index 1 and undo can rewind to 0.
        useWorkflowStore.setState({
          edges: [oldEdge],
          selectedEdgeIds: [],
          isDirty: false,
          history: [{ nodes: [], edges: [oldEdge], variables: [], timestamp: Date.now(), isInitialState: true }],
          historyIndex: 0,
        })

        useWorkflowStore.getState().relocateEdge('e1', newEdge)

        // Undo should restore original edge
        useWorkflowStore.getState().undo()
        const restored = useWorkflowStore.getState()
        expect(restored.edges).toEqual([oldEdge])
      })

      it('preserves sourceHandle through relocation (split mode handles)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const oldEdge: EdgeType = { id: 'e-pass', source: 'assert-1', target: 'B', sourceHandle: 'pass' }
        const newEdge: EdgeType = { id: 'e-pass-new', source: 'assert-1', target: 'C', sourceHandle: 'pass' }

        useWorkflowStore.setState({ edges: [oldEdge], selectedEdgeIds: [], isDirty: false })

        useWorkflowStore.getState().relocateEdge('e-pass', newEdge)

        const edges = useWorkflowStore.getState().edges
        expect(edges).toHaveLength(1)
        expect(edges[0].sourceHandle).toBe('pass')
      })
    })
  })

  describe('Selection', () => {
    describe('setSelectedNodes', () => {
      it('sets selected node ids', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ selectedNodeIds: [] })

        useWorkflowStore.getState().setSelectedNodes(['node-1', 'node-2'])

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1', 'node-2'])
      })

      it('replaces previous selection', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ selectedNodeIds: ['old-node'] })

        useWorkflowStore.getState().setSelectedNodes(['new-node'])

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['new-node'])
      })
    })

    describe('setSelectedEdges', () => {
      it('sets selected edge ids', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ selectedEdgeIds: [] })

        useWorkflowStore.getState().setSelectedEdges(['edge-1'])

        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual(['edge-1'])
      })
    })

    describe('clearSelection', () => {
      it('clears all selections', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-1', 'node-2'],
          selectedEdgeIds: ['edge-1'],
        })

        useWorkflowStore.getState().clearSelection()

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual([])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([])
      })
    })

    describe('selectAll', () => {
      it('selects all nodes and edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        })

        useWorkflowStore.getState().selectAll()

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1', 'node-2'])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual(['edge-1'])
      })
    })
  })

  describe('Viewport', () => {
    describe('setViewport', () => {
      it('sets viewport state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 0, y: 0, zoom: 1 } })

        useWorkflowStore.getState().setViewport({ x: 100, y: 50, zoom: 1.5 })

        expect(useWorkflowStore.getState().viewport).toEqual({ x: 100, y: 50, zoom: 1.5 })
      })
    })

    describe('zoomIn', () => {
      it('increases zoom level', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 0, y: 0, zoom: 1 } })

        useWorkflowStore.getState().zoomIn()

        expect(useWorkflowStore.getState().viewport.zoom).toBeGreaterThan(1)
      })

      it('respects max zoom limit (2.0)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 0, y: 0, zoom: 2.0 } })

        useWorkflowStore.getState().zoomIn()

        expect(useWorkflowStore.getState().viewport.zoom).toBeLessThanOrEqual(2.0)
      })
    })

    describe('zoomOut', () => {
      it('decreases zoom level', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 0, y: 0, zoom: 1 } })

        useWorkflowStore.getState().zoomOut()

        expect(useWorkflowStore.getState().viewport.zoom).toBeLessThan(1)
      })

      it('respects min zoom limit (0.25)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 0, y: 0, zoom: 0.25 } })

        useWorkflowStore.getState().zoomOut()

        expect(useWorkflowStore.getState().viewport.zoom).toBeGreaterThanOrEqual(0.25)
      })
    })

    describe('resetZoom', () => {
      it('resets zoom to 1.0', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ viewport: { x: 100, y: 50, zoom: 1.5 } })

        useWorkflowStore.getState().resetZoom()

        expect(useWorkflowStore.getState().viewport.zoom).toBe(1.0)
      })
    })
  })

  describe('Undo/Redo', () => {
    describe('commitHistory (post-state baseline model)', () => {
      // The entry IS the current canvas state, not the pre-op state. After
      // every commit, history[historyIndex] equals (nodes, edges, variables).
      it('appends a post-state entry for the current canvas', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().commitHistory()

        const state = useWorkflowStore.getState()
        expect(state.history).toHaveLength(1)
        expect(state.historyIndex).toBe(0)
        expect(state.history[0].nodes).toEqual(nodes)
      })

      it('truncates the redoable tail when committing after undo', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 2000 },
          { nodes: [], edges: [], timestamp: now - 1000 },
          { nodes: [], edges: [], timestamp: now },
        ]

        useWorkflowStore.setState({
          nodes: [{ id: 'new', type: 'block', position: { x: 0, y: 0 }, data: { label: 'New' } }],
          edges: [],
          history,
          historyIndex: 0, // Undid twice; entries 1 and 2 are redoable tail
        })

        useWorkflowStore.getState().commitHistory()

        // Tail (entries 1, 2) dropped; current state appended as new entry 1
        expect(useWorkflowStore.getState().history).toHaveLength(2)
        expect(useWorkflowStore.getState().historyIndex).toBe(1)
        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })

      it('respects max history length', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const history: HistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
          nodes: [],
          edges: [],
          timestamp: now - (50 - i) * 1000,
        }))

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history,
          historyIndex: 49,
          maxHistoryLength: 50,
        })

        useWorkflowStore.getState().commitHistory()

        expect(useWorkflowStore.getState().history.length).toBeLessThanOrEqual(50)
      })
    })

    describe('undo', () => {
      it('restores history[historyIndex - 1] and decrements the pointer', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const previousNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
        ]
        const currentNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ]

        // Post-state baseline model: history holds full snapshots; canvas
        // ALWAYS equals history[historyIndex]. To undo from "Current" to
        // "Previous" we need both states present in history.
        const history: HistoryEntry[] = [
          { nodes: previousNodes, edges: [], timestamp: now - 1000, isInitialState: true },
          { nodes: currentNodes, edges: [], timestamp: now, operationDescription: 'Move' },
        ]

        useWorkflowStore.setState({
          nodes: currentNodes,
          edges: [],
          history,
          historyIndex: 1, // Canvas equals history[1]; undo will move to 0
        })

        useWorkflowStore.getState().undo()

        const state = useWorkflowStore.getState()
        expect(state.historyIndex).toBe(0)
        expect(state.nodes[0].data.label).toBe('Previous')
      })

      it('decrements history index', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 2000 },
          { nodes: [], edges: [], timestamp: now - 1000 },
        ]

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history,
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        expect(useWorkflowStore.getState().historyIndex).toBe(0)
      })

      it('is a no-op at the baseline (historyIndex <= 0)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const baselineNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'First' } },
        ]

        // Post-state baseline model: at historyIndex=0, the canvas is
        // already on the baseline; further undos must NOT move the pointer.
        useWorkflowStore.setState({
          nodes: baselineNodes,
          edges: [],
          history: [
            { nodes: baselineNodes, edges: [], timestamp: now, isInitialState: true },
          ],
          historyIndex: 0,
        })

        useWorkflowStore.getState().undo()

        expect(useWorkflowStore.getState().historyIndex).toBe(0)
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('First')
      })
    })

    describe('redo', () => {
      it('restores next state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const nextNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Next' } },
        ]

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 2000 },
          { nodes: nextNodes, edges: [], timestamp: now - 1000 },
        ]

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history,
          historyIndex: 0, // After undo
        })

        useWorkflowStore.getState().redo()

        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Next')
      })

      it('increments history index', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 2000 },
          { nodes: [], edges: [], timestamp: now - 1000 },
        ]

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history,
          historyIndex: 0,
        })

        useWorkflowStore.getState().redo()

        expect(useWorkflowStore.getState().historyIndex).toBe(1)
      })

      it('does nothing when at end of history', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 1000 },
          {
            nodes: [
              {
                id: 'node-1',
                type: 'block',
                position: { x: 0, y: 0 },
                data: { label: 'Final' },
              },
            ],
            edges: [],
            timestamp: now,
          },
        ]

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Final' } },
          ],
          edges: [],
          history,
          historyIndex: 1, // Already at end
        })

        // Should not change anything
        useWorkflowStore.getState().redo()

        expect(useWorkflowStore.getState().historyIndex).toBe(1)
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Final')
      })
    })

    describe('canUndo', () => {
      it('returns true only when historyIndex > 0 (above the baseline)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        // Post-state baseline model: at historyIndex=0 the canvas is on the
        // baseline; canUndo must be false. After one op (historyIndex=1) the
        // pointer can move back to baseline; canUndo must be true.
        useWorkflowStore.setState({
          history: [
            { nodes: [], edges: [], timestamp: now - 1000, isInitialState: true },
            { nodes: [], edges: [], timestamp: now, operationDescription: 'op' },
          ],
          historyIndex: 1,
        })
        expect(useWorkflowStore.getState().canUndo()).toBe(true)

        useWorkflowStore.setState({ historyIndex: 0 })
        expect(useWorkflowStore.getState().canUndo()).toBe(false)

        useWorkflowStore.setState({ historyIndex: -1 })
        expect(useWorkflowStore.getState().canUndo()).toBe(false)
      })

      it('returns false when at beginning of history', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          history: [],
          historyIndex: -1,
        })

        expect(useWorkflowStore.getState().canUndo()).toBe(false)
      })
    })

    describe('canRedo', () => {
      it('returns true when future history exists', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          history: [
            { nodes: [], edges: [], timestamp: now - 1000 },
            { nodes: [], edges: [], timestamp: now },
          ],
          historyIndex: 0,
        })

        expect(useWorkflowStore.getState().canRedo()).toBe(true)
      })

      it('returns false when at end of history', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          history: [{ nodes: [], edges: [], timestamp: Date.now() }],
          historyIndex: 0,
        })

        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })
    })
  })

  describe('Clipboard', () => {
    describe('copy', () => {
      it('copies selected nodes to clipboard', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1'],
          clipboard: null,
        })

        useWorkflowStore.getState().copy()

        const clipboard = useWorkflowStore.getState().clipboard
        expect(clipboard?.nodes).toHaveLength(1)
        expect(clipboard?.nodes[0].id).toBe('node-1')
      })

      it('copies connected edges between selected nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-1', 'node-2'],
          clipboard: null,
        })

        useWorkflowStore.getState().copy()

        const clipboard = useWorkflowStore.getState().clipboard
        expect(clipboard?.edges).toHaveLength(1)
      })
    })

    describe('paste', () => {
      it('pastes nodes from clipboard with new ids', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            ],
            edges: [],
          },
        })

        useWorkflowStore.getState().paste()

        const nodes = useWorkflowStore.getState().nodes
        expect(nodes).toHaveLength(1)
        expect(nodes[0].id).not.toBe('node-1') // New ID
        expect(nodes[0].data.label).toBe('Node 1')
      })

      it('applies offset to pasted nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Node' } },
            ],
            edges: [],
          },
        })

        useWorkflowStore.getState().paste({ x: 20, y: 20 })

        const nodes = useWorkflowStore.getState().nodes
        expect(nodes[0].position.x).toBe(120)
        expect(nodes[0].position.y).toBe(120)
      })

      it('does nothing if clipboard is empty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          clipboard: null,
        })

        useWorkflowStore.getState().paste()

        expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      })

      it('pastes edges with remapped node IDs', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
              { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            ],
            edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
          },
        })

        useWorkflowStore.getState().paste()

        const nodes = useWorkflowStore.getState().nodes
        const edges = useWorkflowStore.getState().edges

        expect(nodes).toHaveLength(2)
        expect(edges).toHaveLength(1)

        // Verify edge references new node IDs
        const edge = edges[0]
        expect(edge.id).not.toBe('edge-1') // New ID
        expect(edge.source).not.toBe('node-1') // Remapped
        expect(edge.target).not.toBe('node-2') // Remapped

        // Verify edge references actual pasted nodes
        const pastedNodeIds = nodes.map((n) => n.id)
        expect(pastedNodeIds).toContain(edge.source)
        expect(pastedNodeIds).toContain(edge.target)
      })

      it('does nothing if clipboard has empty nodes array', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          clipboard: {
            nodes: [],
            edges: [],
          },
        })

        useWorkflowStore.getState().paste()

        expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      })

      it('handles edges referencing non-existent target node gracefully', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Clipboard with edges that reference nodes not in the clipboard
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            ],
            edges: [
              // Edge target references node not in clipboard
              { id: 'edge-1', source: 'node-1', target: 'non-existent-node' },
            ],
          },
        })

        useWorkflowStore.getState().paste()

        const edges = useWorkflowStore.getState().edges
        expect(edges).toHaveLength(1)
        // The target should fall back to the original ID since it's not in idMap
        expect(edges[0].target).toBe('non-existent-node')
      })

      it('handles edges referencing non-existent source node gracefully', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Clipboard with edges where source is not in the clipboard nodes
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            ],
            edges: [
              // Edge source references node not in clipboard
              { id: 'edge-1', source: 'non-existent-source', target: 'node-1' },
            ],
          },
        })

        useWorkflowStore.getState().paste()

        const edges = useWorkflowStore.getState().edges
        expect(edges).toHaveLength(1)
        // The source should fall back to the original ID since it's not in idMap
        expect(edges[0].source).toBe('non-existent-source')
      })

      it('preserves expressionFields on pasted nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              {
                id: 'node-1',
                type: 'block',
                position: { x: 0, y: 0 },
                data: {
                  label: 'HTTP Client',
                  config: { values: { url: 'https://test.com' } },
                  expressionFields: ['url', 'headers'],
                },
              },
            ],
            edges: [],
          },
        })

        useWorkflowStore.getState().paste()

        const pastedNode = useWorkflowStore.getState().nodes[0]
        expect(pastedNode.data.expressionFields).toEqual(['url', 'headers'])
      })
    })

    describe('cut', () => {
      it('copies and removes selected nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1'],
          clipboard: null,
        })

        useWorkflowStore.getState().cut()

        expect(useWorkflowStore.getState().clipboard?.nodes).toHaveLength(1)
        expect(useWorkflowStore.getState().nodes).toHaveLength(0)
      })

      it('sets clipboardSource to cut', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [{ id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } }],
          edges: [],
          selectedNodeIds: ['node-1'],
          clipboard: null,
        })

        useWorkflowStore.getState().cut()

        expect(useWorkflowStore.getState().clipboardSource).toBe('cut')
      })

      it('paste after cut clears clipboard (single-use move)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [{ id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } }],
          edges: [],
          selectedNodeIds: ['node-1'],
          clipboard: null,
        })

        useWorkflowStore.getState().cut()

        // First paste works
        useWorkflowStore.getState().paste()
        expect(useWorkflowStore.getState().nodes).toHaveLength(1)

        // Clipboard is now cleared - second paste does nothing
        expect(useWorkflowStore.getState().clipboard).toBeNull()
        useWorkflowStore.getState().paste()
        expect(useWorkflowStore.getState().nodes).toHaveLength(1) // Still 1, no duplicate
      })

      it('paste after copy does NOT clear clipboard (repeatable)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [{ id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } }],
          edges: [],
          selectedNodeIds: ['node-1'],
          clipboard: null,
        })

        useWorkflowStore.getState().copy()

        // First paste
        useWorkflowStore.getState().paste()
        expect(useWorkflowStore.getState().nodes).toHaveLength(2)

        // Clipboard still available - second paste adds another
        expect(useWorkflowStore.getState().clipboard).not.toBeNull()
        useWorkflowStore.getState().paste()
        expect(useWorkflowStore.getState().nodes).toHaveLength(3)
      })

      it('clears output bindings on pasted nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          clipboard: {
            nodes: [
              {
                id: 'node-1',
                type: 'block',
                position: { x: 0, y: 0 },
                data: {
                  label: 'HTTP Client',
                  config: {
                    values: { url: 'https://test.com' },
                    outputBindings: { status: 'response_code', body: 'response_body' },
                  },
                },
              },
            ],
            edges: [],
          },
        })

        useWorkflowStore.getState().paste()

        const pastedNode = useWorkflowStore.getState().nodes[0]
        const config = pastedNode.data.config as Record<string, unknown>
        expect(config.outputBindings).toEqual({})
      })
    })

    describe('duplicate', () => {
      it('duplicates selected nodes in place', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1'],
        })

        useWorkflowStore.getState().duplicate()

        expect(useWorkflowStore.getState().nodes).toHaveLength(2)
      })

      it('duplicates edges between selected nodes with new ids', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' }, // edge between selected nodes
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-1', 'node-2'], // Select nodes with edge between them
        })

        useWorkflowStore.getState().duplicate()

        // Should have original 3 nodes plus 2 duplicated nodes
        expect(useWorkflowStore.getState().nodes).toHaveLength(5)
        // Should have original 2 edges plus 1 duplicated edge (edge-1 connects selected nodes)
        expect(useWorkflowStore.getState().edges).toHaveLength(3)

        // Verify the duplicated edge has new ID and references new nodes
        const duplicatedEdges = useWorkflowStore
          .getState()
          .edges.filter((e) => e.id !== 'edge-1' && e.id !== 'edge-2')
        expect(duplicatedEdges).toHaveLength(1)
        expect(duplicatedEdges[0].source).not.toBe('node-1')
        expect(duplicatedEdges[0].target).not.toBe('node-2')
      })

      it('does nothing when no nodes are selected', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [],
          selectedNodeIds: [],
        })

        useWorkflowStore.getState().duplicate()

        expect(useWorkflowStore.getState().nodes).toHaveLength(1)
      })

      it('handles edges referencing non-selected nodes gracefully during duplicate', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          // This edge connects node-1 (selected) to node-3 (not selected)
          // When filtering, only edges between selected nodes are duplicated
          // But if somehow an edge with a non-selected node gets through, the ?? handles it
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-1', 'node-2'],
        })

        useWorkflowStore.getState().duplicate()

        // Should have original 3 nodes plus 2 duplicated nodes
        expect(useWorkflowStore.getState().nodes).toHaveLength(5)
        // Should have original 1 edge plus 1 duplicated edge
        expect(useWorkflowStore.getState().edges).toHaveLength(2)
      })

      it('handles stale target node IDs in selection during duplicate', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Edge case: selectedNodeIds contains IDs that don't exist in nodes array
        // This can happen if state becomes inconsistent
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ]
        const edges: EdgeType[] = [
          // Edge target is in selection but doesn't exist in nodes
          { id: 'edge-1', source: 'node-1', target: 'non-existent' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          // Include a non-existent node ID in selection
          selectedNodeIds: ['node-1', 'non-existent'],
        })

        useWorkflowStore.getState().duplicate()

        // Should have original 1 node plus 1 duplicated (only existing nodes are duplicated)
        expect(useWorkflowStore.getState().nodes).toHaveLength(2)
        // Edge should be duplicated with fallback for non-existent node ID
        expect(useWorkflowStore.getState().edges).toHaveLength(2)

        // Find the duplicated edge
        const duplicatedEdge = useWorkflowStore
          .getState()
          .edges.find((e) => e.id !== 'edge-1')
        expect(duplicatedEdge).toBeDefined()
        // Target should fall back to original ID since node doesn't exist
        expect(duplicatedEdge?.target).toBe('non-existent')
      })

      it('handles stale source node IDs in selection during duplicate', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        // Edge case: selectedNodeIds contains source ID that doesn't exist in nodes array
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ]
        const edges: EdgeType[] = [
          // Edge source is in selection but doesn't exist in nodes
          { id: 'edge-1', source: 'non-existent-source', target: 'node-1' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          // Include a non-existent source node ID in selection
          selectedNodeIds: ['non-existent-source', 'node-1'],
        })

        useWorkflowStore.getState().duplicate()

        // Should have original 1 node plus 1 duplicated
        expect(useWorkflowStore.getState().nodes).toHaveLength(2)
        // Edge should be duplicated with fallback for non-existent source
        expect(useWorkflowStore.getState().edges).toHaveLength(2)

        // Find the duplicated edge
        const duplicatedEdge = useWorkflowStore
          .getState()
          .edges.find((e) => e.id !== 'edge-1')
        expect(duplicatedEdge).toBeDefined()
        // Source should fall back to original ID since node doesn't exist
        expect(duplicatedEdge?.source).toBe('non-existent-source')
      })

      it('clears output bindings on duplicated nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          {
            id: 'node-1',
            type: 'block',
            position: { x: 0, y: 0 },
            data: {
              label: 'HTTP Client',
              config: {
                values: { url: 'https://test.com' },
                outputBindings: { status: 'response_code' },
              },
            },
          },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1'],
        })

        useWorkflowStore.getState().duplicate()

        const duplicatedNode = useWorkflowStore.getState().nodes.find((n) => n.id !== 'node-1')!
        const config = duplicatedNode.data.config as Record<string, unknown>
        expect(config.outputBindings).toEqual({})
      })

      it('preserves expressionFields on duplicated nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          {
            id: 'node-1',
            type: 'block',
            position: { x: 0, y: 0 },
            data: {
              label: 'HTTP Client',
              config: { values: { url: 'https://test.com' } },
              expressionFields: ['url', 'timeout'],
            },
          },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1'],
        })

        useWorkflowStore.getState().duplicate()

        const duplicatedNode = useWorkflowStore.getState().nodes.find((n) => n.id !== 'node-1')!
        expect(duplicatedNode.data.expressionFields).toEqual(['url', 'timeout'])
      })
    })
  })

  describe('Dirty State', () => {
    describe('markSaved', () => {
      it('clears dirty flag', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        useWorkflowStore.setState({ isDirty: true, lastSavedAt: null })

        useWorkflowStore.getState().markSaved()

        expect(useWorkflowStore.getState().isDirty).toBe(false)
        expect(useWorkflowStore.getState().lastSavedAt).toBe(now)
      })
    })
  })

  /**
   * REQ-5.2.1.24 Undo/redo support for critical operations
   *
   * Tests for the session-scoped, save-bounded undo/redo architecture.
   *
   * Key architectural behaviors:
   * - Save operation clears both undo and redo stacks (commit point)
   * - Discard changes restores last saved state and clears both stacks
   * - History stack has maximum depth of 50 operations
   * - Dirty state tracks uncommitted changes
   */
  describe('REQ-5.2.1.24 Undo/Redo Support', () => {
    describe('Save-Bounded Architecture', () => {
      /**
       * Per design: "Save operation | Clears both undo and redo stacks (commit point)"
       * Post-state baseline model: markSaved seeds a single isInitialState
       * entry from the current canvas. The user-facing contract (canUndo()
       * === false immediately after save) is preserved; the internal
       * mechanism switches from "clear to empty" to "seed with baseline".
       */
      it('markSaved seeds a single isInitialState baseline (commit point)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const currentNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Current' } },
        ]

        // Setup: create history entries above an existing baseline
        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 2000, isInitialState: true },
          { nodes: currentNodes, edges: [], timestamp: now - 1000, operationDescription: 'op' },
        ]

        useWorkflowStore.setState({
          nodes: currentNodes,
          edges: [],
          history,
          historyIndex: 1,
          isDirty: true,
        })

        // Verify history exists before save
        expect(useWorkflowStore.getState().history.length).toBe(2)
        expect(useWorkflowStore.getState().historyIndex).toBe(1)

        // Save floors to a single baseline entry seeded from current state
        useWorkflowStore.getState().markSaved()

        const state = useWorkflowStore.getState()
        expect(state.history.length).toBe(1)
        expect(state.history[0].isInitialState).toBe(true)
        expect(state.history[0].nodes).toEqual(currentNodes)
        expect(state.historyIndex).toBe(0)
        expect(state.canUndo()).toBe(false)
      })

      it('markSaved discards any redoable tail', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        // Setup: user has undone some actions, so there's future history (redo available)
        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 3000, isInitialState: true },
          { nodes: [], edges: [], timestamp: now - 2000, operationDescription: 'op1' },
          { nodes: [], edges: [], timestamp: now - 1000, operationDescription: 'op2' },
        ]

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history,
          historyIndex: 0, // At baseline, can redo to index 1 and 2
          isDirty: true,
        })

        // Verify redo is available
        expect(useWorkflowStore.getState().canRedo()).toBe(true)

        // Save floors to a single baseline; redo tail is gone
        useWorkflowStore.getState().markSaved()

        const state = useWorkflowStore.getState()
        expect(state.canUndo()).toBe(false)
        expect(state.canRedo()).toBe(false)
        expect(state.history.length).toBe(1)
        expect(state.history[0].isInitialState).toBe(true)
      })

      it('markSaved sets lastSavedAt timestamp', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history: [{ nodes: [], edges: [], timestamp: now - 1000 }],
          historyIndex: 0,
          isDirty: true,
          lastSavedAt: null,
        })

        useWorkflowStore.getState().markSaved()

        expect(useWorkflowStore.getState().lastSavedAt).toBe(now)
      })

      it('after save, the next commit appends a second entry above the baseline', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const initialNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Initial' } },
        ]

        // Setup: has history, then save
        useWorkflowStore.setState({
          nodes: initialNodes,
          edges: [],
          history: [{ nodes: [], edges: [], timestamp: now - 1000 }],
          historyIndex: 0,
          isDirty: true,
        })

        useWorkflowStore.getState().markSaved()

        // Verify baseline-seeded clean state after save
        let state = useWorkflowStore.getState()
        expect(state.history.length).toBe(1)
        expect(state.history[0].isInitialState).toBe(true)
        expect(state.historyIndex).toBe(0)

        // Make a new edit and commit to history
        useWorkflowStore.getState().commitHistory('First edit')

        // Should have baseline + new commit = 2 entries
        state = useWorkflowStore.getState()
        expect(state.history.length).toBe(2)
        expect(state.historyIndex).toBe(1)
        expect(state.canUndo()).toBe(true)
      })
    })

    describe('Discard Changes', () => {
      /**
       * Per design: "Discard changes | Restores last saved state, clears both stacks"
       */
      it('reset seeds an empty baseline (canvas equals history[0])', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Modified' } },
          ],
          edges: [],
          history: [
            { nodes: [], edges: [], timestamp: now - 2000 },
            { nodes: [], edges: [], timestamp: now - 1000 },
          ],
          historyIndex: 1,
          isDirty: true,
        })

        useWorkflowStore.getState().reset()

        const state = useWorkflowStore.getState()
        // Post-state baseline model: reset floors to a single empty baseline,
        // not to history=[].
        expect(state.history.length).toBe(1)
        expect(state.history[0].isInitialState).toBe(true)
        expect(state.history[0].nodes).toEqual([])
        expect(state.historyIndex).toBe(0)
        expect(state.isDirty).toBe(false)
        expect(state.canUndo()).toBe(false)
        expect(state.canRedo()).toBe(false)
      })

      it('reset restores empty state (last saved baseline)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Node' } },
          ],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: ['edge-1'],
          isDirty: true,
        })

        useWorkflowStore.getState().reset()

        expect(useWorkflowStore.getState().nodes).toEqual([])
        expect(useWorkflowStore.getState().edges).toEqual([])
        expect(useWorkflowStore.getState().selectedNodeIds).toEqual([])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([])
      })
    })

    describe('Dirty State Tracking', () => {
      /**
       * Per design dirty state table:
       * - Entity opened: Clean (false)
       * - Any tracked operation: Dirty (true)
       * - Save completed: Clean (false)
       * - Discard changes: Clean (false)
       * - Undo to initial state: Clean (false)
       */
      it('starts clean when reset', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({ isDirty: true })
        useWorkflowStore.getState().reset()

        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('becomes dirty on addNode operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'New' },
        })

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on removeNode operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
          ],
          edges: [],
        })
        // Derived dirty compares against the saved baseline.
        useWorkflowStore.getState().markSaved()

        useWorkflowStore.getState().removeNode('node-1')

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on updateNode operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Original' } },
          ],
          edges: [],
          isDirty: false,
        })

        useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on addEdge operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

        useWorkflowStore.getState().addEdge({
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        })

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on removeEdge operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
        })
        // Derived dirty compares against the saved baseline.
        useWorkflowStore.getState().markSaved()

        useWorkflowStore.getState().removeEdge('edge-1')

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on paste operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          clipboard: {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
            ],
            edges: [],
          },
          isDirty: false,
        })

        useWorkflowStore.getState().paste()

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on cut operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
        })
        // Derived dirty compares against the saved baseline.
        useWorkflowStore.getState().markSaved()

        useWorkflowStore.getState().cut()

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on duplicate operation', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
          isDirty: false,
        })

        useWorkflowStore.getState().duplicate()

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on undo onto a non-baseline entry', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node = (id: string) => ({
          id,
          type: 'block' as const,
          position: { x: 0, y: 0 },
          data: { label: id },
        })

        useWorkflowStore.setState({ nodes: [node('n1')], edges: [] })
        useWorkflowStore.getState().markSaved()
        useWorkflowStore.getState().addNode(node('n2'))
        useWorkflowStore.getState().addNode(node('n3'))

        useWorkflowStore.getState().undo()

        // Restored [n1, n2] diverges from the saved baseline [n1]: dirty.
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes dirty on redo onto a non-baseline entry', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const node = (id: string) => ({
          id,
          type: 'block' as const,
          position: { x: 0, y: 0 },
          data: { label: id },
        })

        useWorkflowStore.setState({ nodes: [node('n1')], edges: [] })
        useWorkflowStore.getState().markSaved()
        useWorkflowStore.getState().addNode(node('n2'))
        useWorkflowStore.getState().undo()
        expect(useWorkflowStore.getState().isDirty).toBe(false)

        useWorkflowStore.getState().redo()

        // Redone [n1, n2] diverges from the saved baseline [n1]: dirty.
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('becomes clean after save (markSaved)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history: [],
          historyIndex: -1,
          isDirty: true,
        })

        useWorkflowStore.getState().markSaved()

        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('becomes clean after discard (reset)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
          ],
          edges: [],
          isDirty: true,
        })

        useWorkflowStore.getState().reset()

        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      /**
       * Per design: "Undo to initial state: Clean (false)"
       * When user undoes all the way back to the initial saved state,
       * isDirty should become false as there are no uncommitted changes.
       */
      it('becomes clean when undoing to initial saved state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        // Initial state represents the saved baseline
        const initialState: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Initial' } },
        ]

        // Current state after modifications
        const modifiedState: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Modified' } },
        ]

        // Post-state baseline model: history holds full snapshots of every
        // state. The baseline carries isInitialState; current state lives at
        // history[historyIndex].
        useWorkflowStore.setState({
          nodes: modifiedState,
          edges: [],
          history: [
            { nodes: initialState, edges: [], timestamp: now - 1000, isInitialState: true },
            { nodes: modifiedState, edges: [], timestamp: now, operationDescription: 'Move' },
          ],
          historyIndex: 1,
          isDirty: true,
          lastSavedAt: now - 2000,
        })

        // Verify dirty before undo
        expect(useWorkflowStore.getState().isDirty).toBe(true)

        // Undo back to initial saved state
        useWorkflowStore.getState().undo()

        // Should be at the baseline
        expect(useWorkflowStore.getState().historyIndex).toBe(0)
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Initial')

        // isDirty should be false since the entry we landed on is isInitialState
        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('remains dirty when undoing but not reaching initial state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const state0: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'State 0' } },
        ]
        const state1: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 50, y: 50 }, data: { label: 'State 1' } },
        ]
        const state2: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'State 2' } },
        ]

        useWorkflowStore.setState({
          nodes: state2,
          edges: [],
          history: [
            { nodes: state0, edges: [], timestamp: now - 2000, isInitialState: true },
            { nodes: state1, edges: [], timestamp: now - 1000 },
            { nodes: state2, edges: [], timestamp: now },
          ],
          historyIndex: 2,
          isDirty: true,
        })

        // Undo once (to state1, not initial)
        useWorkflowStore.getState().undo()

        // Should still be dirty since we haven't reached initial state
        expect(useWorkflowStore.getState().historyIndex).toBe(1)
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })
    })

    describe('History Stack Limits', () => {
      /**
       * Per design: "Maximum depth | 50 operations"
       */
      it('respects maximum history depth of 50', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        // Create a full history stack
        const history: HistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
          nodes: [],
          edges: [],
          timestamp: now - (50 - i) * 1000,
        }))

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Current' } },
          ],
          edges: [],
          history,
          historyIndex: 49,
          maxHistoryLength: 50,
        })

        // Push another entry
        useWorkflowStore.getState().commitHistory()

        // Should still be at max 50, oldest entry removed
        expect(useWorkflowStore.getState().history.length).toBe(50)
      })

      it('removes oldest entries when exceeding max depth', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        // Create history with identifiable first entry
        const firstTimestamp = now - 50000
        const history: HistoryEntry[] = [
          { nodes: [{ id: 'first', type: 'block', position: { x: 0, y: 0 }, data: { label: 'First' } }], edges: [], timestamp: firstTimestamp },
          ...Array.from({ length: 49 }, (_, i) => ({
            nodes: [],
            edges: [],
            timestamp: now - (49 - i) * 1000,
          })),
        ]

        useWorkflowStore.setState({
          nodes: [
            { id: 'current', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Current' } },
          ],
          edges: [],
          history,
          historyIndex: 49,
          maxHistoryLength: 50,
        })

        // Verify first entry exists
        expect(useWorkflowStore.getState().history[0].nodes[0]?.id).toBe('first')

        // Push new entry
        useWorkflowStore.getState().commitHistory()

        // First entry should be removed (oldest)
        expect(useWorkflowStore.getState().history[0].nodes[0]?.id).not.toBe('first')
        expect(useWorkflowStore.getState().history.length).toBe(50)
      })
    })

    describe('History Stack Behavior', () => {
      /**
       * Per design: "Edit operation | Pushes current state onto undo stack, clears redo stack"
       */
      it('commitHistory truncates future history after undo', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const history: HistoryEntry[] = [
          { nodes: [], edges: [], timestamp: now - 3000 },
          { nodes: [], edges: [], timestamp: now - 2000 },
          { nodes: [], edges: [], timestamp: now - 1000 }, // This will be lost
        ]

        useWorkflowStore.setState({
          nodes: [
            { id: 'new', type: 'block', position: { x: 0, y: 0 }, data: { label: 'New change' } },
          ],
          edges: [],
          history,
          historyIndex: 1, // User undid once, index 2 is the redoable tail
        })

        // User makes new edit
        useWorkflowStore.getState().commitHistory()

        // Tail (index 2) dropped; current state appended as new entry 2
        expect(useWorkflowStore.getState().history.length).toBe(3)
        expect(useWorkflowStore.getState().historyIndex).toBe(2)
        // Cannot redo anymore
        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })

      it('undo enables redo (canRedo becomes true after one undo)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const previousNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
        ]
        const currentNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ]

        useWorkflowStore.setState({
          nodes: currentNodes,
          edges: [],
          history: [
            { nodes: previousNodes, edges: [], timestamp: now - 2000, isInitialState: true },
            { nodes: currentNodes, edges: [], timestamp: now - 1000 },
          ],
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        // After undo (index 1 -> 0), redo is enabled and points back to current
        expect(useWorkflowStore.getState().canRedo()).toBe(true)
        expect(useWorkflowStore.getState().historyIndex).toBe(0)
      })

      it('redo restores next state from history', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const previousNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
        ]
        const nextNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Next' } },
        ]

        useWorkflowStore.setState({
          nodes: previousNodes,
          edges: [],
          history: [
            { nodes: previousNodes, edges: [], timestamp: now - 2000 },
            { nodes: nextNodes, edges: [], timestamp: now - 1000 },
          ],
          historyIndex: 0, // After undo
        })

        useWorkflowStore.getState().redo()

        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Next')
        expect(useWorkflowStore.getState().historyIndex).toBe(1)
      })
    })

    describe('Button State Availability', () => {
      /**
       * Per design button states table
       */
      it('canUndo returns false with empty history stack', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          history: [],
          historyIndex: -1,
        })

        expect(useWorkflowStore.getState().canUndo()).toBe(false)
      })

      it('canUndo returns false at beginning of history (index -1)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        // History model: historyIndex = -1 means no undo available
        // historyIndex = 0 means there's one entry to undo to
        useWorkflowStore.setState({
          history: [],
          historyIndex: -1,
        })

        expect(useWorkflowStore.getState().canUndo()).toBe(false)
      })

      it('canUndo returns true when history entries exist before current', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          history: [
            { nodes: [], edges: [], timestamp: now - 1000 },
            { nodes: [], edges: [], timestamp: now },
          ],
          historyIndex: 1,
        })

        expect(useWorkflowStore.getState().canUndo()).toBe(true)
      })

      it('canRedo returns false with empty history stack', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          history: [],
          historyIndex: -1,
        })

        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })

      it('canRedo returns false at end of history', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          history: [
            { nodes: [], edges: [], timestamp: now - 1000 },
            { nodes: [], edges: [], timestamp: now },
          ],
          historyIndex: 1, // At end
        })

        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })

      it('canRedo returns true when future history exists', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          history: [
            { nodes: [], edges: [], timestamp: now - 1000 },
            { nodes: [], edges: [], timestamp: now },
          ],
          historyIndex: 0, // Not at end
        })

        expect(useWorkflowStore.getState().canRedo()).toBe(true)
      })

      it('both canUndo and canRedo return false after save', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        useWorkflowStore.setState({
          nodes: [],
          edges: [],
          history: [
            { nodes: [], edges: [], timestamp: now - 2000 },
            { nodes: [], edges: [], timestamp: now - 1000 },
          ],
          historyIndex: 0, // Can undo and redo
          isDirty: true,
        })

        // Verify both are available before save
        expect(useWorkflowStore.getState().canRedo()).toBe(true)

        useWorkflowStore.getState().markSaved()

        // Both should be unavailable after save
        expect(useWorkflowStore.getState().canUndo()).toBe(false)
        expect(useWorkflowStore.getState().canRedo()).toBe(false)
      })
    })

    describe('Selection State Preservation', () => {
      /**
       * Per design: "Focus remains stable during undo/redo"
       * Selection should not be affected by undo/redo operations
       */
      it('undo does not modify selection state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          history: [
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
              ],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
              ],
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        // Selection should remain unchanged
        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1'])
      })

      it('redo does not modify selection state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          history: [
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
              ],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Next' } },
              ],
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 0,
        })

        useWorkflowStore.getState().redo()

        // Selection should remain unchanged
        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1'])
      })
    })

    describe('Viewport State Preservation', () => {
      /**
       * Viewport (zoom, pan) should not be tracked in undo history
       * per design: "View preferences | Zoom level, collapsed sections | No (not content changes)"
       */
      it('undo does not modify viewport state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const currentViewport = { x: 200, y: 150, zoom: 1.5 }

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
          ],
          edges: [],
          viewport: currentViewport,
          history: [
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
              ],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
              ],
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        // Viewport should remain unchanged
        expect(useWorkflowStore.getState().viewport).toEqual(currentViewport)
      })

      it('redo does not modify viewport state', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const currentViewport = { x: 100, y: 50, zoom: 0.75 }

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
          ],
          edges: [],
          viewport: currentViewport,
          history: [
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
              ],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Next' } },
              ],
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 0,
        })

        useWorkflowStore.getState().redo()

        // Viewport should remain unchanged
        expect(useWorkflowStore.getState().viewport).toEqual(currentViewport)
      })
    })

    describe('Edge Cases', () => {
      it('undo at empty history does nothing', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        const initialNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ]

        useWorkflowStore.setState({
          nodes: initialNodes,
          edges: [],
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().undo()

        // State should be unchanged
        expect(useWorkflowStore.getState().nodes).toEqual(initialNodes)
        expect(useWorkflowStore.getState().historyIndex).toBe(-1)
      })

      it('redo at empty history does nothing', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        const initialNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ]

        useWorkflowStore.setState({
          nodes: initialNodes,
          edges: [],
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().redo()

        // State should be unchanged
        expect(useWorkflowStore.getState().nodes).toEqual(initialNodes)
        expect(useWorkflowStore.getState().historyIndex).toBe(-1)
      })

      it('consecutive undos walk back to baseline then refuse', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const state0: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'State 0' } },
        ]
        const state1: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 50, y: 50 }, data: { label: 'State 1' } },
        ]
        const state2: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'State 2' } },
        ]

        // Post-state baseline model: every state in the timeline lives in
        // history. canvas == history[historyIndex]. state0 is the baseline.
        useWorkflowStore.setState({
          nodes: state2,
          edges: [],
          history: [
            { nodes: state0, edges: [], timestamp: now - 2000, isInitialState: true },
            { nodes: state1, edges: [], timestamp: now - 1000, operationDescription: 'op1' },
            { nodes: state2, edges: [], timestamp: now, operationDescription: 'op2' },
          ],
          historyIndex: 2,
        })

        useWorkflowStore.getState().undo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 1')
        expect(useWorkflowStore.getState().historyIndex).toBe(1)

        useWorkflowStore.getState().undo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 0')
        expect(useWorkflowStore.getState().historyIndex).toBe(0)

        // One more undo at the baseline should do nothing
        useWorkflowStore.getState().undo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 0')
        expect(useWorkflowStore.getState().historyIndex).toBe(0)
      })

      it('consecutive redos work correctly', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const state0: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'State 0' } },
        ]
        const state1: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 50, y: 50 }, data: { label: 'State 1' } },
        ]
        const state2: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'State 2' } },
        ]

        useWorkflowStore.setState({
          nodes: state0,
          edges: [],
          history: [
            { nodes: state0, edges: [], timestamp: now - 2000 },
            { nodes: state1, edges: [], timestamp: now - 1000 },
            { nodes: state2, edges: [], timestamp: now },
          ],
          historyIndex: 0,
        })

        useWorkflowStore.getState().redo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 1')

        useWorkflowStore.getState().redo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 2')

        // One more redo should do nothing (at end)
        useWorkflowStore.getState().redo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('State 2')
        expect(useWorkflowStore.getState().historyIndex).toBe(2)
      })

      it('undo followed by redo is a perfect round-trip (click-twice regression)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()

        const previousNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
        ]
        const currentNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ]

        // One undo + one redo lands exactly back on the starting state - two operations,
        // perfect round-trip.
        useWorkflowStore.setState({
          nodes: currentNodes,
          edges: [],
          history: [
            { nodes: previousNodes, edges: [], timestamp: now - 1000, isInitialState: true },
            { nodes: currentNodes, edges: [], timestamp: now, operationDescription: 'op' },
          ],
          historyIndex: 1,
        })

        // ONE undo flips to Previous
        useWorkflowStore.getState().undo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Previous')
        expect(useWorkflowStore.getState().historyIndex).toBe(0)

        // ONE redo flips back to Current
        useWorkflowStore.getState().redo()
        expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Current')
        expect(useWorkflowStore.getState().historyIndex).toBe(1)
      })
    })

    describe('State Conflict Error Handling', () => {
      /**
       * Per design: "If an undo operation fails due to state conflict,
       * an error toast notifies the user and the history stack resets"
       */
      it('handles undo state conflict gracefully', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        // Post-state baseline model: undo reads history[historyIndex - 1].
        // The corrupt entry must live at history[0] and historyIndex must
        // be >= 1 so the undo doesn't refuse before reaching the guard.
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
          ],
          edges: [],
          history: [
            {
              nodes: null as unknown as NodeType[], // Corrupt baseline target
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
              ],
              edges: [],
              timestamp: now,
              operationDescription: 'op',
            },
          ],
          historyIndex: 1, // Undo will read history[0] which is invalid
          lastError: null,
        })

        // Undo should handle the error gracefully
        useWorkflowStore.getState().undo()

        // Should set an error state for toast notification
        expect(useWorkflowStore.getState().lastError).toBeTruthy()
        expect(useWorkflowStore.getState().lastError?.type).toBe('undo_conflict')
      })

      it('resets history stack on state conflict', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
          ],
          edges: [],
          history: [
            {
              nodes: null as unknown as NodeType[],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
              ],
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        // History should be cleared after conflict
        expect(useWorkflowStore.getState().history).toEqual([])
        expect(useWorkflowStore.getState().historyIndex).toBe(-1)
      })

      it('preserves current state on conflict (does not corrupt data)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        const currentNodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ]

        useWorkflowStore.setState({
          nodes: currentNodes,
          edges: [],
          history: [
            {
              nodes: null as unknown as NodeType[],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: currentNodes,
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 1,
        })

        useWorkflowStore.getState().undo()

        // Current state should be preserved (canvas not rewound)
        expect(useWorkflowStore.getState().nodes).toEqual(currentNodes)
      })

      it('clears error after acknowledgement', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.setState({
          lastError: { type: 'undo_conflict', message: 'Undo failed due to state conflict' },
        })

        useWorkflowStore.getState().clearError()

        expect(useWorkflowStore.getState().lastError).toBeNull()
      })

      it('handles redo state conflict gracefully', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const now = Date.now()
        vi.setSystemTime(now)

        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
          ],
          edges: [],
          history: [
            {
              nodes: [
                { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
              ],
              edges: [],
              timestamp: now - 1000,
            },
            {
              nodes: null as unknown as NodeType[], // Invalid state in future
              edges: [],
              timestamp: now,
            },
          ],
          historyIndex: 0,
          lastError: null,
        })

        useWorkflowStore.getState().redo()

        // Should set error and reset history
        expect(useWorkflowStore.getState().lastError).toBeTruthy()
        expect(useWorkflowStore.getState().lastError?.type).toBe('redo_conflict')
        expect(useWorkflowStore.getState().history).toEqual([])
      })
    })
  })

  describe('Reset', () => {
    it('resets to initial state', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [{ id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } }],
        edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
        selectedNodeIds: ['node-1'],
        isDirty: true,
      })

      useWorkflowStore.getState().reset()

      const state = useWorkflowStore.getState()
      expect(state.nodes).toEqual([])
      expect(state.edges).toEqual([])
      expect(state.selectedNodeIds).toEqual([])
      expect(state.isDirty).toBe(false)
    })

    it('starts a new canvas generation on every reset, so a test load in flight sees its test closed', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const before = useWorkflowStore.getState().canvasGeneration
      expect(before).toEqual(expect.any(Number))

      useWorkflowStore.getState().reset()
      useWorkflowStore.getState().reset()

      expect(useWorkflowStore.getState().canvasGeneration).toBe(before + 2)
    })
  })

  describe('setEdges', () => {
    it('sets all edges', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

      const edges: EdgeType[] = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
        { id: 'edge-2', source: 'node-2', target: 'node-3' },
      ]

      useWorkflowStore.getState().setEdges(edges)

      expect(useWorkflowStore.getState().edges).toEqual(edges)
    })

    it('replaces existing edges', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [],
        edges: [{ id: 'old-edge', source: 'a', target: 'b' }],
        isDirty: false,
      })

      useWorkflowStore.getState().setEdges([{ id: 'new-edge', source: 'c', target: 'd' }])

      expect(useWorkflowStore.getState().edges).toHaveLength(1)
      expect(useWorkflowStore.getState().edges[0].id).toBe('new-edge')
    })

    it('marks state as dirty', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

      useWorkflowStore.getState().setEdges([{ id: 'edge-1', source: 'a', target: 'b' }])

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it('does not mark state as dirty when skipDirty is true', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

      useWorkflowStore.getState().setEdges([{ id: 'edge-1', source: 'a', target: 'b' }], {
        skipDirty: true,
      })

      expect(useWorkflowStore.getState().isDirty).toBe(false)
      expect(useWorkflowStore.getState().edges).toHaveLength(1)
    })

    it('handles empty edges array', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [],
        edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
        isDirty: false,
      })

      useWorkflowStore.getState().setEdges([])

      expect(useWorkflowStore.getState().edges).toEqual([])
    })

    it('supports edge properties like animated and label', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false })

      const edges: EdgeType[] = [
        {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
          animated: true,
          label: 'Connection',
          sourceHandle: 'output',
          targetHandle: 'input',
        },
      ]

      useWorkflowStore.getState().setEdges(edges)

      const storedEdge = useWorkflowStore.getState().edges[0]
      expect(storedEdge.animated).toBe(true)
      expect(storedEdge.label).toBe('Connection')
      expect(storedEdge.sourceHandle).toBe('output')
      expect(storedEdge.targetHandle).toBe('input')
    })
  })

  describe('fitView', () => {
    it('adjusts viewport to fit all nodes', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const nodes: NodeType[] = [
        { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        { id: 'node-2', type: 'block', position: { x: 500, y: 300 }, data: { label: 'Node 2' } },
        { id: 'node-3', type: 'block', position: { x: -200, y: 400 }, data: { label: 'Node 3' } },
      ]

      useWorkflowStore.setState({
        nodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })

      useWorkflowStore.getState().fitView()

      const viewport = useWorkflowStore.getState().viewport
      // Viewport should be adjusted to show all nodes
      // The exact values depend on implementation, but zoom should be adjusted
      expect(viewport).toBeDefined()
      // fitView typically adjusts zoom to fit content
      expect(viewport.zoom).toBeGreaterThan(0)
      expect(viewport.zoom).toBeLessThanOrEqual(2.0) // Max zoom
    })

    it('handles empty canvas', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        viewport: { x: 100, y: 100, zoom: 0.5 },
      })

      // Should not throw on empty canvas
      expect(() => useWorkflowStore.getState().fitView()).not.toThrow()
    })

    it('handles single node', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Node 1' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 0.5 },
      })

      useWorkflowStore.getState().fitView()

      // Should adjust viewport to center on the single node
      const viewport = useWorkflowStore.getState().viewport
      expect(viewport).toBeDefined()
    })

    it('respects padding option', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 200, y: 200 }, data: { label: 'Node 2' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })

      // fitView with padding
      useWorkflowStore.getState().fitView({ padding: 0.1 })

      const viewport = useWorkflowStore.getState().viewport
      expect(viewport).toBeDefined()
    })

    it('handles nodes at the same position (zero width/height)', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      // All nodes at the exact same position - results in zero width and height
      useWorkflowStore.setState({
        nodes: [
          {
            id: 'node-1',
            type: 'block',
            position: { x: 100, y: 100 },
            data: { label: 'Node 1' },
            width: 0,
            height: 0,
          },
          {
            id: 'node-2',
            type: 'block',
            position: { x: 100, y: 100 },
            data: { label: 'Node 2' },
            width: 0,
            height: 0,
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 0.5 },
      })

      // Should not throw and should handle division by zero gracefully
      expect(() => useWorkflowStore.getState().fitView()).not.toThrow()

      const viewport = useWorkflowStore.getState().viewport
      expect(viewport).toBeDefined()
      expect(viewport.zoom).toBeGreaterThan(0)
      expect(viewport.zoom).toBeLessThanOrEqual(2.0) // Max zoom
    })
  })

  describe('requestFitView and acknowledgeFitView', () => {
    it('requestFitView sets fitViewRequested flag', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        fitViewRequested: false,
        fitViewOptions: null,
      })

      useWorkflowStore.getState().requestFitView()

      expect(useWorkflowStore.getState().fitViewRequested).toBe(true)
      expect(useWorkflowStore.getState().fitViewOptions).toBeNull()
    })

    it('requestFitView stores options', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        fitViewRequested: false,
        fitViewOptions: null,
      })

      useWorkflowStore.getState().requestFitView({ padding: 0.5 })

      expect(useWorkflowStore.getState().fitViewRequested).toBe(true)
      expect(useWorkflowStore.getState().fitViewOptions).toEqual({ padding: 0.5 })
    })

    it('acknowledgeFitView clears fitViewRequested flag', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        fitViewRequested: true,
        fitViewOptions: { padding: 0.3 },
      })

      useWorkflowStore.getState().acknowledgeFitView()

      expect(useWorkflowStore.getState().fitViewRequested).toBe(false)
      expect(useWorkflowStore.getState().fitViewOptions).toBeNull()
    })

    it('reset does NOT set fitViewRequested (callers manage fitView explicitly)', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        fitViewRequested: true,
        fitViewOptions: { padding: 0.5 },
      })

      useWorkflowStore.getState().reset()

      // Reset should NOT request fitView - callers are responsible for requesting
      // fitView after loading new content, preventing premature canvas readiness
      expect(useWorkflowStore.getState().fitViewRequested).toBe(false)
      expect(useWorkflowStore.getState().fitViewOptions).toBeNull()
    })
  })

  describe('requestFocus and acknowledgeFocus', () => {
    it('requestFocus sets focusRequested flag and focusNodeId', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        focusRequested: false,
        focusNodeId: null,
        focusOptions: null,
      } as never)

      const store = useWorkflowStore.getState() as unknown as {
        requestFocus: (nodeId: string, options?: { zoom?: number; duration?: number }) => void
      }
      store.requestFocus('n1')

      const state = useWorkflowStore.getState() as unknown as {
        focusRequested: boolean
        focusNodeId: string | null
        focusOptions: { zoom?: number; duration?: number } | null
      }
      expect(state.focusRequested).toBe(true)
      expect(state.focusNodeId).toBe('n1')
      expect(state.focusOptions).toBeNull()
    })

    it('requestFocus stores options', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        focusRequested: false,
        focusNodeId: null,
        focusOptions: null,
      } as never)

      const store = useWorkflowStore.getState() as unknown as {
        requestFocus: (nodeId: string, options?: { zoom?: number; duration?: number }) => void
      }
      store.requestFocus('n1', { zoom: 2, duration: 300 })

      const state = useWorkflowStore.getState() as unknown as {
        focusRequested: boolean
        focusNodeId: string | null
        focusOptions: { zoom?: number; duration?: number } | null
      }
      expect(state.focusRequested).toBe(true)
      expect(state.focusNodeId).toBe('n1')
      expect(state.focusOptions).toEqual({ zoom: 2, duration: 300 })
    })

    it('acknowledgeFocus clears the focus request', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        focusRequested: true,
        focusNodeId: 'n1',
        focusOptions: { zoom: 2, duration: 300 },
      } as never)

      const store = useWorkflowStore.getState() as unknown as {
        acknowledgeFocus: () => void
      }
      store.acknowledgeFocus()

      const state = useWorkflowStore.getState() as unknown as {
        focusRequested: boolean
        focusNodeId: string | null
        focusOptions: { zoom?: number; duration?: number } | null
      }
      expect(state.focusRequested).toBe(false)
      expect(state.focusNodeId).toBeNull()
      expect(state.focusOptions).toBeNull()
    })

    it('reset clears focusRequested and focusNodeId', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({
        focusRequested: true,
        focusNodeId: 'n1',
        focusOptions: { zoom: 2, duration: 300 },
      } as never)

      useWorkflowStore.getState().reset()

      const state = useWorkflowStore.getState() as unknown as {
        focusRequested: boolean
        focusNodeId: string | null
        focusOptions: { zoom?: number; duration?: number } | null
      }
      expect(state.focusRequested).toBe(false)
      expect(state.focusNodeId).toBeNull()
      expect(state.focusOptions).toBeNull()
    })
  })

  describe('mirrorActiveNodeId', () => {
    it('initializes as null', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      const state = useWorkflowStore.getState() as unknown as { mirrorActiveNodeId: string | null }
      expect(state.mirrorActiveNodeId).toBeNull()
    })

    it('setMirrorActiveNodeId stores the id', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      const store = useWorkflowStore.getState() as unknown as {
        setMirrorActiveNodeId: (id: string | null) => void
      }
      store.setMirrorActiveNodeId('n1')

      const state = useWorkflowStore.getState() as unknown as { mirrorActiveNodeId: string | null }
      expect(state.mirrorActiveNodeId).toBe('n1')
    })

    it('setMirrorActiveNodeId(null) clears the id', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ mirrorActiveNodeId: 'n1' } as never)

      const store = useWorkflowStore.getState() as unknown as {
        setMirrorActiveNodeId: (id: string | null) => void
      }
      store.setMirrorActiveNodeId(null)

      const state = useWorkflowStore.getState() as unknown as { mirrorActiveNodeId: string | null }
      expect(state.mirrorActiveNodeId).toBeNull()
    })

    it('reset clears mirrorActiveNodeId', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ mirrorActiveNodeId: 'n1' } as never)

      useWorkflowStore.getState().reset()

      const state = useWorkflowStore.getState() as unknown as { mirrorActiveNodeId: string | null }
      expect(state.mirrorActiveNodeId).toBeNull()
    })
  })

  describe('signalMirrorChange (Follow Changes / pulse target)', () => {
    interface ChangeState {
      mirrorLastChangeNodeId: string | null
      mirrorChangeTick: number
      signalMirrorChange: (id: string | null) => void
    }

    it('initializes with null id and tick 0', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      const state = useWorkflowStore.getState() as unknown as ChangeState
      expect(state.mirrorLastChangeNodeId).toBeNull()
      expect(state.mirrorChangeTick).toBe(0)
    })

    it('a non-null change sets the id and bumps the tick every time (same id re-fires)', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const store = useWorkflowStore.getState() as unknown as ChangeState

      store.signalMirrorChange('n1')
      let state = useWorkflowStore.getState() as unknown as ChangeState
      expect(state.mirrorLastChangeNodeId).toBe('n1')
      expect(state.mirrorChangeTick).toBe(1)

      // Same block changing again still bumps the tick.
      store.signalMirrorChange('n1')
      state = useWorkflowStore.getState() as unknown as ChangeState
      expect(state.mirrorLastChangeNodeId).toBe('n1')
      expect(state.mirrorChangeTick).toBe(2)
    })

    it('a null (metadata/var) frame clears the id without bumping the tick', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const store = useWorkflowStore.getState() as unknown as ChangeState
      store.signalMirrorChange('n1')
      const tickBefore = (useWorkflowStore.getState() as unknown as ChangeState).mirrorChangeTick

      store.signalMirrorChange(null)

      const state = useWorkflowStore.getState() as unknown as ChangeState
      expect(state.mirrorLastChangeNodeId).toBeNull()
      expect(state.mirrorChangeTick).toBe(tickBefore)
    })

    it('reset clears the id and tick', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n1', mirrorChangeTick: 5 } as never)

      useWorkflowStore.getState().reset()

      const state = useWorkflowStore.getState() as unknown as ChangeState
      expect(state.mirrorLastChangeNodeId).toBeNull()
      expect(state.mirrorChangeTick).toBe(0)
    })
  })

  describe('setDirty', () => {
    it('setDirty(true) marks the canvas dirty', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ isDirty: false })

      const store = useWorkflowStore.getState() as unknown as { setDirty: (dirty: boolean) => void }
      store.setDirty(true)

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it('setDirty(false) marks the canvas clean', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      useWorkflowStore.setState({ isDirty: true })

      const store = useWorkflowStore.getState() as unknown as { setDirty: (dirty: boolean) => void }
      store.setDirty(false)

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })
  })

  describe('Computed State / Derived Selectors', () => {
    describe('getSelectedNodes', () => {
      it('returns only selected nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]

        useWorkflowStore.setState({
          nodes,
          edges: [],
          selectedNodeIds: ['node-1', 'node-3'],
        })

        const selected = useWorkflowStore.getState().getSelectedNodes()
        expect(selected).toHaveLength(2)
        expect(selected.map((n) => n.id)).toEqual(['node-1', 'node-3'])
      })
    })

    describe('getSelectedEdges', () => {
      it('returns only selected edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
        ]

        useWorkflowStore.setState({
          nodes: [],
          edges,
          selectedEdgeIds: ['edge-1'],
        })

        const selected = useWorkflowStore.getState().getSelectedEdges()
        expect(selected).toHaveLength(1)
        expect(selected[0].id).toBe('edge-1')
      })
    })

    describe('getNodeCount', () => {
      it('returns total node count', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          ],
          edges: [],
        })

        expect(useWorkflowStore.getState().getNodeCount()).toBe(2)
      })
    })

    describe('getEdgeCount', () => {
      it('returns total edge count', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
            { id: 'edge-2', source: 'node-2', target: 'node-3' },
            { id: 'edge-3', source: 'node-1', target: 'node-3' },
          ],
        })

        expect(useWorkflowStore.getState().getEdgeCount()).toBe(3)
      })
    })

    describe('getNodesByType', () => {
      it('returns nodes filtered by type', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            { id: 'node-2', type: 'control', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
            {
              id: 'node-4',
              type: 'parallel',
              position: { x: 300, y: 0 },
              data: { label: 'Node 4' },
            },
          ],
          edges: [],
        })

        const blocks = useWorkflowStore.getState().getNodesByType('block')
        expect(blocks).toHaveLength(2)
        expect(blocks.every((n) => n.type === 'block')).toBe(true)

        const controls = useWorkflowStore.getState().getNodesByType('control')
        expect(controls).toHaveLength(1)
      })
    })

    describe('getConnectedNodes', () => {
      it('returns nodes connected to a specific node via outgoing edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
            { id: 'node-4', type: 'block', position: { x: 300, y: 0 }, data: { label: 'Node 4' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
            { id: 'edge-2', source: 'node-1', target: 'node-3' },
            { id: 'edge-3', source: 'node-3', target: 'node-4' },
          ],
        })

        const connected = useWorkflowStore.getState().getConnectedNodes('node-1')
        expect(connected).toHaveLength(2)
        expect(connected.map((n) => n.id).sort()).toEqual(['node-2', 'node-3'])
      })

      it('returns nodes connected via incoming edges (as target)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' }, // node-2 is target
            { id: 'edge-2', source: 'node-3', target: 'node-2' }, // node-2 is target from node-3
          ],
        })

        // Get connected nodes for node-2 which is a target (has incoming edges)
        const connected = useWorkflowStore.getState().getConnectedNodes('node-2')
        expect(connected).toHaveLength(2)
        expect(connected.map((n) => n.id).sort()).toEqual(['node-1', 'node-3'])
      })

      it('returns nodes connected via both incoming and outgoing edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
            { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' }, // node-2 is target
            { id: 'edge-2', source: 'node-2', target: 'node-3' }, // node-2 is source
          ],
        })

        // node-2 has both incoming (from node-1) and outgoing (to node-3) edges
        const connected = useWorkflowStore.getState().getConnectedNodes('node-2')
        expect(connected).toHaveLength(2)
        expect(connected.map((n) => n.id).sort()).toEqual(['node-1', 'node-3'])
      })
    })

    describe('getEdgesBySource', () => {
      it('returns edges where given node is the source', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
            { id: 'edge-2', source: 'node-1', target: 'node-3' },
            { id: 'edge-3', source: 'node-2', target: 'node-4' },
          ],
        })

        const edges = useWorkflowStore.getState().getEdgesBySource('node-1')
        expect(edges).toHaveLength(2)
        expect(edges.map((e) => e.id).sort()).toEqual(['edge-1', 'edge-2'])
      })

      it('returns empty array when node has no outgoing edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
        })

        const edges = useWorkflowStore.getState().getEdgesBySource('node-2')
        expect(edges).toHaveLength(0)
      })
    })

    describe('getEdgesByTarget', () => {
      it('returns edges where given node is the target', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-3' },
            { id: 'edge-2', source: 'node-2', target: 'node-3' },
            { id: 'edge-3', source: 'node-1', target: 'node-2' },
          ],
        })

        const edges = useWorkflowStore.getState().getEdgesByTarget('node-3')
        expect(edges).toHaveLength(2)
        expect(edges.map((e) => e.id).sort()).toEqual(['edge-1', 'edge-2'])
      })

      it('returns empty array when node has no incoming edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
        })

        const edges = useWorkflowStore.getState().getEdgesByTarget('node-1')
        expect(edges).toHaveLength(0)
      })
    })

    describe('hasUnsavedChanges', () => {
      it('returns true when dirty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ isDirty: true })

        expect(useWorkflowStore.getState().hasUnsavedChanges()).toBe(true)
      })

      it('returns false when clean', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ isDirty: false })

        expect(useWorkflowStore.getState().hasUnsavedChanges()).toBe(false)
      })
    })

    describe('isNodeSelected', () => {
      it('returns true for selected node', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-1', 'node-2'],
        })

        expect(useWorkflowStore.getState().isNodeSelected('node-1')).toBe(true)
      })

      it('returns false for unselected node', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-1'],
        })

        expect(useWorkflowStore.getState().isNodeSelected('node-3')).toBe(false)
      })
    })

    describe('selectNode', () => {
      it('replaces selection with single node by default', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-2', 'node-3'],
        })

        useWorkflowStore.getState().selectNode('node-1')

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1'])
      })

      it('adds to selection when addToSelection is true', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-2'],
        })

        useWorkflowStore.getState().selectNode('node-1', { addToSelection: true })

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-2', 'node-1'])
      })

      it('does not duplicate when adding already selected node', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-1', 'node-2'],
        })

        useWorkflowStore.getState().selectNode('node-1', { addToSelection: true })

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1', 'node-2'])
      })
    })

    describe('deselectAll', () => {
      it('clears both node and edge selections', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          selectedNodeIds: ['node-1', 'node-2'],
          selectedEdgeIds: ['edge-1'],
        })

        useWorkflowStore.getState().deselectAll()

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual([])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([])
      })
    })

    describe('openConfigModal (ordered open-sheet list)', () => {
      it('appends the node id to openConfigNodeIds', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        type Store = ReturnType<typeof useWorkflowStore.getState>
        useWorkflowStore.setState({
          openConfigNodeIds: [],
        } as unknown as Partial<Store>)

        useWorkflowStore.getState().openConfigModal('node-1')

        expect(
          (useWorkflowStore.getState() as unknown as { openConfigNodeIds: string[] })
            .openConfigNodeIds,
        ).toEqual(['node-1'])
      })
    })

    describe('closeConfigModal', () => {
      it('removes the given node id from openConfigNodeIds', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        type Store = ReturnType<typeof useWorkflowStore.getState>
        useWorkflowStore.setState({
          openConfigNodeIds: ['node-1'],
        } as unknown as Partial<Store>)
        ;(
          useWorkflowStore.getState() as unknown as {
            closeConfigModal: (nodeId: string) => void
          }
        ).closeConfigModal('node-1')

        expect(
          (useWorkflowStore.getState() as unknown as { openConfigNodeIds: string[] })
            .openConfigNodeIds,
        ).toEqual([])
      })
    })

    describe('openPublishDialog / closePublishDialog', () => {
      it('sets and clears publishDialogNodeId', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ publishDialogNodeId: null })

        useWorkflowStore.getState().openPublishDialog('fn-local-1')
        expect(useWorkflowStore.getState().publishDialogNodeId).toBe('fn-local-1')

        useWorkflowStore.getState().closePublishDialog()
        expect(useWorkflowStore.getState().publishDialogNodeId).toBeNull()
      })
    })

    describe('openMakeLocalDialog / closeMakeLocalDialog', () => {
      it('sets and clears makeLocalDialogNodeId', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({ makeLocalDialogNodeId: null })

        useWorkflowStore.getState().openMakeLocalDialog('fn-shared-1')
        expect(useWorkflowStore.getState().makeLocalDialogNodeId).toBe('fn-shared-1')

        useWorkflowStore.getState().closeMakeLocalDialog()
        expect(useWorkflowStore.getState().makeLocalDialogNodeId).toBeNull()
      })
    })

    describe('hasBreakpoint', () => {
      it('returns true when node has breakpoint', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          breakpoints: new Set(['node-1', 'node-2']),
        })

        expect(useWorkflowStore.getState().hasBreakpoint('node-1')).toBe(true)
      })

      it('returns false when node has no breakpoint', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          breakpoints: new Set(['node-1']),
        })

        expect(useWorkflowStore.getState().hasBreakpoint('node-3')).toBe(false)
      })
    })

    describe('toggleBreakpoint', () => {
      it('adds breakpoint when not present', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          breakpoints: new Set(),
        })

        useWorkflowStore.getState().toggleBreakpoint('node-1')

        expect(useWorkflowStore.getState().breakpoints.has('node-1')).toBe(true)
      })

      it('removes breakpoint when present', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          breakpoints: new Set(['node-1']),
        })

        useWorkflowStore.getState().toggleBreakpoint('node-1')

        expect(useWorkflowStore.getState().breakpoints.has('node-1')).toBe(false)
      })
    })

    describe('renameVariable', () => {
      it('renames a variable successfully', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
          nodes: [],
          edges: [],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'new_name')

        expect(result.success).toBe(true)
        expect(useWorkflowStore.getState().variables[0].name).toBe('new_name')
      })

      it('rejects empty name', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', '')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Name is required')
        expect(useWorkflowStore.getState().variables[0].name).toBe('old_name')
      })

      it('rejects invalid variable name (starts with digit)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', '123invalid')

        expect(result.success).toBe(false)
        expect(result.error).toBe(
          'Variable name must start with letter/underscore, contain only letters, numbers, underscores',
        )
      })

      it('rejects invalid variable name (special characters)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'invalid-name')

        expect(result.success).toBe(false)
        expect(result.error).toBe(
          'Variable name must start with letter/underscore, contain only letters, numbers, underscores',
        )
      })

      it('rejects duplicate name', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'var_a', value: 'test1', type: 'string' },
            { id: 'var-2', name: 'var_b', value: 'test2', type: 'string' },
          ],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'var_b')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Name "var_b" already exists in this scope')
      })

      it('succeeds when renaming to same name', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
          nodes: [],
          edges: [],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'old_name')

        expect(result.success).toBe(true)
      })

      it('refuses an id the scope does not hold and changes nothing', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'old_name', value: 'test', type: 'string' }],
          isDirty: false,
        })

        const result = useWorkflowStore.getState().renameVariable('non-existent', 'new_name')

        expect(result.success).toBe(false)
        expect(useWorkflowStore.getState().variables).toEqual([
          { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
        ])
        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('refactors variable references in expression fields', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['param1', 'param2'],
                config: {
                  values: {
                    param1: 'old_var',
                    param2: 'f"prefix_{old_var}_suffix"',
                    param3: 'other_var',  // NOT in expressionFields - should NOT change
                  },
                },
              },
            },
          ],
          edges: [],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'new_var')

        expect(result.success).toBe(true)
        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.param1).toBe('new_var')
        expect(values.param2).toBe('f"prefix_{new_var}_suffix"')
        expect(values.param3).toBe('other_var') // Not an expression, unchanged
      })

      it('refactors expression with method chain', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'my_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['expr'],
                config: { values: { expr: 'my_var.upper()' } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_var')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.expr).toBe('renamed_var.upper()')
      })

      it('refactors variable references in node template fields', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'user_name', value: 'bob', type: 'string' }],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Log',
                templateFields: ['message'],
                config: {
                  values: {
                    message: 'Hi {{ user_name }}, welcome',
                    other: '{{ user_name }}', // NOT a template field - unchanged
                  },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'account')

        const values = (useWorkflowStore.getState().nodes[0].data.config as Record<string, unknown>)
          .values as Record<string, string>
        expect(values.message).toBe('Hi {{ account }}, welcome')
        expect(values.other).toBe('{{ user_name }}')
      })

      it('refactors a Variable Setter target key across variables, keys, and types', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'next_try', value: 0, type: 'integer' }],
          nodes: [
            {
              id: 'setter-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Var Setter',
                elementType: 'variable-setter',
                variableExpressionKeys: ['next_try'],
                variableTemplateKeys: [],
                variableTypes: { next_try: 'integer', greeting: 'string' },
                variableElementTypes: { next_try: ['integer'], greeting: { a: 'string' } },
                config: { values: { variables: { next_try: 'attempt + 1', greeting: 'hi' } } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'retry_count')

        const data = useWorkflowStore.getState().nodes[0].data as Record<string, unknown>
        const vars = (data.config as { values: { variables: Record<string, unknown> } }).values.variables
        expect(vars.retry_count).toBe('attempt + 1')
        expect(vars.next_try).toBeUndefined()
        expect(vars.greeting).toBe('hi')
        expect(data.variableExpressionKeys).toEqual(['retry_count'])
        expect(data.variableTypes).toEqual({ retry_count: 'integer', greeting: 'string' })
        expect(data.variableElementTypes).toEqual({ retry_count: ['integer'], greeting: { a: 'string' } })
      })

      it('refactors a variable referenced inside Variable Setter per-key expression/template values', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'attempt', value: 1, type: 'integer' }],
          nodes: [
            {
              id: 'setter-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Var Setter',
                elementType: 'variable-setter',
                variableExpressionKeys: ['next_try'],
                variableTemplateKeys: ['welcome'],
                variableTypes: { next_try: 'integer', welcome: 'string' },
                config: {
                  values: {
                    variables: { next_try: 'attempt + 1', welcome: 'Hi {{ attempt }}', plain: 'attempt' },
                  },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'tries')

        const vars = (
          useWorkflowStore.getState().nodes[0].data.config as {
            values: { variables: Record<string, string> }
          }
        ).values.variables
        expect(vars.next_try).toBe('tries + 1') // per-key expression refactored
        expect(vars.welcome).toBe('Hi {{ tries }}') // per-key template refactored
        expect(vars.plain).toBe('attempt') // literal (not flagged) - unchanged
      })

      it('leaves a Variable Setter with no variables map untouched', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'foo', value: 'x', type: 'string' }],
          nodes: [
            {
              id: 'setter-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Var Setter',
                elementType: 'variable-setter',
                config: { outputBindings: {} }, // no values.variables
              },
            },
          ],
          edges: [],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'bar')

        expect(result.success).toBe(true)
        expect(useWorkflowStore.getState().nodes[0].data.config).toEqual({ outputBindings: {} })
      })

      it('refactors a Variable Setter target key when the optional key/type lists are absent', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'var-1', name: 'x', value: 'lit', type: 'string' }],
          nodes: [
            {
              id: 'setter-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Var Setter',
                elementType: 'variable-setter',
                // no variableExpressionKeys / variableTemplateKeys / variableTypes
                config: { values: { variables: { x: 'lit' } } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'y')

        const data = useWorkflowStore.getState().nodes[0].data as Record<string, unknown>
        const vars = (data.config as { values: { variables: Record<string, unknown> } }).values.variables
        expect(vars.y).toBe('lit')
        expect(vars.x).toBeUndefined()
        expect(data.variableExpressionKeys).toEqual([])
        expect(data.variableTemplateKeys).toEqual([])
        expect(data.variableTypes).toEqual({})
      })

      it('does not rename non-expression-field array values', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'arr_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                config: {
                  values: {
                    items: ['arr_var', 'static'],
                  },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'new_arr')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, unknown>
        // Array values cannot be expression fields, so they should be unchanged
        expect(values.items).toEqual(['arr_var', 'static'])
      })

      it('handles variable access patterns (dot notation)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'obj_var', value: {}, type: 'map' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['value'],
                config: { values: { value: 'obj_var.property' } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_obj')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.value).toBe('renamed_obj.property')
      })

      it('handles variable access patterns (bracket notation)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'list_var', value: [], type: 'array' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['value'],
                config: { values: { value: 'list_var[0]' } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_list')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.value).toBe('renamed_list[0]')
      })

      it('does not refactor similar variable names (word boundary)', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'var', value: 'test', type: 'string' },
            { id: 'var-2', name: 'var_extended', value: 'other', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['param1', 'param2'],
                config: {
                  values: { param1: 'var', param2: 'var_extended' },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.param1).toBe('renamed')
        expect(values.param2).toBe('var_extended') // Word boundary prevents partial rename
      })

      it('marks workflow as dirty after rename', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
          nodes: [],
          edges: [],
          isDirty: false,
        })

        useWorkflowStore.getState().renameVariable('var-1', 'new_name')

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('handles nodes without config property', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_name', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                // No config property - covers the else branch
              },
            },
          ],
          edges: [],
        })

        const result = useWorkflowStore.getState().renameVariable('var-1', 'new_name')

        expect(result.success).toBe(true)
        // Node should be unchanged (returned as-is)
        expect(useWorkflowStore.getState().nodes[0].data.config).toBeUndefined()
      })

      it('refactors multiple expression fields in same node', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'my_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['ref1', 'ref2'],
                config: {
                  values: { ref1: 'my_var', ref2: 'my_var.property' },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_var')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, string>
        expect(values.ref1).toBe('renamed_var')
        expect(values.ref2).toBe('renamed_var.property')
      })

      it('preserves non-expression-field values without modification', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'my_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['expr'],
                config: {
                  values: { numberVal: 42, boolVal: true, staticStr: 'literal', expr: 'my_var' },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_var')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, unknown>
        expect(values.numberVal).toBe(42)
        expect(values.boolVal).toBe(true)
        expect(values.staticStr).toBe('literal') // Not an expression field, unchanged
        expect(values.expr).toBe('renamed_var') // Expression field, renamed
      })

      it('preserves non-expression string values without modification', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'my_var', value: 'test', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'Test Node',
                expressionFields: ['expr'],
                config: {
                  values: {
                    numberValue: 123,
                    boolValue: false,
                    literalStr: 'my_var is great',
                    expr: 'my_var',
                  },
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'renamed_var')

        const nodeConfig = useWorkflowStore.getState().nodes[0].data.config
        const values = (nodeConfig as Record<string, unknown>).values as Record<string, unknown>
        expect(values.numberValue).toBe(123)
        expect(values.boolValue).toBe(false)
        expect(values.literalStr).toBe('my_var is great') // Not in expressionFields, unchanged
        expect(values.expr).toBe('renamed_var') // Expression field, renamed
      })

      it('renames variable in outputBindings of all nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'old_var', value: '', type: 'string' },
            { id: 'var-2', name: 'status_code', value: '', type: 'string' },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'HTTP Client',
                config: {
                  values: { url: 'https://test.com' },
                  outputBindings: { body: 'old_var', status: 'status_code' },
                },
              },
            },
            {
              id: 'node-2',
              type: 'block',
              position: { x: 100, y: 0 },
              data: {
                label: 'Another HTTP',
                config: {
                  values: { url: 'https://other.com' },
                  outputBindings: { body: 'old_var', headers: '' },
                },
              },
            },
            {
              id: 'node-3',
              type: 'block',
              position: { x: 200, y: 0 },
              data: {
                label: 'No bindings',
                expressionFields: ['message'],
                config: { values: { message: 'old_var' } },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'new_var')

        const state = useWorkflowStore.getState()
        // Node 1: old_var → new_var in outputBindings, status_code unchanged
        const bindings1 = (state.nodes[0].data.config as Record<string, unknown>).outputBindings as Record<string, string>
        expect(bindings1.body).toBe('new_var')
        expect(bindings1.status).toBe('status_code')
        // Node 2: old_var → new_var in outputBindings, empty string unchanged
        const bindings2 = (state.nodes[1].data.config as Record<string, unknown>).outputBindings as Record<string, string>
        expect(bindings2.body).toBe('new_var')
        expect(bindings2.headers).toBe('')
        // Node 3: no outputBindings, but expression field values still refactored
        const config3 = state.nodes[2].data.config as Record<string, unknown>
        expect((config3.values as Record<string, string>).message).toBe('new_var')
      })

      it('renames self-bound output bindings and query aliases for XML Parser individual mode', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'order_status', value: 'COMPLETED', type: 'string' as const },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'XML Parser',
                elementType: 'xml-parser',
                config: {
                  values: {
                    xml_content: '<root/>',
                    queries: { order_status: '//status/text()', item_count: 'count(//item)' },
                    query_output_types: { order_status: 'string', item_count: 'integer' },
                    output_mode: 'individual',
                  },
                  outputBindings: {
                    success: 'xml_success',
                    order_status: 'order_status',
                  },
                  expressionFields: [],
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'new_status')

        const state = useWorkflowStore.getState()
        const config = state.nodes[0].data.config as Record<string, unknown>
        const bindings = config.outputBindings as Record<string, string>
        // Self-bound entry: both key and value renamed
        expect(bindings.new_status).toBe('new_status')
        expect(bindings.order_status).toBeUndefined()
        // Non-self-bound entry unchanged
        expect(bindings.success).toBe('xml_success')
        // Query alias renamed in values.queries
        const values = config.values as Record<string, Record<string, string>>
        expect(values.queries.new_status).toBe('//status/text()')
        expect(values.queries.order_status).toBeUndefined()
        // query_output_types alias renamed
        expect(values.query_output_types.new_status).toBe('string')
        expect(values.query_output_types.order_status).toBeUndefined()
        // Other query untouched
        expect(values.queries.item_count).toBe('count(//item)')
        expect(values.query_output_types.item_count).toBe('integer')
      })

      it('renames query alias even without query_output_types', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'status', value: 'ok', type: 'string' as const },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'XML Parser',
                elementType: 'xml-parser',
                config: {
                  values: {
                    queries: { status: '//status/text()' },
                    // No query_output_types key
                  },
                  outputBindings: { status: 'status' },
                  expressionFields: [],
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'new_status')

        const state = useWorkflowStore.getState()
        const config = state.nodes[0].data.config as Record<string, unknown>
        const values = config.values as Record<string, Record<string, string>>
        // Query alias renamed
        expect(values.queries.new_status).toBe('//status/text()')
        expect(values.queries.status).toBeUndefined()
        // query_output_types should be empty (was undefined)
        expect(values.query_output_types).toEqual({})
      })

      it('keeps the binding key when a script variable is bound to a variable of the same name', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'STATUS', value: '', type: 'string' as const },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'Shell Script',
                elementType: 'shell-script',
                config: {
                  values: { script: 'STATUS=ok' },
                  outputBindings: { STATUS: 'STATUS', stdout: 'log_text' },
                  expressionFields: [],
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'S2')

        const state = useWorkflowStore.getState()
        const config = state.nodes[0].data.config as Record<string, unknown>
        const bindings = config.outputBindings as Record<string, string>
        // The script variable name is the block's own, so only the value moves
        expect(bindings.STATUS).toBe('S2')
        expect(bindings.S2).toBeUndefined()
        expect(bindings.stdout).toBe('log_text')
      })

      it('keeps the binding key when the name is not one of the node query aliases', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'STATUS', value: '', type: 'string' as const },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'JSON Parser',
                elementType: 'json-parser',
                config: {
                  values: { queries: { other_field: '$.y' } },
                  outputBindings: { STATUS: 'STATUS' },
                  expressionFields: [],
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'S2')

        const state = useWorkflowStore.getState()
        const config = state.nodes[0].data.config as Record<string, unknown>
        const bindings = config.outputBindings as Record<string, string>
        expect(bindings.STATUS).toBe('S2')
        expect(bindings.S2).toBeUndefined()
        const values = config.values as Record<string, Record<string, string>>
        expect(values.queries).toEqual({ other_field: '$.y' })
      })

      it('moves the binding key of a JSON Parser query alias', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'STATUS', value: '', type: 'string' as const },
          ],
          nodes: [
            {
              id: 'node-1',
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'JSON Parser',
                elementType: 'json-parser',
                config: {
                  values: {
                    queries: { STATUS: '$.x' },
                    query_output_types: { STATUS: 'string' },
                  },
                  outputBindings: { STATUS: 'STATUS' },
                  expressionFields: [],
                },
              },
            },
          ],
          edges: [],
        })

        useWorkflowStore.getState().renameVariable('var-1', 'S2')

        const state = useWorkflowStore.getState()
        const config = state.nodes[0].data.config as Record<string, unknown>
        const bindings = config.outputBindings as Record<string, string>
        expect(bindings.S2).toBe('S2')
        expect(bindings.STATUS).toBeUndefined()
        const values = config.values as Record<string, Record<string, string>>
        expect(values.queries.S2).toBe('$.x')
        expect(values.queries.STATUS).toBeUndefined()
        expect(values.query_output_types.S2).toBe('string')
        expect(values.query_output_types.STATUS).toBeUndefined()
      })
    })

    describe('setVariables', () => {
      it('sets variables and marks workflow as dirty by default', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [],
          isDirty: false,
        })

        const newVariables = [
          { id: 'var-1', name: 'test_var', value: '123', type: 'string' as const },
        ]
        useWorkflowStore.getState().setVariables(newVariables)

        expect(useWorkflowStore.getState().variables).toEqual(newVariables)
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('sets variables without marking dirty when skipDirty is true', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [],
          isDirty: false,
        })

        const newVariables = [
          { id: 'var-1', name: 'test_var', value: '123', type: 'string' as const },
        ]
        useWorkflowStore.getState().setVariables(newVariables, { skipDirty: true })

        expect(useWorkflowStore.getState().variables).toEqual(newVariables)
        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })
    })

    describe('removeVariable', () => {
      it('removes a variable by id and marks workflow as dirty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'first', value: '1', type: 'string' },
            { id: 'var-2', name: 'second', value: '2', type: 'string' },
          ],
          isDirty: false,
        })

        useWorkflowStore.getState().removeVariable('var-1')

        expect(useWorkflowStore.getState().variables).toHaveLength(1)
        expect(useWorkflowStore.getState().variables[0].id).toBe('var-2')
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })
    })

    describe('addVariable', () => {
      it('adds a new variable with generated id and marks workflow as dirty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [],
          isDirty: false,
        })

        const newVar = useWorkflowStore.getState().addVariable({
          name: 'test_var',
          value: 'test_value',
          type: 'string',
        })

        expect(newVar.id).toBeDefined()
        expect(newVar.name).toBe('test_var')
        expect(useWorkflowStore.getState().variables).toHaveLength(1)
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('throws when the name collides with another variable in the active scope', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [{ id: 'v1', name: 'existing', value: 'x', type: 'string' }],
          isDirty: false,
        })

        expect(() =>
          useWorkflowStore.getState().addVariable({
            name: 'existing',
            value: 'y',
            type: 'string',
          }),
        ).toThrow(/^Name "existing" already exists in this scope$/)
      })
    })

    describe('updateVariable', () => {
      it('updates an existing variable by id and marks workflow as dirty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'original', value: 'old_value', type: 'string' },
          ],
          isDirty: false,
        })

        useWorkflowStore.getState().updateVariable('var-1', { value: 'new_value' })

        const variables = useWorkflowStore.getState().variables
        expect(variables[0].value).toBe('new_value')
        expect(variables[0].name).toBe('original') // unchanged
        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('only updates the specified variable', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'first', value: '1', type: 'string' },
            { id: 'var-2', name: 'second', value: '2', type: 'string' },
          ],
          isDirty: false,
        })

        useWorkflowStore.getState().updateVariable('var-1', { value: 'updated' })

        const variables = useWorkflowStore.getState().variables
        expect(variables[0].value).toBe('updated')
        expect(variables[1].value).toBe('2') // unchanged
      })

      it('persists isExpression flag through updateVariable', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          variables: [
            { id: 'var-1', name: 'myVar', value: 'hello', type: 'string' },
          ],
          isDirty: false,
        })

        useWorkflowStore.getState().updateVariable('var-1', { isExpression: true, value: 'x + 1' })

        const variables = useWorkflowStore.getState().variables
        expect(variables[0].isExpression).toBe(true)
        expect(variables[0].value).toBe('x + 1')
      })
    })
  })

  // ===========================================================================
  // Batch Operations: deleteSelected with edge support
  // ===========================================================================
  describe('Batch Operations', () => {
    describe('deleteSelected', () => {
      it('removes selected nodes and their connected edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-2'],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        const state = useWorkflowStore.getState()
        // node-2 removed; node-1 and node-3 remain
        expect(state.nodes).toHaveLength(2)
        expect(state.nodes.map((n) => n.id)).toEqual(['node-1', 'node-3'])
        // Both edges removed (both connected to deleted node-2)
        expect(state.edges).toHaveLength(0)
        expect(state.isDirty).toBe(true)
      })

      it('removes selected edges when only edges are selected', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: [],
          selectedEdgeIds: ['edge-1'],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        const state = useWorkflowStore.getState()
        // Nodes remain untouched
        expect(state.nodes).toHaveLength(2)
        // Selected edge removed
        expect(state.edges).toHaveLength(0)
        expect(state.isDirty).toBe(true)
      })

      it('removes both selected nodes and selected edges', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
          { id: 'edge-3', source: 'node-1', target: 'node-3' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: ['edge-2'],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        const state = useWorkflowStore.getState()
        // node-1 removed
        expect(state.nodes).toHaveLength(2)
        expect(state.nodes.map((n) => n.id)).toEqual(['node-2', 'node-3'])
        // edge-1 (connected to node-1), edge-2 (selected), edge-3 (connected to node-1) all removed
        expect(state.edges).toHaveLength(0)
      })

      it('clears both selectedNodeIds and selectedEdgeIds after deletion', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: ['edge-1'],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual([])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([])
      })

      it('does nothing when both selections are empty', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        // Nothing changed
        expect(useWorkflowStore.getState().nodes).toHaveLength(1)
        expect(useWorkflowStore.getState().edges).toHaveLength(1)
        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('pushes history before deletion', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        expect(useWorkflowStore.getState().history.length).toBeGreaterThan(0)
      })

      it('preserves variables when deleting nodes with output bindings', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            {
              id: 'node-1',
              type: 'block',
              position: { x: 0, y: 0 },
              data: {
                label: 'HTTP Client',
                config: {
                  values: { url: 'https://test.com' },
                  outputBindings: { status: 'response_code', body: 'response_body' },
                },
              },
            },
            { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Log' } },
          ],
          edges: [],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          variables: [
            { id: 'v1', name: 'response_code', value: '', type: 'string' },
            { id: 'v2', name: 'response_body', value: '', type: 'string' },
            { id: 'v3', name: 'unrelated_var', value: 'keep', type: 'string' },
          ],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().deleteSelected()

        const state = useWorkflowStore.getState()
        expect(state.nodes).toHaveLength(1)
        // Variables are never auto-deleted - only Variable Manager can remove them
        expect(state.variables).toHaveLength(3)
        expect(state.variables.map((v) => v.name)).toEqual(['response_code', 'response_body', 'unrelated_var'])
      })
    })

    describe('disconnectSelected', () => {
      it('removes edges connected to selected nodes without removing nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-2'],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        const state = useWorkflowStore.getState()
        // All 3 nodes still present (disconnect does NOT remove nodes)
        expect(state.nodes).toHaveLength(3)
        // Both edges removed (both connected to selected node-2)
        expect(state.edges).toHaveLength(0)
        expect(state.isDirty).toBe(true)
      })

      it('removes selected edges directly', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: [],
          selectedEdgeIds: ['edge-1'],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        const state = useWorkflowStore.getState()
        // Both nodes still present
        expect(state.nodes).toHaveLength(2)
        // Selected edge removed
        expect(state.edges).toHaveLength(0)
        expect(state.isDirty).toBe(true)
      })

      it('removes both selected edges and edges connected to selected nodes', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        const nodes: NodeType[] = [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ]
        const edges: EdgeType[] = [
          { id: 'edge-1', source: 'node-1', target: 'node-2' },
          { id: 'edge-2', source: 'node-2', target: 'node-3' },
          { id: 'edge-3', source: 'node-1', target: 'node-3' },
        ]

        useWorkflowStore.setState({
          nodes,
          edges,
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: ['edge-2'],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        const state = useWorkflowStore.getState()
        // All 3 nodes still present
        expect(state.nodes).toHaveLength(3)
        // edge-1 (connected to node-1), edge-2 (selected), edge-3 (connected to node-1) all removed
        expect(state.edges).toHaveLength(0)
      })

      it('clears selection after disconnect', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        expect(useWorkflowStore.getState().selectedNodeIds).toEqual([])
        expect(useWorkflowStore.getState().selectedEdgeIds).toEqual([])
      })

      it('does nothing when no selection', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
          selectedNodeIds: [],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        expect(useWorkflowStore.getState().edges).toHaveLength(1)
        expect(useWorkflowStore.getState().isDirty).toBe(false)
      })

      it('pushes history before disconnect', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          ],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2' },
          ],
          selectedNodeIds: ['node-1'],
          selectedEdgeIds: [],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().disconnectSelected()

        expect(useWorkflowStore.getState().history.length).toBeGreaterThan(0)
      })
    })

    describe('updateEdgeType', () => {
      it('changes the type of the specified edge', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'default' },
            { id: 'edge-2', source: 'node-2', target: 'node-3', type: 'default' },
          ],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().updateEdgeType('edge-1', 'step')

        const updatedEdges = useWorkflowStore.getState().edges
        expect(updatedEdges[0].type).toBe('step')
        expect(updatedEdges[1].type).toBe('default')
      })

      it('sets isDirty to true', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'default' },
          ],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().updateEdgeType('edge-1', 'smoothstep')

        expect(useWorkflowStore.getState().isDirty).toBe(true)
      })

      it('pushes history before changing edge type', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'default' },
          ],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().updateEdgeType('edge-1', 'straight')

        expect(useWorkflowStore.getState().history.length).toBeGreaterThan(0)
      })

      it('leaves non-matching edges unchanged', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.setState({
          nodes: [],
          edges: [
            { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'default' },
            { id: 'edge-2', source: 'node-2', target: 'node-3', type: 'smoothstep' },
          ],
          isDirty: false,
          history: [],
          historyIndex: -1,
        })

        useWorkflowStore.getState().updateEdgeType('edge-nonexistent', 'step')

        const edges = useWorkflowStore.getState().edges
        expect(edges[0].type).toBe('default')
        expect(edges[1].type).toBe('smoothstep')
      })
    })

    describe('namespace variables', () => {
      it('setNamespaceVariables stores entries correctly', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.getState().reset()

        useWorkflowStore.getState().setNamespaceVariables('system', [
          { name: 'API_URL', type: 'string' },
          { name: 'TIMEOUT', type: 'integer' },
        ])

        const state = useWorkflowStore.getState()
        expect(state.namespaceVariables.system).toHaveLength(2)
        expect(state.namespaceVariables.system[0].name).toBe('API_URL')
        expect(state.namespaceVariables.system[1].name).toBe('TIMEOUT')
      })

      it('clearNamespaceVariables resets to empty arrays', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
        useWorkflowStore.getState().reset()

        useWorkflowStore.getState().setNamespaceVariables('system', [
          { name: 'HOST', type: 'string' },
        ])
        expect(useWorkflowStore.getState().namespaceVariables.system).toHaveLength(1)

        useWorkflowStore.getState().clearNamespaceVariables()

        const state = useWorkflowStore.getState()
        expect(state.namespaceVariables.system).toEqual([])
        expect(state.namespaceVariables.suite).toEqual([])
        expect(state.namespaceVariables.regression).toEqual([])
      })

      it('reset clears namespace variables', async () => {
        const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

        useWorkflowStore.getState().setNamespaceVariables('system', [
          { name: 'HOST', type: 'string' },
        ])
        expect(useWorkflowStore.getState().namespaceVariables.system).toHaveLength(1)

        useWorkflowStore.getState().reset()

        const state = useWorkflowStore.getState()
        expect(state.namespaceVariables.system).toEqual([])
        expect(state.namespaceVariables.suite).toEqual([])
        expect(state.namespaceVariables.regression).toEqual([])
      })
    })
  })
})

describe('Workflow Store - derived dirty state (REQ-5.2.1.24)', () => {
  /**
   * isDirty is DERIVED: the canvas is dirty exactly when its canonical form
   * differs from the canonical form of the saved baseline. Re-evaluated at
   * every mutation/undo/redo/surgery boundary.
   */
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function seedSavedNode() {
    const { useWorkflowStore } = await import(
      '../../../../src/features/workbench/stores/workflow-store'
    )
    useWorkflowStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node n1' },
        },
      ],
      edges: [],
      variables: [],
      drillPath: [],
      isDirty: false,
    } as never)
    useWorkflowStore.getState().markSaved()
    return useWorkflowStore
  }

  it('entity opened (saved baseline): clean', async () => {
    const useWorkflowStore = await seedSavedNode()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('tracked operation that changes canonical state: dirty', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.getState().updateNode('n1', { position: { x: 10, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it('mutating back to a canonically-baseline-equal state computes CLEAN', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.getState().updateNode('n1', { position: { x: 10, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    useWorkflowStore.getState().updateNode('n1', { position: { x: 0, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    // The canvas equals the saved baseline canonically: derived dirty is false
    // even though the pointer is not on the baseline entry.
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('a React Flow re-measure after save does not defeat the clean state', async () => {
    const useWorkflowStore = await seedSavedNode()
    // The canvas applies RF `dimensions` changes into the store with skipDirty;
    // `measured` is runtime layout residue and must not poison canonical equality.
    useWorkflowStore.getState().setNodes(
      useWorkflowStore
        .getState()
        .nodes.map((n) => (n.id === 'n1' ? { ...n, measured: { width: 131, height: 71 } } : n)) as never,
      { skipDirty: true },
    )
    useWorkflowStore.getState().updateNode('n1', { position: { x: 10, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    useWorkflowStore.getState().updateNode('n1', { position: { x: 0, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('redo onto a canonically-baseline-equal entry computes CLEAN', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.getState().updateNode('n1', { position: { x: 10, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    useWorkflowStore.getState().updateNode('n1', { position: { x: 0, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    useWorkflowStore.getState().undo()
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    useWorkflowStore.getState().redo()
    expect(useWorkflowStore.getState().isDirty).toBe(true)
    useWorkflowStore.getState().redo()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('undo back to the baseline entry: clean', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.getState().updateNode('n1', { position: { x: 10, y: 0 } })
    useWorkflowStore.getState().commitHistory('Move block')
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('runtime-transient skip marks never affect dirty', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.getState().toggleSkip('n1')
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    useWorkflowStore.getState().unskipAll()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it('selection residue never affects dirty (canonical comparison strips it)', async () => {
    const useWorkflowStore = await seedSavedNode()
    useWorkflowStore.setState({
      nodes: useWorkflowStore
        .getState()
        .nodes.map((n) => ({ ...n, selected: true }) as never),
    } as never)
    useWorkflowStore.getState().commitHistory('Selection residue')
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})

describe('Workflow Store - issue severity and Python syntax issues (PYRUN-13, PYRUN-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function loadStore() {
    const { useWorkflowStore } = await import(
      '../../../../src/features/workbench/stores/workflow-store'
    )
    useWorkflowStore.setState({ nodes: [], edges: [], variables: [] })
    return useWorkflowStore
  }

  function pythonNode(values: Record<string, unknown>) {
    return {
      id: 'py-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'python',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'Python',
        config: { values: { script_type: 'source', ...values } },
      },
    }
  }

  describe('setNodeSyntaxIssues', () => {
    it('starts with an empty nodeSyntaxIssues map', async () => {
      const useWorkflowStore = await loadStore()
      const state = useWorkflowStore.getState() as unknown as {
        nodeSyntaxIssues: Map<string, unknown[]>
      }

      expect(state.nodeSyntaxIssues).toBeInstanceOf(Map)
      expect(state.nodeSyntaxIssues.size).toBe(0)
    })

    it('fills the map with the issues of one block', async () => {
      const useWorkflowStore = await loadStore()
      const issues = [
        { line: 3, message: 'Unexpected token' },
        { line: 9, message: 'Unexpected indent' },
      ]

      ;(
        useWorkflowStore.getState() as unknown as {
          setNodeSyntaxIssues: (id: string, list: { line: number; message: string }[]) => void
        }
      ).setNodeSyntaxIssues('py-1', issues)

      const state = useWorkflowStore.getState() as unknown as {
        nodeSyntaxIssues: Map<string, typeof issues>
      }
      expect(state.nodeSyntaxIssues.get('py-1')).toEqual(issues)
    })

    it('keeps one entry per block', async () => {
      const useWorkflowStore = await loadStore()
      const set = (
        useWorkflowStore.getState() as unknown as {
          setNodeSyntaxIssues: (id: string, issues: { line: number; message: string }[]) => void
        }
      ).setNodeSyntaxIssues

      set('py-1', [{ line: 1, message: 'a' }])
      set('py-2', [{ line: 2, message: 'b' }])

      const state = useWorkflowStore.getState() as unknown as {
        nodeSyntaxIssues: Map<string, { line: number; message: string }[]>
      }
      expect([...state.nodeSyntaxIssues.keys()].sort()).toEqual(['py-1', 'py-2'])
    })

    it('replaces the issues a later parse reports', async () => {
      const useWorkflowStore = await loadStore()
      const set = (
        useWorkflowStore.getState() as unknown as {
          setNodeSyntaxIssues: (id: string, issues: { line: number; message: string }[]) => void
        }
      ).setNodeSyntaxIssues

      set('py-1', [{ line: 1, message: 'a' }])
      set('py-1', [{ line: 7, message: 'b' }])

      const state = useWorkflowStore.getState() as unknown as {
        nodeSyntaxIssues: Map<string, { line: number; message: string }[]>
      }
      expect(state.nodeSyntaxIssues.get('py-1')).toEqual([{ line: 7, message: 'b' }])
    })

    it('clears the entry when the parse reports an empty list', async () => {
      const useWorkflowStore = await loadStore()
      const set = (
        useWorkflowStore.getState() as unknown as {
          setNodeSyntaxIssues: (id: string, issues: { line: number; message: string }[]) => void
        }
      ).setNodeSyntaxIssues

      set('py-1', [{ line: 1, message: 'a' }])
      set('py-1', [])

      const state = useWorkflowStore.getState() as unknown as {
        nodeSyntaxIssues: Map<string, unknown[]>
      }
      expect(state.nodeSyntaxIssues.has('py-1')).toBe(false)
    })
  })

  describe('the invalid badge counts only error issues', () => {
    it('lists the unassigned-export warning on the block', async () => {
      const useWorkflowStore = await loadStore()
      const setNodes = useWorkflowStore.getState().setNodes

      setNodes([
        pythonNode({ script: 'x = 1\n', script_variables: ['COUNT'] }) as Parameters<
          typeof setNodes
        >[0][number],
      ])

      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, { message: string; severity?: string }[]>
      }
      expect((state.nodeIssues.get('py-1') ?? []).map((issue) => issue.message)).toContain(
        "Script never sets 'COUNT'",
      )
    })

    it('leaves a block whose only issues are warnings free of error issues', async () => {
      const useWorkflowStore = await loadStore()
      const setNodes = useWorkflowStore.getState().setNodes

      setNodes([
        pythonNode({ script: 'x = 1\n', script_variables: ['COUNT'] }) as Parameters<
          typeof setNodes
        >[0][number],
      ])

      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, { message: string; severity?: string }[]>
      }
      const issues = state.nodeIssues.get('py-1') ?? []
      expect(issues.filter((issue) => issue.severity !== 'warning')).toEqual([])
    })

    it('counts the syntax error the editor reported as an error issue', async () => {
      const useWorkflowStore = await loadStore()
      ;(
        useWorkflowStore.getState() as unknown as {
          setNodeSyntaxIssues: (id: string, issues: { line: number; message: string }[]) => void
        }
      ).setNodeSyntaxIssues('py-1', [{ line: 3, message: 'Unexpected token' }])

      const setNodes = useWorkflowStore.getState().setNodes
      setNodes([
        pythonNode({ script: 'def (\n' }) as Parameters<typeof setNodes>[0][number],
      ])

      const state = useWorkflowStore.getState() as unknown as {
        nodeIssues: Map<string, { message: string; severity?: string }[]>
      }
      const issues = state.nodeIssues.get('py-1') ?? []
      const syntax = issues.find((issue) => issue.message === 'Script has a syntax error on line 3')
      expect(syntax?.severity).toBe('error')
    })
  })
})

// ===========================================================================
// Rename reaches condition rows and Function call bindings (VMGR-105)
// ===========================================================================

describe('Workflow Store - renaming a variable reaches every name site', () => {
  async function storeWith(nodes: unknown[]) {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      variables: [{ id: 'var-1', name: 'flag', value: true, type: 'boolean' }],
      nodes: nodes as never,
      edges: [],
      drillPath: [],
    })
    return useWorkflowStore
  }

  function literalRow(variable: string, extra: Record<string, unknown> = {}) {
    return {
      id: `row-${variable}`,
      type: 'literal',
      variable,
      value_type: 'boolean',
      operator: 'is_true',
      reference_value: null,
      reference_is_expression: false,
      ...extra,
    }
  }

  function checkBlock(elementType: string, values: Record<string, unknown>) {
    return {
      id: 'node-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Check', nodeType: 'control', elementType, config: { values } },
    }
  }

  type Values = Record<string, unknown>
  type Rows = Array<Record<string, unknown>>
  const valuesOf = (node: { data: { config?: Record<string, unknown> } }) =>
    (node.data.config as { values: Values }).values
  const firstBranchRow = (values: Values) => ((values.branches as Rows)[0].conditions as Rows)[0]

  it.each<[string, ReturnType<typeof checkBlock>, (values: Values) => unknown, unknown]>([
    ['an Assert condition row', checkBlock('assert', { assertions: [literalRow('flag')] }), (v) => (v.assertions as Rows)[0].variable, 'ready'],
    [
      'an If/Else branch condition row',
      checkBlock('if-else', {
        branches: [
          { id: 'b1', type: 'if', label: '', conditions: [literalRow('flag')] },
          { id: 'b2', type: 'else', label: '' },
        ],
      }),
      (v) => firstBranchRow(v).variable,
      'ready',
    ],
    [
      'a Switch case condition row',
      checkBlock('switch-case', {
        branches: [
          { id: 'c1', type: 'case', label: '', conditions: [literalRow('flag')], break: true },
          { id: 'd1', type: 'default', label: '' },
        ],
      }),
      (v) => firstBranchRow(v).variable,
      'ready',
    ],
    ['a While condition row', checkBlock('while', { conditions: [literalRow('flag')] }), (v) => (v.conditions as Rows)[0].variable, 'ready'],
    ['a Wait Until condition row', checkBlock('wait-until', { conditions: [literalRow('flag')] }), (v) => (v.conditions as Rows)[0].variable, 'ready'],
    [
      'a compare-to expression',
      checkBlock('assert', {
        assertions: [
          literalRow('count', {
            value_type: 'integer',
            operator: 'equals',
            reference_value: 'flag + 1',
            reference_is_expression: true,
          }),
        ],
      }),
      (v) => (v.assertions as Rows)[0].reference_value,
      'ready + 1',
    ],
    [
      'an expression condition row',
      checkBlock('assert', { assertions: [{ id: 'e1', type: 'expression', expression: 'flag and other' }] }),
      (v) => (v.assertions as Rows)[0].expression,
      'ready and other',
    ],
    [
      'a nested condition group',
      checkBlock('assert', {
        assertions: [{ id: 'g1', type: 'group', items: [literalRow('flag'), { type: 'operator', value: 'or' }, literalRow('other')] }],
      }),
      (v) => ((v.assertions as Rows)[0].items as Rows).map((item) => item.variable),
      ['ready', undefined, 'other'],
    ],
  ])('renames %s', async (_site, node, read, expected) => {
    const useWorkflowStore = await storeWith([node])

    expect(useWorkflowStore.getState().renameVariable('var-1', 'ready')).toEqual({ success: true })

    expect(read(valuesOf(useWorkflowStore.getState().nodes[0]))).toEqual(expected)
  })

  it('renames a variable a Function Block input field reads, and leaves a literal field as it is', async () => {
    const useWorkflowStore = await storeWith([
      {
        id: 'call-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Lookup',
          nodeType: 'function',
          elementType: 'function',
          functionLifecycle: 'shared',
          functionId: 'fn-lib-1',
          expressionFields: ['enabled'],
          config: { values: { enabled: 'flag', note: 'flag' }, outputBindings: {} },
        },
      },
    ])

    useWorkflowStore.getState().renameVariable('var-1', 'ready')

    expect(valuesOf(useWorkflowStore.getState().nodes[0])).toEqual({
      enabled: 'ready',
      note: 'flag',
    })
  })
})

// ===========================================================================
// A Function-local variable lands in the Function its window was opened in (VMGR-102)
// ===========================================================================

describe('Workflow Store - addVariable with the Function path of its window (VMGR-102)', () => {
  type FunctionPath = Array<{ nodeId: string; label: string }>
  interface AddVariableWithPath {
    addVariable: (
      variable: { name: string; type: string; value?: unknown },
      functionPath?: FunctionPath,
    ) => { id: string; name: string }
  }
  const PATH_A: FunctionPath = [{ nodeId: 'fn-a', label: 'Function_A' }]

  function localFn(id: string, label: string, variables: unknown[] = []) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables },
      },
    }
  }

  async function twoFunctions(drillPath: FunctionPath, fnAVariables: unknown[] = []) {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({
      variables: [],
      nodes: [localFn('fn-a', 'Function_A', fnAVariables), localFn('fn-b', 'Function_B')] as never,
      edges: [],
      drillPath,
      isDirty: false,
    })
    const withPath = () => useWorkflowStore.getState() as unknown as AddVariableWithPath
    const localsOf = (id: string) =>
      (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data.localDefinition as
        | { variables?: Array<{ name: string; value?: unknown }> }
        | undefined)?.variables
    return { useWorkflowStore, withPath, localsOf }
  }

  afterEach(async () => {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ drillPath: [], nodes: [], variables: [] })
  })

  it.each<[string, FunctionPath]>([
    ['drilled into another Function', [{ nodeId: 'fn-b', label: 'Function_B' }]],
    ['back at the test root', []],
  ])('writes into the given Function path while the author is %s', async (_where, drillPath) => {
    const { useWorkflowStore, withPath, localsOf } = await twoFunctions(drillPath)

    withPath().addVariable({ name: 'from_a', type: 'integer', value: 3 }, PATH_A)

    expect(localsOf('fn-a')).toEqual([expect.objectContaining({ name: 'from_a', value: 3 })])
    expect(localsOf('fn-b')).toEqual([])
    expect(useWorkflowStore.getState().variables).toEqual([])
  })

  it('checks the name against the Function the path names', async () => {
    const { withPath, localsOf } = await twoFunctions([{ nodeId: 'fn-b', label: 'Function_B' }], [
      { id: 'lv-1', name: 'taken', type: 'string', value: 'x' },
    ])

    expect(() => withPath().addVariable({ name: 'taken', type: 'string', value: 'y' }, PATH_A)).toThrow(
      /^Name "taken" already exists in this scope$/,
    )
    expect(localsOf('fn-b')).toEqual([])
  })

  it('keeps a null value on a new variable', async () => {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ variables: [], nodes: [], edges: [], drillPath: [] })

    useWorkflowStore.getState().addVariable({ name: 'nothing_yet', type: 'integer', value: null })

    expect(useWorkflowStore.getState().variables[0].value).toBeNull()
  })
})

// ===========================================================================
// The Save warning before a plain variable turns secret (REQ-4.5.20, SECUI-12)
// ===========================================================================

describe('Workflow Store - pending secret promotion (REQ-4.5.20, SECUI-12)', () => {
  interface PendingPromotion {
    names: string[]
    save: () => void
  }
  interface SecretPromotionSlice {
    pendingSecretPromotion: PendingPromotion | null
    requestSecretPromotion: (names: string[], save: () => void) => void
    confirmSecretPromotion: () => void
    cancelSecretPromotion: () => void
  }

  async function loadPromotionStore() {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
    useWorkflowStore.setState({ pendingSecretPromotion: null } as never)
    const promotion = () => useWorkflowStore.getState() as unknown as SecretPromotionSlice
    return { useWorkflowStore, promotion }
  }

  it('starts with no pending promotion', async () => {
    const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

    expect((useWorkflowStore.getState() as unknown as SecretPromotionSlice).pendingSecretPromotion).toBeNull()
  })

  it('holds the names and the staged save without saving', async () => {
    const { promotion } = await loadPromotionStore()
    const save = vi.fn()

    promotion().requestSecretPromotion(['api_key', 'db_password'], save)

    expect(promotion().pendingSecretPromotion).toEqual({ names: ['api_key', 'db_password'], save })
    expect(save).not.toHaveBeenCalled()
  })

  it('runs the staged save once on confirm and clears the request', async () => {
    const { promotion } = await loadPromotionStore()
    const save = vi.fn()
    promotion().requestSecretPromotion(['api_key'], save)

    promotion().confirmSecretPromotion()

    expect(save).toHaveBeenCalledTimes(1)
    expect(promotion().pendingSecretPromotion).toBeNull()
  })

  it('clears the request on cancel and never saves', async () => {
    const { promotion } = await loadPromotionStore()
    const save = vi.fn()
    promotion().requestSecretPromotion(['api_key', 'db_password'], save)

    promotion().cancelSecretPromotion()

    expect(save).not.toHaveBeenCalled()
    expect(promotion().pendingSecretPromotion).toBeNull()
  })

  it('does nothing on confirm when no promotion is pending', async () => {
    const { promotion } = await loadPromotionStore()

    expect(() => promotion().confirmSecretPromotion()).not.toThrow()
    expect(promotion().pendingSecretPromotion).toBeNull()
  })

  it('hands the pending promotion to a narrow selector and drops it on cancel', async () => {
    const { useWorkflowStore, promotion } = await loadPromotionStore()
    const save = vi.fn()
    const { result } = renderHook(() =>
      useWorkflowStore((s) => (s as unknown as SecretPromotionSlice).pendingSecretPromotion),
    )

    act(() => promotion().requestSecretPromotion(['api_key'], save))
    expect(result.current).toEqual({ names: ['api_key'], save })

    act(() => promotion().cancelSecretPromotion())
    expect(result.current).toBeNull()
  })

  it('drops a pending promotion without saving when the canvas resets for another Test', async () => {
    const { useWorkflowStore, promotion } = await loadPromotionStore()
    const save = vi.fn()
    promotion().requestSecretPromotion(['api_key'], save)

    useWorkflowStore.getState().reset()

    expect(promotion().pendingSecretPromotion).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
})
