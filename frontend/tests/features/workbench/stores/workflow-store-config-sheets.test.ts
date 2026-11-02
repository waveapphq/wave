/**
 * Workflow Store - Config sheets state tests (CANVAS-227, CANVAS-230).
 *
 * Contract:
 *   - `openConfigNodeIds: string[]` replaces the single `configModalNodeId`.
 *     Order = open order (drives the cascade offset index).
 *   - `openConfigModal(nodeId)` appends if absent and under the cap of 10;
 *     duplicate opens and over-cap opens are silent no-ops (the canvas layer
 *     owns the cap toast and the bring-to-front focus).
 *   - `closeConfigModal(nodeId)` removes one id; `closeAllConfigModals()`
 *     empties the list (test-switch / View-open path).
 *   - Node removal (direct delete AND undo/redo restore) drops the node's id
 *     from `openConfigNodeIds` - "node removed -> sheet closes".
 *   - `lastInteractedNodeId` tracks the most recently selected node, survives
 *     deselection, and is released when its node is removed.
 *   - `reset()` clears both fields.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type StoreState = ReturnType<typeof useWorkflowStore.getState>

interface ConfigSheetSlice {
  openConfigNodeIds: string[]
  lastInteractedNodeId: string | null
  dirtyConfigNodeIds: string[]
  pendingDeleteNodeIds: string[] | null
  pendingDrillAction: { run: () => void } | null
  openConfigModal: (nodeId: string) => void
  closeConfigModal: (nodeId: string) => void
  closeAllConfigModals: () => void
  setConfigSheetDirty: (nodeId: string, dirty: boolean) => void
  requestDeleteSelected: () => void
  confirmPendingDelete: () => void
  cancelPendingDelete: () => void
  requestDrill: (run: () => void) => void
  confirmPendingDrill: () => void
  cancelPendingDrill: () => void
}

function getStore(): StoreState & ConfigSheetSlice {
  return useWorkflowStore.getState() as StoreState & ConfigSheetSlice
}

function makeNode(id: string) {
  return {
    id,
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: { label: id, elementType: 'log', nodeType: 'plugin' as const },
  }
}

function seedNodes(ids: string[]): void {
  useWorkflowStore.setState({
    nodes: ids.map(makeNode),
    edges: [],
  } as unknown as Partial<StoreState>)
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('openConfigNodeIds - open/close actions', () => {
  it('starts empty', () => {
    expect(getStore().openConfigNodeIds).toEqual([])
  })

  it('openConfigModal appends ids in open order', () => {
    seedNodes(['n1', 'n2', 'n3'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    expect(getStore().openConfigNodeIds).toEqual(['n1', 'n2'])
  })

  it('duplicate open is a no-op and keeps the original order', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    getStore().openConfigModal('n1')
    expect(getStore().openConfigNodeIds).toEqual(['n1', 'n2'])
  })

  it('caps the open list at 10 and silently refuses the 11th', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `n${i + 1}`)
    seedNodes(ids)
    for (const id of ids) {
      getStore().openConfigModal(id)
    }
    expect(getStore().openConfigNodeIds).toHaveLength(10)
    expect(getStore().openConfigNodeIds).not.toContain('n11')
    expect(getStore().openConfigNodeIds).toEqual(ids.slice(0, 10))
  })

  it('closeConfigModal removes exactly the given id', () => {
    seedNodes(['n1', 'n2', 'n3'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    getStore().openConfigModal('n3')
    getStore().closeConfigModal('n2')
    expect(getStore().openConfigNodeIds).toEqual(['n1', 'n3'])
  })

  it('closeConfigModal of an id that is not open is a no-op', () => {
    seedNodes(['n1'])
    getStore().openConfigModal('n1')
    getStore().closeConfigModal('ghost')
    expect(getStore().openConfigNodeIds).toEqual(['n1'])
  })

  it('closeAllConfigModals empties the list', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    getStore().closeAllConfigModals()
    expect(getStore().openConfigNodeIds).toEqual([])
  })

  it('re-opening after close appends at the end (new cascade slot)', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    getStore().closeConfigModal('n1')
    getStore().openConfigModal('n1')
    expect(getStore().openConfigNodeIds).toEqual(['n2', 'n1'])
  })
})

describe('openConfigNodeIds - node-removal auto-close', () => {
  it('removeNode drops the removed node id from the open list', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().openConfigModal('n2')
    getStore().removeNode('n1')
    expect(getStore().openConfigNodeIds).toEqual(['n2'])
  })

  it('undo-driven node removal closes the sheet silently', () => {
    getStore().addNode(makeNode('n1'))
    getStore().openConfigModal('n1')
    expect(getStore().openConfigNodeIds).toEqual(['n1'])

    getStore().undo()

    expect(getStore().nodes).toHaveLength(0)
    expect(getStore().openConfigNodeIds).toEqual([])
  })

  it('keeps sheets whose nodes survived the removal', () => {
    seedNodes(['n1', 'n2', 'n3'])
    getStore().openConfigModal('n2')
    getStore().openConfigModal('n3')
    getStore().removeNode('n1')
    expect(getStore().openConfigNodeIds).toEqual(['n2', 'n3'])
  })

  it('releases sheets opened on body nodes when their parent Function is deleted', () => {
    const fnNode = {
      id: 'fn-1',
      type: 'workflowNode' as const,
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_1',
        elementType: 'function',
        nodeType: 'function' as const,
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [makeNode('inner-1')], edges: [] },
          inputs: [],
          outputs: [],
          variables: [],
        },
      },
    }
    useWorkflowStore.setState({
      nodes: [fnNode],
      edges: [],
    } as unknown as Partial<StoreState>)
    getStore().openConfigModal('inner-1')
    getStore().setConfigSheetDirty('inner-1', true)

    getStore().removeNode('fn-1')

    expect(getStore().openConfigNodeIds).toEqual([])
    expect(getStore().dirtyConfigNodeIds).toEqual([])
  })
})

describe('lastInteractedNodeId', () => {
  it('starts null', () => {
    expect(getStore().lastInteractedNodeId).toBeNull()
  })

  it('selectNode records the node as last interacted', () => {
    seedNodes(['n1', 'n2'])
    getStore().selectNode('n1')
    expect(getStore().lastInteractedNodeId).toBe('n1')
    getStore().selectNode('n2')
    expect(getStore().lastInteractedNodeId).toBe('n2')
  })

  it('setSelectedNodes records a single-node selection only', () => {
    seedNodes(['n1', 'n2'])
    getStore().setSelectedNodes(['n1'])
    expect(getStore().lastInteractedNodeId).toBe('n1')

    // A rubber-band multi-select is not an interaction with one block.
    getStore().setSelectedNodes(['n1', 'n2'])
    expect(getStore().lastInteractedNodeId).toBe('n1')
  })

  it('survives deselection (empty selection does not clear it)', () => {
    seedNodes(['n1'])
    getStore().selectNode('n1')
    getStore().deselectAll()
    expect(getStore().lastInteractedNodeId).toBe('n1')
    getStore().clearSelection()
    expect(getStore().lastInteractedNodeId).toBe('n1')
    getStore().setSelectedNodes([])
    expect(getStore().lastInteractedNodeId).toBe('n1')
  })

  it('is released when its node is removed', () => {
    seedNodes(['n1', 'n2'])
    getStore().selectNode('n1')
    getStore().removeNode('n1')
    expect(getStore().lastInteractedNodeId).toBeNull()
  })

  it('is kept when an unrelated node is removed', () => {
    seedNodes(['n1', 'n2'])
    getStore().selectNode('n1')
    getStore().removeNode('n2')
    expect(getStore().lastInteractedNodeId).toBe('n1')
  })

  it('is released when its node disappears via undo', () => {
    getStore().addNode(makeNode('n1'))
    getStore().selectNode('n1')
    getStore().undo()
    expect(getStore().lastInteractedNodeId).toBeNull()
  })
})

describe('requestDrill (dirty sheets gate drill navigation)', () => {
  it('runs the navigation immediately when no sheet is dirty', () => {
    let ran = 0
    getStore().requestDrill(() => { ran += 1 })
    expect(ran).toBe(1)
    expect(getStore().pendingDrillAction).toBeNull()
  })

  it('defers the navigation while any sheet has unsaved edits', () => {
    let ran = 0
    getStore().setConfigSheetDirty('n1', true)
    getStore().requestDrill(() => { ran += 1 })
    expect(ran).toBe(0)
    expect(getStore().pendingDrillAction).not.toBeNull()
  })

  it('confirmPendingDrill runs the deferred navigation and clears the pending state', () => {
    let ran = 0
    getStore().setConfigSheetDirty('n1', true)
    getStore().requestDrill(() => { ran += 1 })
    getStore().confirmPendingDrill()
    expect(ran).toBe(1)
    expect(getStore().pendingDrillAction).toBeNull()
  })

  it('cancelPendingDrill clears the pending state without running', () => {
    let ran = 0
    getStore().setConfigSheetDirty('n1', true)
    getStore().requestDrill(() => { ran += 1 })
    getStore().cancelPendingDrill()
    expect(ran).toBe(0)
    expect(getStore().pendingDrillAction).toBeNull()
  })

  it('confirm and cancel are safe no-ops with nothing pending', () => {
    getStore().confirmPendingDrill()
    getStore().cancelPendingDrill()
    expect(getStore().pendingDrillAction).toBeNull()
  })

  it('a second request replaces an unresolved pending navigation', () => {
    let first = 0
    let second = 0
    getStore().setConfigSheetDirty('n1', true)
    getStore().requestDrill(() => { first += 1 })
    getStore().requestDrill(() => { second += 1 })
    getStore().confirmPendingDrill()
    expect(first).toBe(0)
    expect(second).toBe(1)
  })

  it('reset() clears a pending drill navigation', () => {
    getStore().setConfigSheetDirty('n1', true)
    getStore().requestDrill(() => {})
    expect(getStore().pendingDrillAction).not.toBeNull()
    getStore().reset()
    expect(getStore().pendingDrillAction).toBeNull()
  })
})

describe('reset() integration', () => {
  it('clears openConfigNodeIds and lastInteractedNodeId', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().selectNode('n2')
    getStore().reset()
    expect(getStore().openConfigNodeIds).toEqual([])
    expect(getStore().lastInteractedNodeId).toBeNull()
  })

  it('clears dirty tracking and any pending delete confirmation', () => {
    seedNodes(['n1'])
    getStore().openConfigModal('n1')
    getStore().setConfigSheetDirty('n1', true)
    getStore().selectNode('n1')
    getStore().requestDeleteSelected()
    expect(getStore().pendingDeleteNodeIds).toEqual(['n1'])
    getStore().reset()
    expect(getStore().dirtyConfigNodeIds).toEqual([])
    expect(getStore().pendingDeleteNodeIds).toBeNull()
  })
})

describe('setConfigSheetDirty (dirty tracking)', () => {
  it('tracks and untracks a sheet id', () => {
    getStore().setConfigSheetDirty('n1', true)
    expect(getStore().dirtyConfigNodeIds).toEqual(['n1'])
    getStore().setConfigSheetDirty('n1', false)
    expect(getStore().dirtyConfigNodeIds).toEqual([])
  })

  it('no-ops on redundant updates (already tracked / already clean)', () => {
    getStore().setConfigSheetDirty('n1', true)
    const tracked = getStore().dirtyConfigNodeIds
    getStore().setConfigSheetDirty('n1', true)
    expect(getStore().dirtyConfigNodeIds).toBe(tracked)
    getStore().setConfigSheetDirty('ghost', false)
    expect(getStore().dirtyConfigNodeIds).toBe(tracked)
  })

  it('is released when the node is removed', () => {
    seedNodes(['n1', 'n2'])
    getStore().setConfigSheetDirty('n1', true)
    getStore().removeNode('n1')
    expect(getStore().dirtyConfigNodeIds).toEqual([])
  })

  it('is released when the node disappears via undo', () => {
    getStore().addNode(makeNode('n1'))
    getStore().setConfigSheetDirty('n1', true)
    getStore().undo()
    expect(getStore().dirtyConfigNodeIds).toEqual([])
  })
})

describe('requestDeleteSelected (dirty-delete confirmation)', () => {
  it('deletes immediately when no selected node has a dirty sheet', () => {
    seedNodes(['n1', 'n2'])
    getStore().selectNode('n1')
    getStore().requestDeleteSelected()
    expect(getStore().pendingDeleteNodeIds).toBeNull()
    expect(getStore().nodes.map((n) => n.id)).toEqual(['n2'])
  })

  it('intercepts the delete when a selected node has a dirty sheet', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().setConfigSheetDirty('n1', true)
    getStore().selectNode('n1')
    getStore().requestDeleteSelected()
    expect(getStore().pendingDeleteNodeIds).toEqual(['n1'])
    expect(getStore().nodes).toHaveLength(2)
  })

  it('confirmPendingDelete performs the intercepted delete', () => {
    seedNodes(['n1', 'n2'])
    getStore().openConfigModal('n1')
    getStore().setConfigSheetDirty('n1', true)
    getStore().selectNode('n1')
    getStore().requestDeleteSelected()
    getStore().confirmPendingDelete()
    expect(getStore().pendingDeleteNodeIds).toBeNull()
    expect(getStore().nodes.map((n) => n.id)).toEqual(['n2'])
    expect(getStore().openConfigNodeIds).toEqual([])
    expect(getStore().dirtyConfigNodeIds).toEqual([])
  })

  it('cancelPendingDelete keeps the node and its sheet', () => {
    seedNodes(['n1'])
    getStore().openConfigModal('n1')
    getStore().setConfigSheetDirty('n1', true)
    getStore().selectNode('n1')
    getStore().requestDeleteSelected()
    getStore().cancelPendingDelete()
    expect(getStore().pendingDeleteNodeIds).toBeNull()
    expect(getStore().nodes).toHaveLength(1)
    expect(getStore().openConfigNodeIds).toEqual(['n1'])
  })
})
