/**
 * Tests for useFunctionScope - derives the active Function scope from the
 * workflow store's drillPath and the deepest Function's localDefinition.
 *
 * Contract:
 *   - When drillPath is empty: insideFunction === false; declared name
 *     arrays are empty; allowedVarNames is an empty Set.
 *   - When drillPath has one entry: insideFunction === true; the declared
 *     input/output names are drawn from that Function's
 *     localDefinition.inputs / outputs; allowedVarNames unions input names,
 *     output names, and Function-local variable names.
 *   - When drillPath has more than one entry: the scope is derived from the
 *     DEEPEST entry (the leaf of the drill stack).
 *
 * REQ scope: REQ-3.1.1.4, REQ-3.1.1.5 (Function-scoped variable visibility).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useFunctionScope } from '@/features/functions/canvas/use-function-scope'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface Param {
  name: string
  type: string
}

interface InnerVar {
  id: string
  name: string
  value: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
}

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
      inputs: Param[]
      outputs: Param[]
      variables?: InnerVar[]
    }
  }
}

function localFn(
  id: string,
  label: string,
  schema: { inputs?: Param[]; outputs?: Param[]; variables?: InnerVar[]; nodes?: MinimalNode[] } = {},
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
        workflow: { nodes: schema.nodes ?? [], edges: [] },
        inputs: schema.inputs ?? [],
        outputs: schema.outputs ?? [],
        variables: schema.variables ?? [],
      },
    },
  }
}

function setStore(nodes: MinimalNode[], drillPath: { nodeId: string; label: string }[]): void {
  useWorkflowStore.setState({
    nodes: nodes as unknown as never,
    drillPath,
  } as Partial<ReturnType<typeof useWorkflowStore.getState>>)
}

beforeEach(() => {
  setStore([], [])
})

describe('useFunctionScope - outside Function (empty drillPath)', () => {
  it('returns insideFunction=false when drillPath is empty', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.insideFunction).toBe(false)
  })

  it('returns empty declared name arrays when drillPath is empty', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.declaredInputNames).toEqual([])
    expect(result.current.declaredOutputNames).toEqual([])
  })

  it('returns an empty allowedVarNames Set when drillPath is empty', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.allowedVarNames).toBeInstanceOf(Set)
    expect(result.current.allowedVarNames.size).toBe(0)
  })
})

describe('useFunctionScope - inside a single drilled Function', () => {
  beforeEach(() => {
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'user_id', type: 'string' }, { name: 'count', type: 'integer' }],
      outputs: [{ name: 'result', type: 'string' }],
      variables: [
        { id: 'lv1', name: 'tmp', value: 0, type: 'integer' },
        { id: 'lv2', name: 'state', value: false, type: 'boolean' },
      ],
    })
    setStore([fn], [{ nodeId: 'fn-1', label: 'Function_1' }])
  })

  it('returns insideFunction=true', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.insideFunction).toBe(true)
  })

  it('returns the declared input names from the Function localDefinition', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.declaredInputNames).toEqual(['user_id', 'count'])
  })

  it('returns the declared output names from the Function localDefinition', () => {
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.declaredOutputNames).toEqual(['result'])
  })

  it('returns allowedVarNames unioning inputs, outputs, and local variables', () => {
    const { result } = renderHook(() => useFunctionScope())
    const names = Array.from(result.current.allowedVarNames).sort()
    expect(names).toEqual(['count', 'result', 'state', 'tmp', 'user_id'])
  })
})

describe('useFunctionScope - names from the one scope-names reader', () => {
  it('allows a profile alias bound on a Block inside the Function', () => {
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'user_id', type: 'string' }],
      nodes: [
        {
          id: 'inner-sql',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Query users',
            nodeType: 'plugin',
            config: { values: {}, profileBindings: [{ profileId: 'p1', alias: 'db', bindings: {} }] },
          } as MinimalNode['data'],
        },
      ],
    })
    setStore([fn], [{ nodeId: 'fn-1', label: 'Function_1' }])

    const { result } = renderHook(() => useFunctionScope())

    expect(Array.from(result.current.allowedVarNames).sort()).toEqual(['db', 'user_id'])
    expect(result.current.declaredInputNames).toEqual(['user_id'])
  })
})

describe('useFunctionScope - inside nested Functions', () => {
  it('derives scope from the DEEPEST Function in the drill stack', () => {
    const inner = localFn('inner', 'Helper_2', {
      inputs: [{ name: 'token', type: 'string' }],
      outputs: [{ name: 'response_body', type: 'string' }],
      variables: [{ id: 'iv1', name: 'retries', value: 3, type: 'integer' }],
    })
    const outer = localFn('outer', 'Function_1', {
      inputs: [{ name: 'outer_input', type: 'string' }],
      outputs: [{ name: 'outer_output', type: 'string' }],
      variables: [{ id: 'ov1', name: 'outer_local', value: 'x', type: 'string' }],
      nodes: [inner],
    })
    setStore(
      [outer],
      [
        { nodeId: 'outer', label: 'Function_1' },
        { nodeId: 'inner', label: 'Helper_2' },
      ],
    )

    const { result } = renderHook(() => useFunctionScope())

    expect(result.current.insideFunction).toBe(true)
    expect(result.current.declaredInputNames).toEqual(['token'])
    expect(result.current.declaredOutputNames).toEqual(['response_body'])
    expect(Array.from(result.current.allowedVarNames).sort()).toEqual([
      'response_body',
      'retries',
      'token',
    ])
    // The outer Function's identifiers are NOT in scope.
    expect(result.current.allowedVarNames.has('outer_input')).toBe(false)
    expect(result.current.allowedVarNames.has('outer_local')).toBe(false)
  })

  it('isolates per-level at depth 3 - only the deepest Function names are in scope', () => {
    const deepest = localFn('deepest', 'Deepest_3', {
      inputs: [{ name: 'd_in', type: 'string' }],
      outputs: [{ name: 'd_out', type: 'string' }],
      variables: [{ id: 'dv', name: 'd_local', value: 1, type: 'integer' }],
    })
    const middle = localFn('middle', 'Middle_2', {
      inputs: [{ name: 'm_in', type: 'string' }],
      outputs: [{ name: 'm_out', type: 'string' }],
      variables: [{ id: 'mv', name: 'm_local', value: 'x', type: 'string' }],
      nodes: [deepest],
    })
    const top = localFn('top', 'Top_1', {
      inputs: [{ name: 't_in', type: 'string' }],
      outputs: [{ name: 't_out', type: 'string' }],
      variables: [{ id: 'tv', name: 't_local', value: true, type: 'boolean' }],
      nodes: [middle],
    })
    setStore(
      [top],
      [
        { nodeId: 'top', label: 'Top_1' },
        { nodeId: 'middle', label: 'Middle_2' },
        { nodeId: 'deepest', label: 'Deepest_3' },
      ],
    )

    const { result } = renderHook(() => useFunctionScope())

    expect(result.current.declaredInputNames).toEqual(['d_in'])
    expect(result.current.declaredOutputNames).toEqual(['d_out'])
    expect(Array.from(result.current.allowedVarNames).sort()).toEqual(['d_in', 'd_local', 'd_out'])
    // No leakage from EITHER ancestor level (middle or top).
    for (const leaked of ['m_in', 'm_out', 'm_local', 't_in', 't_out', 't_local']) {
      expect(result.current.allowedVarNames.has(leaked)).toBe(false)
    }
  })
})

describe('useFunctionScope - defensive cases', () => {
  it('falls back to empty arrays/Set when the deepest drill node has no localDefinition', () => {
    // Shouldn't happen via the supported drill flow (pushDrill gates on
    // nodeType === 'function'), but the scope hook must not crash if a
    // drill entry's node was mutated to a non-Function in the meantime.
    const orphan: MinimalNode = {
      id: 'orphan',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Orphan', nodeType: 'plugin' },
    }
    setStore([orphan], [{ nodeId: 'orphan', label: 'Orphan' }])

    const { result } = renderHook(() => useFunctionScope())

    expect(result.current.insideFunction).toBe(true)
    expect(result.current.declaredInputNames).toEqual([])
    expect(result.current.declaredOutputNames).toEqual([])
    expect(result.current.allowedVarNames.size).toBe(0)
  })

  it('treats a missing variables field on localDefinition as an empty list', () => {
    const fn = localFn('fn-1', 'Function_1', {
      inputs: [{ name: 'x', type: 'string' }],
      outputs: [{ name: 'y', type: 'string' }],
    })
    delete fn.data.localDefinition!.variables
    setStore([fn], [{ nodeId: 'fn-1', label: 'Function_1' }])

    const { result } = renderHook(() => useFunctionScope())

    expect(Array.from(result.current.allowedVarNames).sort()).toEqual(['x', 'y'])
  })

  it('returns empty allowed-name list when inputs / outputs fields are undefined', () => {
    // Force inputs/outputs to undefined so namesFrom() takes the `!items`
    // early-return branch.
    const fn: MinimalNode = {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_1',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
        } as unknown as MinimalNode['data']['localDefinition'],
      },
    }
    setStore([fn], [{ nodeId: 'fn-1', label: 'Function_1' }])
    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.allowedVarNames.size).toBe(0)
  })

  it('filters out non-object entries from inputs / outputs / variables arrays', () => {
    // Pass primitives + nulls inside the spec arrays so the type-guard's
    // `typeof item !== 'object' || item === null` branch fires.
    const fn: MinimalNode = {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_1',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [], edges: [] },
          inputs: [{ name: 'x', type: 'string' }, 'not_an_object', null] as Param[],
          outputs: [],
          variables: [{ id: 'v1', name: 'tmp', value: 0, type: 'integer' }, 42, undefined] as unknown as InnerVar[],
        },
      },
    }
    setStore([fn], [{ nodeId: 'fn-1', label: 'Function_1' }])

    const { result } = renderHook(() => useFunctionScope())
    expect(result.current.declaredInputNames).toEqual(['x'])
    expect(Array.from(result.current.allowedVarNames).sort()).toEqual(['tmp', 'x'])
  })
})
