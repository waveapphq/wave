/**
 * Workflow Store - declared input/output parameter actions on the active
 * Function.
 *
 * Contract (REQ-3.1.1.5):
 *
 *   addInputParam(spec)     -> appends `spec` to active Function's
 *                              `localDefinition.inputs`. Throws when not
 *                              drilled in (inputs only exist on Functions).
 *   removeInputParam(name)  -> filters out the entry whose `name` matches.
 *                              Throws when not drilled in.
 *   addOutputParam(spec)    -> appends to `localDefinition.outputs`.
 *                              Throws when not drilled in.
 *   removeOutputParam(name) -> filters out by name. Throws when not drilled in.
 *
 * REQ scope: REQ-3.1.1.5 (block parameter configuration forms - Function-side),
 * REQ-3.1.2.1 (custom blocks with input parameters), REQ-3.1.2.4 (validation
 * - structural duplicate-name handled at dialog level; this layer is the
 * persistence sink).
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { activeScopeNames, useWorkflowStore } from '@/features/workbench/stores/workflow-store'

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

interface ParamSpec {
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  default?: unknown
  required?: boolean
  secret?: boolean
  enumValues?: unknown[]
  isExpression?: boolean
  isTemplate?: boolean
  description?: string
}

type FunctionPath = Array<{ nodeId: string; label: string }>

interface ScopedVariable {
  id: string
  name: string
  type: string
  value?: unknown
  isSecret?: boolean
  isExpression?: boolean
  isTemplate?: boolean
  elementTypes?: unknown
}

type StoreResult = { success: boolean; error?: string }

interface ParamSlice {
  drillPath: FunctionPath
  pushDrill: (id: string) => void
  addInputParam: (spec: ParamSpec, functionPath?: FunctionPath) => void
  removeInputParam: (name: string) => void
  addOutputParam: (spec: ParamSpec, functionPath?: FunctionPath) => void
  removeOutputParam: (name: string) => void
  updateInputParam: (oldName: string, updates: Partial<ParamSpec>, functionPath?: FunctionPath) => StoreResult
  updateOutputParam: (oldName: string, updates: Partial<ParamSpec>, functionPath?: FunctionPath) => StoreResult
  renameVariable: (id: string, newName: string, functionPath?: FunctionPath) => StoreResult
  updateVariable: (id: string, updates: Partial<Omit<ScopedVariable, 'id'>>, functionPath?: FunctionPath) => void
  getActiveNodes: () => MinimalNode[]
}

function asStore() {
  return useWorkflowStore.getState() as unknown as ParamSlice & {
    nodes: MinimalNode[]
    variables: ScopedVariable[]
    isDirty: boolean
  }
}

const localFn = (
  id: string,
  label: string,
  inner: { inputs?: ParamSpec[]; outputs?: ParamSpec[] } = {},
): MinimalNode => ({
  id,
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label,
    nodeType: 'function',
    functionLifecycle: 'local',
    localDefinition: {
      workflow: { nodes: [], edges: [] },
      inputs: inner.inputs ?? [],
      outputs: inner.outputs ?? [],
      variables: [],
    },
  },
})

function reset(nodes: MinimalNode[] = [], variables: ScopedVariable[] = []) {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    edges: [] as never,
    variables: variables as never,
    drillPath: [],
    isDirty: false,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => reset())

describe('Workflow Store - addInputParam', () => {
  it('appends the spec to the deepest Function localDefinition.inputs', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')

    asStore().addInputParam({ name: 'username', type: 'string' })

    const root = asStore().nodes
    expect(root[0].data.localDefinition?.inputs).toEqual([
      { name: 'username', type: 'string' },
    ])
  })

  it('throws when not drilled into a Function', () => {
    expect(() => asStore().addInputParam({ name: 'x', type: 'string' })).toThrow(
      /^Cannot add input parameter outside a Function$/,
    )
  })

  it('appends required + default + secret metadata verbatim', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')

    asStore().addInputParam({
      name: 'count',
      type: 'integer',
      default: 5,
      required: true,
      secret: false,
    })

    const root = asStore().nodes
    expect(root[0].data.localDefinition?.inputs).toEqual([
      { name: 'count', type: 'integer', default: 5, required: true, secret: false },
    ])
  })

  it('preserves existing inputs when appending', () => {
    reset([localFn('fn-1', 'Function_1', { inputs: [{ name: 'a', type: 'string' }] })])
    asStore().pushDrill('fn-1')

    asStore().addInputParam({ name: 'b', type: 'integer' })

    const root = asStore().nodes
    expect(root[0].data.localDefinition?.inputs).toEqual([
      { name: 'a', type: 'string' },
      { name: 'b', type: 'integer' },
    ])
  })

  it('flips isDirty to true on success', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')
    expect(asStore().isDirty).toBe(false)

    asStore().addInputParam({ name: 'x', type: 'string' })

    expect(asStore().isDirty).toBe(true)
  })

  it('throws when the name collides with another input/output/variable in the active Function scope', () => {
    reset([
      localFn('fn-1', 'Function_1', {
        inputs: [{ name: 'taken', type: 'string' }],
      }),
    ])
    asStore().pushDrill('fn-1')

    expect(() => asStore().addInputParam({ name: 'taken', type: 'string' })).toThrow(
      /^Name "taken" already exists in this Function$/,
    )
  })

  it('handles a Function node whose localDefinition has no inputs/outputs keys (?? [] fallback)', () => {
    // Defensive: legacy / partially-formed Function fixtures may lack the
    // inputs/outputs arrays entirely. activeScopeNames must fall back to
    // empty arrays without crashing.
    const sparse: MinimalNode = {
      id: 'fn-sparse',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Sparse',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          variables: [],
        },
      },
    } as unknown as MinimalNode
    reset([sparse])
    asStore().pushDrill('fn-sparse')

    // First add succeeds since the scope is effectively empty.
    asStore().addInputParam({ name: 'first', type: 'string' })
    const root = asStore().nodes
    expect(root[0].data.localDefinition?.inputs).toEqual([
      { name: 'first', type: 'string' },
    ])
  })
})

describe('Workflow Store - removeInputParam', () => {
  it('filters the named entry out of localDefinition.inputs', () => {
    reset([
      localFn('fn-1', 'Function_1', {
        inputs: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'integer' },
        ],
      }),
    ])
    asStore().pushDrill('fn-1')

    asStore().removeInputParam('a')

    const root = asStore().nodes
    expect(root[0].data.localDefinition?.inputs).toEqual([
      { name: 'b', type: 'integer' },
    ])
  })

  it('throws when not drilled into a Function', () => {
    expect(() => asStore().removeInputParam('a')).toThrow(
      /^Cannot remove input parameter outside a Function$/,
    )
  })

  it('is a no-op when the name does not match any input', () => {
    reset([
      localFn('fn-1', 'Function_1', { inputs: [{ name: 'a', type: 'string' }] }),
    ])
    asStore().pushDrill('fn-1')

    asStore().removeInputParam('missing')

    expect(asStore().nodes[0].data.localDefinition?.inputs).toEqual([
      { name: 'a', type: 'string' },
    ])
  })
})

describe('Workflow Store - addOutputParam', () => {
  it('appends to localDefinition.outputs', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')

    asStore().addOutputParam({ name: 'result', type: 'string' })

    expect(asStore().nodes[0].data.localDefinition?.outputs).toEqual([
      { name: 'result', type: 'string' },
    ])
  })

  it('throws when not drilled into a Function', () => {
    expect(() => asStore().addOutputParam({ name: 'r', type: 'string' })).toThrow(
      /^Cannot add output parameter outside a Function$/,
    )
  })

  it('flips isDirty to true on success', () => {
    reset([localFn('fn-1', 'Function_1')])
    asStore().pushDrill('fn-1')

    asStore().addOutputParam({ name: 'r', type: 'string' })

    expect(asStore().isDirty).toBe(true)
  })

  it('throws when the name collides with another input/output/variable in the active Function scope', () => {
    reset([
      localFn('fn-1', 'Function_1', {
        outputs: [{ name: 'result', type: 'string' }],
      }),
    ])
    asStore().pushDrill('fn-1')

    expect(() => asStore().addOutputParam({ name: 'result', type: 'string' })).toThrow(
      /^Name "result" already exists in this Function$/,
    )
  })
})

describe('Workflow Store - removeOutputParam', () => {
  it('filters the named entry out of localDefinition.outputs', () => {
    reset([
      localFn('fn-1', 'Function_1', {
        outputs: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'integer' },
        ],
      }),
    ])
    asStore().pushDrill('fn-1')

    asStore().removeOutputParam('b')

    expect(asStore().nodes[0].data.localDefinition?.outputs).toEqual([
      { name: 'a', type: 'string' },
    ])
  })

  it('throws when not drilled into a Function', () => {
    expect(() => asStore().removeOutputParam('a')).toThrow(
      /^Cannot remove output parameter outside a Function$/,
    )
  })
})

describe('Workflow Store - updateInputParam / updateOutputParam', () => {
  // Synthesized var-row ids (`param:input:*` / `param:output:*`) map to nothing in
  // state.variables, so the update actions mutate localDefinition.inputs / outputs directly.
  function withInputFn(extra: ParamSpec[] = []) {
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'user_id', type: 'string', default: 'admin' }, ...extra],
      outputs: [{ name: 'result', type: 'integer', default: 0 }],
    })
    reset([fn])
    asStore().pushDrill('fn-1')
  }

  it('updates an input param default in place', () => {
    withInputFn()
    const r = asStore().updateInputParam('user_id', { default: 'guest' })
    expect(r).toEqual({ success: true })
    expect(asStore().nodes[0].data.localDefinition?.inputs).toEqual([
      { name: 'user_id', type: 'string', default: 'guest' },
    ])
    expect(asStore().isDirty).toBe(true)
  })

  it('updates the matched input param while leaving siblings untouched', () => {
    // Exercises the non-matching branch in the param-array mutator (covers
    // both arms of `p.name === oldName ? newSpec : p`).
    withInputFn([
      { name: 'sibling_keep', type: 'integer', default: 7 },
    ])
    const r = asStore().updateInputParam('user_id', { default: 'guest' })
    expect(r).toEqual({ success: true })
    expect(asStore().nodes[0].data.localDefinition?.inputs).toEqual([
      { name: 'user_id', type: 'string', default: 'guest' },
      { name: 'sibling_keep', type: 'integer', default: 7 },
    ])
  })

  it('updateInputParam tolerates a Function whose inputs field is missing', () => {
    // Exercises the `?? []` fallback when `active.localDefinition[field]` is
    // undefined (defensive against fixtures that omit the array entirely).
    const fn = localFn('fn-1', 'Function_1')
    // Strip the inputs field after construction to simulate a malformed
    // fixture; walkActiveSubtree returns the localDefinition as-is.
    delete (fn.data.localDefinition as { inputs?: unknown }).inputs
    reset([fn])
    asStore().pushDrill('fn-1')
    const r = asStore().updateInputParam('user_id', { default: 'guest' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Parameter "user_id" not found')
  })

  it('updates an input param type + default in place', () => {
    withInputFn()
    const r = asStore().updateInputParam('user_id', { type: 'integer', default: 7 })
    expect(r).toEqual({ success: true })
    expect(asStore().nodes[0].data.localDefinition?.inputs).toEqual([
      { name: 'user_id', type: 'integer', default: 7 },
    ])
  })

  it('renames an input param and refactors inner-workflow expression references', () => {
    const innerNode: MinimalNode = {
      id: 'log-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Log',
        // Cast through any to widen the inline-node shape for the rename test;
        // the store only needs the expressionFields / config / values to
        // exist for the refactor pass.
        ...({ expressionFields: ['message'], config: { values: { message: 'user_id' } } } as object),
      } as unknown as MinimalNode['data'],
    }
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'user_id', type: 'string', default: 'admin' }],
    })
    fn.data.localDefinition!.workflow.nodes = [innerNode]
    reset([fn])
    asStore().pushDrill('fn-1')

    const r = asStore().updateInputParam('user_id', { name: 'username' })
    expect(r).toEqual({ success: true })

    const inputs = asStore().nodes[0].data.localDefinition?.inputs
    expect(inputs).toEqual([{ name: 'username', type: 'string', default: 'admin' }])

    const refactored = asStore().nodes[0].data.localDefinition!.workflow.nodes[0]
    const config = (refactored.data as { config?: { values?: { message?: string } } }).config
    expect(config?.values?.message).toBe('username')
  })

  it('rejects updateInputParam when not drilled into a Function', () => {
    reset()
    const r = asStore().updateInputParam('user_id', { default: 'guest' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Cannot update input parameter outside a Function')
  })

  it('rejects updateInputParam when the param does not exist', () => {
    withInputFn()
    const r = asStore().updateInputParam('does_not_exist', { default: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Parameter "does_not_exist" not found')
  })

  it('rejects updateInputParam on rename collision with an output param', () => {
    withInputFn()
    const r = asStore().updateInputParam('user_id', { name: 'result' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Name "result" already exists in this Function')
  })

  it('updates an output param default in place', () => {
    withInputFn()
    const r = asStore().updateOutputParam('result', { default: 42 })
    expect(r).toEqual({ success: true })
    expect(asStore().nodes[0].data.localDefinition?.outputs).toEqual([
      { name: 'result', type: 'integer', default: 42 },
    ])
  })

  it('rejects updateOutputParam when not drilled into a Function', () => {
    reset()
    const r = asStore().updateOutputParam('result', { default: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Cannot update output parameter outside a Function')
  })

  it('rejects updateOutputParam when the param does not exist', () => {
    withInputFn()
    const r = asStore().updateOutputParam('missing', { default: 1 })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Parameter "missing" not found')
  })

  it('rejects updateOutputParam on rename collision with another output', () => {
    const fn = localFn('fn-1', 'Function_1', {
      outputs: [
        { name: 'a', type: 'integer', default: 0 },
        { name: 'b', type: 'integer', default: 0 },
      ],
    })
    reset([fn])
    asStore().pushDrill('fn-1')
    const r = asStore().updateOutputParam('a', { name: 'b' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Name "b" already exists in this Function')
  })
})

describe('Workflow Store - param actions at depth 2', () => {
  it('addInputParam targets the deepest Function in the drill stack', () => {
    const child = localFn('child', 'Helper_2')
    const parent: MinimalNode = {
      id: 'parent',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_1',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [child], edges: [] },
          inputs: [],
          outputs: [],
          variables: [],
        },
      },
    }
    reset([parent])
    asStore().pushDrill('parent')
    asStore().pushDrill('child')

    asStore().addInputParam({ name: 'inner_in', type: 'string' })

    const parentNode = asStore().nodes[0]
    expect(parentNode.data.localDefinition?.inputs).toEqual([])
    const childNode = parentNode.data.localDefinition!.workflow.nodes[0]
    expect(childNode.data.localDefinition?.inputs).toEqual([
      { name: 'inner_in', type: 'string' },
    ])
  })
})

// ---------------------------------------------------------------------------
// A creation window keeps creating into the Function it was opened in (VMGR-102)
// ---------------------------------------------------------------------------

describe('Workflow Store - a parameter lands in the Function its window was opened in (VMGR-102)', () => {
  const PATH_A: FunctionPath = [{ nodeId: 'fn-a', label: 'Function_A' }]

  function twoFunctions(inner: { inputs?: ParamSpec[]; outputs?: ParamSpec[] } = {}) {
    reset([localFn('fn-a', 'Function_A', inner), localFn('fn-b', 'Function_B')])
  }

  function paramsOf(id: string, field: 'inputs' | 'outputs'): unknown[] | undefined {
    return asStore().nodes.find((n) => n.id === id)?.data.localDefinition?.[field]
  }

  it.each<['addInputParam' | 'addOutputParam', 'inputs' | 'outputs', string]>([
    ['addInputParam', 'inputs', 'drilled into another Function'],
    ['addOutputParam', 'outputs', 'drilled into another Function'],
    ['addInputParam', 'inputs', 'back at the test root'],
    ['addOutputParam', 'outputs', 'back at the test root'],
  ])('%s writes into the %s of the given Function path while the author is %s', (action, field, where) => {
    twoFunctions()
    if (where === 'drilled into another Function') asStore().pushDrill('fn-b')

    asStore()[action]({ name: 'from_a', type: 'string' }, PATH_A)

    expect(paramsOf('fn-a', field)).toEqual([{ name: 'from_a', type: 'string' }])
    expect(paramsOf('fn-b', field)).toEqual([])
  })

  it.each<['addInputParam' | 'addOutputParam', 'inputs' | 'outputs']>([
    ['addInputParam', 'inputs'],
    ['addOutputParam', 'outputs'],
  ])('%s checks the name against the %s of the Function the path names', (action, field) => {
    twoFunctions({ [field]: [{ name: 'taken', type: 'string' }] })
    asStore().pushDrill('fn-b')

    expect(() => asStore()[action]({ name: 'taken', type: 'string' }, PATH_A)).toThrow(
      /^Name "taken" already exists in this Function$/,
    )
    expect(paramsOf('fn-b', field)).toEqual([])
  })

  it('writes into a nested Function the path names', () => {
    const child = localFn('child', 'Helper_2')
    const parent = localFn('parent', 'Function_1')
    parent.data.localDefinition!.workflow.nodes = [child]
    reset([parent])

    asStore().addInputParam({ name: 'inner_in', type: 'string' }, [
      { nodeId: 'parent', label: 'Function_1' },
      { nodeId: 'child', label: 'Helper_2' },
    ])

    const parentNode = asStore().nodes[0]
    expect(parentNode.data.localDefinition?.inputs).toEqual([])
    expect(parentNode.data.localDefinition!.workflow.nodes[0].data.localDefinition?.inputs).toEqual([
      { name: 'inner_in', type: 'string' },
    ])
  })

  it.each<['addInputParam' | 'addOutputParam', 'inputs' | 'outputs', ParamSpec]>([
    ['addInputParam', 'inputs', { name: 'opt', type: 'string', default: null }],
    ['addOutputParam', 'outputs', { name: 'res', type: 'map', default: null }],
    ['addInputParam', 'inputs', { name: 'level', type: 'integer', required: true, enumValues: [1, 2], default: 1 }],
    ['addOutputParam', 'outputs', { name: 'sum', type: 'integer', default: 'a + b', isExpression: true }],
    ['addOutputParam', 'outputs', { name: 'greeting', type: 'string', default: 'Hi {{ who }}', isTemplate: true }],
  ])('%s stores the %s spec as given: %j', (action, field, spec) => {
    twoFunctions()
    asStore().pushDrill('fn-a')

    asStore()[action](spec, PATH_A)

    expect(paramsOf('fn-a', field)).toStrictEqual([spec])
  })
})

describe('Workflow Store - renaming a parameter reaches every name site in the Function', () => {
  it('renames an input in a condition row and in a Function Block field inside the Function', () => {
    const assertBlock = {
      id: 'assert-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Assert',
        ...({
          nodeType: 'control',
          elementType: 'assert',
          config: {
            values: {
              assertions: [
                {
                  id: 'row-1',
                  type: 'literal',
                  variable: 'user_id',
                  value_type: 'string',
                  operator: 'is_not_null',
                  reference_value: null,
                  reference_is_expression: false,
                },
              ],
            },
          },
        } as object),
      } as unknown as MinimalNode['data'],
    }
    const callBlock = {
      id: 'call-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Lookup',
        ...({
          nodeType: 'function',
          elementType: 'function',
          functionLifecycle: 'shared',
          expressionFields: ['id'],
          config: { values: { id: 'user_id' }, outputBindings: {} },
        } as object),
      } as unknown as MinimalNode['data'],
    }
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'user_id', type: 'string' }],
    })
    fn.data.localDefinition!.workflow.nodes = [assertBlock, callBlock]
    reset([fn])
    asStore().pushDrill('fn-1')

    expect(asStore().updateInputParam('user_id', { name: 'username' })).toEqual({ success: true })

    const [assertAfter, callAfter] = asStore().nodes[0].data.localDefinition!.workflow.nodes as unknown as Array<{
      data: { config: { values: Record<string, unknown> } }
    }>
    expect((assertAfter.data.config.values.assertions as Array<{ variable: string }>)[0].variable).toBe('username')
    expect(callAfter.data.config.values).toEqual({ id: 'username' })
  })
})

describe('Workflow Store - a renamed parameter reaches computed sources and the Function Block fields', () => {
  type Rec = Record<string, unknown>
  const withData = (node: MinimalNode, extra: Rec): MinimalNode => ({
    ...node,
    data: { ...node.data, ...extra } as MinimalNode['data'],
  })
  const fnBody = (node: MinimalNode) => node.data.localDefinition!

  it('renames an output inside Expression and Template outputs and the call output binding', () => {
    const fn = withData(
      localFn('fn-1', 'Function_1', {
        outputs: [
          { name: 'total', type: 'integer' },
          { name: 'doubled', type: 'integer', isExpression: true, default: 'total * 2' },
          { name: 'message', type: 'string', isTemplate: true, default: 'Total {{ total }}' },
          { name: 'plain', type: 'string', default: 'total' },
          { name: 'pending', type: 'integer', isExpression: true, default: null },
          { name: 'other', type: 'integer', isExpression: true, default: 'doubled + 1' },
        ],
      }),
      { config: { outputBindings: { total: 'result_var', doubled: 'twice_var' } } },
    )
    const sibling = withData(localFn('fn-2', 'Function_2'), { config: { outputBindings: { total: 'kept_var' } } })
    reset([fn, sibling])
    asStore().pushDrill('fn-1')

    expect(asStore().updateOutputParam('total', { name: 'sum' })).toEqual({ success: true })

    const [fnAfter, siblingAfter] = asStore().nodes
    expect(fnBody(fnAfter).outputs).toEqual([
      { name: 'sum', type: 'integer' },
      { name: 'doubled', type: 'integer', isExpression: true, default: 'sum * 2' },
      { name: 'message', type: 'string', isTemplate: true, default: 'Total {{ sum }}' },
      { name: 'plain', type: 'string', default: 'total' },
      { name: 'pending', type: 'integer', isExpression: true, default: null },
      { name: 'other', type: 'integer', isExpression: true, default: 'doubled + 1' },
    ])
    expect((fnAfter.data as unknown as Rec).config).toEqual({ outputBindings: { sum: 'result_var', doubled: 'twice_var' } })
    expect((siblingAfter.data as unknown as Rec).config).toEqual({ outputBindings: { total: 'kept_var' } })
  })

  it('renames an output of a call block that has no config or no output bindings', () => {
    const bare = localFn('fn-1', 'Function_1', { outputs: [{ name: 'total', type: 'integer' }] })
    reset([bare])
    asStore().pushDrill('fn-1')

    expect(asStore().updateOutputParam('total', { name: 'sum' })).toEqual({ success: true })
    expect((asStore().nodes[0].data as unknown as Rec).config).toBeUndefined()

    const noBindings = withData(localFn('fn-2', 'Function_2', { outputs: [{ name: 'total', type: 'integer' }] }), {
      config: { values: {} },
    })
    reset([noBindings])
    asStore().pushDrill('fn-2')

    expect(asStore().updateOutputParam('total', { name: 'sum' })).toEqual({ success: true })
    expect((asStore().nodes[0].data as unknown as Rec).config).toEqual({ values: {}, outputBindings: undefined })
  })

  it('renames an input inside the computed locals of the Function', () => {
    const fn = localFn('fn-1', 'Function_1', { inputs: [{ name: 'who', type: 'string' }] })
    fnBody(fn).variables = [
      { id: 'l1', name: 'greeting', type: 'string', value: 'Hi {{ who }}', isTemplate: true },
      { id: 'l2', name: 'upper', type: 'string', value: 'who.upper()', isExpression: true },
      { id: 'l3', name: 'plain', type: 'string', value: 'who' },
      { id: 'l4', name: 'empty', type: 'string', value: null, isExpression: true },
      { id: 'l5', name: 'unrelated', type: 'string', value: 'other_name', isExpression: true },
    ]
    reset([fn])
    asStore().pushDrill('fn-1')

    expect(asStore().updateInputParam('who', { name: 'person' })).toEqual({ success: true })

    expect(fnBody(asStore().nodes[0]).variables).toEqual([
      { id: 'l1', name: 'greeting', type: 'string', value: 'Hi {{ person }}', isTemplate: true },
      { id: 'l2', name: 'upper', type: 'string', value: 'person.upper()', isExpression: true },
      { id: 'l3', name: 'plain', type: 'string', value: 'who' },
      { id: 'l4', name: 'empty', type: 'string', value: null, isExpression: true },
      { id: 'l5', name: 'unrelated', type: 'string', value: 'other_name', isExpression: true },
    ])
  })

  it('renames the input field of a Function Block nested inside another Function, with its expression flag', () => {
    const inner = withData(localFn('fn-inner', 'Inner', { inputs: [{ name: 'level', type: 'string' }] }), {
      expressionFields: ['level'],
      config: { values: { level: 'chosen' } },
    })
    const outer = localFn('fn-outer', 'Outer')
    fnBody(outer).workflow.nodes = [inner]
    reset([outer])
    asStore().pushDrill('fn-outer')
    asStore().pushDrill('fn-inner')

    expect(asStore().updateInputParam('level', { name: 'tier' })).toEqual({ success: true })

    const innerAfter = fnBody(asStore().nodes[0]).workflow.nodes[0]
    const innerData = innerAfter.data as unknown as Rec
    expect((innerData.config as Rec).values).toEqual({ tier: 'chosen' })
    expect(innerData.expressionFields).toEqual(['tier'])
    expect(fnBody(innerAfter).inputs).toEqual([{ name: 'tier', type: 'string' }])
  })

  it('renames a map input of a Function Block with its dotted entry flags and its element types', () => {
    const fn = withData(localFn('fn-1', 'Function_1', { inputs: [{ name: 'headers', type: 'map' }] }), {
      expressionFields: ['headers.X-Id'],
      elementTypes: { headers: { 'X-Id': 'string', retries: 'integer' } },
      config: { values: { headers: { 'X-Id': 'request_id', retries: 3 } } },
    })
    reset([fn])
    asStore().pushDrill('fn-1')

    expect(asStore().updateInputParam('headers', { name: 'request_headers' })).toEqual({ success: true })

    const data = asStore().nodes[0].data as unknown as Rec
    expect((data.config as Rec).values).toEqual({ request_headers: { 'X-Id': 'request_id', retries: 3 } })
    expect(data.expressionFields).toEqual(['request_headers.X-Id'])
    expect(data.elementTypes).toEqual({ request_headers: { 'X-Id': 'string', retries: 'integer' } })
  })
})

// ---------------------------------------------------------------------------
// The variable window writes into its own scope, under one name rule (REQ-3.1.2.4, VMGR-106)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

const PATH_A: FunctionPath = [{ nodeId: 'fn-a', label: 'Function_A' }]
const TEST_SCOPE: FunctionPath = []
const PARAM_NAME_RULE = 'Parameter name must start with a letter, contain only letters, numbers, underscores'

/** A block whose `message` field reads `source` as an expression. */
function readerBlock(id: string, source: string): MinimalNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      ...({ expressionFields: ['message'], config: { values: { message: source } } } as object),
    } as MinimalNode['data'],
  }
}

