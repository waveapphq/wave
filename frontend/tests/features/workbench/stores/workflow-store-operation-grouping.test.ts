/**
 * Workflow Store Operation Grouping Tests
 *
 * REQ-5.2.1.24 Undo/redo support for critical operations
 *
 * Grouping specifications:
 * - Text input: Characters typed within 500ms group together
 * - Drag operations: Drag start to drop is single operation
 * - Batch selections: Multi-select followed by action is single operation
 * - Explicit group: Operations within programmatic transaction group together
 *
 * Store API under test:
 * - updateNodeWithGrouping(): Debounced node updates for text input
 * - startDragOperation() / endDragOperation() / cancelDragOperation(): Drag grouping
 * - deleteSelected() / moveSelectedNodes(): Batch operations
 * - transaction(): Programmatic grouping
 * - isDragging / isInTransaction: State indicators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  EdgeType,
  HistoryEntry,
  NodeType,
} from '../../../../src/features/workbench/stores/workflow-store'

/**
 * Build a baseline history entry for the post-state baseline model. Every
 * test that asserts undo behavior must seed the canvas this way so the
 * pointer can move from index 1 (post-op) back to index 0 (baseline).
 */
function makeBaselineEntry(
  nodes: NodeType[] = [],
  edges: EdgeType[] = [],
): HistoryEntry {
  return {
    nodes: [...nodes],
    edges: [...edges],
    timestamp: Date.now(),
    operationDescription: 'Saved baseline',
    isInitialState: true,
  }
}

