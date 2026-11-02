/**
 * Tests for inner-workflow.ts - pure helpers that walk the drill stack and
 * apply mutations to the active subtree.
 *
 * Contract (REQ-3.1.1.4):
 *   - drillPath is an ordered stack of { nodeId, label } entries. Empty
 *     drillPath = Test root; non-empty drillPath = inside one or more nested
 *     local Functions.
 *   - walkActiveSubtree(rootNodes, rootEdges, rootVariables, drillPath)
 *     returns { nodes, edges, variables, localDefinition } for the deepest
 *     Function instance addressed by drillPath, or the root tree when
 *     drillPath is empty.
 *   - applyMutationAtPath(rootNodes, drillPath, mutator) returns a NEW root
 *     nodes tree with the mutator applied to the nodes array at the deepest
 *     drill level. Root and intermediate Function nodes are not mutated in
 *     place; structural sharing is preserved where untouched.
 *
 * REQ scope: REQ-3.1.1.4 (nested Function composition).
 */

import { describe, it, expect } from 'vitest'

import {
  walkActiveSubtree,
  applyMutationAtPath,
  applyEdgesMutationAtPath,
  applyVariablesMutationAtPath,
  applyInputsMutationAtPath,
  applyOutputsMutationAtPath,
  getActiveTree,
  isScopeReadOnly,
} from '@/features/functions/canvas/inner-workflow'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

interface MinimalNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType?: 'control' | 'plugin' | 'function'
    functionLifecycle?: 'local' | 'shared'
    localDefinition?: {
      workflow: { nodes: MinimalNode[]; edges: unknown[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: unknown[]
    }
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

const pluginNode = (id: string, label = id): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: { label, nodeType: 'plugin' },
})

const functionNode = (
  id: string,
  label: string,
  inner: {
    nodes?: MinimalNode[]
    edges?: MinimalEdge[]
    inputs?: unknown[]
    outputs?: unknown[]
    variables?: MinimalVariable[]
  } = {},
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
      inputs: inner.inputs ?? [],
      outputs: inner.outputs ?? [],
      variables: inner.variables ?? [],
    },
  },
})

// -----------------------------------------------------------------------------
// walkActiveSubtree
// -----------------------------------------------------------------------------

describe('walkActiveSubtree', () => {
  it('returns the root tree when drillPath is empty', () => {
    const rootNodes: MinimalNode[] = [pluginNode('p1'), pluginNode('p2')]
    const rootEdges: MinimalEdge[] = [{ id: 'e1', source: 'p1', target: 'p2' }]
    const rootVars: MinimalVariable[] = [
      { id: 'v1', name: 'x', value: 1, type: 'integer' },
    ]

    const result = walkActiveSubtree(rootNodes, rootEdges, rootVars, [])

    expect(result.nodes).toBe(rootNodes)
    expect(result.edges).toBe(rootEdges)
    expect(result.variables).toBe(rootVars)
    expect(result.localDefinition).toBeNull()
  })

  it('returns the deepest Function subtree at depth 1', () => {
    const innerNode = pluginNode('inner-1')
    const innerEdge = { id: 'e-inner', source: 'inner-1', target: 'inner-1' }
    const innerVar: MinimalVariable = { id: 'iv1', name: 'inner_x', value: 'hi', type: 'string' }
    const fn = functionNode('fn-1', 'Function_1', {
      nodes: [innerNode],
      edges: [innerEdge],
      variables: [innerVar],
    })
    const rootNodes: MinimalNode[] = [fn, pluginNode('sibling')]
    const rootEdges: MinimalEdge[] = []
    const rootVars: MinimalVariable[] = []

    const result = walkActiveSubtree(rootNodes, rootEdges, rootVars, [
      { nodeId: 'fn-1', label: 'Function_1' },
    ])

    expect(result.nodes).toEqual([innerNode])
    expect(result.edges).toEqual([innerEdge])
    expect(result.variables).toEqual([innerVar])
    expect(result.localDefinition).not.toBeNull()
    expect(result.localDefinition?.inputs).toEqual([])
    expect(result.localDefinition?.outputs).toEqual([])
  })

  it('returns the deepest Function subtree at depth 2 (nested Functions)', () => {
    const deepest = pluginNode('deepest')
    const child = functionNode('child', 'Helper_2', { nodes: [deepest] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })

    const result = walkActiveSubtree(
      [parent],
      [],
      [],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
    )

    expect(result.nodes).toEqual([deepest])
  })

  it('treats variables as empty array when localDefinition.variables is undefined', () => {
    const fn = functionNode('fn-1', 'Function_1', { nodes: [] })
    // Force `variables` to undefined to simulate old persisted local
    // Definitions that pre-date the variables field.
    delete fn.data.localDefinition!.variables

    const result = walkActiveSubtree([fn], [], [], [
      { nodeId: 'fn-1', label: 'Function_1' },
    ])

    expect(result.variables).toEqual([])
  })

  it('falls back to the root subtree (no throw) when a drill entry references a missing node', () => {
    // Redo-after-Drop-Changes left a drillPath pointing at a node the revert
    // removed. walkActiveSubtree must degrade to the root tree instead of
    // throwing "Drill path references missing node ..." (the crash trace).
    const rootNodes: MinimalNode[] = [pluginNode('p1')]
    const rootEdges: MinimalEdge[] = [{ id: 'e1', source: 'p1', target: 'p1' }]
    const rootVars: MinimalVariable[] = [{ id: 'v1', name: 'x', value: 1, type: 'integer' }]

    const result = walkActiveSubtree(rootNodes, rootEdges, rootVars, [
      { nodeId: 'missing', label: 'Ghost' },
    ])

    expect(result.nodes).toBe(rootNodes)
    expect(result.edges).toBe(rootEdges)
    expect(result.variables).toBe(rootVars)
    expect(result.localDefinition).toBeNull()
  })

  it('degrades to the nearest valid ancestor when a drill entry references a non-Function node', () => {
    const plugin = pluginNode('p1')
    const result = walkActiveSubtree([plugin], [], [], [
      { nodeId: 'p1', label: 'Should not work' },
    ])
    expect(result.nodes).toEqual([plugin])
    expect(result.localDefinition).toBeNull()
  })

  it('degrades to the deepest valid prefix when a deeper entry is invalid', () => {
    const inner = pluginNode('inner-1')
    const fn = functionNode('fn-1', 'Function_1', { nodes: [inner] })
    const result = walkActiveSubtree([fn], [], [], [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'missing-child', label: 'Ghost' },
    ])
    expect(result.nodes).toEqual([inner])
    expect(result.localDefinition).not.toBeNull()
  })
})