/** A Local Function Block with its body, locals, and the Block's own data (bindings, config). */
function functionBlock(
  id: string,
  label: string,
  body: {
    inputs?: ParamSpec[]
    outputs?: ParamSpec[]
    variables?: ScopedVariable[]
    nodes?: MinimalNode[]
    block?: Rec
  } = {},
): MinimalNode {
  const fn = localFn(id, label, { inputs: body.inputs, outputs: body.outputs })
  fn.data.localDefinition!.variables = body.variables ?? []
  fn.data.localDefinition!.workflow.nodes = body.nodes ?? []
  return { ...fn, data: { ...fn.data, ...body.block } as MinimalNode['data'] }
}

function findDeep(nodes: MinimalNode[], id: string): MinimalNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const inner = node.data.localDefinition?.workflow.nodes
    const found = inner ? findDeep(inner, id) : undefined
    if (found) return found
  }
  return undefined
}

function blockData(id: string): Rec {
  return findDeep(asStore().nodes, id)!.data as unknown as Rec
}

function bodyOf(id: string) {
  return findDeep(asStore().nodes, id)!.data.localDefinition!
}

function localsOf(id: string): ScopedVariable[] {
  return (bodyOf(id).variables ?? []) as ScopedVariable[]
}

function messageOf(id: string): unknown {
  return (blockData(id) as { config: { values: { message: unknown } } }).config.values.message
}

