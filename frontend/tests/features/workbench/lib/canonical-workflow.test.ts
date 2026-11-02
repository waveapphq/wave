/**
 * canonical-workflow - the shared persistence-shape transform and the
 * order-stable structural equality used for snapshot/dirty
 * comparison. One canonical definition backs save payloads, run-current
 * payloads, derived dirty, and history surgery.
 *
 * Contract under test (REQ-5.2.1.24):
 *  - canonicalizeNodes recursively walks the whole tree (root + every
 *    localDefinition body at any depth):
 *      - edit-mode Shared: fold localDefinition into draft, drop the transient
 *        localDefinition (the draft IS the persisted/executed body);
 *      - non-edit-mode Shared: drop the drill-stamped transient localDefinition;
 *      - all nodes: strip selection/drag residue and hasNewerVersion;
 *      - Local Functions: keep localDefinition (persisted) and canonicalize
 *        inside it.
 *  - canonicalEqual is key-order insensitive but value- and array-order
 *    sensitive.
 */

import { describe, it, expect } from 'vitest'

import {
  canonicalizeNodes,
  canonicalEqual,
  canvasFunctionBody,
  canvasFunctionVariables,
  canvasLocalFunctionBodies,
  canvasVariable,
  newVariableId,
  storedFunctionBody,
  storedFunctionVariables,
  storedLocalFunctionBodies,
  storedVariableEntry,
} from '@/features/workbench/lib/canonical-workflow'
import type { WorkflowVariable } from '@/features/workbench/stores/workflow-store'

interface AnyNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  selected?: boolean
  dragging?: boolean
}

function logNode(id: string, extra: Partial<AnyNode> = {}): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin', elementType: 'log' },
    ...extra,
  }
}

function body(nodes: AnyNode[]): Record<string, unknown> {
  return {
    workflow: { nodes, edges: [] },
    inputs: [],
    outputs: [],
    variables: [],
  }
}

function localFn(id: string, innerNodes: AnyNode[]): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'local',
      localDefinition: body(innerNodes),
    },
  }
}

function sharedFn(
  id: string,
  opts: { editMode?: boolean; stampedNodes?: AnyNode[]; draftNodes?: AnyNode[] } = {},
): AnyNode {
  const data: Record<string, unknown> = {
    label: id,
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'shared',
    functionId: `lib-${id}`,
    functionVersion: '1.0.0',
  }
  if (opts.editMode) {
    data.editMode = true
    data.upstreamLink = { functionId: `lib-${id}`, sourceVersion: '1.0.0' }
    data.draft = {
      name: id,
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: opts.draftNodes ?? [], edges: [] },
    }
  }
  if (opts.stampedNodes) {
    data.localDefinition = body(opts.stampedNodes)
  }
  return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data }
}

function dataOf(nodes: AnyNode[], id: string): Record<string, unknown> {
  const node = nodes.find((n) => n.id === id)
  expect(node).toBeDefined()
  return node!.data
}

function innerNodesOf(data: Record<string, unknown>, field: 'localDefinition' | 'draft'): AnyNode[] {
  const def = data[field] as { workflow?: { nodes?: AnyNode[] } } | undefined
  return def?.workflow?.nodes ?? []
}