// -----------------------------------------------------------------------------
// applyMutationAtPath
// -----------------------------------------------------------------------------

describe('applyMutationAtPath', () => {
  it('applies the mutator to the root nodes when drillPath is empty', () => {
    const rootNodes: MinimalNode[] = [pluginNode('p1')]
    const newNode = pluginNode('p2')

    const result = applyMutationAtPath(rootNodes, [], (nodes: MinimalNode[]) => [...nodes, newNode])

    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('p2')
    // Immutable: source array untouched.
    expect(rootNodes).toHaveLength(1)
  })

  it('returns a NEW root array (referential inequality) even when drillPath is empty', () => {
    const rootNodes: MinimalNode[] = [pluginNode('p1')]
    const result = applyMutationAtPath(rootNodes, [], (nodes: MinimalNode[]) => nodes.slice())
    expect(result).not.toBe(rootNodes)
  })

  it('applies the mutator to the deepest Function subtree at depth 1', () => {
    const innerOriginal = pluginNode('inner-1')
    const fn = functionNode('fn-1', 'Function_1', { nodes: [innerOriginal] })
    const rootNodes: MinimalNode[] = [fn]

    const appended = pluginNode('inner-2')
    const result = applyMutationAtPath(
      rootNodes,
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (nodes: MinimalNode[]) => [...nodes, appended],
    )

    const updatedFn = result[0]
    expect(updatedFn.data.localDefinition?.workflow.nodes).toHaveLength(2)
    expect(updatedFn.data.localDefinition?.workflow.nodes[1]?.id).toBe('inner-2')
    // Immutable: source not mutated.
    expect(fn.data.localDefinition?.workflow.nodes).toHaveLength(1)
  })

  it('applies the mutator to the deepest subtree at depth 2 (nested Functions)', () => {
    const innermostOriginal = pluginNode('inner-1')
    const child = functionNode('child', 'Helper_2', { nodes: [innermostOriginal] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })

    const appended = pluginNode('inner-2')
    const result = applyMutationAtPath(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (nodes: MinimalNode[]) => [...nodes, appended],
    )

    const updatedParent = result[0]
    const updatedChild = updatedParent.data.localDefinition!.workflow.nodes[0] as MinimalNode
    expect(updatedChild.data.localDefinition?.workflow.nodes).toHaveLength(2)
    expect(updatedChild.data.localDefinition?.workflow.nodes[1]?.id).toBe('inner-2')
    // Original tree untouched.
    expect(child.data.localDefinition?.workflow.nodes).toHaveLength(1)
    expect(parent.data.localDefinition?.workflow.nodes[0]).toBe(child)
  })

  it('preserves structural sharing for sibling subtrees outside the drill path', () => {
    const sibling = pluginNode('sibling')
    const fn = functionNode('fn-1', 'Function_1', { nodes: [pluginNode('inner')] })
    const rootNodes: MinimalNode[] = [fn, sibling]

    const result = applyMutationAtPath(
      rootNodes,
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (nodes: MinimalNode[]) => [...nodes],
    )

    // The drilled function node has a new identity (data was replaced).
    expect(result[0]).not.toBe(fn)
    // The sibling node has the same identity (untouched subtree).
    expect(result[1]).toBe(sibling)
  })

  it('throws an anchored error when a drill entry references a missing node', () => {
    expect(() =>
      applyMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'missing', label: 'Ghost' }],
        (nodes: MinimalNode[]) => nodes,
      ),
    ).toThrow(/^Drill path references missing node 'missing'$/)
  })

  it('throws an anchored error when a drill entry references a non-Function node', () => {
    expect(() =>
      applyMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'p1', label: 'Should not work' }],
        (nodes: MinimalNode[]) => nodes,
      ),
    ).toThrow(/^Drill path entry 'p1' is not a Function node$/)
  })
})

