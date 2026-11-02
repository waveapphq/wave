/**
 * WorkflowStore Disable/Skip Tests - Element Context Menu Wiring
 *
 * Tests for toggleDisable(nodeId) and toggleSkip(nodeId) store actions.
 *
 * Design decisions:
 * - CANVAS-43: "Disable" grays out element, skips execution
 * - CANVAS-71: Disabled = structural (no connections)
 * - CANVAS-72: Skipped = runtime (bypassed)
 * - CANVAS-73: Both dashed border, Disabled also 50% opacity
 * - CANVAS-145: "Skip" separate from "Disable"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

// Local type aliases matching store types
interface Position {
  x: number
  y: number
}

interface NodeType {
  id: string
  type: 'block' | 'control' | 'parallel' | 'error-handler' | 'workflowNode'
  position: Position
  data: {
    label: string
    elementType?: string
    disabled?: boolean
  }
}

function makeNode(id: string, overrides?: Partial<NodeType>): NodeType {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: { label: `Node ${id}` },
    ...overrides,
  }
}

describe('WorkflowStore Disable/Skip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      isDirty: false,
      history: [],
      historyIndex: -1,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('toggleDisable', () => {
    it('sets disabled=true on a node that is not disabled', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
      })

      useWorkflowStore.getState().toggleDisable('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(true)
    })

    it('sets disabled=false on a node that is already disabled', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1', { data: { label: 'Node n1', disabled: true } })],
      })

      useWorkflowStore.getState().toggleDisable('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(false)
    })

    it('does nothing for non-existent node', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
      })

      useWorkflowStore.getState().toggleDisable('non-existent')

      // State unchanged
      const nodes = useWorkflowStore.getState().nodes
      expect(nodes).toHaveLength(1)
      expect(nodes[0].data.disabled).toBeUndefined()
    })

    it('marks state as dirty', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        isDirty: false,
      })

      useWorkflowStore.getState().toggleDisable('n1')

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it('commits a post-state history entry above the baseline', () => {
      const node = makeNode('n1')
      useWorkflowStore.setState({
        nodes: [node],
        history: [
          { nodes: [node], edges: [], timestamp: Date.now(), isInitialState: true },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().toggleDisable('n1')

      // Post-state baseline model: baseline + 1 commit = 2 entries; the new
      // entry IS the post-mutation state (disabled=true).
      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(2)
      expect(state.historyIndex).toBe(1)
      expect(state.history[1].nodes[0].data.disabled).toBe(true)
    })

    it('does not affect other nodes', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2')],
      })

      useWorkflowStore.getState().toggleDisable('n1')

      const n1 = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      const n2 = useWorkflowStore.getState().nodes.find((n) => n.id === 'n2')
      expect(n1?.data.disabled).toBe(true)
      expect(n2?.data.disabled).toBeUndefined()
    })

    it('preserves other node data when toggling', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', {
            data: { label: 'Custom Label', elementType: 'http-client' },
          }),
        ],
      })

      useWorkflowStore.getState().toggleDisable('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.label).toBe('Custom Label')
      expect(node?.data.elementType).toBe('http-client')
      expect(node?.data.disabled).toBe(true)
    })

    it('does NOT remove edges when disabling (edges preserved)', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      })

      useWorkflowStore.getState().toggleDisable('n2')

      const edges = useWorkflowStore.getState().edges
      expect(edges).toHaveLength(2)
      expect(edges[0].id).toBe('e1')
      expect(edges[1].id).toBe('e2')
    })

    it('does not remove edges when re-enabling a node', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1'),
          makeNode('n2', { data: { label: 'Node n2', disabled: true } }),
          makeNode('n3'),
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n3' },
        ],
      })

      useWorkflowStore.getState().toggleDisable('n2')

      const edges = useWorkflowStore.getState().edges
      expect(edges).toHaveLength(1)
      expect(edges[0].id).toBe('e1')
    })
  })

  describe('toggleSkip (transient skippedNodeIds - CANVAS-72)', () => {
    it('adds node ID to skippedNodeIds when not skipped', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: [],
      })

      useWorkflowStore.getState().toggleSkip('n1')

      expect(useWorkflowStore.getState().skippedNodeIds).toContain('n1')
    })

    it('removes node ID from skippedNodeIds when already skipped', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: ['n1'],
      })

      useWorkflowStore.getState().toggleSkip('n1')

      expect(useWorkflowStore.getState().skippedNodeIds).not.toContain('n1')
    })

    it('does nothing for non-existent node', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: [],
      })

      useWorkflowStore.getState().toggleSkip('non-existent')

      expect(useWorkflowStore.getState().skippedNodeIds).toHaveLength(0)
    })

    it('does not mark state as dirty (skip is transient - CANVAS-72)', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: [],
        isDirty: false,
      })

      useWorkflowStore.getState().toggleSkip('n1')

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })

    it('commits NO history entry (skip is runtime-transient, never undoable)', () => {
      const node = makeNode('n1')
      useWorkflowStore.setState({
        nodes: [node],
        skippedNodeIds: [],
        history: [
          { nodes: [node], edges: [], timestamp: Date.now(), isInitialState: true },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().toggleSkip('n1')

      // Snapshots cannot represent skip state (skippedNodeIds is not in
      // HistoryEntry); committing produced dead undo steps that could
      // fake-dirty on redo.
      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(1)
      expect(state.historyIndex).toBe(0)
      expect(state.canUndo()).toBe(false)
    })

    it('undo never reverts a skip mark', () => {
      const node = makeNode('n1')
      useWorkflowStore.setState({
        nodes: [node],
        skippedNodeIds: [],
        history: [
          { nodes: [node], edges: [], timestamp: Date.now(), isInitialState: true },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().toggleSkip('n1')
      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().skippedNodeIds).toEqual(['n1'])
    })

    it('does not affect other nodes in skippedNodeIds', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2')],
        skippedNodeIds: [],
      })

      useWorkflowStore.getState().toggleSkip('n1')

      expect(useWorkflowStore.getState().skippedNodeIds).toEqual(['n1'])
    })

    it('does not mutate node data (skip is NOT in node.data)', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', {
            data: { label: 'Custom Label', elementType: 'sql-client' },
          }),
        ],
        skippedNodeIds: [],
      })

      useWorkflowStore.getState().toggleSkip('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.label).toBe('Custom Label')
      expect(node?.data.elementType).toBe('sql-client')
      expect(node?.data).not.toHaveProperty('skipped')
    })
  })

  describe('Skip persists across save (CANVAS-72: transient but not cleared on save)', () => {
    it('preserves skippedNodeIds when markSaved is called', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2')],
        skippedNodeIds: ['n1', 'n2'],
        isDirty: true,
      })

      useWorkflowStore.getState().markSaved()

      expect(useWorkflowStore.getState().skippedNodeIds).toEqual(['n1', 'n2'])
    })

    it('skippedNodeIds is never saved to node data', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: ['n1'],
        isDirty: true,
      })

      useWorkflowStore.getState().markSaved()

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data).not.toHaveProperty('skipped')
    })
  })

  describe('Disable and Skip coexistence', () => {
    it('allows a node to be both disabled and skipped', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: [],
      })

      useWorkflowStore.getState().toggleDisable('n1')
      useWorkflowStore.getState().toggleSkip('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(true)
      expect(useWorkflowStore.getState().skippedNodeIds).toContain('n1')
    })

    it('toggles disable independently of skip', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
        ],
        skippedNodeIds: ['n1'],
      })

      // Toggle disable off - skip should remain
      useWorkflowStore.getState().toggleDisable('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(false)
      expect(useWorkflowStore.getState().skippedNodeIds).toContain('n1')
    })

    it('toggles skip independently of disable', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
        ],
        skippedNodeIds: ['n1'],
      })

      // Toggle skip off - disable should remain
      useWorkflowStore.getState().toggleSkip('n1')

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(true)
      expect(useWorkflowStore.getState().skippedNodeIds).not.toContain('n1')
    })
  })

  describe('unlinkNode', () => {
    it('removes all ingress and egress edges for a node', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      })

      useWorkflowStore.getState().unlinkNode('n2')

      const edges = useWorkflowStore.getState().edges
      expect(edges).toHaveLength(0)
    })

    it('only removes edges connected to the unlinked node', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3'), makeNode('n4')],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n3', target: 'n4' },
        ],
      })

      useWorkflowStore.getState().unlinkNode('n2')

      const edges = useWorkflowStore.getState().edges
      expect(edges).toHaveLength(1)
      expect(edges[0].id).toBe('e2')
    })

    it('marks state as dirty', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2')],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        isDirty: false,
      })

      useWorkflowStore.getState().unlinkNode('n2')

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it('commits a post-state history entry above the baseline', () => {
      const n1 = makeNode('n1')
      const n2 = makeNode('n2')
      useWorkflowStore.setState({
        nodes: [n1, n2],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        history: [
          {
            nodes: [n1, n2],
            edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
            timestamp: Date.now(),
            isInitialState: true,
          },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().unlinkNode('n2')

      // Post-state baseline model: baseline + 1 commit = 2 entries; the new
      // entry IS the post-mutation state (edge gone).
      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(2)
      expect(state.historyIndex).toBe(1)
      expect(state.history[1].edges).toEqual([])
      expect(state.history[1].operationDescription).toBe('Unlink block')
    })

    it('does nothing for non-existent node', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2')],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      })

      useWorkflowStore.getState().unlinkNode('non-existent')

      const edges = useWorkflowStore.getState().edges
      expect(edges).toHaveLength(1)
    })
  })

  describe('unskipAll', () => {
    it('clears all skipped node IDs', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')],
        skippedNodeIds: ['n1', 'n2'],
      })

      useWorkflowStore.getState().unskipAll()

      expect(useWorkflowStore.getState().skippedNodeIds).toEqual([])
    })

    it('does NOT mark state as dirty (skip is transient)', () => {
      useWorkflowStore.setState({
        nodes: [makeNode('n1')],
        skippedNodeIds: ['n1'],
        isDirty: false,
      })

      useWorkflowStore.getState().unskipAll()

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })

    it('preserves disabled state on nodes', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
        ],
        skippedNodeIds: ['n1'],
      })

      useWorkflowStore.getState().unskipAll()

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(true)
      expect(useWorkflowStore.getState().skippedNodeIds).toEqual([])
    })

    it('commits NO history entry (symmetry with toggleSkip)', () => {
      const n1 = makeNode('n1')
      useWorkflowStore.setState({
        nodes: [n1],
        skippedNodeIds: ['n1'],
        history: [
          { nodes: [n1], edges: [], timestamp: Date.now(), isInitialState: true },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().unskipAll()

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(1)
      expect(state.historyIndex).toBe(0)
      expect(state.canUndo()).toBe(false)
    })
  })

  describe('enableAll', () => {
    it('clears disabled on all nodes', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
          makeNode('n2', { data: { label: 'Node n2', disabled: true } }),
          makeNode('n3', { data: { label: 'Node n3' } }),
        ],
      })

      useWorkflowStore.getState().enableAll()

      const nodes = useWorkflowStore.getState().nodes
      expect(nodes.find((n) => n.id === 'n1')?.data.disabled).toBe(false)
      expect(nodes.find((n) => n.id === 'n2')?.data.disabled).toBe(false)
      expect(nodes.find((n) => n.id === 'n3')?.data.disabled).toBeUndefined()
    })

    it('marks state as dirty', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
        ],
        isDirty: false,
      })

      useWorkflowStore.getState().enableAll()

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it('preserves skippedNodeIds', () => {
      useWorkflowStore.setState({
        nodes: [
          makeNode('n1', { data: { label: 'Node n1', disabled: true } }),
        ],
        skippedNodeIds: ['n1'],
      })

      useWorkflowStore.getState().enableAll()

      const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'n1')
      expect(node?.data.disabled).toBe(false)
      expect(useWorkflowStore.getState().skippedNodeIds).toContain('n1')
    })

    it('commits a post-state history entry above the baseline', () => {
      // Per the post-state baseline model: enableAll is a
      // user-visible mutation and must produce one history entry so that
      // undo restores all the disabled flags.
      const n1 = makeNode('n1', { data: { label: 'Node n1', disabled: true } })
      const n2 = makeNode('n2', { data: { label: 'Node n2', disabled: true } })
      useWorkflowStore.setState({
        nodes: [n1, n2],
        history: [
          { nodes: [n1, n2], edges: [], timestamp: Date.now(), isInitialState: true },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().enableAll()

      const state = useWorkflowStore.getState()
      expect(state.history.length).toBe(2)
      expect(state.historyIndex).toBe(1)
      // Entry IS the post-mutation state (both enabled)
      expect(state.history[1].nodes[0].data.disabled).toBe(false)
      expect(state.history[1].nodes[1].data.disabled).toBe(false)
    })
  })

  describe('setPulseValidationNodeIds', () => {
    it('replaces the pulse set wholesale', () => {
      useWorkflowStore.getState().setPulseValidationNodeIds(['n1', 'n2'])

      const after = useWorkflowStore.getState().pulseValidationNodeIds
      expect(after.has('n1')).toBe(true)
      expect(after.has('n2')).toBe(true)
    })
  })

  describe('clearPulseValidationNodeId', () => {
    it('removes a single node ID from the pulse set', () => {
      useWorkflowStore.getState().setPulseValidationNodeIds(['n1', 'n2', 'n3'])

      useWorkflowStore.getState().clearPulseValidationNodeId('n2')

      const after = useWorkflowStore.getState().pulseValidationNodeIds
      expect(after.has('n2')).toBe(false)
      expect(after.has('n1')).toBe(true)
      expect(after.has('n3')).toBe(true)
    })
  })

  describe('reset clears pulseValidationNodeIds', () => {
    it('clears the pulse set on reset', () => {
      useWorkflowStore.getState().setPulseValidationNodeIds(['n1', 'n2'])

      useWorkflowStore.getState().reset()

      expect(useWorkflowStore.getState().pulseValidationNodeIds.size).toBe(0)
    })
  })
})