describe('REQ-5.2.1.24 Operation Grouping', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Text Input Grouping', () => {
    /**
     * Per design: "Text input: Characters typed within 500ms group together"
     */
    it('groups text changes within 500ms into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: '' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      // Simulate rapid text input (typing "chart")
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'c' } })
      vi.advanceTimersByTime(100) // 100ms
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'ch' } })
      vi.advanceTimersByTime(100) // 200ms total
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'cha' } })
      vi.advanceTimersByTime(100) // 300ms total
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'char' } })
      vi.advanceTimersByTime(100) // 400ms total
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'chart' } })

      // Wait for debounce to complete (500ms from last input)
      vi.advanceTimersByTime(500)

      // Should only have ONE history entry for all the typing
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('chart')
    })

    it('creates separate history entries for text changes >500ms apart', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: '' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      // First text input
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'first' } })
      vi.advanceTimersByTime(500) // Wait for debounce

      // Second text input after 500ms gap
      vi.advanceTimersByTime(100) // Extra gap
      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'second' } })
      vi.advanceTimersByTime(500) // Wait for debounce

      // Should have TWO history entries
      expect(useWorkflowStore.getState().history.length).toBe(2)
    })

    it('text input debounce uses 500ms interval per design', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: '' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().updateNodeWithGrouping('node-1', { data: { label: 'a' } })

      // At 499ms, history should not be pushed yet
      vi.advanceTimersByTime(499)
      expect(useWorkflowStore.getState().history.length).toBe(0)

      // At 500ms, history should be pushed
      vi.advanceTimersByTime(1)
      expect(useWorkflowStore.getState().history.length).toBe(1)
    })

    it('updateNodeWithGrouping does nothing for non-existent node', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      const originalNodes = [
        { id: 'node-1', type: 'block' as const, position: { x: 0, y: 0 }, data: { label: 'Original' } },
      ]

      useWorkflowStore.setState({
        nodes: originalNodes,
        edges: [],
        history: [],
        historyIndex: -1,
      })

      // Try to update a node that doesn't exist
      useWorkflowStore.getState().updateNodeWithGrouping('non-existent', { data: { label: 'New' } })

      // Wait for debounce
      vi.advanceTimersByTime(500)

      // State should remain unchanged (node not found)
      expect(useWorkflowStore.getState().nodes[0].data.label).toBe('Original')
    })

    it('commitHistory does nothing during drag operation', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
        isDragging: true, // In a drag operation
        dragStartState: {
          nodes: [],
          edges: [],
          variables: [],
        },
      })

      // Calling commitHistory during drag should be a no-op (drag end will commit)
      useWorkflowStore.getState().commitHistory('Manual push during drag')

      // No history should be added during drag
      expect(useWorkflowStore.getState().history.length).toBe(0)
    })
  })

  describe('Drag Operation Grouping', () => {
    /**
     * Per design: "Drag operations: Drag start to drop is single operation"
     */
    it('groups entire drag operation into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      // Start drag operation
      useWorkflowStore.getState().startDragOperation()

      // Multiple position updates during drag
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 10, y: 10 } })
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 20, y: 20 } })
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 30, y: 30 } })
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 50, y: 50 } })

      // End drag operation (drop)
      useWorkflowStore.getState().endDragOperation()

      // Should only have ONE history entry for entire drag
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 50, y: 50 })
    })

    it('does not create history entries during drag', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().startDragOperation()

      // Update position multiple times
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 200, y: 200 } })

      // History should still be empty during drag
      expect(useWorkflowStore.getState().history.length).toBe(0)

      useWorkflowStore.getState().endDragOperation()

      // Now history should have one entry
      expect(useWorkflowStore.getState().history.length).toBe(1)
    })

    it('undoing drag reverts to position before drag started', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      const originalPosition = { x: 0, y: 0 }
      const startNode: NodeType = {
        id: 'node-1', type: 'block', position: originalPosition, data: { label: 'Node' },
      }

      // Post-state baseline model: seed a baseline so undo can move from
      // the post-drag entry (index 1) back to the baseline (index 0).
      useWorkflowStore.setState({
        nodes: [startNode],
        edges: [],
        history: [makeBaselineEntry([startNode])],
        historyIndex: 0,
      })

      // Do a drag
      useWorkflowStore.getState().startDragOperation()
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 200, y: 200 } })
      useWorkflowStore.getState().endDragOperation()

      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 200, y: 200 })
      expect(useWorkflowStore.getState().historyIndex).toBe(1)

      // Undo should revert to original position
      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual(originalPosition)
    })
  })

  describe('Batch Selection Grouping', () => {
    /**
     * Per design: "Batch selections: Multi-select followed by action is single operation"
     */
    it('groups multi-node deletion into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1', 'node-2', 'node-3'],
        history: [],
        historyIndex: -1,
      })

      // Delete all selected nodes as batch
      useWorkflowStore.getState().deleteSelected()

      // Should only have ONE history entry for batch delete
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().nodes.length).toBe(0)
    })

    it('undoing batch deletion restores all nodes at once', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      const originalNodes: NodeType[] = [
        { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
      ]

      // Post-state baseline model: seed a baseline so undo can rewind.
      useWorkflowStore.setState({
        nodes: originalNodes,
        edges: [],
        selectedNodeIds: ['node-1', 'node-2', 'node-3'],
        history: [makeBaselineEntry(originalNodes)],
        historyIndex: 0,
      })

      useWorkflowStore.getState().deleteSelected()
      expect(useWorkflowStore.getState().nodes.length).toBe(0)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)

      // Undo should restore all nodes
      useWorkflowStore.getState().undo()
      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes.length).toBe(3)
    })

    it('groups multi-node move into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1', 'node-2'],
        history: [],
        historyIndex: -1,
      })

      // Move selected nodes as batch
      useWorkflowStore.getState().moveSelectedNodes({ x: 50, y: 50 })

      // Should only have ONE history entry
      expect(useWorkflowStore.getState().history.length).toBe(1)
    })

    it('moveSelectedNodes only moves selected nodes, unselected remain in place', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
          { id: 'node-3', type: 'block', position: { x: 200, y: 0 }, data: { label: 'Node 3' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1'], // Only node-1 is selected
        history: [],
        historyIndex: -1,
      })

      // Move selected nodes by delta
      useWorkflowStore.getState().moveSelectedNodes({ x: 50, y: 25 })

      const nodes = useWorkflowStore.getState().nodes

      // node-1 should be moved
      expect(nodes.find((n) => n.id === 'node-1')?.position).toEqual({ x: 50, y: 25 })

      // node-2 and node-3 should remain unchanged (else branch of ternary)
      expect(nodes.find((n) => n.id === 'node-2')?.position).toEqual({ x: 100, y: 0 })
      expect(nodes.find((n) => n.id === 'node-3')?.position).toEqual({ x: 200, y: 0 })
    })

    it('groups multi-node duplicate into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1', 'node-2'],
        history: [],
        historyIndex: -1,
      })

      // Duplicate selected nodes
      useWorkflowStore.getState().duplicate()

      // Should only have ONE history entry
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().nodes.length).toBe(4)
    })
  })

  describe('Programmatic Transaction Grouping', () => {
    /**
     * Per design: "Explicit group: Operations within programmatic transaction group together"
     */
    it('groups operations within transaction into single history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      // Use transaction to group multiple operations
      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node 1' },
        })
        useWorkflowStore.getState().addNode({
          id: 'node-2',
          type: 'block',
          position: { x: 100, y: 0 },
          data: { label: 'Node 2' },
        })
        useWorkflowStore.getState().addEdge({
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        })
      })

      // Should only have ONE history entry for entire transaction
      expect(useWorkflowStore.getState().history.length).toBe(1)
      expect(useWorkflowStore.getState().nodes.length).toBe(2)
      expect(useWorkflowStore.getState().edges.length).toBe(1)
    })

    it('undoing transaction reverts all operations', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Post-state baseline model: seed a baseline so undo can rewind.
      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [makeBaselineEntry()],
        historyIndex: 0,
      })

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node 1' },
        })
        useWorkflowStore.getState().addNode({
          id: 'node-2',
          type: 'block',
          position: { x: 100, y: 0 },
          data: { label: 'Node 2' },
        })
        useWorkflowStore.getState().addEdge({
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
        })
      })

      expect(useWorkflowStore.getState().nodes.length).toBe(2)
      expect(useWorkflowStore.getState().edges.length).toBe(1)
      expect(useWorkflowStore.getState().historyIndex).toBe(1)

      // Undo should revert everything to the baseline
      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().historyIndex).toBe(0)
      expect(useWorkflowStore.getState().nodes.length).toBe(0)
      expect(useWorkflowStore.getState().edges.length).toBe(0)
    })

    it('nested transactions are flattened', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().addNode({
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Node 1' },
        })

        // Nested transaction
        useWorkflowStore.getState().transaction(() => {
          useWorkflowStore.getState().addNode({
            id: 'node-2',
            type: 'block',
            position: { x: 100, y: 0 },
            data: { label: 'Node 2' },
          })
        })
      })

      // Should still only have ONE history entry
      expect(useWorkflowStore.getState().history.length).toBe(1)
    })
  })

  describe('Grouping State Indicators', () => {
    it('isDragging returns true during drag operation', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
      })

      expect(useWorkflowStore.getState().isDragging).toBe(false)

      useWorkflowStore.getState().startDragOperation()
      expect(useWorkflowStore.getState().isDragging).toBe(true)

      useWorkflowStore.getState().endDragOperation()
      expect(useWorkflowStore.getState().isDragging).toBe(false)
    })

    it('isInTransaction returns true during transaction', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
      })

      expect(useWorkflowStore.getState().isInTransaction).toBe(false)

      useWorkflowStore.getState().transaction(() => {
        expect(useWorkflowStore.getState().isInTransaction).toBe(true)
      })

      expect(useWorkflowStore.getState().isInTransaction).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('canceling drag does not create history entry', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().startDragOperation()
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })
      useWorkflowStore.getState().cancelDragOperation()

      // Should revert to original position and not create history
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })
      expect(useWorkflowStore.getState().history.length).toBe(0)
    })

    it('cancelDragOperation does nothing when not dragging', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      const originalNodes = [
        { id: 'node-1', type: 'block' as const, position: { x: 0, y: 0 }, data: { label: 'Node' } },
      ]

      useWorkflowStore.setState({
        nodes: originalNodes,
        edges: [],
        history: [],
        historyIndex: -1,
        isDragging: false,
        dragStartState: null,
      })

      // Calling cancelDragOperation when not dragging should be a no-op
      useWorkflowStore.getState().cancelDragOperation()

      // State should remain unchanged
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })
      expect(useWorkflowStore.getState().isDragging).toBe(false)
    })

    it('endDragOperation does nothing when not dragging', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [],
        historyIndex: -1,
        isDragging: false,
        dragStartState: null,
      })

      // Calling endDragOperation when not dragging should be a no-op
      useWorkflowStore.getState().endDragOperation()

      // State should remain unchanged (no history added)
      expect(useWorkflowStore.getState().history.length).toBe(0)
      expect(useWorkflowStore.getState().isDragging).toBe(false)
    })

    it('deleteSelected does nothing when no nodes are selected', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ],
        edges: [],
        selectedNodeIds: [], // No selection
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().deleteSelected()

      // Nothing should be deleted, no history added
      expect(useWorkflowStore.getState().nodes.length).toBe(1)
      expect(useWorkflowStore.getState().history.length).toBe(0)
    })

    it('moveSelectedNodes does nothing when no nodes are selected', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
        ],
        edges: [],
        selectedNodeIds: [], // No selection
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().moveSelectedNodes({ x: 100, y: 100 })

      // Nothing should move, no history added
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })
      expect(useWorkflowStore.getState().history.length).toBe(0)
    })

    it('transaction error rolls back all changes', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      try {
        useWorkflowStore.getState().transaction(() => {
          useWorkflowStore.getState().addNode({
            id: 'node-1',
            type: 'block',
            position: { x: 0, y: 0 },
            data: { label: 'Node 1' },
          })
          throw new Error('Simulated error')
        })
      } catch {
        // Expected error
      }

      // Should roll back to empty state
      expect(useWorkflowStore.getState().nodes.length).toBe(0)
      expect(useWorkflowStore.getState().history.length).toBe(0)
    })

    it('transaction error with null transactionStartState falls back to empty arrays', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'existing', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Existing' } },
        ],
        edges: [{ id: 'edge-1', source: 'a', target: 'b' }],
        history: [],
        historyIndex: -1,
      })

      try {
        useWorkflowStore.getState().transaction(() => {
          // Clear transactionStartState during the transaction (edge case)
          // This simulates a race condition or corrupted state
          useWorkflowStore.setState({ transactionStartState: null })
          throw new Error('Simulated error with null transactionStartState')
        })
      } catch {
        // Expected error
      }

      // With null transactionStartState, rollback uses empty arrays as fallback
      expect(useWorkflowStore.getState().nodes).toEqual([])
      expect(useWorkflowStore.getState().edges).toEqual([])
      expect(useWorkflowStore.getState().isInTransaction).toBe(false)
    })
  })

  describe('History Truncation in Operations', () => {
    /**
     * Per design: "Maximum depth | 50 operations"
     * These tests verify that endDragOperation and transaction enforce the max history limit
     */
    it('endDragOperation respects max history length', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Create a full history stack (50 entries)
      const history = Array.from({ length: 50 }, (_, i) => ({
        nodes: [],
        edges: [],
        timestamp: now - (50 - i) * 1000,
        operationDescription: `Operation ${i}`,
      }))

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history,
        historyIndex: 49,
        maxHistoryLength: 50,
      })

      // Perform drag operation
      useWorkflowStore.getState().startDragOperation()
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })
      useWorkflowStore.getState().endDragOperation()

      // History should still be at max (50), oldest entry removed
      expect(useWorkflowStore.getState().history.length).toBe(50)
    })

    it('endDragOperation removes oldest entries when exceeding max depth', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Create history with identifiable first entry
      const firstTimestamp = now - 50000
      const history = [
        {
          nodes: [{ id: 'first', type: 'block' as const, position: { x: 0, y: 0 }, data: { label: 'First' } }],
          edges: [],
          timestamp: firstTimestamp,
          operationDescription: 'First operation',
        },
        ...Array.from({ length: 49 }, (_, i) => ({
          nodes: [],
          edges: [],
          timestamp: now - (49 - i) * 1000,
          operationDescription: `Operation ${i + 1}`,
        })),
      ]

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history,
        historyIndex: 49,
        maxHistoryLength: 50,
      })

      // Verify first entry exists
      expect(useWorkflowStore.getState().history[0].nodes[0]?.id).toBe('first')

      // Perform drag operation
      useWorkflowStore.getState().startDragOperation()
      useWorkflowStore.getState().updateNode('node-1', { position: { x: 100, y: 100 } })
      useWorkflowStore.getState().endDragOperation()

      // First entry should be removed (oldest)
      expect(useWorkflowStore.getState().history[0].nodes[0]?.id).not.toBe('first')
      expect(useWorkflowStore.getState().history.length).toBe(50)
    })

    it('transaction respects max history length', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Create a full history stack (50 entries)
      const history = Array.from({ length: 50 }, (_, i) => ({
        nodes: [],
        edges: [],
        timestamp: now - (50 - i) * 1000,
        operationDescription: `Operation ${i}`,
      }))

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history,
        historyIndex: 49,
        maxHistoryLength: 50,
      })

      // Perform transaction
      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().addNode({
          id: 'new-node',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'New Node' },
        })
      })

      // History should still be at max (50), oldest entry removed
      expect(useWorkflowStore.getState().history.length).toBe(50)
    })

    it('transaction removes oldest entries when exceeding max depth', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Create history with identifiable first entry
      const firstTimestamp = now - 50000
      const history = [
        {
          nodes: [{ id: 'first', type: 'block' as const, position: { x: 0, y: 0 }, data: { label: 'First' } }],
          edges: [],
          timestamp: firstTimestamp,
          operationDescription: 'First operation',
        },
        ...Array.from({ length: 49 }, (_, i) => ({
          nodes: [],
          edges: [],
          timestamp: now - (49 - i) * 1000,
          operationDescription: `Operation ${i + 1}`,
        })),
      ]

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history,
        historyIndex: 49,
        maxHistoryLength: 50,
      })

      // Verify first entry exists
      expect(useWorkflowStore.getState().history[0].nodes[0]?.id).toBe('first')

      // Perform transaction
      useWorkflowStore.getState().transaction(() => {
        useWorkflowStore.getState().addNode({
          id: 'new-node',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'New Node' },
        })
      })

      // First entry should be removed (oldest)
      expect(useWorkflowStore.getState().history[0].nodes[0]?.id).not.toBe('first')
      expect(useWorkflowStore.getState().history.length).toBe(50)
    })
  })
})