// -----------------------------------------------------------------------------
// applyEdgesMutationAtPath
// -----------------------------------------------------------------------------

describe('applyEdgesMutationAtPath', () => {
  it('returns rootNodes unchanged when drillPath is empty', () => {
    const root: MinimalNode[] = [pluginNode('p1')]
    const result = applyEdgesMutationAtPath(root, [], (edges: MinimalEdge[]) => [...edges, { id: 'e1', source: 'p1', target: 'p1' }])
    expect(result).toBe(root)
  })

  it('mutates the deepest Function edges at depth 1', () => {
    const fn = functionNode('fn-1', 'Function_1', {
      nodes: [pluginNode('a'), pluginNode('b')],
      edges: [],
    })
    const newEdge: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const result = applyEdgesMutationAtPath<MinimalNode, MinimalEdge>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (edges: MinimalEdge[]) => [...edges, newEdge],
    )
    expect(result[0].data.localDefinition?.workflow.edges).toHaveLength(1)
    expect(result[0].data.localDefinition?.workflow.edges[0]).toBe(newEdge)
  })

  it('mutates edges at depth 2 (nested Functions)', () => {
    const child = functionNode('child', 'Helper_2', { edges: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    const newEdge: MinimalEdge = { id: 'e1', source: 'a', target: 'b' }
    const result = applyEdgesMutationAtPath<MinimalNode, MinimalEdge>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (edges: MinimalEdge[]) => [...edges, newEdge],
    )
    const updatedChild = result[0].data.localDefinition!.workflow.nodes[0]
    expect(updatedChild.data.localDefinition?.workflow.edges).toEqual([newEdge])
  })

  it('throws an anchored error when a drill entry references a missing node', () => {
    expect(() =>
      applyEdgesMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'missing', label: 'Ghost' }],
        (edges: MinimalEdge[]) => edges,
      ),
    ).toThrow(/^Drill path references missing node 'missing'$/)
  })

  it('throws an anchored error when a drill entry references a non-Function node', () => {
    expect(() =>
      applyEdgesMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'p1', label: 'Not a Function' }],
        (edges: MinimalEdge[]) => edges,
      ),
    ).toThrow(/^Drill path entry 'p1' is not a Function node$/)
  })
})

// -----------------------------------------------------------------------------
// applyVariablesMutationAtPath
// -----------------------------------------------------------------------------

