/**
 * function-scope-rows - the one scope-names reader: the names a Function scope can read (its inputs,
 * outputs and locals, and the profile aliases its Blocks bind) and the Blocks that write each name
 * (REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.3.11).
 */

import { describe, it, expect } from 'vitest'
import {
  functionScopeNames,
  functionScopeRows,
  type ScopeBody,
} from '@/features/workbench/lib/function-scope-rows'

interface InnerBlock {
  id: string
  data: Record<string, unknown>
}

function block(
  id: string,
  label: string,
  config: { outputBindings?: Record<string, string>; profileBindings?: unknown[] } = {},
): InnerBlock {
  return {
    id,
    data: {
      label,
      nodeType: 'plugin',
      elementType: 'log',
      config: { values: {}, profileBindings: [], ...config },
    },
  }
}

function functionBlock(id: string, label: string, inner: ScopeBody, outputBindings: Record<string, string> = {}): InnerBlock {
  return {
    id,
    data: {
      label,
      nodeType: 'function',
      elementType: 'function',
      functionLifecycle: 'local',
      localDefinition: inner,
      config: { values: {}, profileBindings: [], outputBindings },
    },
  }
}

function body(spec: Partial<ScopeBody> & { nodes?: InnerBlock[] }): ScopeBody {
  return {
    inputs: spec.inputs ?? [],
    outputs: spec.outputs ?? [],
    variables: spec.variables ?? [],
    workflow: { nodes: spec.nodes ?? [] },
  }
}

const kindsOf = (scope: ScopeBody | null | undefined) =>
  functionScopeNames(scope).map((entry) => [entry.name, entry.kind])

const writersOf = (scope: ScopeBody, name: string) =>
  functionScopeNames(scope).find((entry) => entry.name === name)?.writers

describe('functionScopeNames - declared names', () => {
  it('lists the inputs, then the outputs, then the locals, each in declared order', () => {
    const scope = body({
      inputs: [{ name: 'user_id', type: 'string' }, { name: 'count', type: 'integer' }],
      outputs: [{ name: 'result', type: 'string' }],
      variables: [
        { id: 'v1', name: 'tmp', value: 0, type: 'integer' },
        { id: 'v2', name: 'state', value: false, type: 'boolean' },
      ],
    })

    expect(kindsOf(scope)).toEqual([
      ['user_id', 'input'],
      ['count', 'input'],
      ['result', 'output'],
      ['tmp', 'local'],
      ['state', 'local'],
    ])
  })

  it('lists the same names the Variable Manager rows show, in the same order', () => {
    const scope = body({
      inputs: [{ name: 'a', type: 'string' }],
      outputs: [{ name: 'b', type: 'map' }],
      variables: [{ id: 'v1', name: 'c', value: null, type: 'string' }],
    })

    expect(functionScopeNames(scope).map((entry) => entry.name)).toEqual(
      functionScopeRows(scope).map((row) => row.name),
    )
  })

  it('reads no names from a missing body', () => {
    expect(functionScopeNames(null)).toEqual([])
    expect(functionScopeNames(undefined)).toEqual([])
  })

  it('reads a body with no inputs, outputs or locals keys as having none', () => {
    expect(functionScopeNames({ workflow: { nodes: [] } })).toEqual([])
  })

  it('skips entries that carry no name', () => {
    const scope = {
      inputs: [{ name: 'x', type: 'string' }, 'not_an_object', null, { type: 'string' }],
      outputs: [],
      variables: [{ id: 'v1', name: 'tmp', value: 0, type: 'integer' }, 42, undefined],
      workflow: { nodes: [] },
    } as unknown as ScopeBody

    expect(kindsOf(scope)).toEqual([
      ['x', 'input'],
      ['tmp', 'local'],
    ])
  })
})