describe('Workflow Store - activeScopeNames lists the names of one scope', () => {
  function state() {
    return useWorkflowStore.getState()
  }

  beforeEach(() => {
    const inner = functionBlock('fn-inner', 'Inner', {
      inputs: [{ name: 'depth', type: 'integer' }],
      variables: [{ id: 'i-loc', name: 'inner_loc', type: 'string', value: 'x' }],
    })
    reset(
      [
        functionBlock('fn-a', 'Function_A', {
          inputs: [{ name: 'region', type: 'string' }],
          outputs: [{ name: 'result', type: 'string' }],
          variables: [{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 1 }],
          nodes: [inner],
        }),
      ],
      [{ id: 't-base', name: 'base', type: 'string', value: 'x' }],
    )
  })

  it('lists the Test variables for the Test scope', () => {
    expect(activeScopeNames(state().nodes, state().edges, state().variables, TEST_SCOPE)).toEqual(['base'])
  })

  it('lists the inputs, outputs and locals of the Function the path names as one namespace', () => {
    expect(activeScopeNames(state().nodes, state().edges, state().variables, PATH_A)).toEqual([
      'region',
      'result',
      'loc_n',
    ])
  })

  it('lists only the nested Function names for a nested path', () => {
    const nested = [...PATH_A, { nodeId: 'fn-inner', label: 'Inner' }]
    expect(activeScopeNames(state().nodes, state().edges, state().variables, nested)).toEqual([
      'depth',
      'inner_loc',
    ])
  })
})