describe('applyVariablesMutationAtPath', () => {
  it('returns rootNodes unchanged when drillPath is empty', () => {
    const root: MinimalNode[] = [pluginNode('p1')]
    const result = applyVariablesMutationAtPath(root, [], (vars: MinimalVariable[]) => vars)
    expect(result).toBe(root)
  })

  it('mutates the deepest Function variables at depth 1', () => {
    const fn = functionNode('fn-1', 'Function_1', { variables: [] })
    const newVar: MinimalVariable = { id: 'v1', name: 'x', value: 1, type: 'integer' }
    const result = applyVariablesMutationAtPath<MinimalNode, MinimalVariable>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (vars: MinimalVariable[]) => [...vars, newVar],
    )
    expect(result[0].data.localDefinition?.variables).toEqual([newVar])
  })

  it('mutates variables at depth 2', () => {
    const child = functionNode('child', 'Helper_2', { variables: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    const newVar: MinimalVariable = { id: 'v1', name: 'x', value: 1, type: 'integer' }
    const result = applyVariablesMutationAtPath<MinimalNode, MinimalVariable>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (vars: MinimalVariable[]) => [...vars, newVar],
    )
    const updatedChild = result[0].data.localDefinition!.workflow.nodes[0]
    expect(updatedChild.data.localDefinition?.variables).toEqual([newVar])
  })

  it('treats missing localDefinition.variables as empty list when mutating', () => {
    const fn = functionNode('fn-1', 'Function_1')
    delete fn.data.localDefinition!.variables

    const newVar: MinimalVariable = { id: 'v1', name: 'x', value: 1, type: 'integer' }
    const result = applyVariablesMutationAtPath<MinimalNode, MinimalVariable>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (vars: MinimalVariable[]) => [...vars, newVar],
    )
    expect(result[0].data.localDefinition?.variables).toEqual([newVar])
  })

  it('preserves parent.variables fallback to empty array when nested mutation runs', () => {
    // Two-level drill where the INTERMEDIATE parent's variables are
    // undefined; the deepest mutation should still succeed and the
    // intermediate's variables should still be the empty array fallback.
    const child = functionNode('child', 'Helper_2', { variables: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    delete parent.data.localDefinition!.variables

    const newVar: MinimalVariable = { id: 'v1', name: 'x', value: 1, type: 'integer' }
    const result = applyVariablesMutationAtPath<MinimalNode, MinimalVariable>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (vars: MinimalVariable[]) => [...vars, newVar],
    )
    expect(result[0].data.localDefinition?.variables).toEqual([])
    const updatedChild = result[0].data.localDefinition!.workflow.nodes[0]
    expect(updatedChild.data.localDefinition?.variables).toEqual([newVar])
  })

  it('throws an anchored error when a drill entry references a missing node', () => {
    expect(() =>
      applyVariablesMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'missing', label: 'Ghost' }],
        (vars: MinimalVariable[]) => vars,
      ),
    ).toThrow(/^Drill path references missing node 'missing'$/)
  })

  it('throws an anchored error when a drill entry references a non-Function node', () => {
    expect(() =>
      applyVariablesMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'p1', label: 'Not a Function' }],
        (vars: MinimalVariable[]) => vars,
      ),
    ).toThrow(/^Drill path entry 'p1' is not a Function node$/)
  })
})

// -----------------------------------------------------------------------------
// applyInputsMutationAtPath
// -----------------------------------------------------------------------------

interface MinimalParamSpec {
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  default?: unknown
  required?: boolean
}