describe('canonicalizeNodes - residue stripping (root level)', () => {
  it('strips selected and dragging from nodes', () => {
    const result = canonicalizeNodes([
      logNode('a', { selected: true, dragging: true }),
    ]) as unknown as AnyNode[]
    expect(result[0]).not.toHaveProperty('selected')
    expect(result[0]).not.toHaveProperty('dragging')
  })

  it('strips runtime measured dimensions at every depth', () => {
    const inner = { ...logNode('inner'), measured: { width: 130, height: 70 } }
    const parent = { ...localFn('p1', [inner]), measured: { width: 200, height: 80 } }
    const result = canonicalizeNodes([parent]) as unknown as (AnyNode & { measured?: object })[]
    expect(result[0].measured).toBeUndefined()
    const innerOut = innerNodesOf(dataOf(result, 'p1'), 'localDefinition')[0] as AnyNode & {
      measured?: object
    }
    expect(innerOut.measured).toBeUndefined()
  })

  it('strips hasNewerVersion from node data', () => {
    const node = logNode('a')
    node.data.hasNewerVersion = true
    const result = canonicalizeNodes([node]) as unknown as AnyNode[]
    expect(result[0].data).not.toHaveProperty('hasNewerVersion')
  })

  it('preserves persisted node fields (position, config, label)', () => {
    const node = logNode('a')
    node.data.config = { values: { message: "'hi'" } }
    const result = canonicalizeNodes([node]) as unknown as AnyNode[]
    expect(result[0].position).toEqual({ x: 0, y: 0 })
    expect(result[0].data.label).toBe('a')
    expect(result[0].data.config).toEqual({ values: { message: "'hi'" } })
  })
})

describe('canonicalizeNodes - Shared instances (root level)', () => {
  it('drops the drill-stamped localDefinition of a non-edit-mode Shared', () => {
    const result = canonicalizeNodes([
      sharedFn('s1', { stampedNodes: [logNode('inner')] }),
    ]) as unknown as AnyNode[]
    expect(dataOf(result, 's1')).not.toHaveProperty('localDefinition')
  })

  it('folds localDefinition into draft for an edit-mode Shared and drops the transient body', () => {
    const working = [logNode('edited-inner')]
    const result = canonicalizeNodes([
      sharedFn('s1', { editMode: true, stampedNodes: working, draftNodes: [logNode('stale')] }),
    ]) as unknown as AnyNode[]
    const data = dataOf(result, 's1')
    expect(data).not.toHaveProperty('localDefinition')
    expect(innerNodesOf(data, 'draft').map((n) => n.id)).toEqual(['edited-inner'])
    expect(data.editMode).toBe(true)
  })

  it('keeps the draft name when folding (draft-only fields survive)', () => {
    const result = canonicalizeNodes([
      sharedFn('s1', { editMode: true, stampedNodes: [logNode('x')] }),
    ]) as unknown as AnyNode[]
    const draft = dataOf(result, 's1').draft as Record<string, unknown>
    expect(draft.name).toBe('s1')
  })

  it('keeps the persisted draft of an edit-mode Shared with no transient body', () => {
    const result = canonicalizeNodes([
      sharedFn('s1', { editMode: true, draftNodes: [logNode('persisted')] }),
    ]) as unknown as AnyNode[]
    expect(innerNodesOf(dataOf(result, 's1'), 'draft').map((n) => n.id)).toEqual(['persisted'])
  })

  it('defaults missing nodes/edges arrays when canonicalizing a draft body', () => {
    const fn = sharedFn('s1', { editMode: true })
    fn.data.draft = { name: 's1', inputs: [], outputs: [], workflow: {} }
    const result = canonicalizeNodes([fn]) as unknown as AnyNode[]
    const draft = dataOf(result, 's1').draft as { workflow: { nodes: unknown[]; edges: unknown[] } }
    expect(draft.workflow.nodes).toEqual([])
    expect(draft.workflow.edges).toEqual([])
  })
})