describe('Workflow Store - renameVariable in the scope of its window (VMGR-106)', () => {
  function windowScopes() {
    reset(
      [
        functionBlock('fn-a', 'Function_A', {
          inputs: [{ name: 'region', type: 'string' }],
          outputs: [{ name: 'result', type: 'string' }],
          variables: [
            { id: 'a-loc', name: 'loc_n', type: 'integer', value: 1 },
            { id: 'a-map', name: 'loc_map', type: 'map', value: {} },
          ],
          nodes: [readerBlock('a-log', 'loc_n')],
        }),
        functionBlock('fn-b', 'Function_B', {
          variables: [
            { id: 'b-loc', name: 'loc_n', type: 'integer', value: 2 },
            { id: 'b-only', name: 'b_only', type: 'integer', value: 3 },
          ],
          nodes: [readerBlock('b-log', 'loc_n')],
        }),
        readerBlock('root-log', 'base'),
      ],
      [
        { id: 't-base', name: 'base', type: 'string', value: 'x' },
        { id: 't-other', name: 'other', type: 'string', value: 'y' },
      ],
    )
  }

  beforeEach(windowScopes)

  it('renames a Function local in the Function the path names while the canvas shows another Function', () => {
    asStore().pushDrill('fn-b')

    expect(asStore().renameVariable('a-loc', 'count_n', PATH_A)).toEqual({ success: true })

    expect(localsOf('fn-a')[0]).toEqual({ id: 'a-loc', name: 'count_n', type: 'integer', value: 1 })
    expect(messageOf('a-log')).toBe('count_n')
    expect(localsOf('fn-b')[0]).toEqual({ id: 'b-loc', name: 'loc_n', type: 'integer', value: 2 })
    expect(messageOf('b-log')).toBe('loc_n')
  })

  it('renames a Function local through its path while the canvas shows the Test', () => {
    expect(asStore().renameVariable('a-loc', 'count_n', PATH_A)).toEqual({ success: true })

    expect(localsOf('fn-a')[0].name).toBe('count_n')
    expect(messageOf('a-log')).toBe('count_n')
    expect(messageOf('root-log')).toBe('base')
  })

  it('renames a Test variable through the empty path while the canvas shows a Function', () => {
    asStore().pushDrill('fn-a')

    expect(asStore().renameVariable('t-base', 'base_url', TEST_SCOPE)).toEqual({ success: true })

    expect(asStore().variables.map((v) => v.name)).toEqual(['base_url', 'other'])
    expect(messageOf('root-log')).toBe('base_url')
    expect(localsOf('fn-a').map((v) => v.name)).toEqual(['loc_n', 'loc_map'])
  })

  it.each([
    ['an input', 'region'],
    ['an output', 'result'],
    ['another local', 'loc_map'],
  ])('refuses a local renamed to %s of its Function', (_what, taken) => {
    asStore().pushDrill('fn-a')

    expect(asStore().renameVariable('a-loc', taken, PATH_A)).toEqual({
      success: false,
      error: `Name "${taken}" already exists in this Function`,
    })
    expect(localsOf('fn-a')[0].name).toBe('loc_n')
  })

  it('accepts a name free in the path Function though the Function the canvas shows has it', () => {
    asStore().pushDrill('fn-b')

    expect(asStore().renameVariable('a-loc', 'b_only', PATH_A)).toEqual({ success: true })
    expect(localsOf('fn-a')[0].name).toBe('b_only')
  })

  it('refuses a Test variable renamed to another Test variable name', () => {
    expect(asStore().renameVariable('t-base', 'other', TEST_SCOPE)).toEqual({
      success: false,
      error: 'Name "other" already exists in this scope',
    })
    expect(asStore().variables[0].name).toBe('base')
  })

  it('lets a Test variable take a name a Function uses while the canvas shows that Function', () => {
    asStore().pushDrill('fn-a')

    expect(asStore().renameVariable('t-base', 'region', TEST_SCOPE)).toEqual({ success: true })
    expect(asStore().variables[0].name).toBe('region')
  })

  it.each([
    ['', 'Name is required'],
    ['  base', 'Name cannot have leading or trailing whitespace'],
    ['a'.repeat(65), 'Name must be 64 characters or fewer'],
    ['9lives', 'Variable name must start with letter/underscore, contain only letters, numbers, underscores'],
    ['my-var', 'Variable name must start with letter/underscore, contain only letters, numbers, underscores'],
    ['class', '"class" is a Python keyword'],
    ['suite', '"suite" is reserved for namespace access. Use suite.field_name in expressions.'],
  ])('refuses the name %j with the one name rule: %s', (name, error) => {
    expect(asStore().renameVariable('t-base', name, TEST_SCOPE)).toEqual({ success: false, error })
    expect(asStore().variables[0].name).toBe('base')
  })

  it('lets a Function local start with an underscore', () => {
    asStore().pushDrill('fn-a')

    expect(asStore().renameVariable('a-loc', '_tmp', PATH_A)).toEqual({ success: true })
    expect(localsOf('fn-a')[0].name).toBe('_tmp')
  })

  it('keeps a Function local under its own name through the path, never refusing it as taken', () => {
    expect(asStore().renameVariable('a-loc', 'loc_n', PATH_A)).toEqual({ success: true })

    expect(localsOf('fn-a').map((v) => v.name)).toEqual(['loc_n', 'loc_map'])
    expect(messageOf('a-log')).toBe('loc_n')
  })

  it('lets a Function local take a Test variable name, since the Function has its own names', () => {
    expect(asStore().renameVariable('a-loc', 'base', PATH_A)).toEqual({ success: true })

    expect(localsOf('fn-a')[0].name).toBe('base')
    expect(asStore().variables.map((v) => v.name)).toEqual(['base', 'other'])
  })

  it('renames a local of a nested Function through its path while the canvas shows the Test', () => {
    const inner = functionBlock('fn-inner', 'Inner', {
      variables: [{ id: 'i-loc', name: 'loc_n', type: 'integer', value: 4 }],
      nodes: [readerBlock('inner-log', 'loc_n')],
    })
    reset([functionBlock('fn-outer', 'Outer', { variables: [{ id: 'o-loc', name: 'loc_n', type: 'integer', value: 5 }], nodes: [inner] })])
    const nested = [{ nodeId: 'fn-outer', label: 'Outer' }, { nodeId: 'fn-inner', label: 'Inner' }]

    expect(asStore().renameVariable('i-loc', 'tries', nested)).toEqual({ success: true })

    expect(localsOf('fn-inner')[0].name).toBe('tries')
    expect(messageOf('inner-log')).toBe('tries')
    expect(localsOf('fn-outer')[0].name).toBe('loc_n')
  })
})

