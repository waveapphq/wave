/**
 * Workflow Store - edit-mode dialog actions and the deep
 * (nested-localDefinition) tree walkers used by the edit-mode apply actions
 * and shared-drill residue cleanup.
 *
 * Covers:
 *   - openPublishEditModeDialog / closePublishEditModeDialog
 *   - openDropChangesDialog / closeDropChangesDialog
 *   - applyEditModeEntered (persisted + unpersisted)
 *   - applyEditModeDropped
 *   - applyEditModePublished
 *   - mergeNodeDataDeep recursion into a nested node's localDefinition
 *   - stripLocalDefinitionForSharedIds recursion into a nested shared node
 *
 * REQ scope: REQ-3.1.2.2 (edit-mode dialog actions) + shared drill.
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
    draft?: Record<string, unknown>
    upstreamLink?: unknown
    localDefinition?: MinimalLocalDef
    [key: string]: unknown
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

interface EditModeStoreSlice {
  nodes: MinimalNode[]
  drillPath: DrillEntry[]
  isDirty: boolean
  publishEditModeDialogNodeId: string | null
  dropChangesDialogNodeId: string | null
  openPublishEditModeDialog: (id: string) => void
  closePublishEditModeDialog: () => void
  openDropChangesDialog: (id: string) => void
  closeDropChangesDialog: () => void
  applyEditModeEntered: (
    id: string,
    nodeData: Record<string, unknown>,
    persisted?: boolean,
  ) => void
  applyEditModeDropped: (id: string, nodeData: Record<string, unknown>) => void
  applyEditModePublished: (id: string, nodeData: Record<string, unknown>) => void
  pushSharedDrill: (id: string, def: MinimalLocalDef) => void
  popDrillOne: () => void
  clearDrill: () => void
}

function asStore() {
  return useWorkflowStore.getState() as unknown as EditModeStoreSlice
}

function plugin(id: string, label = id): MinimalNode {
  return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data: { label, nodeType: 'plugin' } }
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
    data: { label, nodeType: 'function', functionLifecycle: 'shared', functionId },
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
    publishEditModeDialogNodeId: null,
    dropChangesDialogNodeId: null,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  reset()
})

// ---------------------------------------------------------------------------
// edit-mode dialog open/close actions
// ---------------------------------------------------------------------------

describe('Workflow Store - publish/drop edit-mode dialogs', () => {
  it('openPublishEditModeDialog stores the node id', () => {
    asStore().openPublishEditModeDialog('n1')
    expect(asStore().publishEditModeDialogNodeId).toBe('n1')
  })

  it('closePublishEditModeDialog clears the node id', () => {
    asStore().openPublishEditModeDialog('n1')
    asStore().closePublishEditModeDialog()
    expect(asStore().publishEditModeDialogNodeId).toBeNull()
  })

  it('openDropChangesDialog stores the node id', () => {
    asStore().openDropChangesDialog('n2')
    expect(asStore().dropChangesDialogNodeId).toBe('n2')
  })

  it('closeDropChangesDialog clears the node id', () => {
    asStore().openDropChangesDialog('n2')
    asStore().closeDropChangesDialog()
    expect(asStore().dropChangesDialogNodeId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applyEditModeEntered (exactly ONE undoable entry)
// ---------------------------------------------------------------------------

/** Seed a single-entry saved baseline from the current canvas. */
function seedBaseline(): void {
  const state = useWorkflowStore.getState()
  useWorkflowStore.setState({
    history: [
      {
        nodes: [...state.nodes],
        edges: [...state.edges],
        variables: [...state.variables],
        timestamp: 1,
        operationDescription: 'Saved baseline',
        isInitialState: true,
      },
    ],
    historyIndex: 0,
  } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

describe('Workflow Store - applyEditModeEntered', () => {
  it('merges nodeData and commits exactly ONE history entry', () => {
    reset([sharedFn('s1', 'FetchUser')])
    seedBaseline()

    asStore().applyEditModeEntered(
      's1',
      { editMode: true, upstreamLink: { functionId: 'lib-1', sourceVersion: '1.0.0' }, draft: { name: 'Draft' } },
      false,
    )

    const state = useWorkflowStore.getState()
    const node = asStore().nodes.find((n) => n.id === 's1') as MinimalNode
    expect(node.data.editMode).toBe(true)
    expect(node.data.draft).toEqual({ name: 'Draft' })
    expect(state.history).toHaveLength(2)
    expect(state.historyIndex).toBe(1)
    // Entering edit mode changes canonical state (the markers persist on save).
    expect(asStore().isDirty).toBe(true)
  })

  it('undo of the enter-edit entry exits edit mode cleanly', () => {
    reset([sharedFn('s1', 'FetchUser')])
    seedBaseline()

    asStore().applyEditModeEntered(
      's1',
      { editMode: true, upstreamLink: { functionId: 'lib-1', sourceVersion: '1.0.0' }, draft: { name: 'Draft' } },
      false,
    )
    useWorkflowStore.getState().undo()

    const node = asStore().nodes.find((n) => n.id === 's1') as MinimalNode
    expect(node.data.editMode).toBeUndefined()
    expect(node.data.draft).toBeUndefined()
    expect(node.data.upstreamLink).toBeUndefined()
    // Back at the saved baseline: derived dirty computes clean.
    expect(asStore().isDirty).toBe(false)
    // Redo re-enters edit mode (the entry is a normal timeline step).
    useWorkflowStore.getState().redo()
    const redone = asStore().nodes.find((n) => n.id === 's1') as MinimalNode
    expect(redone.data.editMode).toBe(true)
  })

  it('commits exactly ONE entry regardless of the persisted flag', () => {
    reset([sharedFn('s1', 'FetchUser')])
    seedBaseline()

    asStore().applyEditModeEntered('s1', { editMode: true, draft: { name: 'Draft' } })

    expect(useWorkflowStore.getState().history).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// applyMakeLocal (in-store rewrite, ONE undoable entry)
// ---------------------------------------------------------------------------

interface LifecycleRewriteActions {
  applyMakeLocal?: (nodeId: string, nodeData: Record<string, unknown>) => void
  applyFirstPublish?: (nodeId: string, nodeData: Record<string, unknown>) => void
}

function lifecycleActions(): LifecycleRewriteActions {
  return useWorkflowStore.getState() as unknown as LifecycleRewriteActions
}

function localFormData(label: string): Record<string, unknown> {
  return {
    label,
    nodeType: 'function',
    functionLifecycle: 'local',
    localDefinition: {
      name: label,
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    },
  }
}

function sharedFormData(label: string, functionId: string, version: string): Record<string, unknown> {
  return {
    label,
    nodeType: 'function',
    functionLifecycle: 'shared',
    functionId,
    functionVersion: version,
  }
}

describe('Workflow Store - applyMakeLocal', () => {
  it('exposes the applyMakeLocal store action', () => {
    expect(typeof lifecycleActions().applyMakeLocal).toBe('function')
  })

  it('rewrites shared-to-local in-store with exactly ONE history entry', () => {
    reset([sharedFn('fn-1', 'FetchUser')])
    seedBaseline()

    lifecycleActions().applyMakeLocal?.('fn-1', localFormData('FetchUser'))

    const state = useWorkflowStore.getState()
    const node = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(node.data.functionLifecycle).toBe('local')
    expect(node.data.localDefinition).toBeDefined()
    expect(state.history).toHaveLength(2)
    expect(state.historyIndex).toBe(1)
  })

  it('undo restores the shared instance; redo re-applies the local form', () => {
    reset([sharedFn('fn-1', 'FetchUser', 'lib-9')])
    seedBaseline()

    lifecycleActions().applyMakeLocal?.('fn-1', localFormData('FetchUser'))
    useWorkflowStore.getState().undo()

    let node = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(node.data.functionLifecycle).toBe('shared')
    expect(node.data.functionId).toBe('lib-9')

    useWorkflowStore.getState().redo()
    node = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(node.data.functionLifecycle).toBe('local')
  })
})

// ---------------------------------------------------------------------------
// applyFirstPublish (pick-out, NO undoable conversion entry)
// ---------------------------------------------------------------------------

describe('Workflow Store - applyFirstPublish', () => {
  function localWithBody(inner: MinimalNode[]): MinimalNode {
    return localFn('fn-1', 'Helper', { nodes: inner })
  }

  it('exposes the applyFirstPublish store action', () => {
    expect(typeof lifecycleActions().applyFirstPublish).toBe('function')
  })

  it('rewrites local-to-shared with NO undoable conversion entry; prior body edits are picked out', () => {
    const base = localWithBody([])
    const edited = localWithBody([plugin('inner-1')])
    reset([edited])
    useWorkflowStore.setState({
      isDirty: true,
      history: [
        { nodes: [base], edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
        { nodes: [edited], edges: [], variables: [], timestamp: 2, operationDescription: 'Add block' },
      ],
      historyIndex: 1,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    lifecycleActions().applyFirstPublish?.('fn-1', sharedFormData('Helper', 'lib-new', '1.0.0'))

    const state = useWorkflowStore.getState()
    const node = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(node.data.functionLifecycle).toBe('shared')
    expect(node.data.functionId).toBe('lib-new')
    // The function appears in its pinned form in EVERY retained entry: the
    // in-body edit dedups away and no conversion entry is appended.
    const anyLocal = state.history.some((entry) =>
      (entry.nodes as unknown as MinimalNode[]).some(
        (n) => n.id === 'fn-1' && n.data.functionLifecycle === 'local',
      ),
    )
    expect(anyLocal).toBe(false)
    expect(state.canUndo()).toBe(false)
    // Undo is a no-op: the conversion is not undoable.
    useWorkflowStore.getState().undo()
    const after = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(after.data.functionLifecycle).toBe('shared')
  })

  it('keeps unrelated changes individually undoable across the first publish', () => {
    const base = [localWithBody([]), plugin('log-a', 'a0')]
    const unrelated = [localWithBody([]), plugin('log-a', 'a1')]
    const bodyEdit = [localWithBody([plugin('inner-1')]), plugin('log-a', 'a1')]
    reset(bodyEdit)
    useWorkflowStore.setState({
      isDirty: true,
      history: [
        { nodes: base, edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
        { nodes: unrelated, edges: [], variables: [], timestamp: 2, operationDescription: 'Log A msg' },
        { nodes: bodyEdit, edges: [], variables: [], timestamp: 3, operationDescription: 'Add block' },
      ],
      historyIndex: 2,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    lifecycleActions().applyFirstPublish?.('fn-1', sharedFormData('Helper', 'lib-new', '1.0.0'))

    const state = useWorkflowStore.getState()
    expect(state.history.map((e) => e.operationDescription)).toEqual([
      'baseline',
      'Log A msg',
    ])
    expect(state.canUndo()).toBe(true)

    useWorkflowStore.getState().undo()
    const log = asStore().nodes.find((n) => n.id === 'log-a') as MinimalNode
    expect(log.data.label).toBe('a0')
    const fn = asStore().nodes.find((n) => n.id === 'fn-1') as MinimalNode
    expect(fn.data.functionLifecycle).toBe('shared')
  })
})

// ---------------------------------------------------------------------------
// applyEditModeDropped
// ---------------------------------------------------------------------------

describe('Workflow Store - applyEditModeDropped', () => {
  it('clears editMode markers, closes the drop dialog, and marks dirty', () => {
    const node = sharedFn('s1', 'FetchUser')
    node.data.editMode = true
    node.data.draft = { name: 'WIP' }
    node.data.upstreamLink = { fnId: 'lib-1', version: '1.0.0' }
    reset([node])
    // Clean reopen of a test SAVED with the Function in edit mode: the baseline
    // carries the edit-mode node, so dropping diverges from saved -> dirty.
    useWorkflowStore.setState({
      dropChangesDialogNodeId: 's1',
      isDirty: false,
      history: [
        { nodes: [node], edges: [], variables: [], timestamp: 1, operationDescription: 'baseline', isInitialState: true },
      ],
      historyIndex: 0,
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    asStore().applyEditModeDropped('s1', { functionLifecycle: 'shared' })

    const updated = asStore().nodes.find((n) => n.id === 's1') as MinimalNode
    expect(updated.data.editMode).toBeUndefined()
    expect(updated.data.draft).toBeUndefined()
    expect(updated.data.upstreamLink).toBeUndefined()
    expect(asStore().dropChangesDialogNodeId).toBeNull()
    // Drop diverges from the saved state, so it must be saveable.
    expect(asStore().isDirty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// applyEditModePublished
// ---------------------------------------------------------------------------

describe('Workflow Store - applyEditModePublished', () => {
  it('clears editMode markers, closes the publish dialog, and leaves the canvas dirty', () => {
    const node = sharedFn('s1', 'FetchUser')
    node.data.editMode = true
    node.data.draft = { name: 'WIP' }
    node.data.upstreamLink = { fnId: 'lib-1', version: '1.0.0' }
    reset([node])
    useWorkflowStore.setState({
      publishEditModeDialogNodeId: 's1',
      isDirty: true,
    } as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    asStore().applyEditModePublished('s1', {
      functionId: 'lib-1',
      functionVersion: '1.1.0',
    })

    const updated = asStore().nodes.find((n) => n.id === 's1') as MinimalNode
    expect(updated.data.editMode).toBeUndefined()
    expect(updated.data.draft).toBeUndefined()
    expect(updated.data.upstreamLink).toBeUndefined()
    expect(updated.data.functionVersion).toBe('1.1.0')
    expect(asStore().publishEditModeDialogNodeId).toBeNull()
    // Publish re-pins as a normal dirty edit; it does NOT force a save.
    expect(asStore().isDirty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// mergeNodeDataDeep - recursion into a NESTED node's localDefinition
// ---------------------------------------------------------------------------

describe('Workflow Store - edit-mode apply on a nested node (mergeNodeDataDeep recursion)', () => {
  it('applyEditModeEntered merges into a node nested inside a local Function body', () => {
    const inner = sharedFn('inner-shared', 'InnerFn')
    const outer = localFn('outer', 'OuterFn', { nodes: [inner] })
    reset([outer])

    asStore().applyEditModeEntered('inner-shared', { editMode: true, draft: { name: 'D' } }, true)

    const outerNode = asStore().nodes.find((n) => n.id === 'outer') as MinimalNode
    const innerNode = outerNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'inner-shared',
    ) as MinimalNode
    expect(innerNode.data.editMode).toBe(true)
    expect(innerNode.data.draft).toEqual({ name: 'D' })
    // The outer wrapper is rebuilt (new localDefinition object), proving the
    // recursive merge path executed.
    expect(outerNode.data.functionLifecycle).toBe('local')
  })

  it('applyEditModeDropped clears markers on a deeply nested node', () => {
    const innerShared = sharedFn('inner-shared', 'InnerFn')
    innerShared.data.editMode = true
    innerShared.data.draft = { name: 'WIP' }
    const mid = localFn('mid', 'MidFn', { nodes: [innerShared] })
    const outer = localFn('outer', 'OuterFn', { nodes: [mid] })
    reset([outer])

    asStore().applyEditModeDropped('inner-shared', { functionLifecycle: 'shared' })

    const outerNode = asStore().nodes.find((n) => n.id === 'outer') as MinimalNode
    const midNode = outerNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'mid',
    ) as MinimalNode
    const innerNode = midNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'inner-shared',
    ) as MinimalNode
    expect(innerNode.data.editMode).toBeUndefined()
    expect(innerNode.data.draft).toBeUndefined()
  })

  it('leaves a sibling Function body untouched when the target is in another branch', () => {
    const target = sharedFn('target', 'Target')
    const branchA = localFn('branch-a', 'A', { nodes: [target] })
    const branchB = localFn('branch-b', 'B', { nodes: [plugin('p1', 'Shell Script')] })
    reset([branchA, branchB])

    asStore().applyEditModeEntered('target', { editMode: true }, true)

    const bNode = asStore().nodes.find((n) => n.id === 'branch-b') as MinimalNode
    // Untouched branch keeps its original localDefinition reference contents.
    expect(bNode.data.localDefinition!.workflow.nodes.map((n) => n.id)).toEqual(['p1'])
    const aTarget = (asStore().nodes.find((n) => n.id === 'branch-a') as MinimalNode).data
      .localDefinition!.workflow.nodes.find((n) => n.id === 'target') as MinimalNode
    expect(aTarget.data.editMode).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// stripLocalDefinitionForSharedIds - recursion into a NESTED shared node
// ---------------------------------------------------------------------------

describe('Workflow Store - shared-drill residue cleanup on a nested shared node', () => {
  it('strips a nested shared node localDefinition when its drill scope is exited', () => {
    // Outer local Function holds an inner SHARED node. Drill: outer -> inner
    // shared (pushSharedDrill stamps the inner node with a transient
    // localDefinition). Popping out of the shared scope must strip that
    // residue, which requires recursing through the outer node's body.
    const innerShared = sharedFn('inner-shared', 'InnerFn')
    const outer = localFn('outer', 'OuterFn', { nodes: [innerShared] })
    reset([outer])

    // Drill into the local outer first so the active subtree is the outer body.
    useWorkflowStore.getState().pushDrill('outer')
    asStore().pushSharedDrill('inner-shared', {
      workflow: { nodes: [plugin('lib-step', 'LibStep')], edges: [] },
      inputs: [],
      outputs: [],
    })

    // The inner shared node now carries the stamped localDefinition residue.
    let outerNode = asStore().nodes.find((n) => n.id === 'outer') as MinimalNode
    let innerNode = outerNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'inner-shared',
    ) as MinimalNode
    expect(innerNode.data.localDefinition).toBeDefined()

    // Pop out of the shared scope: residue on the nested shared node is stripped.
    asStore().popDrillOne()

    outerNode = asStore().nodes.find((n) => n.id === 'outer') as MinimalNode
    innerNode = outerNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'inner-shared',
    ) as MinimalNode
    expect(innerNode.data.localDefinition).toBeUndefined()
  })

  it('clearDrill strips residue from a nested shared node across the whole path', () => {
    const innerShared = sharedFn('inner-shared', 'InnerFn')
    const outer = localFn('outer', 'OuterFn', { nodes: [innerShared] })
    reset([outer])

    useWorkflowStore.getState().pushDrill('outer')
    asStore().pushSharedDrill('inner-shared', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
    })

    asStore().clearDrill()

    const outerNode = asStore().nodes.find((n) => n.id === 'outer') as MinimalNode
    const innerNode = outerNode.data.localDefinition!.workflow.nodes.find(
      (n) => n.id === 'inner-shared',
    ) as MinimalNode
    expect(innerNode.data.localDefinition).toBeUndefined()
  })
})