describe('canonicalizeNodes - recursion at depth', () => {
  it('folds an edit-mode Shared nested inside a local parent body (depth 2)', () => {
    const nested = sharedFn('s2', {
      editMode: true,
      stampedNodes: [logNode('deep-edit')],
      draftNodes: [logNode('stale')],
    })
    const result = canonicalizeNodes([localFn('outer', [nested])]) as unknown as AnyNode[]
    const outerBody = innerNodesOf(dataOf(result, 'outer'), 'localDefinition')
    const nestedData = dataOf(outerBody, 's2')
    expect(nestedData).not.toHaveProperty('localDefinition')
    expect(innerNodesOf(nestedData, 'draft').map((n) => n.id)).toEqual(['deep-edit'])
  })

  it('folds an edit-mode Shared nested inside another edit-mode Shared (depth 3)', () => {
    const innermost = sharedFn('s3', {
      editMode: true,
      stampedNodes: [logNode('deepest-edit')],
    })
    const middle = sharedFn('s2', {
      editMode: true,
      stampedNodes: [innermost],
    })
    const result = canonicalizeNodes([localFn('outer', [middle])]) as unknown as AnyNode[]
    const outerBody = innerNodesOf(dataOf(result, 'outer'), 'localDefinition')
    const middleData = dataOf(outerBody, 's2')
    expect(middleData).not.toHaveProperty('localDefinition')
    const middleDraftNodes = innerNodesOf(middleData, 'draft')
    const innermostData = dataOf(middleDraftNodes, 's3')
    expect(innermostData).not.toHaveProperty('localDefinition')
    expect(innerNodesOf(innermostData, 'draft').map((n) => n.id)).toEqual(['deepest-edit'])
  })

  it('strips a stamped non-edit Shared nested inside a local body', () => {
    const nested = sharedFn('s2', { stampedNodes: [logNode('viewed')] })
    const result = canonicalizeNodes([localFn('outer', [nested])]) as unknown as AnyNode[]
    const outerBody = innerNodesOf(dataOf(result, 'outer'), 'localDefinition')
    expect(dataOf(outerBody, 's2')).not.toHaveProperty('localDefinition')
  })

  it('strips selection/drag residue inside nested bodies', () => {
    const inner = logNode('inner', { selected: true, dragging: true })
    inner.data.hasNewerVersion = true
    const result = canonicalizeNodes([localFn('outer', [inner])]) as unknown as AnyNode[]
    const outerBody = innerNodesOf(dataOf(result, 'outer'), 'localDefinition')
    expect(outerBody[0]).not.toHaveProperty('selected')
    expect(outerBody[0]).not.toHaveProperty('dragging')
    expect(outerBody[0].data).not.toHaveProperty('hasNewerVersion')
  })

  it('keeps localDefinition on local Functions at every depth', () => {
    const result = canonicalizeNodes([
      localFn('outer', [localFn('mid', [logNode('leaf')])]),
    ]) as unknown as AnyNode[]
    const outerBody = innerNodesOf(dataOf(result, 'outer'), 'localDefinition')
    const midBody = innerNodesOf(dataOf(outerBody, 'mid'), 'localDefinition')
    expect(midBody.map((n) => n.id)).toEqual(['leaf'])
  })
})