describe('Workflow Store - updateVariable in the scope of its window', () => {
  beforeEach(() => {
    reset(
      [
        functionBlock('fn-a', 'Function_A', {
          variables: [{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 1 }],
        }),
        functionBlock('fn-b', 'Function_B', {
          variables: [{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 2 }],
        }),
      ],
      [{ id: 't-base', name: 'base', type: 'string', value: 'x' }],
    )
  })

  it('writes type, kind and value into the Function the path names while the canvas shows another Function', () => {
    asStore().pushDrill('fn-b')

    asStore().updateVariable('a-loc', { type: 'string', value: 'base.upper()', isExpression: true }, PATH_A)

    expect(bodyOf('fn-a').variables).toEqual([
      { id: 'a-loc', name: 'loc_n', type: 'string', value: 'base.upper()', isExpression: true },
    ])
    expect(bodyOf('fn-b').variables).toEqual([{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 2 }])
  })

  it('writes value, secret and element types of a Test variable through the empty path while the canvas shows a Function', () => {
    asStore().pushDrill('fn-a')

    asStore().updateVariable('t-base', { type: 'array', value: [1], isSecret: true, elementTypes: ['integer'] }, TEST_SCOPE)

    expect(asStore().variables).toEqual([
      { id: 't-base', name: 'base', type: 'array', value: [1], isSecret: true, elementTypes: ['integer'] },
    ])
    expect(bodyOf('fn-a').variables).toEqual([{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 1 }])
  })
})

