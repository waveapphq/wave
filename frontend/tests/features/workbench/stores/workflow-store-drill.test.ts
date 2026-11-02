/**
 * Workflow Store - Drill state and drill-path-aware mutations.
 *
 * Contract:
 *
 *   STATE
 *   - drillPath: DrillEntry[] (each entry { nodeId, label }). Default = [].
 *
 *   ACTIONS
 *   - pushDrill(nodeId)     -> resolves the node's data.label, appends
 *                              { nodeId, label } to drillPath. No-op for
 *                              non-Function and shared Function nodes.
 *   - popDrillOne()         -> removes the last entry. Idempotent on empty.
 *   - popDrillTo(depth)     -> truncates drillPath to length `depth`.
 *                              Idempotent when depth >= current length.
 *   - clearDrill()          -> sets drillPath = [].
 *
 *   DRILL-AWARE MUTATIONS
 *   - addNode/setNodes/removeNode/addEdge/setEdges/removeEdge/addVariable/
 *     updateVariable/removeVariable/setVariables write to the active
 *     subtree (deepest Function's localDefinition) when drillPath is
 *     non-empty, and to the root tree when drillPath is empty.
 *   - isDirty is set on the root regardless of depth.
 *   - Pop-drill is non-destructive; existing entries in
 *     drillPath are not used to "freeze" or "discard" the dirty edits at
 *     the popped-from level.
 *
 *   SELECTORS
 *   - getActiveNodes()      -> root nodes when drillPath empty, else the
 *                              deepest Function's localDefinition.workflow.nodes.
 *   - getActiveEdges()      -> same logic for edges.
 *   - getActiveVariables()  -> root variables when drillPath empty, else
 *                              the deepest Function's localDefinition.variables.
 *
 * REQ scope: REQ-3.1.1.4 (nested Function composition / drill).
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface MinimalLocalDef {
  workflow: { nodes: MinimalNode[]; edges: MinimalEdge[] }
  inputs: unknown[]
  outputs: unknown[]
  variables?: MinimalVariable[]
}

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    localDefinition?: MinimalLocalDef
  }
}

interface MinimalEdge {
  id: string
  source: string
  target: string
}

interface MinimalVariable {
  id: string
  name: string
  value: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
}

interface DrillEntry {
  nodeId: string
  label: string
}

interface DrillStateSlice {
  drillPath: DrillEntry[]
  pushDrill: (id: string) => void
  popDrillOne: () => void
  popDrillTo: (depth: number) => void
  clearDrill: () => void
  getActiveNodes: () => MinimalNode[]
  getActiveEdges: () => MinimalEdge[]
  getActiveVariables: () => MinimalVariable[]
}

function asDrillStore() {
  // Cast helper - keeps the test body readable without leaking `as any`.
  return useWorkflowStore.getState() as unknown as DrillStateSlice & {
    nodes: MinimalNode[]
    edges: MinimalEdge[]
    variables: MinimalVariable[]
    isDirty: boolean
    selectedNodeIds: string[]
    skippedNodeIds: string[]
    clipboard: { nodes: MinimalNode[]; edges: MinimalEdge[] } | null
    setNodes: (nodes: MinimalNode[], options?: { skipDirty?: boolean }) => void
    setEdges: (edges: MinimalEdge[], options?: { skipDirty?: boolean }) => void
    addNode: (n: MinimalNode) => void
    removeNode: (id: string) => void
    addEdge: (e: MinimalEdge) => void
    removeEdge: (id: string) => void
    setVariables: (vars: MinimalVariable[], options?: { skipDirty?: boolean }) => void
    addVariable: (v: Omit<MinimalVariable, 'id'>) => MinimalVariable
    updateVariable: (id: string, updates: Partial<Omit<MinimalVariable, 'id'>>) => void
    removeVariable: (id: string) => void
    selectNode: (id: string, options?: { addToSelection?: boolean }) => void
    selectAll: () => void
    selectNodesInRect: (rect: { x: number; y: number; width: number; height: number }) => void
    chainSelect: (clickedNodeId: string) => void
    deleteSelected: () => void
    duplicate: () => void
    copy: () => void
    cut: () => void
    paste: (offset?: { x: number; y: number }) => void
    unlinkNode: (id: string) => void
    toggleDisable: (id: string) => void
    toggleSkip: (id: string) => void
    renameVariable: (id: string, newName: string) => { success: boolean; error?: string }
    updateEdgeType: (id: string, type: string) => void
    relocateEdge: (
      oldEdgeId: string,
      newEdge: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string },
    ) => void
    enableAll: () => void
    disconnectSelected: () => void
    moveSelectedNodes: (delta: { x: number; y: number }) => void
    setSelectedEdges: (ids: string[]) => void
  }
}

const plugin = (id: string, label = id): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label, nodeType: 'plugin' },
})

const localFn = (
  id: string,
  label: string,
  inner: { nodes?: MinimalNode[]; edges?: MinimalEdge[]; variables?: MinimalVariable[] } = {},
): MinimalNode => ({
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
      variables: inner.variables ?? [],
    },
  },
})

const sharedFn = (id: string, label: string): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label, nodeType: 'function', functionLifecycle: 'shared' },
})

function reset(nodes: MinimalNode[] = [], edges: MinimalEdge[] = [], variables: MinimalVariable[] = []): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: edges as unknown as never,
    variables: variables as unknown as never,
    drillPath: [],
    isDirty: false,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    skippedNodeIds: [],
    clipboard: null,
    clipboardSource: null,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  reset()
})

// ---------------------------------------------------------------------------
// drill state and actions
// ---------------------------------------------------------------------------

describe('Workflow Store - drillPath default state', () => {
  it('initializes drillPath to an empty array', () => {
    expect(asDrillStore().drillPath).toEqual([])
  })
})

describe('Workflow Store - pushDrill', () => {
  it('appends a drill entry resolving label from the node data', () => {
    reset([localFn('fn-1', 'Function_1')])
    asDrillStore().pushDrill('fn-1')
    expect(asDrillStore().drillPath).toEqual([{ nodeId: 'fn-1', label: 'Function_1' }])
  })

  it('does nothing when the node is not a Function', () => {
    reset([plugin('p1', 'Shell Script')])
    asDrillStore().pushDrill('p1')
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('pushDrill (local-only path) does nothing for a shared Function', () => {
    // pushSharedDrill serves shared instances; pushDrill still rejects
    // shared so the two paths stay separable.
    reset([sharedFn('s1', 'Library Fn')])
    asDrillStore().pushDrill('s1')
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('walks the active subtree so pushDrill works on nested Function nodes', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])

    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    expect(asDrillStore().drillPath).toEqual([
      { nodeId: 'parent', label: 'Function_1' },
      { nodeId: 'child', label: 'Helper_2' },
    ])
  })

  it('does NOT set isDirty (drill is read-only navigation)', () => {
    reset([localFn('fn-1', 'Function_1')])
    asDrillStore().pushDrill('fn-1')
    expect(asDrillStore().isDirty).toBe(false)
  })

  it('does nothing when a local Function node has no localDefinition (defensive)', () => {
    const malformed: MinimalNode = {
      id: 'fn-bad',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Broken Function',
        nodeType: 'function',
        functionLifecycle: 'local',
        // No localDefinition - this should not be reachable via the canvas
        // UI but pushDrill guards anyway.
      },
    }
    reset([malformed])
    asDrillStore().pushDrill('fn-bad')
    expect(asDrillStore().drillPath).toEqual([])
  })
})

describe('Workflow Store - popDrillOne / popDrillTo / clearDrill', () => {
  it('popDrillOne removes the last entry', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])
    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    asDrillStore().popDrillOne()

    expect(asDrillStore().drillPath).toEqual([{ nodeId: 'parent', label: 'Function_1' }])
  })

  it('popDrillOne is idempotent on an empty drillPath', () => {
    asDrillStore().popDrillOne()
    asDrillStore().popDrillOne()
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('popDrillTo(n) truncates the drillPath to length n', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])
    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    asDrillStore().popDrillTo(1)
    expect(asDrillStore().drillPath).toHaveLength(1)
    expect(asDrillStore().drillPath[0]?.nodeId).toBe('parent')
  })

  it('popDrillTo(0) clears the path', () => {
    reset([localFn('fn-1', 'Function_1')])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().popDrillTo(0)
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('popDrillTo is idempotent when called with depth >= current length', () => {
    reset([localFn('fn-1', 'Function_1')])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().popDrillTo(5)
    expect(asDrillStore().drillPath).toEqual([{ nodeId: 'fn-1', label: 'Function_1' }])
  })

  it('clearDrill empties the drillPath', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])
    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    asDrillStore().clearDrill()
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('clearDrill is a no-op (early return) when the drillPath is already empty', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    const nodesBefore = asDrillStore().nodes

    asDrillStore().clearDrill()

    expect(asDrillStore().drillPath).toEqual([])
    // Early return leaves the nodes reference untouched (no cleanup pass ran).
    expect(asDrillStore().nodes).toBe(nodesBefore)
  })
})

// ---------------------------------------------------------------------------
// cleanupSharedDrillResidue early return: when the popped entry's nodeId is
// still present elsewhere on the path (a repeated id), nothing exited so the
// nodes array is returned unchanged.
// ---------------------------------------------------------------------------

describe('Workflow Store - drill residue cleanup with a repeated node id', () => {
  it('popDrillOne returns nodes unchanged when the popped id stays on the path', () => {
    // Parent local Function "dup" contains an inner local Function ALSO id'd
    // "dup". Drilling twice yields drillPath [dup, dup]; popping one keeps the
    // remaining "dup", so no id exited -> cleanup early-returns the same nodes.
    const innerDup = localFn('dup', 'Inner_Dup')
    const parentDup = localFn('dup', 'Outer_Dup', { nodes: [innerDup] })
    reset([parentDup])

    asDrillStore().pushDrill('dup') // root -> parent dup
    asDrillStore().pushDrill('dup') // parent body -> inner dup
    expect(asDrillStore().drillPath.map((e) => e.nodeId)).toEqual(['dup', 'dup'])

    const nodesBefore = asDrillStore().nodes
    asDrillStore().popDrillOne()

    expect(asDrillStore().drillPath.map((e) => e.nodeId)).toEqual(['dup'])
    // exitedIds is empty (dup still on path) -> cleanup returns the same array.
    expect(asDrillStore().nodes).toBe(nodesBefore)
  })
})

// ---------------------------------------------------------------------------
// Active-subtree selectors
// ---------------------------------------------------------------------------

describe('Workflow Store - getActiveNodes / getActiveEdges / getActiveVariables', () => {
  it('returns root nodes/edges/variables when drillPath is empty', () => {
    const rootNodes = [plugin('p1')]
    const rootEdges = [{ id: 'e1', source: 'p1', target: 'p1' }]
    const rootVars: MinimalVariable[] = [{ id: 'rv1', name: 'r', value: 1, type: 'integer' }]
    reset(rootNodes, rootEdges, rootVars)

    const s = asDrillStore()
    expect(s.getActiveNodes()).toEqual(rootNodes)
    expect(s.getActiveEdges()).toEqual(rootEdges)
    expect(s.getActiveVariables()).toEqual(rootVars)
  })

  it('returns the deepest Function subtree when drillPath has one entry', () => {
    const innerNode = plugin('inner')
    const innerEdge: MinimalEdge = { id: 'e-inner', source: 'inner', target: 'inner' }
    const innerVar: MinimalVariable = { id: 'iv1', name: 'inner_x', value: 'hi', type: 'string' }
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [innerNode],
      edges: [innerEdge],
      variables: [innerVar],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    const s = asDrillStore()
    expect(s.getActiveNodes()).toEqual([innerNode])
    expect(s.getActiveEdges()).toEqual([innerEdge])
    expect(s.getActiveVariables()).toEqual([innerVar])
  })

  it('returns the DEEPEST subtree for a two-level drill', () => {
    const deepNode = plugin('deepest')
    const child = localFn('child', 'Helper_2', { nodes: [deepNode] })
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])
    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    expect(asDrillStore().getActiveNodes()).toEqual([deepNode])
  })
})

// ---------------------------------------------------------------------------
// Drill-aware mutations
// ---------------------------------------------------------------------------

describe('Workflow Store - addNode under drill', () => {
  it('appends to root nodes when drillPath is empty', () => {
    reset([])
    asDrillStore().addNode(plugin('p1'))
    expect(asDrillStore().nodes.map((n) => n.id)).toEqual(['p1'])
  })

  it('appends to the deepest Function subtree when drilled in', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().addNode(plugin('inner-new'))

    const innerNodes = asDrillStore().getActiveNodes()
    expect(innerNodes.map((n) => n.id)).toEqual(['inner-new'])
    // The root nodes array still has exactly one entry (the Function), and
    // its localDefinition now contains the new inner node.
    const root = asDrillStore().nodes
    expect(root).toHaveLength(1)
    const updatedFn = root[0]
    expect(updatedFn.id).toBe('fn-1')
    expect(updatedFn.data.localDefinition?.workflow.nodes.map((n: MinimalNode) => n.id)).toEqual(['inner-new'])
  })

  it('sets isDirty on the root when a nested mutation occurs', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().addNode(plugin('inner-new'))

    expect(asDrillStore().isDirty).toBe(true)
  })
})

describe('Workflow Store - removeNode under drill', () => {
  it('removes from the deepest Function subtree when drilled in', () => {
    const innerNode = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [innerNode] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().removeNode('inner-1')

    expect(asDrillStore().getActiveNodes()).toEqual([])
  })

  it('does not affect root nodes when drilled in', () => {
    const sibling = plugin('sibling')
    const innerNode = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [innerNode] })
    reset([fn, sibling])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().removeNode('inner-1')

    expect(asDrillStore().nodes.map((n) => n.id)).toEqual(['fn-1', 'sibling'])
  })
})

describe('Workflow Store - setNodes under drill', () => {
  it('replaces the deepest Function nodes when drilled in', () => {
    const fn = localFn('fn-1', 'Function_1', { nodes: [plugin('old-1')] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setNodes([plugin('new-1'), plugin('new-2')])

    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['new-1', 'new-2'])
  })
})

describe('Workflow Store - addEdge / removeEdge under drill', () => {
  it('appends to the deepest Function edges when drilled in', () => {
    const fn = localFn('fn-1', 'Function_1', { nodes: [plugin('a'), plugin('b')] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().addEdge({ id: 'e1', source: 'a', target: 'b' })

    expect(asDrillStore().getActiveEdges()).toEqual([{ id: 'e1', source: 'a', target: 'b' }])
  })

  it('removes from the deepest Function edges when drilled in', () => {
    const innerEdge: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [plugin('a'), plugin('b')],
      edges: [innerEdge],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().removeEdge('e1')

    expect(asDrillStore().getActiveEdges()).toEqual([])
  })
})

describe('Workflow Store - variable mutations under drill', () => {
  it('addVariable writes to the deepest Function variables when drilled in', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    const created = asDrillStore().addVariable({ name: 'count', value: 0, type: 'integer' })

    expect(created.name).toBe('count')
    const innerVars = asDrillStore().getActiveVariables()
    expect(innerVars.map((v) => v.name)).toEqual(['count'])
  })

  it('does not write to root variables when adding under drill', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().addVariable({ name: 'count', value: 0, type: 'integer' })

    // Root vars unchanged.
    expect(asDrillStore().variables).toEqual([])
  })

  it('removeVariable writes to the deepest Function variables when drilled in', () => {
    const v: MinimalVariable = { id: 'v1', name: 'count', value: 1, type: 'integer' }
    const fn = localFn('fn-1', 'Function_1', { variables: [v] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().removeVariable('v1')

    expect(asDrillStore().getActiveVariables()).toEqual([])
  })

  it('updateVariable writes to the deepest Function variables when drilled in', () => {
    const v: MinimalVariable = { id: 'v1', name: 'count', value: 1, type: 'integer' }
    const fn = localFn('fn-1', 'Function_1', { variables: [v] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().updateVariable('v1', { value: 5 })

    expect(asDrillStore().getActiveVariables()[0]?.value).toBe(5)
  })

  it('setVariables replaces the deepest Function variables when drilled in', () => {
    const fn = localFn('fn-1', 'Function_1', {
      variables: [{ id: 'v1', name: 'count', value: 1, type: 'integer' }],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setVariables([
      { id: 'v2', name: 'state', value: 'idle', type: 'string' },
    ])

    expect(asDrillStore().getActiveVariables().map((v) => v.name)).toEqual(['state'])
  })

  it('marks isDirty on the root when a nested variable mutation occurs', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().addVariable({ name: 'x', value: 1, type: 'integer' })

    expect(asDrillStore().isDirty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pop-drill is non-destructive
// ---------------------------------------------------------------------------

describe('Workflow Store - pop-drill is non-destructive', () => {
  it('keeps in-memory edits made at the popped-from level after popDrillOne', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().addNode(plugin('inner-new'))

    asDrillStore().popDrillOne()

    // After popping back out, the inner edits are still present in the
    // root tree's nested localDefinition.
    const root = asDrillStore().nodes
    expect(root[0].data.localDefinition?.workflow.nodes.map((n: MinimalNode) => n.id)).toEqual(['inner-new'])
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('preserves variables added at a deeper level after pop', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1', { nodes: [child] })
    reset([parent])
    asDrillStore().pushDrill('parent')
    asDrillStore().pushDrill('child')

    asDrillStore().addVariable({ name: 'tmp', value: 0, type: 'integer' })
    asDrillStore().popDrillTo(1)

    const root = asDrillStore().nodes
    const updatedParent = root[0]
    const updatedChild = updatedParent.data.localDefinition!.workflow.nodes[0] as MinimalNode
    expect(updatedChild.data.localDefinition?.variables).toEqual([
      expect.objectContaining({ name: 'tmp', value: 0, type: 'integer' }),
    ])
  })
})

// ---------------------------------------------------------------------------
// skipDirty option behavior under drill
// ---------------------------------------------------------------------------

describe('Workflow Store - setNodes/setEdges/setVariables under drill with skipDirty', () => {
  it('setNodes with skipDirty:true while drilled in does NOT flip isDirty', () => {
    const fn = localFn('fn-1', 'Function_1', { nodes: [plugin('old')] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setNodes([plugin('new-1')], { skipDirty: true })

    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['new-1'])
    expect(asDrillStore().isDirty).toBe(false)
  })

  it('setEdges with skipDirty:true while drilled in does NOT flip isDirty', () => {
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [plugin('a'), plugin('b')],
      edges: [],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setEdges(
      [{ id: 'e1', source: 'a', target: 'b' }],
      { skipDirty: true },
    )

    expect(asDrillStore().getActiveEdges().map((e) => e.id)).toEqual(['e1'])
    expect(asDrillStore().isDirty).toBe(false)
  })

  it('setVariables with skipDirty:true while drilled in does NOT flip isDirty', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setVariables(
      [{ id: 'v1', name: 'x', value: 1, type: 'integer' }],
      { skipDirty: true },
    )

    expect(asDrillStore().getActiveVariables().map((v) => v.name)).toEqual(['x'])
    expect(asDrillStore().isDirty).toBe(false)
  })

  it('setNodes drilled in WITHOUT skipDirty option flips isDirty', () => {
    const fn = localFn('fn-1', 'Function_1', { nodes: [plugin('old')] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setNodes([plugin('new-1')])

    expect(asDrillStore().isDirty).toBe(true)
  })

  it('setEdges drilled in WITHOUT skipDirty option flips isDirty', () => {
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [plugin('a'), plugin('b')],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setEdges([{ id: 'e1', source: 'a', target: 'b' }])

    expect(asDrillStore().getActiveEdges().map((e) => e.id)).toEqual(['e1'])
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('setVariables drilled in WITHOUT skipDirty option flips isDirty', () => {
    const fn = localFn('fn-1', 'Function_1')
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().setVariables([{ id: 'v1', name: 'x', value: 1, type: 'integer' }])

    expect(asDrillStore().isDirty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Drill-aware refactor of node-level actions (deleteSelected, duplicate,
// copy/cut/paste, unlinkNode, toggleDisable, toggleSkip, renameVariable,
// selectAll, selectNodesInRect, chainSelect).
//
// Each test seeds the canvas with a Function instance plus a sibling at root,
// drills in, performs the action on an INNER selection, and asserts:
//   - the inner tree changed,
//   - the root sibling is untouched,
//   - isDirty flipped on the root (where applicable).
// ---------------------------------------------------------------------------

describe('Workflow Store - deleteSelected under drill', () => {
  it('deletes inner-node selection from the deepest subtree, leaves root sibling untouched', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    const sibling = plugin('sibling')
    reset([fn, sibling])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')

    asDrillStore().deleteSelected()

    expect(asDrillStore().getActiveNodes()).toEqual([])
    expect(asDrillStore().nodes.map((n) => n.id)).toEqual(['fn-1', 'sibling'])
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('deletes inner edges connected to the deleted node from the deepest subtree', () => {
    const a = plugin('a')
    const b = plugin('b')
    const ab: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [ab] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('a')

    asDrillStore().deleteSelected()

    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['b'])
    expect(asDrillStore().getActiveEdges()).toEqual([])
  })
})

describe('Workflow Store - duplicate under drill', () => {
  it('duplicates the inner selection inside the deepest subtree', () => {
    const inner = plugin('inner-1', 'Original')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')

    asDrillStore().duplicate()

    const innerNodes = asDrillStore().getActiveNodes()
    expect(innerNodes).toHaveLength(2)
    expect(innerNodes.map((n) => n.data.label)).toEqual(['Original', 'Original'])
    expect(asDrillStore().isDirty).toBe(true)
  })
})

describe('Workflow Store - copy / cut / paste under drill', () => {
  it('copy captures the inner selection only', () => {
    const sibling = plugin('sibling')
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn, sibling])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')

    asDrillStore().copy()

    const clip = asDrillStore().clipboard
    expect(clip).not.toBeNull()
    expect(clip!.nodes.map((n) => n.id)).toEqual(['inner-1'])
  })

  it('cut removes the inner selection and stores it on the clipboard', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')

    asDrillStore().cut()

    expect(asDrillStore().getActiveNodes()).toEqual([])
    expect(asDrillStore().clipboard?.nodes.map((n) => n.id)).toEqual(['inner-1'])
  })

  it('cut filters out edges that touch a selected inner node', () => {
    const a = plugin('a')
    const b = plugin('b')
    const c = plugin('c')
    // edges: a->b (will be removed - source selected), b->c (will be removed
    // - target b is selected), and c->c (will survive - neither end selected)
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [a, b, c],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'c' },
      ],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('b')

    asDrillStore().cut()

    // b is gone; a and c remain. Only e3 survives in the inner edges.
    expect(asDrillStore().getActiveNodes().map((n) => n.id).sort()).toEqual(['a', 'c'])
    expect(asDrillStore().getActiveEdges().map((e) => e.id)).toEqual(['e3'])
  })
})

describe('Workflow Store - unlinkNode under drill', () => {
  it('removes inner edges touching the node, leaves the inner node itself in place', () => {
    const a = plugin('a')
    const b = plugin('b')
    const ab: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [ab] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().unlinkNode('a')

    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['a', 'b'])
    expect(asDrillStore().getActiveEdges()).toEqual([])
    expect(asDrillStore().isDirty).toBe(true)
  })
})

describe('Workflow Store - toggleDisable / toggleSkip under drill', () => {
  it('toggleDisable flips the disabled flag on the inner node', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().toggleDisable('inner-1')

    const innerNodes = asDrillStore().getActiveNodes() as Array<MinimalNode & { data: { disabled?: boolean } }>
    expect(innerNodes[0].data.disabled).toBe(true)
  })

  it('toggleDisable on an already-disabled inner node leaves skippedNodeIds untouched', () => {
    const inner = {
      ...plugin('inner-1'),
      data: { ...plugin('inner-1').data, disabled: true },
    } as MinimalNode
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    // Pre-populate skippedNodeIds; un-disable should NOT touch it.
    useWorkflowStore.setState({ skippedNodeIds: ['inner-1'] } as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    asDrillStore().toggleDisable('inner-1')

    expect(asDrillStore().skippedNodeIds).toEqual(['inner-1'])
    const innerNodes = asDrillStore().getActiveNodes() as Array<MinimalNode & { data: { disabled?: boolean } }>
    expect(innerNodes[0].data.disabled).toBe(false)
  })

  it('toggleSkip toggles skip status for the inner node id', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().toggleSkip('inner-1')

    expect(asDrillStore().skippedNodeIds).toContain('inner-1')

    asDrillStore().toggleSkip('inner-1')
    expect(asDrillStore().skippedNodeIds).not.toContain('inner-1')
  })
})

describe('Workflow Store - renameVariable under drill', () => {
  it('renames a Function-local variable and updates its inner-node config references', () => {
    const inner = {
      ...plugin('inner-1'),
      data: {
        ...plugin('inner-1').data,
        config: { values: { x: '{old_name}' }, outputBindings: { result: 'old_name' } },
        expressionFields: ['x'],
      },
    } as MinimalNode
    const v: MinimalVariable = { id: 'v1', name: 'old_name', value: 1, type: 'integer' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner], variables: [v] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    const result = asDrillStore().renameVariable('v1', 'new_name')
    expect(result.success).toBe(true)

    const innerVars = asDrillStore().getActiveVariables()
    expect(innerVars[0]?.name).toBe('new_name')
    const updatedInner = asDrillStore().getActiveNodes()[0] as MinimalNode & {
      data: { config?: { values?: Record<string, unknown>; outputBindings?: Record<string, string> } }
    }
    expect(updatedInner.data.config?.values?.x).toBe('{new_name}')
    expect(updatedInner.data.config?.outputBindings?.result).toBe('new_name')
  })
})

describe('Workflow Store - updateNode under drill', () => {
  it('updates the inner node when drilled in, leaves root untouched', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    const sibling = plugin('sibling')
    reset([fn, sibling])
    asDrillStore().pushDrill('fn-1')

    const updateNode = useWorkflowStore.getState().updateNode as (id: string, updates: { data?: Record<string, unknown> }) => void
    updateNode('inner-1', { data: { ...inner.data, label: 'Renamed' } })

    const innerNodes = asDrillStore().getActiveNodes()
    expect(innerNodes[0]?.data.label).toBe('Renamed')
    // Root sibling untouched.
    const root = asDrillStore().nodes
    expect(root.find((n) => n.id === 'sibling')?.data.label).toBe('sibling')
  })

  it('is a no-op when the target id does not exist in the inner subtree', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    const dirtyBefore = asDrillStore().isDirty

    const updateNode = useWorkflowStore.getState().updateNode as (id: string, updates: { data?: Record<string, unknown> }) => void
    updateNode('ghost', { data: { label: 'Should Not Apply' } })

    // Inner node label unchanged AND isDirty stays at its prior value (the
    // no-op short-circuits the mutation path).
    const innerNodes = asDrillStore().getActiveNodes()
    expect(innerNodes[0]?.data.label).toBe('inner-1')
    expect(asDrillStore().isDirty).toBe(dirtyBefore)
  })
})

describe('Workflow Store - selection actions under drill', () => {
  it('selectAll selects every inner node (no root nodes)', () => {
    const inner1 = plugin('inner-1')
    const inner2 = plugin('inner-2')
    const sibling = plugin('root-sibling')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner1, inner2] })
    reset([fn, sibling])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().selectAll()

    const ids = asDrillStore().selectedNodeIds
    expect(ids).toEqual(['inner-1', 'inner-2'])
    expect(ids).not.toContain('root-sibling')
    expect(ids).not.toContain('fn-1')
  })

  it('selectNodesInRect selects inner nodes whose position is inside the rect', () => {
    const innerInside = { ...plugin('in'), position: { x: 50, y: 50 } }
    const innerOutside = { ...plugin('out'), position: { x: 500, y: 500 } }
    const fn = localFn('fn-1', 'Function_1', { nodes: [innerInside, innerOutside] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().selectNodesInRect({ x: 0, y: 0, width: 200, height: 200 })

    expect(asDrillStore().selectedNodeIds).toEqual(['in'])
  })

  it('chainSelect uses inner edges to compute the shortest path inside the Function', () => {
    const a = plugin('a')
    const b = plugin('b')
    const c = plugin('c')
    const fn = localFn('fn-1', 'Function_1', {
      nodes: [a, b, c],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('a')

    asDrillStore().chainSelect('c')

    const ids = asDrillStore().selectedNodeIds
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).toContain('c')
  })
})

// ---------------------------------------------------------------------------
// Edge mutations + bulk node operations under drill
// (Subsystem 1 audit: updateEdgeType / relocateEdge / enableAll / paste /
// disconnectSelected / moveSelectedNodes were root-only before the audit.)
// ---------------------------------------------------------------------------

describe('Workflow Store - updateEdgeType under drill', () => {
  it('rewrites the inner edge type without touching root edges', () => {
    const a = plugin('a')
    const b = plugin('b')
    const innerEdge: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [innerEdge] })
    const rootEdge: MinimalEdge = { id: 'root-e', source: 'fn-1', target: 'fn-1' }
    reset([fn], [rootEdge])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().updateEdgeType('e1', 'step')

    const innerEdges = asDrillStore().getActiveEdges() as Array<MinimalEdge & { type?: string }>
    expect(innerEdges[0]?.type).toBe('step')
    expect(asDrillStore().edges).toEqual([rootEdge])
    expect(asDrillStore().isDirty).toBe(true)
  })
})

describe('Workflow Store - relocateEdge under drill', () => {
  it('replaces an inner edge with a new one inside the deepest subtree', () => {
    const a = plugin('a')
    const b = plugin('b')
    const c = plugin('c')
    const innerEdge: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b, c], edges: [innerEdge] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().relocateEdge('e1', { id: 'e2', source: 'a', target: 'c' })

    const innerEdges = asDrillStore().getActiveEdges()
    expect(innerEdges.map((e) => e.id)).toEqual(['e2'])
    expect(innerEdges[0]).toMatchObject({ source: 'a', target: 'c' })
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('migrates ingress handles on the OLD target when the relocated edge changes target', () => {
    const a = plugin('a')
    const b = plugin('b')
    const c = plugin('c')
    // Two edges into b; relocating one to target c should compact b's ingress.
    const e1: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const e2: MinimalEdge & { targetHandle?: string } = {
      id: 'e2',
      source: 'c',
      target: 'b',
      targetHandle: 'ingress_1',
    }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b, c], edges: [e1, e2] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().relocateEdge('e1', { id: 'e3', source: 'a', target: 'c' })

    const innerEdges = asDrillStore().getActiveEdges() as Array<
      MinimalEdge & { targetHandle?: string }
    >
    // e3 (a->c) and e2 (c->b) survive; e2's targetHandle is compacted to undefined.
    const e2After = innerEdges.find((e) => e.id === 'e2')
    expect(e2After?.targetHandle).toBeUndefined()
  })
})

describe('Workflow Store - enableAll under drill', () => {
  it('re-enables every disabled inner node without touching the root', () => {
    const innerDisabled = {
      ...plugin('inner-1'),
      data: { ...plugin('inner-1').data, disabled: true },
    } as MinimalNode
    const rootDisabled = {
      ...plugin('root-disabled'),
      data: { ...plugin('root-disabled').data, disabled: true },
    } as MinimalNode
    const fn = localFn('fn-1', 'Function_1', { nodes: [innerDisabled] })
    reset([fn, rootDisabled])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().enableAll()

    const innerNodes = asDrillStore().getActiveNodes() as Array<MinimalNode & { data: { disabled?: boolean } }>
    expect(innerNodes[0]?.data.disabled).toBe(false)
    // Root sibling stays disabled (action scoped to active subtree).
    const root = asDrillStore().nodes
    const rootSibling = root.find((n) => n.id === 'root-disabled') as MinimalNode & {
      data: { disabled?: boolean }
    }
    expect(rootSibling?.data.disabled).toBe(true)
  })
})

describe('Workflow Store - paste under drill', () => {
  it('pastes the clipboard contents into the deepest subtree (no root mutation)', () => {
    const inner = plugin('inner-1', 'Inner Original')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    const rootSibling = plugin('root-1')
    reset([fn, rootSibling])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')
    asDrillStore().copy()

    asDrillStore().paste({ x: 25, y: 25 })

    const innerNodes = asDrillStore().getActiveNodes()
    // Original plus pasted copy.
    expect(innerNodes).toHaveLength(2)
    // Root unchanged (still fn-1 and root-1, no pasted ids leaked there).
    expect(asDrillStore().nodes.map((n) => n.id).sort()).toEqual(['fn-1', 'root-1'])
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('paste clears clipboard after a cut-paste cycle inside a Function', () => {
    const inner = plugin('inner-1')
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('inner-1')
    asDrillStore().cut()
    asDrillStore().paste()

    expect(asDrillStore().clipboard).toBeNull()
  })

  it('paste rewires edges between pasted nodes inside the deepest subtree', () => {
    const a = plugin('a')
    const b = plugin('b')
    const ab: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [ab] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('a', { addToSelection: true })
    asDrillStore().selectNode('b', { addToSelection: true })
    asDrillStore().copy()

    asDrillStore().paste()

    const innerEdges = asDrillStore().getActiveEdges()
    // Two edges: the original + one re-mapped between the pasted node ids.
    expect(innerEdges).toHaveLength(2)
  })
})

describe('Workflow Store - disconnectSelected under drill', () => {
  it('removes inner edges connected to the selected inner node (root untouched)', () => {
    const a = plugin('a')
    const b = plugin('b')
    const ab: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [ab] })
    const rootEdge: MinimalEdge = { id: 'root-e', source: 'fn-1', target: 'fn-1' }
    reset([fn], [rootEdge])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('a')

    asDrillStore().disconnectSelected()

    expect(asDrillStore().getActiveEdges()).toEqual([])
    // Root edges untouched.
    expect(asDrillStore().edges.map((e) => e.id)).toEqual(['root-e'])
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('removes the selected inner edge id without removing the inner nodes', () => {
    const a = plugin('a')
    const b = plugin('b')
    const ab: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b], edges: [ab] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().setSelectedEdges(['e1'])

    asDrillStore().disconnectSelected()

    expect(asDrillStore().getActiveEdges()).toEqual([])
    expect(asDrillStore().getActiveNodes().map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('no-ops when nothing is selected', () => {
    const inner = plugin('inner-1')
    const ab: MinimalEdge = { id: 'e1', source: 'inner-1', target: 'inner-1' }
    const fn = localFn('fn-1', 'Function_1', { nodes: [inner], edges: [ab] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().disconnectSelected()

    // Inner edge still present (no selection -> early return).
    expect(asDrillStore().getActiveEdges().map((e) => e.id)).toEqual(['e1'])
  })
})

describe('Workflow Store - moveSelectedNodes under drill', () => {
  it('shifts the selected inner node positions inside the deepest subtree', () => {
    const a = { ...plugin('a'), position: { x: 10, y: 20 } }
    const b = { ...plugin('b'), position: { x: 30, y: 40 } }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a, b] })
    const rootSibling = { ...plugin('root-1'), position: { x: 0, y: 0 } }
    reset([fn, rootSibling])
    asDrillStore().pushDrill('fn-1')
    asDrillStore().selectNode('a')

    asDrillStore().moveSelectedNodes({ x: 5, y: 7 })

    const innerNodes = asDrillStore().getActiveNodes()
    const movedA = innerNodes.find((n) => n.id === 'a')
    const unchangedB = innerNodes.find((n) => n.id === 'b')
    expect(movedA?.position).toEqual({ x: 15, y: 27 })
    expect(unchangedB?.position).toEqual({ x: 30, y: 40 })
    // Root sibling untouched.
    const rootSiblingAfter = asDrillStore().nodes.find((n) => n.id === 'root-1')
    expect(rootSiblingAfter?.position).toEqual({ x: 0, y: 0 })
    expect(asDrillStore().isDirty).toBe(true)
  })

  it('no-ops when nothing is selected inside the Function', () => {
    const a = { ...plugin('a'), position: { x: 10, y: 20 } }
    const fn = localFn('fn-1', 'Function_1', { nodes: [a] })
    reset([fn])
    asDrillStore().pushDrill('fn-1')

    asDrillStore().moveSelectedNodes({ x: 5, y: 7 })

    const innerNodes = asDrillStore().getActiveNodes()
    expect(innerNodes[0]?.position).toEqual({ x: 10, y: 20 })
    expect(asDrillStore().isDirty).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Undo/redo drillPath reconciliation (REQ-5.2.1.24)
// ---------------------------------------------------------------------------

type StoreState = ReturnType<typeof useWorkflowStore.getState>

function seedBaselineHistory(): void {
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
  } as unknown as Partial<StoreState>)
}

describe('Workflow Store - undo/redo drillPath reconciliation', () => {
  it('stay-put: undo keeps the drill location while the scope is still valid', () => {
    const parent = localFn('parent', 'Function_1', { nodes: [plugin('inner-1')] })
    reset([parent])
    seedBaselineHistory()

    asDrillStore().pushDrill('parent')
    asDrillStore().addNode(plugin('inner-2'))
    useWorkflowStore.getState().undo()

    expect(asDrillStore().drillPath).toEqual([{ nodeId: 'parent', label: 'Function_1' }])
    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['inner-1'])
  })

  it('auto-pop: undo pops to the nearest valid ancestor when the drilled node is gone', () => {
    reset([])
    seedBaselineHistory()

    asDrillStore().addNode(localFn('parent', 'Function_1', { nodes: [plugin('inner-1')] }))
    asDrillStore().pushDrill('parent')
    useWorkflowStore.getState().undo()

    // Restored baseline has no 'parent': the location reconciles to root.
    expect(asDrillStore().drillPath).toEqual([])
    expect(() => asDrillStore().getActiveNodes()).not.toThrow()
    expect(asDrillStore().getActiveNodes()).toEqual([])
    // The existing undo announcement is the orientation cue.
    expect(useWorkflowStore.getState().lastAnnouncement).toMatch(/^Undone:/)
  })

  it('auto-pop: undo pops when the drilled body is no longer materialized (never-crash)', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedBaselineHistory()

    useWorkflowStore.getState().pushSharedDrill('s1', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    } as never)
    expect(asDrillStore().drillPath).toEqual([{ nodeId: 's1', label: 'Library Fn' }])

    // A drilled mutation commits an entry whose snapshot carries the stamp.
    asDrillStore().addNode(plugin('inner-x'))
    // Undo restores the baseline where s1 has NO localDefinition: the drilled
    // scope is invalid and must degrade to the nearest valid ancestor (root)
    // instead of crashing the active-subtree walk.
    useWorkflowStore.getState().undo()

    expect(asDrillStore().drillPath).toEqual([])
    expect(() => asDrillStore().getActiveNodes()).not.toThrow()
    expect(asDrillStore().getActiveNodes().map((n) => n.id)).toEqual(['s1'])
  })

  it('drops shared-drill residue outside the drill path after a restore', () => {
    reset([sharedFn('s1', 'Library Fn')])
    seedBaselineHistory()

    useWorkflowStore.getState().pushSharedDrill('s1', {
      workflow: { nodes: [plugin('inner-1')], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    } as never)
    asDrillStore().addNode(plugin('inner-2'))
    asDrillStore().popDrillOne()
    useWorkflowStore.getState().toggleDisable('s1')

    // Undo restores the entry committed WHILE drilled (stamped body), but the
    // drill path is now empty: the transient stamp must not re-materialize.
    useWorkflowStore.getState().undo()

    const s1 = useWorkflowStore.getState().nodes.find((n) => n.id === 's1')
    expect(s1?.data.localDefinition).toBeUndefined()
    expect(asDrillStore().drillPath).toEqual([])
  })

  it('releases selection, config sheet, and breakpoint refs absent from the restored tree', () => {
    reset([plugin('p1')])
    seedBaselineHistory()

    asDrillStore().addNode(plugin('p2'))
    useWorkflowStore.getState().selectNode('p2')
    useWorkflowStore.getState().openConfigModal('p2')
    useWorkflowStore.getState().toggleBreakpoint('p2')

    useWorkflowStore.getState().undo()

    const state = useWorkflowStore.getState()
    expect(state.selectedNodeIds).not.toContain('p2')
    expect(
      (state as unknown as { openConfigNodeIds: string[] }).openConfigNodeIds,
    ).not.toContain('p2')
    expect(state.breakpoints.has('p2')).toBe(false)
  })

  it('keeps selection and breakpoint refs that survive the restore', () => {
    reset([plugin('p1')])
    seedBaselineHistory()

    asDrillStore().addNode(plugin('p2'))
    useWorkflowStore.getState().selectNode('p1')
    useWorkflowStore.getState().toggleBreakpoint('p1')

    useWorkflowStore.getState().undo()

    const state = useWorkflowStore.getState()
    expect(state.selectedNodeIds).toContain('p1')
    expect(state.breakpoints.has('p1')).toBe(true)
  })

  it('keeps dialog and dig-in refs present in the restored tree', () => {
    reset([plugin('p1')])
    seedBaselineHistory()

    asDrillStore().addNode(plugin('p2'))
    useWorkflowStore.setState({
      openConfigNodeIds: ['p1'],
      publishDialogNodeId: 'p1',
      makeLocalDialogNodeId: 'p1',
      publishEditModeDialogNodeId: 'p1',
      dropChangesDialogNodeId: 'p1',
      digInPendingNodeId: 'p1',
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    useWorkflowStore.getState().undo()

    const state = useWorkflowStore.getState()
    expect(
      (state as unknown as { openConfigNodeIds: string[] }).openConfigNodeIds,
    ).toContain('p1')
    expect(state.publishDialogNodeId).toBe('p1')
    expect(state.makeLocalDialogNodeId).toBe('p1')
    expect(state.publishEditModeDialogNodeId).toBe('p1')
    expect(state.dropChangesDialogNodeId).toBe('p1')
    expect(state.digInPendingNodeId).toBe('p1')
  })

  it('releases dialog and dig-in refs absent from the restored tree', () => {
    reset([plugin('p1')])
    seedBaselineHistory()

    asDrillStore().addNode(plugin('p2'))
    useWorkflowStore.setState({
      publishDialogNodeId: 'p2',
      makeLocalDialogNodeId: 'p2',
      publishEditModeDialogNodeId: 'p2',
      dropChangesDialogNodeId: 'p2',
      digInPendingNodeId: 'p2',
    })

    useWorkflowStore.getState().undo()

    const state = useWorkflowStore.getState()
    expect(state.publishDialogNodeId).toBeNull()
    expect(state.makeLocalDialogNodeId).toBeNull()
    expect(state.publishEditModeDialogNodeId).toBeNull()
    expect(state.dropChangesDialogNodeId).toBeNull()
    expect(state.digInPendingNodeId).toBeNull()
  })

  it('drill push/pop never commits a history entry', () => {
    const parent = localFn('parent', 'Function_1', { nodes: [plugin('inner-1')] })
    reset([parent])
    seedBaselineHistory()

    asDrillStore().pushDrill('parent')
    asDrillStore().popDrillOne()
    useWorkflowStore.getState().pushSharedDrill('parent', {
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      variables: [],
    } as never)

    expect(useWorkflowStore.getState().history).toHaveLength(1)
    expect(useWorkflowStore.getState().historyIndex).toBe(0)
  })
})
