/**
 * Workflow Store Accessibility Tests
 *
 * REQ-5.2.1.24 Undo/redo support for critical operations
 *
 * Accessibility specifications:
 * - Screen reader: Announce "Undone: [operation]" / "Redone: [operation]"
 * - Focus management: Focus remains stable during undo/redo
 * - Reduced motion: State changes execute immediately without animation
 *
 * Store API under test:
 * - lastAnnouncement: Screen reader announcement text
 * - prefersReducedMotion(): Check user's motion preference
 * - operationDescription in HistoryEntry: Description for announcements
 * - startDragOperation() / endDragOperation(): For operation tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('REQ-5.2.1.24 Undo/Redo Accessibility', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Screen Reader Announcements', () => {
    /**
     * Per design: "Screen reader: Announce 'Undone: [operation]' / 'Redone: [operation]'"
     */
    it('announces undo operation to screen readers', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Create an aria-live region for announcements if it doesn't exist
      let liveRegion = document.getElementById('undo-redo-announcements')
      if (!liveRegion) {
        liveRegion = document.createElement('div')
        liveRegion.id = 'undo-redo-announcements'
        liveRegion.setAttribute('aria-live', 'polite')
        liveRegion.setAttribute('aria-atomic', 'true')
        liveRegion.className = 'sr-only'
        document.body.appendChild(liveRegion)
      }

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ],
        edges: [],
        history: [
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
            ],
            edges: [],
            timestamp: now - 1000,
            operationDescription: 'Move block',
          },
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
            ],
            edges: [],
            timestamp: now,
            operationDescription: 'Move block',
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      // Check that the live region was updated with announcement
      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: Move block')

      // Cleanup
      document.body.removeChild(liveRegion)
    })

    it('announces redo operation to screen readers', async () => {
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
            operationDescription: 'Move block',
          },
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
            ],
            edges: [],
            timestamp: now,
            operationDescription: 'Move block',
          },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().redo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Redone: Move block')
    })

    it('announces operation type for add node', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        history: [
          {
            nodes: [],
            edges: [],
            timestamp: now - 1000,
            operationDescription: 'Add block',
          },
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
            ],
            edges: [],
            timestamp: now,
            operationDescription: 'Add block',
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: Add block')
    })

    it('announces operation type for delete node', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
            ],
            edges: [],
            timestamp: now - 1000,
            operationDescription: 'Delete block',
          },
          {
            nodes: [],
            edges: [],
            timestamp: now,
            operationDescription: 'Delete block',
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: Delete block')
    })

    it('announces operation type for connection changes', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
        history: [
          {
            nodes: [],
            edges: [],
            timestamp: now - 1000,
            operationDescription: 'Add connection',
          },
          {
            nodes: [],
            edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
            timestamp: now,
            operationDescription: 'Add connection',
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: Add connection')
    })

    it('provides generic announcement when operation description is missing', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [
          {
            nodes: [],
            edges: [],
            timestamp: now - 1000,
            // No operationDescription
          },
          {
            nodes: [],
            edges: [],
            timestamp: now,
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('Undone: last change')
    })

    it('does not announce when undo is not possible', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
        lastAnnouncement: '',
      })

      useWorkflowStore.getState().undo()

      // Should not update announcement when nothing to undo
      expect(useWorkflowStore.getState().lastAnnouncement).toBe('')
    })

    it('does not announce when redo is not possible', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
        lastAnnouncement: '',
      })

      useWorkflowStore.getState().redo()

      expect(useWorkflowStore.getState().lastAnnouncement).toBe('')
    })
  })

  describe('Focus Management', () => {
    /**
     * Per design: "Focus management: Focus remains stable during undo/redo"
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
              { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
            ],
            edges: [],
            timestamp: now,
          },
        ],
        historyIndex: 0,
      })

      useWorkflowStore.getState().redo()

      expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1'])
    })

    it('preserves multiple selections during undo', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
          { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
        ],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
        selectedNodeIds: ['node-1', 'node-2'],
        selectedEdgeIds: ['edge-1'],
        history: [
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 10 }, data: { label: 'Node 1' } },
              { id: 'node-2', type: 'block', position: { x: 100, y: 10 }, data: { label: 'Node 2' } },
            ],
            edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
            timestamp: now - 1000,
          },
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
              { id: 'node-2', type: 'block', position: { x: 100, y: 0 }, data: { label: 'Node 2' } },
            ],
            edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
            timestamp: now,
          },
        ],
        historyIndex: 1,
      })

      useWorkflowStore.getState().undo()

      // Refs that SURVIVE the restore are preserved (refs absent from the
      // restored tree would be released).
      expect(useWorkflowStore.getState().selectedNodeIds).toEqual(['node-1', 'node-2'])
      expect(useWorkflowStore.getState().selectedEdgeIds).toEqual(['edge-1'])
    })
  })

  describe('Reduced Motion Support', () => {
    /**
     * Per design: "Reduced motion: State changes execute immediately without animation"
     */
    it('reports reduced motion preference', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      // Mock matchMedia for prefers-reduced-motion
      const originalMatchMedia = window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      expect(useWorkflowStore.getState().prefersReducedMotion()).toBe(true)

      // Restore
      window.matchMedia = originalMatchMedia
    })

    it('applies immediate state changes when reduced motion is preferred', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Mock reduced motion preference
      const originalMatchMedia = window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      // Post-state baseline model: history holds full snapshots; canvas
      // ALWAYS equals history[historyIndex]. Two entries here so undo can
      // rewind from the post-Move snapshot (index 1) to the baseline (index 0).
      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
        ],
        edges: [],
        history: [
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Previous' } },
            ],
            edges: [],
            timestamp: now - 1000,
            isInitialState: true,
          },
          {
            nodes: [
              { id: 'node-1', type: 'block', position: { x: 100, y: 100 }, data: { label: 'Current' } },
            ],
            edges: [],
            timestamp: now,
            operationDescription: 'Move',
          },
        ],
        historyIndex: 1,
      })

      // Undo should complete immediately without animation delay
      const startTime = Date.now()
      useWorkflowStore.getState().undo()
      const endTime = Date.now()

      // State should be updated synchronously (no animation delay)
      expect(useWorkflowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })
      expect(endTime - startTime).toBeLessThan(50) // Should be nearly instant

      // Restore
      window.matchMedia = originalMatchMedia
    })

    it('handles animation gracefully when reduced motion is not preferred', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      // Mock no reduced motion preference
      const originalMatchMedia = window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      expect(useWorkflowStore.getState().prefersReducedMotion()).toBe(false)

      // Restore
      window.matchMedia = originalMatchMedia
    })

    it('returns false in SSR environment when window is undefined', async () => {
      vi.resetModules()

      // Save original window
      const originalWindow = globalThis.window

      // Mock SSR environment where window is undefined
      // @ts-expect-error - intentionally setting to undefined for SSR test
      delete globalThis.window

      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')

      expect(useWorkflowStore.getState().prefersReducedMotion()).toBe(false)

      // Restore window
      globalThis.window = originalWindow
    })
  })

  describe('Operation Description Tracking', () => {
    it('tracks operation description when adding node', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().addNode({
        id: 'node-1',
        type: 'block',
        position: { x: 0, y: 0 },
        data: { label: 'New Node' },
      })

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Add block')
    })

    it('tracks operation description when removing node', async () => {
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

      useWorkflowStore.getState().removeNode('node-1')

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Delete block')
    })

    it('tracks operation description when adding edge', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().addEdge({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
      })

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Add connection')
    })

    it('tracks operation description when removing edge', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().removeEdge('edge-1')

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Remove connection')
    })

    it('tracks operation description when moving node', async () => {
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
      useWorkflowStore.getState().endDragOperation()

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Move block')
    })

    it('tracks operation description when duplicating', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1'],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().duplicate()

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Duplicate selection')
    })

    it('tracks operation description when pasting', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [],
        edges: [],
        clipboard: {
          nodes: [
            { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
          ],
          edges: [],
        },
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().paste()

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Paste')
    })

    it('tracks operation description when cutting', async () => {
      const { useWorkflowStore } = await import('../../../../src/features/workbench/stores/workflow-store')
      const now = Date.now()
      vi.setSystemTime(now)

      useWorkflowStore.setState({
        nodes: [
          { id: 'node-1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Node' } },
        ],
        edges: [],
        selectedNodeIds: ['node-1'],
        history: [],
        historyIndex: -1,
      })

      useWorkflowStore.getState().cut()

      const history = useWorkflowStore.getState().history
      expect(history[history.length - 1].operationDescription).toBe('Cut selection')
    })
  })
})