describe('Workflow Store - updateInputParam / updateOutputParam in the scope of its window (VMGR-106)', () => {
  function paramScopes() {
    reset([
      functionBlock('fn-a', 'Function_A', {
        inputs: [{ name: 'region', type: 'string', default: 'eu' }],
        outputs: [
          { name: 'total', type: 'integer', secret: true },
          { name: 'note', type: 'string' },
        ],
        variables: [{ id: 'a-loc', name: 'loc_n', type: 'integer', value: 1 }],
        nodes: [readerBlock('a-log', 'region')],
        block: {
          config: {
            values: { region: 'us' },
            outputBindings: { total: 'sum_var', note: 'note_var' },
            outputSecretFields: ['total'],
          },
        },
      }),
      functionBlock('fn-b', 'Function_B', {
        inputs: [
          { name: 'region', type: 'string' },
          { name: 'zone', type: 'string' },
        ],
        variables: [{ id: 'b-only', name: 'b_only', type: 'integer', value: 3 }],
        block: { config: { values: { region: 'b' } } },
      }),
    ])
  }

  beforeEach(paramScopes)

  it.each<['updateInputParam' | 'updateOutputParam', 'inputs' | 'outputs', string]>([
    ['updateInputParam', 'inputs', 'region'],
    ['updateOutputParam', 'outputs', 'note'],
  ])('%s updates the %s of the Function the path names while the canvas shows another Function', (action, field, name) => {
    asStore().pushDrill('fn-b')

    expect(asStore()[action](name, { description: 'What it is for' }, PATH_A)).toEqual({ success: true })

    expect((bodyOf('fn-a')[field] as ParamSpec[]).find((p) => p.name === name)?.description).toBe('What it is for')
    expect((bodyOf('fn-b')[field] as ParamSpec[]).some((p) => p.description !== undefined)).toBe(false)
  })

  it.each<['updateInputParam' | 'updateOutputParam', 'inputs' | 'outputs', string]>([
    ['updateInputParam', 'inputs', 'region'],
    ['updateOutputParam', 'outputs', 'note'],
  ])('%s updates the %s of the Function the path names while the canvas shows the Test', (action, field, name) => {
    expect(asStore()[action](name, { description: 'What it is for' }, PATH_A)).toEqual({ success: true })

    expect((bodyOf('fn-a')[field] as ParamSpec[]).find((p) => p.name === name)?.description).toBe('What it is for')
  })

  it.each<['updateInputParam' | 'updateOutputParam', string, string]>([
    ['updateInputParam', 'region', 'Cannot update input parameter outside a Function'],
    ['updateOutputParam', 'note', 'Cannot update output parameter outside a Function'],
  ])('%s refuses the empty path (the Test scope) even while the canvas shows a Function', (action, name, error) => {
    asStore().pushDrill('fn-a')

    expect(asStore()[action](name, { default: 'x' }, TEST_SCOPE)).toEqual({ success: false, error })
  })

  it('reports the parameter missing from the path Function even when the Function the canvas shows has it', () => {
    asStore().pushDrill('fn-b')

    expect(asStore().updateInputParam('zone', { default: 'x' }, PATH_A)).toEqual({
      success: false,
      error: 'Parameter "zone" not found',
    })
    expect((bodyOf('fn-b').inputs as ParamSpec[])[1]).toEqual({ name: 'zone', type: 'string' })
  })

  it.each<['updateInputParam' | 'updateOutputParam', string, string]>([
    ['updateInputParam', 'region', 'note'],
    ['updateInputParam', 'region', 'loc_n'],
    ['updateOutputParam', 'note', 'region'],
    ['updateOutputParam', 'note', 'total'],
    ['updateOutputParam', 'note', 'loc_n'],
  ])('%s refuses renaming %s to %s, a name the path Function already has', (action, oldName, taken) => {
    expect(asStore()[action](oldName, { name: taken }, PATH_A)).toEqual({
      success: false,
      error: `Name "${taken}" already exists in this Function`,
    })
  })

  it('accepts a name free in the path Function though the Function the canvas shows has it', () => {
    asStore().pushDrill('fn-b')

    expect(asStore().updateInputParam('region', { name: 'b_only' }, PATH_A)).toEqual({ success: true })
    expect((bodyOf('fn-a').inputs as ParamSpec[])[0].name).toBe('b_only')
  })

  it('renaming an input through the path renames its readers and keeps the Function Block value', () => {
    expect(asStore().updateInputParam('region', { name: 'area' }, PATH_A)).toEqual({ success: true })

    expect(bodyOf('fn-a').inputs).toEqual([{ name: 'area', type: 'string', default: 'eu' }])
    expect(messageOf('a-log')).toBe('area')
    expect((blockData('fn-a').config as Rec).values).toEqual({ area: 'us' })
    expect((blockData('fn-b').config as Rec).values).toEqual({ region: 'b' })
  })

  it('renaming a secret output keeps its Secret box ticked on the Function Block', () => {
    asStore().pushDrill('fn-a')

    expect(asStore().updateOutputParam('total', { name: 'grand_total' })).toEqual({ success: true })

    expect(blockData('fn-a').config).toEqual({
      values: { region: 'us' },
      outputBindings: { grand_total: 'sum_var', note: 'note_var' },
      outputSecretFields: ['grand_total'],
    })
  })

  it('renaming a secret output through the path moves its binding and its Secret box', () => {
    expect(asStore().updateOutputParam('total', { name: 'grand_total' }, PATH_A)).toEqual({ success: true })

    expect(blockData('fn-a').config).toEqual({
      values: { region: 'us' },
      outputBindings: { grand_total: 'sum_var', note: 'note_var' },
      outputSecretFields: ['grand_total'],
    })
  })

  it('renaming a plain output leaves the Secret boxes of the other outputs as they are', () => {
    expect(asStore().updateOutputParam('note', { name: 'memo' }, PATH_A)).toEqual({ success: true })

    expect(blockData('fn-a').config).toEqual({
      values: { region: 'us' },
      outputBindings: { total: 'sum_var', memo: 'note_var' },
      outputSecretFields: ['total'],
    })
  })

  it('renaming a secret output moves its Secret box even when no variable is bound to it yet', () => {
    reset([
      functionBlock('fn-s', 'Function_S', {
        outputs: [{ name: 'total', type: 'integer', secret: true }],
        block: { config: { values: {}, outputSecretFields: ['total'] } },
      }),
    ])

    asStore().pushDrill('fn-s')

    expect(asStore().updateOutputParam('total', { name: 'grand_total' })).toEqual({ success: true })

    expect((blockData('fn-s').config as Rec).outputSecretFields).toEqual(['grand_total'])
  })

  it('renaming a declared-secret output on a Block that never saved its Secret boxes writes no secret list', () => {
    reset([
      functionBlock('fn-s', 'Function_S', {
        outputs: [{ name: 'total', type: 'integer', secret: true }],
        block: { config: { outputBindings: { total: 'sum_var' } } },
      }),
    ])

    asStore().pushDrill('fn-s')

    expect(asStore().updateOutputParam('total', { name: 'grand_total' })).toEqual({ success: true })

    expect((blockData('fn-s').config as Rec).outputBindings).toEqual({ grand_total: 'sum_var' })
    expect((blockData('fn-s').config as Rec).outputSecretFields).toBeUndefined()
    expect(bodyOf('fn-s').outputs).toEqual([{ name: 'grand_total', type: 'integer', secret: true }])
  })

  it('renaming a secret output of a Function Block nested inside another Function moves its Secret box', () => {
    const inner = functionBlock('fn-inner', 'Inner', {
      outputs: [{ name: 'total', type: 'integer', secret: true }],
      block: { config: { outputBindings: { total: 'sum_var' }, outputSecretFields: ['total'] } },
    })
    reset([functionBlock('fn-outer', 'Outer', { nodes: [inner] })])
    asStore().pushDrill('fn-outer')
    asStore().pushDrill('fn-inner')

    expect(asStore().updateOutputParam('total', { name: 'grand_total' })).toEqual({ success: true })

    expect(blockData('fn-inner').config).toEqual({
      outputBindings: { grand_total: 'sum_var' },
      outputSecretFields: ['grand_total'],
    })
  })
})

