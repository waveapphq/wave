/**
 * Workflow Store - read-only scope selector + shared drill action.
 *
 * Contract:
 *
 *   STATE
 *   - drillPath: DrillEntry[] (unchanged)
 *
 *   ACTIONS
 *   - pushSharedDrill(nodeId, resolvedDefinition):
 *       Injects `resolvedDefinition` as the shared node's `localDefinition`
 *       (transient - sanitize-on-save strips it back off), then appends the
 *       entry to drillPath. No-op when the node is not shared. Mirrors
 *       pushDrill's gates for non-Function / missing-node.
 *
 *   SELECTORS
 *   - isCurrentScopeReadOnly():
 *       Returns true when any entry in drillPath references a node whose
 *       functionLifecycle is 'shared'. False at the Test root and inside
 *       local-Function drills.
 *
 *  REQ scope: architectural - no REQ-x.y.z anchor.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface MinimalLocalDef {
  workflow: { nodes: MinimalNode[]; edges: MinimalEdge[] }
  inputs: unknown[]
  outputs: unknown[]
  variables?: unknown[]
}

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    functionId?: string
    editMode?: boolean
    draft?: {
      name?: string
      workflow?: { nodes: MinimalNode[]; edges: MinimalEdge[] }
      inputs?: unknown[]
      outputs?: unknown[]
      dependencies?: unknown
    }
    localDefinition?: MinimalLocalDef
  }
}

interface MinimalEdge {
  id: string
  source: string
  target: string
}

interface DrillEntry {
  nodeId: string
  label: string
}

interface ReadOnlyStoreSlice {
  drillPath: DrillEntry[]
  pushDrill: (id: string) => void
  pushSharedDrill: (id: string, def: MinimalLocalDef) => void
  refreshSharedDrillBody: (id: string, def: MinimalLocalDef) => void
  popDrillOne: () => void
  clearDrill: () => void
  isCurrentScopeReadOnly: () => boolean
  nodes: MinimalNode[]
}

function asStore() {
  return useWorkflowStore.getState() as unknown as ReadOnlyStoreSlice
}

function localFn(
  id: string,
  label: string,
  inner: { nodes?: MinimalNode[]; edges?: MinimalEdge[] } = {},
): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: inner.nodes ?? [], edges: inner.edges ?? [] },
        inputs: [],
        outputs: [],
        variables: [],
      },
    },
  }
}

function sharedFn(id: string, label: string, functionId = 'lib-1'): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId,
    },
  }
}

function reset(nodes: MinimalNode[] = []): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: [] as unknown as never,
    variables: [] as unknown as never,
    drillPath: [],
    isDirty: false,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    skippedNodeIds: [],
    executionStatus: 'idle',
    saveInFlight: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  reset()
})

// ---------------------------------------------------------------------------
// isCurrentScopeReadOnly
// ---------------------------------------------------------------------------

describe('Workflow Store - isCurrentScopeReadOnly', () => {
  it('returns false at the Test root (drillPath empty)', () => {
    reset([localFn('fn-1', 'Function_1')])
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('returns false when drilled into a local Function', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('returns true when drilled into a shared Function', () => {
    reset([sharedFn('s1', 'FetchUser')])
    const resolved: MinimalLocalDef = {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
    }
    asStore().pushSharedDrill('s1', resolved)
    expect(asStore().isCurrentScopeReadOnly()).toBe(true)
  })

  it('returns true when ANY ancestor in drillPath is shared (nested)', () => {
    // Local outer drilled first, then a shared child drilled next: the
    // whole inner scope is read-only because the chain crosses a shared
    // boundary. Even if the deepest entry happens to be local, structural
    // edits inside the shared ancestor are still forbidden.
    const sharedChild = sharedFn('s-child', 'Shared Inner')
    const localOuter = localFn('fn-outer', 'Function_1', { nodes: [sharedChild] })
    reset([localOuter])

    asStore().pushDrill('fn-outer')
    asStore().pushSharedDrill('s-child', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
    })

    expect(asStore().isCurrentScopeReadOnly()).toBe(true)
  })

  it('returns false again after popping out of the shared scope', () => {
    reset([sharedFn('s1', 'FetchUser')])
    asStore().pushSharedDrill('s1', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
    })
    expect(asStore().isCurrentScopeReadOnly()).toBe(true)

    asStore().popDrillOne()

    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('returns false defensively when a drill entry references a missing node', () => {
    // Push a drill entry whose nodeId is not in the tree (shouldn't happen
    // via the UI, but the selector must not crash).
    reset([localFn('fn-1', 'Function_1')])
    useWorkflowStore.setState({
      drillPath: [{ nodeId: 'does-not-exist', label: 'Ghost' }],
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('returns false defensively when a local drill-path node has no localDefinition', () => {
    // Same shape as use-readonly-canvas defensive case: if a drilled local
    // Function is missing its body, the walk stops and the canvas stays
    // editable (the structurally safer default).
    const malformed: MinimalNode = {
      id: 'fn-bad',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Broken', nodeType: 'function', functionLifecycle: 'local' },
    }
    reset([malformed])
    useWorkflowStore.setState({
      drillPath: [{ nodeId: 'fn-bad', label: 'Broken' }],
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pushSharedDrill
// ---------------------------------------------------------------------------

describe('Workflow Store - pushSharedDrill', () => {
  const RESOLVED: MinimalLocalDef = {
    workflow: { nodes: [], edges: [] },
    inputs: [{ name: 'in1' }],
    outputs: [{ name: 'out1' }],
    variables: [],
  }

  it('appends a drill entry for a shared Function with the resolved body injected', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-uuid')])
    asStore().pushSharedDrill('s1', RESOLVED)

    expect(asStore().drillPath).toEqual([{ nodeId: 's1', label: 'FetchUser' }])

    // The library body should be visible as the node's localDefinition so
    // walkActiveSubtree can render it.
    const node = asStore().nodes.find((n) => n.id === 's1')
    expect(node?.data.localDefinition).toEqual(RESOLVED)
  })

  it('does nothing for a non-Function node', () => {
    const plugin: MinimalNode = {
      id: 'p1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Shell Script', nodeType: 'plugin' },
    }
    reset([plugin])
    asStore().pushSharedDrill('p1', RESOLVED)
    expect(asStore().drillPath).toEqual([])
  })

  it('does nothing for a local Function (use pushDrill instead)', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushSharedDrill('fn-1', RESOLVED)
    expect(asStore().drillPath).toEqual([])
  })

  it('does nothing when the nodeId is not in the active subtree', () => {
    reset([sharedFn('s1', 'FetchUser')])
    asStore().pushSharedDrill('ghost', RESOLVED)
    expect(asStore().drillPath).toEqual([])
  })

  it('leaves sibling nodes untouched when injecting the resolved body', () => {
    // Covers the `: n` branch of the inject map: nodes whose id does not
    // match keep their identity (no spread, no localDefinition injection).
    const sibling = sharedFn('s2', 'OtherFn', 'lib-2')
    const target = sharedFn('s1', 'FetchUser', 'lib-1')
    reset([sibling, target])

    asStore().pushSharedDrill('s1', RESOLVED)

    const refreshedSibling = asStore().nodes.find((n) => n.id === 's2')
    expect(refreshedSibling).toBe(sibling)
    expect(refreshedSibling?.data.localDefinition).toBeUndefined()
  })

  it('injects the body at the correct level when drilled inside a local parent', () => {
    const sharedChild = sharedFn('s-child', 'Shared Inner', 'lib-1')
    const localOuter = localFn('fn-outer', 'Function_1', { nodes: [sharedChild] })
    reset([localOuter])

    asStore().pushDrill('fn-outer')
    asStore().pushSharedDrill('s-child', RESOLVED)

    expect(asStore().drillPath).toEqual([
      { nodeId: 'fn-outer', label: 'Function_1' },
      { nodeId: 's-child', label: 'Shared Inner' },
    ])
    // The injection lands inside the local parent's localDefinition.nodes,
    // not at the root.
    const outer = asStore().nodes.find((n) => n.id === 'fn-outer')
    const inner = outer?.data.localDefinition?.workflow.nodes.find(
      (n) => n.id === 's-child',
    )
    expect(inner?.data.localDefinition).toEqual(RESOLVED)
  })
})

// ---------------------------------------------------------------------------
// pop syncs the edit-mode working body back into the draft
// ---------------------------------------------------------------------------

describe('Workflow Store - pop syncs edit-mode shared body into draft', () => {
  const innerNode = (id: string): MinimalNode => ({
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin' },
  })

  function editModeShared(): MinimalNode {
    return {
      id: 's1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'F1-Func',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'lib-1',
        editMode: true,
        draft: {
          name: 'F1-Func',
          workflow: { nodes: [innerNode('A')], edges: [] },
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
        },
      },
    }
  }

  it('folds drilled-in localDefinition edits into draft.workflow on pop, preserving draft.name', () => {
    reset([editModeShared()])
    // Drill in: the edit-mode draft body is injected as the transient working copy.
    asStore().pushSharedDrill('s1', {
      workflow: { nodes: [innerNode('A')], edges: [] },
      inputs: [],
      outputs: [],
    })
    // Edit inside the drilled body: add a second node to the working copy.
    const store = useWorkflowStore.getState() as unknown as { addNode: (n: MinimalNode) => void }
    store.addNode(innerNode('B'))

    asStore().popDrillOne()

    const node = asStore().nodes.find((n) => n.id === 's1')!
    // The inner edits survive the round-trip in draft.workflow ...
    expect(node.data.draft?.workflow?.nodes.map((n) => n.id)).toEqual(['A', 'B'])
    // ... the locked name is preserved ...
    expect(node.data.draft?.name).toBe('F1-Func')
    // ... and the transient working copy is stripped.
    expect(node.data.localDefinition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// refreshSharedDrillBody - re-resolve the drilled body in place (Drop changes)
// ---------------------------------------------------------------------------

describe('Workflow Store - refreshSharedDrillBody', () => {
  const EMPTY: MinimalLocalDef = { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] }
  const NEW_BODY: MinimalLocalDef = {
    workflow: {
      nodes: [{ id: 'published', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'P', nodeType: 'plugin' } }],
      edges: [],
    },
    inputs: [],
    outputs: [],
    variables: [],
  }

  it('replaces the deepest drilled shared body in place, leaving drillPath unchanged', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    asStore().pushSharedDrill('s1', EMPTY)
    asStore().refreshSharedDrillBody('s1', NEW_BODY)

    expect(asStore().drillPath).toEqual([{ nodeId: 's1', label: 'FetchUser' }])
    expect(asStore().nodes.find((n) => n.id === 's1')?.data.localDefinition).toEqual(NEW_BODY)
  })

  it('is a no-op when not drilled in (drillPath empty)', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    asStore().refreshSharedDrillBody('s1', NEW_BODY)
    expect(asStore().nodes.find((n) => n.id === 's1')?.data.localDefinition).toBeUndefined()
  })

  it('is a no-op when the deepest drill entry is a different node', () => {
    reset([sharedFn('s1', 'FetchUser', 'lib-1')])
    asStore().pushSharedDrill('s1', EMPTY)
    asStore().refreshSharedDrillBody('other', NEW_BODY)
    expect(asStore().nodes.find((n) => n.id === 's1')?.data.localDefinition?.workflow.nodes).toEqual([])
  })

  it('replaces the body at the correct level when drilled inside a local parent (nested)', () => {
    const sharedChild = sharedFn('s-child', 'Shared Inner', 'lib-1')
    const localOuter = localFn('fn-outer', 'Function_1', { nodes: [sharedChild] })
    reset([localOuter])
    asStore().pushDrill('fn-outer')
    asStore().pushSharedDrill('s-child', EMPTY)

    asStore().refreshSharedDrillBody('s-child', NEW_BODY)

    const outer = asStore().nodes.find((n) => n.id === 'fn-outer')
    const inner = outer?.data.localDefinition?.workflow.nodes.find((n) => n.id === 's-child')
    expect(inner?.data.localDefinition).toEqual(NEW_BODY)
    expect(asStore().drillPath).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Single read-only definition + store-level undo/redo gating
// ---------------------------------------------------------------------------

type StoreState = ReturnType<typeof useWorkflowStore.getState>

interface GatingActions {
  setExecutionStatus?: (status: 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped') => void
  setSaveInFlight?: (inFlight: boolean) => void
}

function gating(): GatingActions {
  return useWorkflowStore.getState() as unknown as GatingActions
}

function seedUndoableEntry(): void {
  const state = useWorkflowStore.getState()
  const baselineNodes = state.nodes.slice(0, Math.max(0, state.nodes.length - 1))
  useWorkflowStore.setState({
    history: [
      {
        nodes: baselineNodes,
        edges: [...state.edges],
        variables: [...state.variables],
        timestamp: 1,
        operationDescription: 'Saved baseline',
        isInitialState: true,
      },
      {
        nodes: [...state.nodes],
        edges: [...state.edges],
        variables: [...state.variables],
        timestamp: 2,
        operationDescription: 'Add block',
      },
    ],
    historyIndex: 1,
  } as unknown as Partial<StoreState>)
}

function editModeSharedFn(id: string, label: string): MinimalNode {
  const node = sharedFn(id, label)
  node.data.editMode = true
  node.data.draft = { name: label, workflow: { nodes: [], edges: [] }, inputs: [], outputs: [] }
  node.data.localDefinition = {
    workflow: { nodes: [], edges: [] },
    inputs: [],
    outputs: [],
    variables: [],
  }
  return node
}

describe('Workflow Store - isCurrentScopeReadOnly is editMode-aware', () => {
  it('returns FALSE when drilled into a Shared instance in edit mode', () => {
    reset([editModeSharedFn('s1', 'Editable Fn')])
    asStore().pushSharedDrill('s1', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    })
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('returns FALSE for an edit-mode Shared nested under a local parent', () => {
    const editable = editModeSharedFn('s-child', 'Editable Inner')
    reset([localFn('fn-outer', 'Function_1', { nodes: [editable] })])
    asStore().pushDrill('fn-outer')
    asStore().pushSharedDrill('s-child', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    })
    expect(asStore().isCurrentScopeReadOnly()).toBe(false)
  })

  it('still returns TRUE for a clean (non-edit) Shared drill', () => {
    reset([sharedFn('s1', 'Library Fn')])
    asStore().pushSharedDrill('s1', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    })
    expect(asStore().isCurrentScopeReadOnly()).toBe(true)
  })
})

describe('Workflow Store - undo/redo gating', () => {
  it('exposes setExecutionStatus and setSaveInFlight store actions', () => {
    expect(typeof gating().setExecutionStatus).toBe('function')
    expect(typeof gating().setSaveInFlight).toBe('function')
  })

  it('undo refuses and canUndo is false while the execution is running', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedUndoableEntry()
    expect(useWorkflowStore.getState().canUndo()).toBe(true)

    gating().setExecutionStatus?.('running')

    const state = useWorkflowStore.getState()
    expect(state.canUndo()).toBe(false)
    expect(state.canRedo()).toBe(false)
    const nodesBefore = state.nodes
    state.undo()
    expect(useWorkflowStore.getState().nodes).toBe(nodesBefore)
    expect(useWorkflowStore.getState().historyIndex).toBe(1)
  })

  it('undo refuses while the execution is paused', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedUndoableEntry()
    gating().setExecutionStatus?.('paused')

    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().historyIndex).toBe(1)
    expect(useWorkflowStore.getState().canUndo()).toBe(false)
  })

  it('redo refuses while running', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedUndoableEntry()
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().canRedo()).toBe(true)

    gating().setExecutionStatus?.('running')
    useWorkflowStore.getState().redo()
    expect(useWorkflowStore.getState().historyIndex).toBe(0)
  })

  it('availability returns when the execution reaches a terminal state', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedUndoableEntry()
    gating().setExecutionStatus?.('running')
    expect(useWorkflowStore.getState().canUndo()).toBe(false)

    gating().setExecutionStatus?.('passed')
    expect(useWorkflowStore.getState().canUndo()).toBe(true)
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().historyIndex).toBe(0)
  })

  it('undo/redo refuse while a save request is in flight', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedUndoableEntry()
    gating().setSaveInFlight?.(true)

    const state = useWorkflowStore.getState()
    expect(state.canUndo()).toBe(false)
    expect(state.canRedo()).toBe(false)
    state.undo()
    expect(useWorkflowStore.getState().historyIndex).toBe(1)

    gating().setSaveInFlight?.(false)
    expect(useWorkflowStore.getState().canUndo()).toBe(true)
  })

  it('a read-only drilled scope does NOT block undo (the timeline is canvas-global)', () => {
    reset([sharedFn('s1', 'Library Fn')])
    asStore().pushSharedDrill('s1', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    })
    seedUndoableEntry()
    expect(asStore().isCurrentScopeReadOnly()).toBe(true)

    expect(useWorkflowStore.getState().canUndo()).toBe(true)
    useWorkflowStore.getState().undo()
    expect(useWorkflowStore.getState().historyIndex).toBe(0)
  })
})