describe('applyInputsMutationAtPath', () => {
  it('returns rootNodes unchanged when drillPath is empty', () => {
    const root: MinimalNode[] = [pluginNode('p1')]
    const result = applyInputsMutationAtPath(root, [], (inputs: MinimalParamSpec[]) => [...inputs, { name: 'x', type: 'string' as const }])
    expect(result).toBe(root)
  })

  it('mutates the deepest Function inputs at depth 1', () => {
    const fn = functionNode('fn-1', 'Function_1', { inputs: [] })
    const newInput: MinimalParamSpec = { name: 'x', type: 'string' }
    const result = applyInputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (inputs: MinimalParamSpec[]) => [...inputs, newInput],
    )
    expect(result[0].data.localDefinition?.inputs).toEqual([newInput])
    // Immutable: source not mutated.
    expect(fn.data.localDefinition?.inputs).toEqual([])
  })

  it('mutates inputs at depth 2', () => {
    const child = functionNode('child', 'Helper_2', { inputs: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    const newInput: MinimalParamSpec = { name: 'x', type: 'integer', required: true }
    const result = applyInputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (inputs: MinimalParamSpec[]) => [...inputs, newInput],
    )
    const updatedChild = result[0].data.localDefinition!.workflow.nodes[0]
    expect(updatedChild.data.localDefinition?.inputs).toEqual([newInput])
  })

  it('preserves parent.inputs when mutating nested child', () => {
    const child = functionNode('child', 'Helper_2', { inputs: [] })
    const parentExistingInput: MinimalParamSpec = { name: 'parent_in', type: 'string' }
    const parent = functionNode('parent', 'Function_1', {
      nodes: [child],
      inputs: [parentExistingInput],
    })
    const newInput: MinimalParamSpec = { name: 'child_in', type: 'string' }
    const result = applyInputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (inputs: MinimalParamSpec[]) => [...inputs, newInput],
    )
    expect(result[0].data.localDefinition?.inputs).toEqual([parentExistingInput])
  })

  it('throws an anchored error when a drill entry references a missing node', () => {
    expect(() =>
      applyInputsMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'missing', label: 'Ghost' }],
        (inputs: MinimalParamSpec[]) => inputs,
      ),
    ).toThrow(/^Drill path references missing node 'missing'$/)
  })

  it('throws an anchored error when a drill entry references a non-Function node', () => {
    expect(() =>
      applyInputsMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'p1', label: 'Not a Function' }],
        (inputs: MinimalParamSpec[]) => inputs,
      ),
    ).toThrow(/^Drill path entry 'p1' is not a Function node$/)
  })

  it('treats missing localDefinition.inputs as empty list when mutating', () => {
    const fn = functionNode('fn-1', 'Function_1')
    // Force inputs to undefined to exercise the `?? []` fallback.
    ;(fn.data.localDefinition as unknown as { inputs?: unknown[] }).inputs = undefined as unknown as unknown[]

    const result = applyInputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (inputs: MinimalParamSpec[]) => [...inputs, { name: 'x', type: 'string' as const }],
    )
    expect(result[0].data.localDefinition?.inputs).toEqual([{ name: 'x', type: 'string' }])
  })

  it('preserves parent.inputs fallback to empty array when mutating nested child', () => {
    const child = functionNode('child', 'Helper_2', { inputs: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    // Force parent.inputs to undefined; the rest-non-empty branch keeps it as []
    ;(parent.data.localDefinition as unknown as { inputs?: unknown[] }).inputs = undefined as unknown as unknown[]

    const result = applyInputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (inputs: MinimalParamSpec[]) => [...inputs, { name: 'inner', type: 'string' as const }],
    )
    expect(result[0].data.localDefinition?.inputs).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// applyOutputsMutationAtPath
// -----------------------------------------------------------------------------

describe('applyOutputsMutationAtPath', () => {
  it('returns rootNodes unchanged when drillPath is empty', () => {
    const root: MinimalNode[] = [pluginNode('p1')]
    const result = applyOutputsMutationAtPath(root, [], (outs: MinimalParamSpec[]) => [...outs, { name: 'y', type: 'string' as const }])
    expect(result).toBe(root)
  })

  it('mutates the deepest Function outputs at depth 1', () => {
    const fn = functionNode('fn-1', 'Function_1', { outputs: [] })
    const newOutput: MinimalParamSpec = { name: 'y', type: 'string' }
    const result = applyOutputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (outs: MinimalParamSpec[]) => [...outs, newOutput],
    )
    expect(result[0].data.localDefinition?.outputs).toEqual([newOutput])
    expect(fn.data.localDefinition?.outputs).toEqual([])
  })

  it('mutates outputs at depth 2', () => {
    const child = functionNode('child', 'Helper_2', { outputs: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    const newOutput: MinimalParamSpec = { name: 'y', type: 'integer' }
    const result = applyOutputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (outs: MinimalParamSpec[]) => [...outs, newOutput],
    )
    const updatedChild = result[0].data.localDefinition!.workflow.nodes[0]
    expect(updatedChild.data.localDefinition?.outputs).toEqual([newOutput])
  })

  it('throws an anchored error when a drill entry references a missing node', () => {
    expect(() =>
      applyOutputsMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'missing', label: 'Ghost' }],
        (outs: MinimalParamSpec[]) => outs,
      ),
    ).toThrow(/^Drill path references missing node 'missing'$/)
  })

  it('throws an anchored error when a drill entry references a non-Function node', () => {
    expect(() =>
      applyOutputsMutationAtPath(
        [pluginNode('p1')],
        [{ nodeId: 'p1', label: 'Not a Function' }],
        (outs: MinimalParamSpec[]) => outs,
      ),
    ).toThrow(/^Drill path entry 'p1' is not a Function node$/)
  })

  it('treats missing localDefinition.outputs as empty list when mutating', () => {
    const fn = functionNode('fn-1', 'Function_1')
    ;(fn.data.localDefinition as unknown as { outputs?: unknown[] }).outputs = undefined as unknown as unknown[]

    const result = applyOutputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [fn],
      [{ nodeId: 'fn-1', label: 'Function_1' }],
      (outs: MinimalParamSpec[]) => [...outs, { name: 'y', type: 'string' as const }],
    )
    expect(result[0].data.localDefinition?.outputs).toEqual([{ name: 'y', type: 'string' }])
  })

  it('preserves parent.outputs fallback to empty array when mutating nested child', () => {
    const child = functionNode('child', 'Helper_2', { outputs: [] })
    const parent = functionNode('parent', 'Function_1', { nodes: [child] })
    ;(parent.data.localDefinition as unknown as { outputs?: unknown[] }).outputs = undefined as unknown as unknown[]

    const result = applyOutputsMutationAtPath<MinimalNode, MinimalParamSpec>(
      [parent],
      [
        { nodeId: 'parent', label: 'Function_1' },
        { nodeId: 'child', label: 'Helper_2' },
      ],
      (outs: MinimalParamSpec[]) => [...outs, { name: 'inner_out', type: 'string' as const }],
    )
    expect(result[0].data.localDefinition?.outputs).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// getActiveTree
// -----------------------------------------------------------------------------

describe('getActiveTree', () => {
  it('returns root tree when drillPath is empty', () => {
    const rootNodes: MinimalNode[] = [pluginNode('p1')]
    const rootEdges: MinimalEdge[] = []
    const rootVars: MinimalVariable[] = []

    const result = getActiveTree({
      nodes: rootNodes,
      edges: rootEdges,
      variables: rootVars,
      drillPath: [],
    })

    expect(result.nodes).toBe(rootNodes)
    expect(result.edges).toBe(rootEdges)
    expect(result.variables).toBe(rootVars)
    expect(result.localDefinition).toBeNull()
  })

  it('returns deepest Function subtree when drilled', () => {
    const innerNode = pluginNode('inner-1')
    const innerEdge = { id: 'e-inner', source: 'inner-1', target: 'inner-1' }
    const fn = functionNode('fn-1', 'Function_1', {
      nodes: [innerNode],
      edges: [innerEdge],
    })
    const result = getActiveTree({
      nodes: [fn],
      edges: [],
      variables: [],
      drillPath: [{ nodeId: 'fn-1', label: 'Function_1' }],
    })
    expect(result.nodes).toEqual([innerNode])
    expect(result.edges).toEqual([innerEdge])
    expect(result.localDefinition).not.toBeNull()
  })
})

// -----------------------------------------------------------------------------
// isScopeReadOnly
// -----------------------------------------------------------------------------

describe('isScopeReadOnly', () => {
  const shared = (node: MinimalNode, editMode?: boolean): MinimalNode => ({
    ...node,
    data: { ...node.data, functionLifecycle: 'shared', ...(editMode === undefined ? {} : { editMode }) },
  })
  const entry = (nodeId: string) => ({ nodeId, label: nodeId })

  it('is editable at the Test root and inside a Local Function', () => {
    const fn = functionNode('fn-1', 'Function_1')

    expect(isScopeReadOnly([fn], [])).toBe(false)
    expect(isScopeReadOnly([fn], [entry('fn-1')])).toBe(false)
  })

  it('is read-only inside a Shared Function, and inside a Local nested in it', () => {
    const inner = functionNode('fn-inner', 'Inner')
    const outer = shared(functionNode('fn-outer', 'Outer', { nodes: [inner] }))

    expect(isScopeReadOnly([outer], [entry('fn-outer')])).toBe(true)
    expect(isScopeReadOnly([outer], [entry('fn-outer'), entry('fn-inner')])).toBe(true)
  })

  it('is editable inside a Shared Function in edit mode', () => {
    const outer = shared(functionNode('fn-outer', 'Outer'), true)

    expect(isScopeReadOnly([outer], [entry('fn-outer')])).toBe(false)
  })

  it('stops at a missing node or a Function without a body, keeping the deepest Shared seen', () => {
    const bodiless: MinimalNode = { ...pluginNode('fn-bare'), data: { label: 'Bare', nodeType: 'function', functionLifecycle: 'shared' } }
    const outer = shared(functionNode('fn-outer', 'Outer'))

    expect(isScopeReadOnly([outer], [entry('fn-outer'), entry('ghost')])).toBe(true)
    expect(isScopeReadOnly([pluginNode('p1')], [entry('ghost')])).toBe(false)
    expect(isScopeReadOnly([bodiless], [entry('fn-bare'), entry('anything')])).toBe(true)
  })
})