describe('Workflow Store - an input or output name starts with a letter (REQ-3.1.2.4)', () => {
  beforeEach(() => {
    reset([
      functionBlock('fn-a', 'Function_A', {
        inputs: [{ name: 'region', type: 'string' }],
        outputs: [{ name: 'note', type: 'string' }],
      }),
    ])
    asStore().pushDrill('fn-a')
  })

  it.each<['updateInputParam' | 'updateOutputParam', 'inputs' | 'outputs', string]>([
    ['updateInputParam', 'inputs', 'region'],
    ['updateOutputParam', 'outputs', 'note'],
  ])('%s refuses a rename to a leading underscore', (action, field, name) => {
    expect(asStore()[action](name, { name: '_id' })).toEqual({ success: false, error: PARAM_NAME_RULE })
    expect((bodyOf('fn-a')[field] as ParamSpec[])[0].name).toBe(name)
  })

  it.each<['addInputParam' | 'addOutputParam', 'inputs' | 'outputs']>([
    ['addInputParam', 'inputs'],
    ['addOutputParam', 'outputs'],
  ])('%s refuses a leading underscore', (action, field) => {
    expect(() => asStore()[action]({ name: '_id', type: 'string' })).toThrow(new RegExp(`^${PARAM_NAME_RULE}$`))
    expect(bodyOf('fn-a')[field]).toHaveLength(1)
  })

  it.each([
    ['', 'Name is required'],
    ['9lives', PARAM_NAME_RULE],
    ['class', '"class" is a Python keyword'],
  ])('a parameter rename to %j runs the one name rule: %s', (name, error) => {
    expect(asStore().updateInputParam('region', { name })).toEqual({ success: false, error })
  })
})

describe('Workflow Store - a Local Function input change reconciles its Function Block values (FNCFG-9)', () => {
  const VALUES = { count: 3, ratio: 1.5, level: 'high', label: 'base_label + "!"' }

  function callers() {
    reset([
      functionBlock('fn-a', 'Function_A', {
        inputs: [
          { name: 'count', type: 'integer' },
          { name: 'ratio', type: 'float' },
          { name: 'level', type: 'string', required: true, enumValues: ['low', 'high'], default: 'low' },
          { name: 'label', type: 'string' },
        ],
        outputs: [{ name: 'total', type: 'integer' }],
        block: { expressionFields: ['label'], config: { values: VALUES, outputBindings: { total: 'sum_var' } } },
      }),
      functionBlock('fn-b', 'Function_B', {
        inputs: [{ name: 'count', type: 'integer' }],
        block: { config: { values: { count: 3 } } },
      }),
    ])
  }

  beforeEach(callers)

  function without(name: keyof typeof VALUES): Rec {
    const { [name]: _dropped, ...kept } = VALUES
    return kept
  }

  it('retyping an input drops a literal that no longer fits', () => {
    asStore().pushDrill('fn-a')

    expect(asStore().updateInputParam('count', { type: 'string' })).toEqual({ success: true })

    expect(valuesOf('fn-a')).toEqual(without('count'))
  })

  it('retyping a float input to integer drops its float literal', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('ratio', { type: 'integer' })

    expect(valuesOf('fn-a')).toEqual(without('ratio'))
  })

  it('keeps a literal that still fits (integer 3 to Float)', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('count', { type: 'float' })

    expect(valuesOf('fn-a')).toEqual(VALUES)
  })

  it('keeps an expression as written whatever the new type', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('label', { type: 'integer' })

    expect(valuesOf('fn-a')).toEqual(VALUES)
    expect(blockData('fn-a').expressionFields).toEqual(['label'])
  })

  it('narrowing the allowed values drops a pick no longer allowed and leaves the field empty, never on the default', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('level', { enumValues: ['low', 'mid'] })

    expect(valuesOf('fn-a')).toEqual(without('level'))
  })

  it('keeps a pick the new allowed values still hold', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('level', { enumValues: ['high', 'mid'], default: 'high' })

    expect(valuesOf('fn-a')).toEqual(VALUES)
  })

  it('retyping an input to true / false leaves its dropped field empty, never on the default', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('count', { type: 'boolean', default: false })

    expect(valuesOf('fn-a')).toEqual(without('count'))
  })

  it('renaming a choice-list input whose pick was dropped keeps the field empty', () => {
    asStore().pushDrill('fn-a')
    asStore().updateInputParam('level', { enumValues: ['low', 'mid'] })

    asStore().updateInputParam('level', { name: 'tier' })

    expect(valuesOf('fn-a')).toEqual(without('level'))
  })

  it('deleting an input drops its value from the Function Block', () => {
    asStore().pushDrill('fn-a')

    asStore().removeInputParam('count')

    expect(valuesOf('fn-a')).toEqual(without('count'))
  })

  it('deleting an input drops its expression flag with its value', () => {
    asStore().pushDrill('fn-a')

    asStore().removeInputParam('label')

    expect(valuesOf('fn-a')).toEqual(without('label'))
    expect(blockData('fn-a').expressionFields ?? []).toEqual([])
  })

  it('a new free-entry input starts not set and leaves the other values as they are', () => {
    asStore().pushDrill('fn-a')

    asStore().addInputParam({ name: 'limit', type: 'integer', required: true })
    asStore().addInputParam({ name: 'note', type: 'string', default: 'hello' })

    expect(valuesOf('fn-a')).toEqual(VALUES)
  })

  it('a change that breaks nothing keeps every input value and output binding', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('count', { description: 'How many', required: true })

    expect(blockData('fn-a').config).toEqual({ values: VALUES, outputBindings: { total: 'sum_var' } })
  })

  it('a rename with a retype that still fits keeps the value under the new name', () => {
    asStore().pushDrill('fn-a')

    asStore().updateInputParam('count', { name: 'amount', type: 'float' })

    expect(valuesOf('fn-a')).toEqual({ ...without('count'), amount: 3 })
  })

  it('reconciles the Function Block of the Function the path names, not the one the canvas shows', () => {
    asStore().pushDrill('fn-b')

    expect(asStore().updateInputParam('count', { type: 'string' }, PATH_A)).toEqual({ success: true })

    expect(valuesOf('fn-a')).toEqual(without('count'))
    expect(valuesOf('fn-b')).toEqual({ count: 3 })
  })

  it('leaves the values of a Shared Function draft Block for its publish to reconcile', () => {
    reset([
      functionBlock('fn-s', 'Function_S', {
        inputs: [{ name: 'count', type: 'integer' }],
        block: { functionLifecycle: 'shared', editMode: true, config: { values: { count: 3 } } },
      }),
    ])
    const draftPath = [{ nodeId: 'fn-s', label: 'Function_S' }]

    expect(asStore().updateInputParam('count', { type: 'string' }, draftPath)).toEqual({ success: true })

    expect(valuesOf('fn-s')).toEqual({ count: 3 })
  })

  it('reconciles a Function Block nested inside another Function', () => {
    const inner = functionBlock('fn-inner', 'Inner', {
      inputs: [{ name: 'count', type: 'integer' }],
      block: { config: { values: { count: 3 } } },
    })
    reset([functionBlock('fn-outer', 'Outer', { nodes: [inner] })])
    asStore().pushDrill('fn-outer')
    asStore().pushDrill('fn-inner')

    asStore().updateInputParam('count', { type: 'boolean' })

    expect(valuesOf('fn-inner')).toEqual({})
  })
})

