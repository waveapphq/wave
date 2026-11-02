/**
 * Workflow Store Debug Additions - REQ-3.2.1.2, REQ-3.2.2.1, REQ-3.2.2.3
 *
 * Contract for the debug-related store state and actions:
 *  - pausedNodeId (string | null) + setPausedNodeId
 *  - debugOptions ({pauseOnFirstBlock, pauseOnErrors}) + setDebugOptions
 *  - getBreakpointList() selector returning array form of the Set
 *  - clearBreakpointsOnTestClose() action
 *
 * The store is imported inside each test via dynamic import because the
 * module is reset by vi.resetModules() between tests (see tests/setup.ts
 * afterEach) - following the same pattern used in workflow-store.test.ts.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

describe('Workflow Store - Debug Additions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('pausedNodeId', () => {
    it('starts as null', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(useWorkflowStore.getState().pausedNodeId).toBeNull()
    })

    it('exposes a setPausedNodeId action', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(typeof useWorkflowStore.getState().setPausedNodeId).toBe('function')
    })

    it('setPausedNodeId stores the node id', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setPausedNodeId('node-42')
      expect(useWorkflowStore.getState().pausedNodeId).toBe('node-42')
    })

    it('setPausedNodeId(null) clears the paused node', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setPausedNodeId('node-42')
      useWorkflowStore.getState().setPausedNodeId(null)
      expect(useWorkflowStore.getState().pausedNodeId).toBeNull()
    })

    it('reset() clears pausedNodeId', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setPausedNodeId('node-x')
      useWorkflowStore.getState().reset()
      expect(useWorkflowStore.getState().pausedNodeId).toBeNull()
    })
  })

  describe('debugOptions', () => {
    it('starts with both pauseOnFirstBlock and pauseOnErrors set to false', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(useWorkflowStore.getState().debugOptions).toEqual({
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
      })
    })

    it('exposes a setDebugOptions action', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(typeof useWorkflowStore.getState().setDebugOptions).toBe('function')
    })

    it('setDebugOptions replaces the full object', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setDebugOptions({
        pauseOnFirstBlock: true,
        pauseOnErrors: true,
      })
      expect(useWorkflowStore.getState().debugOptions).toEqual({
        pauseOnFirstBlock: true,
        pauseOnErrors: true,
      })
    })

    it('setDebugOptions persists to localStorage under key wave.workbench.debugOptions', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setDebugOptions({
        pauseOnFirstBlock: true,
        pauseOnErrors: false,
      })
      const raw = localStorage.getItem('wave.workbench.debugOptions')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string)).toEqual({
        pauseOnFirstBlock: true,
        pauseOnErrors: false,
      })
    })

    it('rehydrates debugOptions from localStorage on store init', async () => {
      localStorage.setItem(
        'wave.workbench.debugOptions',
        JSON.stringify({ pauseOnFirstBlock: true, pauseOnErrors: true })
      )
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(useWorkflowStore.getState().debugOptions).toEqual({
        pauseOnFirstBlock: true,
        pauseOnErrors: true,
      })
    })

    it('falls back to defaults when localStorage contains malformed JSON', async () => {
      localStorage.setItem('wave.workbench.debugOptions', 'not-json{{')
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(useWorkflowStore.getState().debugOptions).toEqual({
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
      })
    })

  })

  describe('getBreakpointList selector', () => {
    it('returns an empty array when no breakpoints are set', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(useWorkflowStore.getState().getBreakpointList()).toEqual([])
    })

    it('returns an array of node ids for all active breakpoints', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      useWorkflowStore.getState().toggleBreakpoint('node-b')
      useWorkflowStore.getState().toggleBreakpoint('node-c')

      const list = useWorkflowStore.getState().getBreakpointList()
      expect(list).toHaveLength(3)
      expect(list).toEqual(expect.arrayContaining(['node-a', 'node-b', 'node-c']))
    })

    it('returns a plain array (not a Set)', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      const list = useWorkflowStore.getState().getBreakpointList()
      expect(Array.isArray(list)).toBe(true)
    })

    it('reflects removal when a breakpoint is toggled off', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      expect(useWorkflowStore.getState().getBreakpointList()).toEqual([])
    })
  })

  describe('clearBreakpointsOnTestClose action', () => {
    it('is exposed on the store', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      expect(typeof useWorkflowStore.getState().clearBreakpointsOnTestClose).toBe(
        'function'
      )
    })

    it('empties the breakpoints set', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      useWorkflowStore.getState().toggleBreakpoint('node-b')

      useWorkflowStore.getState().clearBreakpointsOnTestClose()

      expect(useWorkflowStore.getState().breakpoints.size).toBe(0)
      expect(useWorkflowStore.getState().getBreakpointList()).toEqual([])
    })

    it('does not wipe unrelated state (nodes, edges, variables)', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().setNodes([
        {
          id: 'node-1',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { label: 'Block' },
        },
      ])
      useWorkflowStore.getState().toggleBreakpoint('node-1')

      useWorkflowStore.getState().clearBreakpointsOnTestClose()

      expect(useWorkflowStore.getState().nodes).toHaveLength(1)
      expect(useWorkflowStore.getState().breakpoints.size).toBe(0)
    })
  })

  describe('clearBreakpoints action', () => {
    it('empties the breakpoints set without touching other state', async () => {
      const { useWorkflowStore } = await import(
        '../../../../src/features/workbench/stores/workflow-store'
      )
      useWorkflowStore.getState().toggleBreakpoint('node-a')
      useWorkflowStore.getState().toggleBreakpoint('node-b')

      useWorkflowStore.getState().clearBreakpoints()

      expect(useWorkflowStore.getState().breakpoints.size).toBe(0)
      expect(useWorkflowStore.getState().getBreakpointList()).toEqual([])
    })
  })
})