describe('functionScopeNames - profile aliases bound on the Blocks of the scope', () => {
  it('lists each alias a Block in the Function binds, after the locals', () => {
    const scope = body({
      inputs: [{ name: 'host', type: 'string' }],
      variables: [{ id: 'v1', name: 'tmp', value: 0, type: 'integer' }],
      nodes: [
        block('b1', 'Query users', { profileBindings: [{ profileId: 'p1', alias: 'db', bindings: {} }] }),
        block('b2', 'Call API', { profileBindings: [{ profileId: 'p2', alias: 'api', bindings: {} }] }),
      ],
    })

    expect(kindsOf(scope)).toEqual([
      ['host', 'input'],
      ['tmp', 'local'],
      ['db', 'profile'],
      ['api', 'profile'],
    ])
  })

  it('lists an alias two Blocks bind once', () => {
    const scope = body({
      nodes: [
        block('b1', 'First', { profileBindings: [{ profileId: 'p1', alias: 'db', bindings: {} }] }),
        block('b2', 'Second', { profileBindings: [{ profileId: 'p1', alias: 'db', bindings: {} }] }),
      ],
    })

    expect(kindsOf(scope)).toEqual([['db', 'profile']])
  })

  it('adds no name for a profile binding with no alias', () => {
    const scope = body({
      nodes: [block('b1', 'First', { profileBindings: [{ profileId: 'p1', alias: '', bindings: {} }, { profileId: 'p2' }] })],
    })

    expect(functionScopeNames(scope)).toEqual([])
  })

  it('leaves out the aliases bound inside a nested Function, which is its own scope', () => {
    const nested = body({
      nodes: [block('in1', 'Inner', { profileBindings: [{ profileId: 'p9', alias: 'inner_db', bindings: {} }] })],
    })
    const scope = body({ nodes: [functionBlock('fn-2', 'Helper', nested)] })

    expect(functionScopeNames(scope).map((entry) => entry.name)).not.toContain('inner_db')
  })
})

describe('functionScopeNames - the Blocks that write each name', () => {
  it('names the Block whose output binding writes a local', () => {
    const scope = body({
      variables: [{ id: 'v1', name: 'rows', value: null, type: 'array' }],
      nodes: [block('b1', 'Load rows', { outputBindings: { result: 'rows' } })],
    })

    expect(writersOf(scope, 'rows')).toEqual(['Load rows'])
  })

  it('names the Block whose output binding writes a Function output', () => {
    const scope = body({
      outputs: [{ name: 'total', type: 'integer' }],
      nodes: [block('b1', 'Count rows', { outputBindings: { count: 'total' } })],
    })

    expect(writersOf(scope, 'total')).toEqual(['Count rows'])
  })

  it('names every Block that writes one name, in canvas order', () => {
    const scope = body({
      variables: [{ id: 'v1', name: 'status', value: null, type: 'string' }],
      nodes: [
        block('b1', 'First check', { outputBindings: { message: 'status' } }),
        block('b2', 'Unrelated'),
        block('b3', 'Second check', { outputBindings: { message: 'status' } }),
      ],
    })

    expect(writersOf(scope, 'status')).toEqual(['First check', 'Second check'])
  })

  it('names a nested Function Block that writes a local through its own output binding', () => {
    const scope = body({
      variables: [{ id: 'v1', name: 'token', value: null, type: 'string' }],
      nodes: [functionBlock('fn-2', 'Get token', body({}), { token_out: 'token' })],
    })

    expect(writersOf(scope, 'token')).toEqual(['Get token'])
  })

  it('gives a name no Block writes an empty writer list', () => {
    const scope = body({
      inputs: [{ name: 'host', type: 'string' }],
      variables: [{ id: 'v1', name: 'unused', value: null, type: 'string' }],
      nodes: [block('b1', 'Log', { outputBindings: { message: '' } })],
    })

    expect(writersOf(scope, 'host')).toEqual([])
    expect(writersOf(scope, 'unused')).toEqual([])
  })

  it('adds no name for a binding to a name the scope does not declare', () => {
    const scope = body({
      variables: [{ id: 'v1', name: 'kept', value: null, type: 'string' }],
      nodes: [block('b1', 'Stray', { outputBindings: { message: 'ghost' } })],
    })

    expect(functionScopeNames(scope).map((entry) => entry.name)).toEqual(['kept'])
  })
})

describe('functionScopeNames - a body that is not well formed', () => {
  it('reads no Blocks from a flow whose nodes are not a list', () => {
    const body = { inputs: [{ name: 'a' }], workflow: { nodes: 'none' } } as unknown as ScopeBody
    expect(functionScopeNames(body).map((entry) => entry.name)).toEqual(['a'])
  })

  it('skips a node that is not an object and a node whose data is not an object', () => {
    const body = {
      outputs: [{ name: 'out' }],
      workflow: {
        nodes: [
          null,
          'text',
          { id: 'n1', data: null },
          { id: 'n2', data: { label: 'Writer', config: { outputBindings: { result: 'out' } } } },
        ],
      },
    } as unknown as ScopeBody
    expect(functionScopeNames(body).find((entry) => entry.name === 'out')?.writers).toEqual(['Writer'])
  })

  it('skips a profile binding that is not an object or has no alias', () => {
    const body = {
      workflow: {
        nodes: [{ id: 'n1', data: { config: { profileBindings: [null, 'db', { alias: '' }, { alias: 'pg' }] } } }],
      },
    } as unknown as ScopeBody
    expect(functionScopeNames(body).map((entry) => [entry.name, entry.kind])).toEqual([['pg', 'profile']])
  })
})