function valuesOf(id: string): Rec {
  return (blockData(id).config as Rec | undefined)?.values as Rec
}

describe('Workflow Store - a new choice-list or true / false input starts on its default on the Function Block (FNCFG-9)', () => {
  const VALUES = { region: 'eu' }

  beforeEach(() => {
    reset([
      functionBlock('fn-a', 'Function_A', {
        inputs: [{ name: 'region', type: 'string' }],
        block: { config: { values: VALUES } },
      }),
      functionBlock('fn-b', 'Function_B', {
        inputs: [{ name: 'region', type: 'string' }],
        block: { config: { values: { region: 'b' } } },
      }),
    ])
  })

  it.each<[string, ParamSpec, unknown]>([
    ['a Required choice-list input', { name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' }, 'silver'],
    ['an Integer choice-list input', { name: 'retries', type: 'integer', required: true, enumValues: [1, 3, 5], default: 3 }, 3],
    ['a true / false input whose default is false', { name: 'verbose', type: 'boolean', default: false }, false],
    ['a Required true / false input', { name: 'strict', type: 'boolean', required: true, default: true }, true],
  ])('adding %s writes its default on the Function Block as a plain value', (_case, spec, value) => {
    asStore().pushDrill('fn-a')

    asStore().addInputParam(spec)

    expect(valuesOf('fn-a')).toEqual({ ...VALUES, [spec.name]: value })
    expect(blockData('fn-a').expressionFields ?? []).toEqual([])
    expect(blockData('fn-a').templateFields ?? []).toEqual([])
  })

  it('adding a choice-list input to the Function the path names writes on that Function Block only', () => {
    asStore().pushDrill('fn-b')

    asStore().addInputParam({ name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' }, PATH_A)

    expect(valuesOf('fn-a')).toEqual({ ...VALUES, tier: 'silver' })
    expect(valuesOf('fn-b')).toEqual({ region: 'b' })
  })

  it('adding a true / false input to a Function Block that holds no values yet writes it', () => {
    reset([functionBlock('fn-e', 'Function_E')])
    asStore().pushDrill('fn-e')

    asStore().addInputParam({ name: 'verbose', type: 'boolean', default: false })

    expect(valuesOf('fn-e')).toEqual({ verbose: false })
  })

  it('adding a choice-list input to a Function nested inside another Function writes on the nested Block', () => {
    const inner = functionBlock('fn-inner', 'Inner', { block: { config: { values: {} } } })
    reset([functionBlock('fn-outer', 'Outer', { nodes: [inner] })])
    asStore().pushDrill('fn-outer')
    asStore().pushDrill('fn-inner')

    asStore().addInputParam({ name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' })

    expect(valuesOf('fn-inner')).toEqual({ tier: 'silver' })
    expect(blockData('fn-outer').config).toBeUndefined()
  })

  it('adding a choice-list input to a Shared Function draft writes nothing until its publish', () => {
    reset([
      functionBlock('fn-s', 'Function_S', {
        inputs: [{ name: 'region', type: 'string' }],
        block: { functionLifecycle: 'shared', editMode: true, config: { values: VALUES } },
      }),
    ])
    const draftPath = [{ nodeId: 'fn-s', label: 'Function_S' }]

    asStore().addInputParam({ name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' }, draftPath)

    expect(valuesOf('fn-s')).toEqual(VALUES)
  })
})

describe('Workflow Store - removing a parameter drops the Function Block field with all its flags (REQ-3.1.2.1)', () => {
  const BLOCK = {
    expressionFields: ['region', 'headers.X-Id'],
    templateFields: ['greeting'],
    elementTypes: { headers: { 'X-Id': 'string', retries: 'integer' } },
    config: {
      values: { region: 'zone_var', headers: { 'X-Id': 'request_id', retries: 3 }, greeting: 'Hi {{ who }}' },
      outputBindings: { total: 'sum_var', token: 'token_var' },
      outputSecretFields: ['token'],
    },
  }
  const INPUTS: ParamSpec[] = [
    { name: 'region', type: 'string' },
    { name: 'headers', type: 'map' },
    { name: 'greeting', type: 'string' },
  ]
  const OUTPUTS: ParamSpec[] = [
    { name: 'total', type: 'integer' },
    { name: 'token', type: 'string', secret: true },
  ]

  beforeEach(() => {
    reset([functionBlock('fn-a', 'Function_A', { inputs: INPUTS, outputs: OUTPUTS, block: BLOCK })])
    asStore().pushDrill('fn-a')
  })

  it('removing a map input drops its value, its dotted entry flags and its element types', () => {
    asStore().removeInputParam('headers')

    expect(valuesOf('fn-a')).toEqual({ region: 'zone_var', greeting: 'Hi {{ who }}' })
    expect(blockData('fn-a').expressionFields).toEqual(['region'])
    expect(blockData('fn-a').elementTypes ?? {}).toEqual({})
  })

  it('removing a template input drops its value and its template flag', () => {
    asStore().removeInputParam('greeting')

    expect(valuesOf('fn-a')).toEqual({ region: 'zone_var', headers: { 'X-Id': 'request_id', retries: 3 } })
    expect(blockData('fn-a').templateFields ?? []).toEqual([])
  })

  it('removing an output drops its binding and its secret mark', () => {
    asStore().removeOutputParam('token')

    expect(blockData('fn-a').config).toEqual({
      values: BLOCK.config.values,
      outputBindings: { total: 'sum_var' },
      outputSecretFields: [],
    })
  })

  it('removing an output of a Function Block that never saved its Secret boxes writes no secret list', () => {
    reset([
      functionBlock('fn-b', 'Function_B', {
        outputs: OUTPUTS,
        block: { config: { values: {}, outputBindings: { total: 'sum_var', token: 'token_var' } } },
      }),
    ])
    asStore().pushDrill('fn-b')

    asStore().removeOutputParam('total')

    expect(blockData('fn-b').config).toEqual({ values: {}, outputBindings: { token: 'token_var' } })
    expect(blockData('fn-b').config as Rec).not.toHaveProperty('outputSecretFields')
  })

  it.each<['removeInputParam' | 'removeOutputParam', string, (data: Rec) => unknown, unknown]>([
    ['removeInputParam', 'region', (data) => (data.config as Rec).values, { headers: { 'X-Id': 'request_id', retries: 3 }, greeting: 'Hi {{ who }}' }],
    ['removeOutputParam', 'token', (data) => (data.config as Rec).outputBindings, { total: 'sum_var' }],
  ])('%s drops the field of a Shared Function draft Block right away', (action, name, read, expected) => {
    const draft = functionBlock('fn-s', 'Function_S', {
      inputs: INPUTS,
      outputs: OUTPUTS,
      block: { ...BLOCK, functionLifecycle: 'shared', editMode: true },
    })
    reset([draft])
    useWorkflowStore.setState({ drillPath: [{ nodeId: 'fn-s', label: 'Function_S' }] } as Partial<
      ReturnType<typeof useWorkflowStore.getState>
    >)

    asStore()[action](name)

    expect(read(blockData('fn-s'))).toEqual(expected)
  })
})
