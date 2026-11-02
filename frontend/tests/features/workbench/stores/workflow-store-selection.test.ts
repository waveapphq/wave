/**
 * Workflow Store - Selection Utilities Tests
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations (Rubber-Band Selection)
 * REQ-5.2.1.31 Full keyboard navigation
 *
 * Tests for rectangle intersection, rubber-band selection, and chain selection
 * logic added to the workflow store.
 *
 * Rubber-Band Selection:
 * - Shift+Drag creates visible selection rectangle
 * - All nodes whose bounding boxes intersect the rectangle are added to selection (additive)
 *
 * Chain Selection (Shift+Click):
 * - BFS shortest path between clicked node and nearest selected node
 * - All nodes along the path are added to selection (additive)
 * - No-op when: no selection, clicked node not connected, only selected node clicked
 *
 * Edge Cases:
 * - Shift+click on empty canvas = no-op
 * - Shift+click with no existing selection = no-op
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Type definitions matching workflow-store.ts
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
    nodeType?: 'control' | 'plugin' | 'function'
    config?: Record<string, unknown>
    displayName?: string
    version?: string
    hasNewerVersion?: boolean
    disabled?: boolean
  }
  width?: number
  height?: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Helper to create a node at a given position with known dimensions
function makeNode(
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 80
): NodeType {
  return {
    id,
    type: 'block',
    position: { x, y },
    data: { label: `Node ${id}` },
    width,
    height,
  }
}

describe('REQ-4.2.5 Workflow Store - Selection Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('rectangleIntersectsNode - pure geometry helper', () => {
    let rectangleIntersectsNode: (rect: Rect, node: NodeType) => boolean

    beforeEach(async () => {
      vi.resetModules()
      const mod = await import('@/features/workbench/stores/workflow-store')
      rectangleIntersectsNode = mod.rectangleIntersectsNode
    })

    it('returns true when node is fully inside rectangle', () => {
      const rect: Rect = { x: 0, y: 0, width: 500, height: 500 }
      const node = makeNode('a', 100, 100, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(true)
    })

    it('returns true when node partially overlaps rectangle', () => {
      const rect: Rect = { x: 0, y: 0, width: 150, height: 150 }
      // Node at (100, 100) with width=200, height=80
      // Node occupies x:[100,300], y:[100,180]
      // Rect occupies x:[0,150], y:[0,150]
      // Overlap: x:[100,150], y:[100,150] - partial overlap
      const node = makeNode('a', 100, 100, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(true)
    })

    it('returns false when node is completely outside rectangle', () => {
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 }
      // Node at (200, 200) - no overlap
      const node = makeNode('a', 200, 200, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(false)
    })

    it('returns false when rectangles touch but do not overlap (edge case)', () => {
      const rect: Rect = { x: 0, y: 0, width: 100, height: 100 }
      // Node starts exactly where rect ends - touching at edge
      const node = makeNode('a', 100, 100, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(false)
    })

    it('handles negative-direction selection rectangle (width/height derived from drag)', () => {
      // When user drags right-to-left or bottom-to-top, the rect should still work
      // The rect should be normalized (x,y = top-left corner, positive width/height)
      // The helper should handle or expect normalized input
      const rect: Rect = { x: 50, y: 50, width: 300, height: 200 }
      const node = makeNode('a', 100, 100, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(true)
    })

    it('uses default dimensions when node has no width/height', () => {
      const rect: Rect = { x: 0, y: 0, width: 500, height: 500 }
      const node: NodeType = {
        id: 'a',
        type: 'block',
        position: { x: 100, y: 100 },
        data: { label: 'Node A' },
        // No width/height - should use defaults
      }

      expect(rectangleIntersectsNode(rect, node)).toBe(true)
    })

    it('returns false for zero-area rectangle', () => {
      const rect: Rect = { x: 100, y: 100, width: 0, height: 0 }
      const node = makeNode('a', 100, 100, 200, 80)

      expect(rectangleIntersectsNode(rect, node)).toBe(false)
    })
  })

  describe('selectNodesInRect - store action', () => {
    let getStore: () => import('@/features/workbench/stores/workflow-store').WorkflowState

    beforeEach(async () => {
      vi.resetModules()
      const mod = await import('@/features/workbench/stores/workflow-store')
      const useWorkflowStore = mod.useWorkflowStore
      getStore = () => useWorkflowStore.getState()
      // Reset store
      getStore().reset()
    })

    it('selects all nodes within rectangle', () => {
      const state = getStore()
      // Place 3 nodes: two inside rect, one outside
      state.setNodes([
        makeNode('n1', 100, 100, 200, 80),
        makeNode('n2', 150, 150, 200, 80),
        makeNode('n3', 800, 800, 200, 80),
      ])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('n1')
      expect(updated.selectedNodeIds).toContain('n2')
      expect(updated.selectedNodeIds).not.toContain('n3')
    })

    it('is additive - preserves previously selected nodes', () => {
      const state = getStore()
      state.setNodes([
        makeNode('n1', 100, 100, 200, 80),
        makeNode('n2', 500, 500, 200, 80),
        makeNode('n3', 150, 150, 200, 80),
      ])

      // Pre-select n2 (outside the rect)
      state.setSelectedNodes(['n2'])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      // n2 should still be selected (additive)
      expect(updated.selectedNodeIds).toContain('n2')
      // n1 and n3 should be added
      expect(updated.selectedNodeIds).toContain('n1')
      expect(updated.selectedNodeIds).toContain('n3')
    })

    it('does not duplicate already-selected nodes', () => {
      const state = getStore()
      state.setNodes([
        makeNode('n1', 100, 100, 200, 80),
        makeNode('n2', 150, 150, 200, 80),
      ])

      // Pre-select n1
      state.setSelectedNodes(['n1'])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      // n1 should appear only once
      const n1Count = updated.selectedNodeIds.filter((id: string) => id === 'n1').length
      expect(n1Count).toBe(1)
      expect(updated.selectedNodeIds).toContain('n2')
    })

    it('selects nothing when no nodes intersect rectangle', () => {
      const state = getStore()
      state.setNodes([
        makeNode('n1', 500, 500, 200, 80),
        makeNode('n2', 600, 600, 200, 80),
      ])

      state.selectNodesInRect({ x: 0, y: 0, width: 100, height: 100 })

      const updated = getStore()
      expect(updated.selectedNodeIds).toHaveLength(0)
    })

    it('selects nothing when canvas has no nodes', () => {
      const state = getStore()
      state.setNodes([])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      expect(updated.selectedNodeIds).toHaveLength(0)
    })

    it('clears edge selection when selecting nodes via rect (mutual exclusivity)', () => {
      const state = getStore()
      state.setNodes([makeNode('n1', 100, 100, 200, 80)])
      state.setSelectedEdges(['e1', 'e2'])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('n1')
      expect(updated.selectedEdgeIds).toHaveLength(0)
    })
  })

  describe('chainSelect - Shift+click chain selection', () => {
    let getStore: () => import('@/features/workbench/stores/workflow-store').WorkflowState

    beforeEach(async () => {
      vi.resetModules()
      const mod = await import('@/features/workbench/stores/workflow-store')
      const useWorkflowStore = mod.useWorkflowStore
      getStore = () => useWorkflowStore.getState()
      getStore().reset()
    })

    function makeEdge(id: string, source: string, target: string) {
      return { id, source, target, type: 'smoothstep' }
    }

    it('selects shortest path between selected and clicked node (A→B→C)', () => {
      const state = getStore()
      state.setNodes([
        makeNode('A', 0, 0, 200, 80),
        makeNode('B', 300, 0, 200, 80),
        makeNode('C', 600, 0, 200, 80),
      ])
      state.setEdges([makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')])
      state.setSelectedNodes(['A'])

      state.chainSelect('C')

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('A')
      expect(updated.selectedNodeIds).toContain('B')
      expect(updated.selectedNodeIds).toContain('C')
    })

    it('selects shortest path in reverse direction (D selected, click B)', () => {
      const state = getStore()
      state.setNodes([
        makeNode('A', 0, 0, 200, 80),
        makeNode('B', 300, 0, 200, 80),
        makeNode('C', 600, 0, 200, 80),
        makeNode('D', 900, 0, 200, 80),
        makeNode('E', 1200, 0, 200, 80),
      ])
      state.setEdges([
        makeEdge('e1', 'A', 'B'),
        makeEdge('e2', 'B', 'C'),
        makeEdge('e3', 'C', 'D'),
        makeEdge('e4', 'D', 'E'),
      ])
      state.setSelectedNodes(['D'])

      state.chainSelect('B')

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('B')
      expect(updated.selectedNodeIds).toContain('C')
      expect(updated.selectedNodeIds).toContain('D')
      expect(updated.selectedNodeIds).not.toContain('A')
      expect(updated.selectedNodeIds).not.toContain('E')
    })

    it('is additive - preserves existing selection', () => {
      const state = getStore()
      state.setNodes([
        makeNode('X', 0, 500, 200, 80),
        makeNode('A', 0, 0, 200, 80),
        makeNode('B', 300, 0, 200, 80),
        makeNode('C', 600, 0, 200, 80),
      ])
      state.setEdges([makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')])
      state.setSelectedNodes(['X', 'A'])

      state.chainSelect('C')

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('X')
      expect(updated.selectedNodeIds).toContain('A')
      expect(updated.selectedNodeIds).toContain('B')
      expect(updated.selectedNodeIds).toContain('C')
    })

    it('is no-op when no nodes are selected', () => {
      const state = getStore()
      state.setNodes([makeNode('A', 0, 0, 200, 80), makeNode('B', 300, 0, 200, 80)])
      state.setEdges([makeEdge('e1', 'A', 'B')])
      state.setSelectedNodes([])

      state.chainSelect('B')

      expect(getStore().selectedNodeIds).toHaveLength(0)
    })

    it('is no-op when clicked node is already selected', () => {
      const state = getStore()
      state.setNodes([makeNode('A', 0, 0, 200, 80), makeNode('B', 300, 0, 200, 80)])
      state.setEdges([makeEdge('e1', 'A', 'B')])
      state.setSelectedNodes(['A'])

      state.chainSelect('A')

      expect(getStore().selectedNodeIds).toEqual(['A'])
    })

    it('is no-op when clicked node is not connected to any selected node', () => {
      const state = getStore()
      state.setNodes([
        makeNode('A', 0, 0, 200, 80),
        makeNode('B', 300, 0, 200, 80),
        makeNode('C', 600, 0, 200, 80),
      ])
      state.setEdges([makeEdge('e1', 'A', 'B')])
      state.setSelectedNodes(['A'])

      state.chainSelect('C')

      expect(getStore().selectedNodeIds).toEqual(['A'])
    })

    it('clears edge selection (mutual exclusivity)', () => {
      const state = getStore()
      state.setNodes([makeNode('A', 0, 0, 200, 80), makeNode('B', 300, 0, 200, 80)])
      state.setEdges([makeEdge('e1', 'A', 'B')])
      state.setSelectedNodes(['A'])
      state.setSelectedEdges(['e1'])

      state.chainSelect('B')

      expect(getStore().selectedEdgeIds).toHaveLength(0)
    })

    it('finds shortest path when multiple paths exist', () => {
      const state = getStore()
      // Short: A → B → D  |  Long: A → C → E → D
      state.setNodes([
        makeNode('A', 0, 0, 200, 80),
        makeNode('B', 300, 0, 200, 80),
        makeNode('C', 0, 200, 200, 80),
        makeNode('D', 600, 0, 200, 80),
        makeNode('E', 300, 200, 200, 80),
      ])
      state.setEdges([
        makeEdge('e1', 'A', 'B'),
        makeEdge('e2', 'B', 'D'),
        makeEdge('e3', 'A', 'C'),
        makeEdge('e4', 'C', 'E'),
        makeEdge('e5', 'E', 'D'),
      ])
      state.setSelectedNodes(['A'])

      state.chainSelect('D')

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('A')
      expect(updated.selectedNodeIds).toContain('B')
      expect(updated.selectedNodeIds).toContain('D')
      expect(updated.selectedNodeIds).not.toContain('C')
      expect(updated.selectedNodeIds).not.toContain('E')
    })

    it('works with directly adjacent nodes', () => {
      const state = getStore()
      state.setNodes([makeNode('A', 0, 0, 200, 80), makeNode('B', 300, 0, 200, 80)])
      state.setEdges([makeEdge('e1', 'A', 'B')])
      state.setSelectedNodes(['A'])

      state.chainSelect('B')

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('A')
      expect(updated.selectedNodeIds).toContain('B')
    })
  })

  describe('handleShiftPaneClick - Shift+click on empty canvas', () => {
    let getStore: () => import('@/features/workbench/stores/workflow-store').WorkflowState

    beforeEach(async () => {
      vi.resetModules()
      const mod = await import('@/features/workbench/stores/workflow-store')
      const useWorkflowStore = mod.useWorkflowStore
      getStore = () => useWorkflowStore.getState()
      getStore().reset()
    })

    it('is a no-op regardless of selection state', () => {
      const state = getStore()
      state.setNodes([makeNode('n1', 0, 0, 200, 80), makeNode('n2', 300, 0, 200, 80)])
      state.setSelectedNodes(['n1'])

      state.handleShiftPaneClick({ x: 500, y: 500 })

      expect(getStore().selectedNodeIds).toEqual(['n1'])
    })

    it('is a no-op when no nodes are selected', () => {
      const state = getStore()
      state.setNodes([makeNode('n1', 100, 100, 200, 80)])
      state.setSelectedNodes([])

      state.handleShiftPaneClick({ x: 500, y: 500 })

      expect(getStore().selectedNodeIds).toHaveLength(0)
    })
  })

  describe('Integration with existing selection actions', () => {
    let getStore: () => import('@/features/workbench/stores/workflow-store').WorkflowState

    beforeEach(async () => {
      vi.resetModules()
      const mod = await import('@/features/workbench/stores/workflow-store')
      const useWorkflowStore = mod.useWorkflowStore
      getStore = () => useWorkflowStore.getState()
      getStore().reset()
    })

    it('selectNodesInRect works after clearSelection', () => {
      const state = getStore()
      state.setNodes([makeNode('n1', 100, 100, 200, 80)])
      state.setSelectedNodes(['n1'])
      state.clearSelection()

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })

      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('n1')
    })

    it('selectAll still works after selectNodesInRect', () => {
      const state = getStore()
      state.setNodes([
        makeNode('n1', 100, 100, 200, 80),
        makeNode('n2', 500, 500, 200, 80),
      ])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })
      // Only n1 selected
      expect(getStore().selectedNodeIds).toEqual(['n1'])

      state.selectAll()
      const updated = getStore()
      expect(updated.selectedNodeIds).toContain('n1')
      expect(updated.selectedNodeIds).toContain('n2')
    })

    it('deselectAll clears rect-selected nodes', () => {
      const state = getStore()
      state.setNodes([makeNode('n1', 100, 100, 200, 80)])

      state.selectNodesInRect({ x: 0, y: 0, width: 400, height: 300 })
      expect(getStore().selectedNodeIds).toHaveLength(1)

      state.deselectAll()
      expect(getStore().selectedNodeIds).toHaveLength(0)
    })
  })
})