describe('canonicalEqual - order-stable structural equality', () => {
  it('treats identical content with different key order as equal', () => {
    const a = { nodes: [{ id: 'n1', data: { label: 'x', config: { p: 1, q: 2 } } }], edges: [] }
    const b = { edges: [], nodes: [{ data: { config: { q: 2, p: 1 }, label: 'x' }, id: 'n1' }] }
    expect(canonicalEqual(a, b)).toBe(true)
  })

  it('treats different values as unequal', () => {
    expect(canonicalEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('treats a missing key as unequal', () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })

  it('keeps array order significant', () => {
    expect(canonicalEqual({ xs: [1, 2] }, { xs: [2, 1] })).toBe(false)
  })

  it('handles primitives and null', () => {
    expect(canonicalEqual(null, null)).toBe(true)
    expect(canonicalEqual(1, 1)).toBe(true)
    expect(canonicalEqual('a', 'b')).toBe(false)
    expect(canonicalEqual(null, {})).toBe(false)
  })

  it('compares nested arrays of objects key-order insensitively', () => {
    const a = [{ id: 'n1', position: { x: 1, y: 2 } }]
    const b = [{ position: { y: 2, x: 1 }, id: 'n1' }]
    expect(canonicalEqual(a, b)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Stored and canvas variable shapes: `secret` on the wire, `isSecret` on the canvas
// ---------------------------------------------------------------------------

describe('storedVariableEntry - the stored entry of a canvas variable', () => {
  const canvas = (extra: Partial<WorkflowVariable>): WorkflowVariable => ({ id: 'v1', name: 'v', type: 'string', ...extra })

  it('keeps no value key for a variable that holds nothing', () => {
    expect(storedVariableEntry(canvas({}))).toEqual({ type: 'string' })
  })

  it('stores the value and every kind and secret flag', () => {
    expect(storedVariableEntry(canvas({ value: 'a + b', isExpression: true }))).toEqual({
      value: 'a + b',
      type: 'string',
      isExpression: true,
    })
    expect(storedVariableEntry(canvas({ value: 'Hi {{ a }}', isTemplate: true, isSecret: true }))).toEqual({
      value: 'Hi {{ a }}',
      type: 'string',
      isTemplate: true,
      secret: true,
    })
  })

  it('stores element types only for an array or map literal holding a value', () => {
    const types: WorkflowVariable['elementTypes'] = ['integer']
    expect(storedVariableEntry(canvas({ type: 'array', value: [1], elementTypes: types }))).toEqual({
      value: [1],
      type: 'array',
      elementTypes: types,
    })
    expect(storedVariableEntry(canvas({ type: 'array', value: [1] }))).toEqual({ value: [1], type: 'array' })
    expect(storedVariableEntry(canvas({ type: 'string', value: 'x', elementTypes: types }))).toEqual({
      value: 'x',
      type: 'string',
    })
    expect(storedVariableEntry(canvas({ type: 'map', elementTypes: { k: 'string' } }))).toEqual({ type: 'map' })
    expect(storedVariableEntry(canvas({ type: 'array', value: 'items', isExpression: true, elementTypes: types }))).toEqual({
      value: 'items',
      type: 'array',
      isExpression: true,
    })
  })
})

describe('canvasVariable - the canvas variable of a stored entry', () => {
  it('maps the stored secret flag to isSecret and keeps the kinds and valid element types', () => {
    expect(
      canvasVariable('id-1', 'items', {
        type: 'array',
        value: [1],
        isExpression: true,
        isTemplate: true,
        secret: true,
        elementTypes: ['integer'],
      }),
    ).toEqual({
      id: 'id-1',
      name: 'items',
      type: 'array',
      value: [1],
      isExpression: true,
      isTemplate: true,
      isSecret: true,
      elementTypes: ['integer'],
    })
  })

  it('holds no value for an entry without a value key and drops malformed element types', () => {
    expect(canvasVariable('id-2', 'empty', { type: 'map', elementTypes: { k: 'no-such-type' } })).toEqual({
      id: 'id-2',
      name: 'empty',
      type: 'map',
    })
  })
})

describe('Function locals - stored list and canvas list', () => {
  const LOCAL: WorkflowVariable = { id: 'var-1', name: 'token', type: 'string', value: 'x', isSecret: true }
  const STORED = { name: 'token', type: 'string', value: 'x', secret: true }
  const stableId = (name: string) => `id-${name}`

  it('stores each local by name without its id, the secret flag as secret', () => {
    expect(storedFunctionVariables([LOCAL])).toEqual([STORED])
  })

  it('reads a stored list back with ids, skipping entries without a name', () => {
    expect(canvasFunctionVariables([STORED, null, { type: 'string' }, 'text'], stableId)).toEqual([
      { id: 'id-token', name: 'token', type: 'string', value: 'x', isSecret: true },
    ])
  })

  it('reads a list that is not a list as no locals', () => {
    expect(canvasFunctionVariables({ token: STORED })).toEqual([])
  })

  it('gives each read local a fresh id by default', () => {
    const [first] = canvasFunctionVariables([STORED])
    const [second] = canvasFunctionVariables([STORED])

    expect(first.id).toMatch(/^var-token-\d+-\w+$/)
    expect(first.id).not.toBe(second.id)
    expect(newVariableId('token')).toMatch(/^var-token-\d+-\w+$/)
  })
})

describe('Function bodies - every Local body and edit-mode draft, at any depth', () => {
  type Rec = Record<string, unknown>
  const LOCAL: WorkflowVariable = { id: 'var-1', name: 'token', type: 'string', value: 'x', isSecret: true }
  const STORED = { name: 'token', type: 'string', value: 'x', secret: true }
  const stableId = (name: string) => `id-${name}`
  const body = (variables: unknown[], nodes: unknown[] = []) => ({
    workflow: { nodes, edges: [] },
    inputs: [],
    outputs: [],
    variables,
  })
  const fnNode = (id: string, data: Rec) => ({ id, type: 'workflowNode', data: { label: id, nodeType: 'function', ...data } })
  const dataOf = (node: unknown) => (node as { data: Rec }).data

  it('maps the locals of a Local body, a nested Local body and an edit-mode draft', () => {
    const inner = fnNode('inner', { localDefinition: body([LOCAL]) })
    const local = fnNode('fn', { localDefinition: body([LOCAL], [inner]) })
    const shared = fnNode('sh', { functionLifecycle: 'shared', editMode: true, draft: body([LOCAL]) })

    const stored = storedLocalFunctionBodies([local, shared])

    const localBody = dataOf(stored[0]).localDefinition as ReturnType<typeof body>
    expect(localBody.variables).toEqual([STORED])
    expect((dataOf(localBody.workflow.nodes[0]).localDefinition as Rec).variables).toEqual([STORED])
    expect((dataOf(stored[1]).draft as Rec).variables).toEqual([STORED])
  })

  it('maps both the drill stamp and the draft of an edit-mode Shared node', () => {
    const shared = fnNode('sh', { localDefinition: body([STORED]), draft: body([STORED]) })

    const [canvas] = canvasLocalFunctionBodies([shared], stableId)

    const expected = [{ id: 'id-token', name: 'token', type: 'string', value: 'x', isSecret: true }]
    expect((dataOf(canvas).localDefinition as Rec).variables).toEqual(expected)
    expect((dataOf(canvas).draft as Rec).variables).toEqual(expected)
  })

  it('leaves a node without a body, a node without data and a non-object as they are', () => {
    const plugin = { id: 'p', data: { label: 'Log', nodeType: 'plugin' } }
    const bare = { id: 'b' }
    const nodes = [plugin, bare, 'text']

    const mapped = canvasLocalFunctionBodies(nodes)

    expect(mapped[0]).toBe(plugin)
    expect(mapped[1]).toBe(bare)
    expect(mapped[2]).toBe('text')
  })

  it('keeps a body with no locals list and no workflow as it is', () => {
    const odd = fnNode('fn', { localDefinition: { workflow: 'none' }, draft: { workflow: { nodes: 'none' } } })

    const [mapped] = storedLocalFunctionBodies([odd])

    expect(dataOf(mapped).localDefinition).toEqual({ workflow: 'none' })
    expect(dataOf(mapped).draft).toEqual({ workflow: { nodes: 'none' } })
  })

  it('maps one Function body with its nested bodies both ways', () => {
    const inner = fnNode('inner', { localDefinition: body([LOCAL]) })
    const canvasBody = body([LOCAL], [inner])

    const stored = storedFunctionBody(canvasBody)
    expect(stored.variables).toEqual([STORED])
    expect((dataOf(stored.workflow.nodes[0]).localDefinition as Rec).variables).toEqual([STORED])

    const back = canvasFunctionBody(stored)
    expect(back.variables).toEqual([expect.objectContaining({ name: 'token', isSecret: true, id: expect.any(String) })])
    expect(back.inputs).toEqual([])
  })
})
