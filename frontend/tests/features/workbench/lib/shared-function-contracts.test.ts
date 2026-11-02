/**
 * shared-function-contracts - the contract a Shared (library) Function instance carries at any
 * depth of the tree: the inputs and outputs of the version it pins (REQ-3.1.2.4).
 */

import { describe, it, expect } from 'vitest'
import type { VersionDescriptor } from '@/features/functions/api/types'
import {
  sharedFunctionIds,
  stampSharedFunctionContracts,
  unresolvedSharedPins,
  type VersionsByFunction,
} from '@/features/workbench/lib/shared-function-contracts'

interface TestNode {
  id: string
  data: Record<string, unknown>
}

const WHO = [{ name: 'who', type: 'string', required: true }]
const OUT = [{ name: 'token', type: 'string' }]

function shared(id: string, functionId: string, functionVersion = '1.0.0'): TestNode {
  return { id, data: { nodeType: 'function', functionLifecycle: 'shared', functionId, functionVersion } }
}

function local(id: string, nodes: TestNode[]): TestNode {
  return {
    id,
    data: {
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { inputs: [], outputs: [], workflow: { nodes, edges: [] } },
    },
  }
}

function version(v: string, inputs?: unknown[], outputs?: unknown[]): VersionDescriptor {
  return { version: v, inputs, outputs } as unknown as VersionDescriptor
}

function versionsOf(functionId: string, ...descriptors: VersionDescriptor[]): VersionsByFunction {
  return new Map([[functionId, new Map(descriptors.map((d) => [d.version, d]))]])
}

const bodyOf = (node: TestNode): TestNode[] =>
  (node.data.localDefinition as { workflow: { nodes: TestNode[] } }).workflow.nodes

describe('sharedFunctionIds', () => {
  it('names each library Function a pinned Shared instance refers to, at any depth, once', () => {
    const nodes = [
      shared('a', 'lib-1'),
      local('host', [shared('b', 'lib-2'), local('deep', [shared('c', 'lib-1')])]),
    ]

    expect(sharedFunctionIds(nodes)).toEqual(['lib-1', 'lib-2'])
  })

  it('skips a Local Function, a plugin and a Shared instance that pins no version', () => {
    const nodes = [
      { id: 'p', data: { elementType: 'log' } },
      local('host', []),
      { id: 'no-version', data: { functionLifecycle: 'shared', functionId: 'lib-1' } },
      { id: 'no-id', data: { functionLifecycle: 'shared', functionVersion: '1.0.0' } },
    ]

    expect(sharedFunctionIds(nodes)).toEqual([])
  })
})

describe('stampSharedFunctionContracts', () => {
  it('stamps the pinned version contract on a top-level instance', () => {
    const nodes = [shared('a', 'lib-1')]

    const stamped = stampSharedFunctionContracts(nodes, versionsOf('lib-1', version('1.0.0', WHO, OUT)))

    expect(stamped[0].data.resolvedInputs).toEqual(WHO)
    expect(stamped[0].data.resolvedOutputs).toEqual(OUT)
  })

  it('stamps an instance inside a Local Function body and keeps the body around it', () => {
    const logNode = { id: 'log', data: { elementType: 'log' } }
    const nodes = [local('host', [logNode, shared('inner', 'lib-1')])]

    const stamped = stampSharedFunctionContracts(nodes, versionsOf('lib-1', version('1.0.0', WHO, [])))

    const body = bodyOf(stamped[0])
    expect(body[0]).toBe(logNode)
    expect(body[1].data.resolvedInputs).toEqual(WHO)
    expect(body[1].data.resolvedOutputs).toEqual([])
  })

  it('marks an instance pinned to a version the library no longer has', () => {
    const nodes = [shared('gone', 'lib-1', '9.9.9')]

    const stamped = stampSharedFunctionContracts(nodes, versionsOf('lib-1', version('1.0.0', WHO)))

    expect(stamped[0].data.missingVersion).toBe(true)
    expect(stamped[0].data.resolvedInputs).toBeUndefined()
  })

  it('returns the same tree when nothing changes', () => {
    const marked = { ...shared('gone', 'lib-1', '9.9.9'), data: { ...shared('gone', 'lib-1', '9.9.9').data, missingVersion: true } }
    const nodes = [
      shared('unread', 'lib-other'),
      shared('no-contract', 'lib-1'),
      marked,
      local('host', [{ id: 'log', data: { elementType: 'log' } }]),
      { id: 'note', data: {} },
    ]

    const stamped = stampSharedFunctionContracts(nodes, versionsOf('lib-1', version('1.0.0')))

    expect(stamped).toBe(nodes)
  })

  it('leaves an instance that already carries the read contract as it is', () => {
    const descriptor = version('1.0.0', WHO, OUT)
    const nodes = [{ id: 'a', data: { ...shared('a', 'lib-1').data, resolvedInputs: WHO, resolvedOutputs: OUT } }]

    expect(stampSharedFunctionContracts(nodes, versionsOf('lib-1', descriptor))).toBe(nodes)
  })
})

describe('stampSharedFunctionContracts - a second stamp', () => {
  it('changes nothing when the version lists inputs but no outputs', () => {
    const versions = versionsOf('lib-1', version('1.0.0', WHO))
    const once = stampSharedFunctionContracts([shared('a', 'lib-1')], versions)

    expect(stampSharedFunctionContracts(once, versions)).toBe(once)
  })
})

describe('unresolvedSharedPins', () => {
  it('names each pinned instance with no contract at any depth, once per Function and version', () => {
    const stamped = { id: 'done', data: { ...shared('done', 'lib-3').data, resolvedInputs: WHO } }
    const outputsOnly = { id: 'out', data: { ...shared('out', 'lib-4').data, resolvedOutputs: OUT } }
    const missing = { id: 'gone', data: { ...shared('gone', 'lib-5').data, missingVersion: true } }
    const nodes = [
      shared('a', 'lib-1'),
      shared('a2', 'lib-1'),
      shared('a3', 'lib-1', '2.0.0'),
      local('host', [shared('b', 'lib-2'), stamped, outputsOnly, missing]),
      { id: 'p', data: { elementType: 'log' } },
    ]

    expect(unresolvedSharedPins(nodes)).toEqual([
      { functionId: 'lib-1', functionVersion: '1.0.0' },
      { functionId: 'lib-1', functionVersion: '2.0.0' },
      { functionId: 'lib-2', functionVersion: '1.0.0' },
    ])
  })
})


// A Shared Function Block dropped from the library or added by Quick Add holds no values until its contract lands.
describe('stampSharedFunctionContracts - choice-list and true / false inputs start on their default (FIELD-8, REQ-3.1.2.10)', () => {
  const PINNED = [
    { name: 'level', type: 'string', required: true, default: 'low', enumValues: ['low', 'high'], description: '' },
    { name: 'retries', type: 'integer', required: true, default: 3, enumValues: [1, 3, 5], description: '' },
    { name: 'verbose', type: 'boolean', required: false, default: false, description: '' },
    { name: 'strict', type: 'boolean', required: true, default: true, description: '' },
    { name: 'region', type: 'string', required: false, default: 'eu', description: '' },
    { name: 'count', type: 'integer', required: true, default: null, description: '' },
    { name: 'token', type: 'string', required: false, secret: true, default: null, description: '' },
  ]
  const CHOICE_DEFAULTS = { level: 'low', retries: 3, verbose: false, strict: true }
  const VERSIONS = versionsOf('lib-1', version('1.0.0', PINNED, OUT))

  const configOf = (node: TestNode) => node.data.config as { values?: Record<string, unknown> } | undefined
  const valuesOf = (node: TestNode) => configOf(node)?.values

  it('writes the default of each choice-list and true / false input, Required included, on a new Block', () => {
    const stamped = stampSharedFunctionContracts([shared('a', 'lib-1')], VERSIONS)

    expect(valuesOf(stamped[0])).toEqual(CHOICE_DEFAULTS)
    expect(stamped[0].data.resolvedInputs).toEqual(PINNED)
  })

  it('leaves every free-entry input not set: a plain default, a Required input and a secret input', () => {
    const values = valuesOf(stampSharedFunctionContracts([shared('a', 'lib-1')], VERSIONS)[0]) ?? {}

    expect(values).not.toHaveProperty('region')
    expect(values).not.toHaveProperty('count')
    expect(values).not.toHaveProperty('token')
  })

  it('keeps a value the Block already holds and writes only the missing defaults', () => {
    const held = { id: 'a', data: { ...shared('a', 'lib-1').data, config: { values: { level: 'high', region: 'us' } } } }

    const stamped = stampSharedFunctionContracts([held], VERSIONS)

    expect(valuesOf(stamped[0])).toEqual({ ...CHOICE_DEFAULTS, level: 'high', region: 'us' })
  })

  it('writes only the choice inputs a re-stamp adds, never one the earlier contract already had', () => {
    const earlier = PINNED.filter((input) => input.name !== 'verbose')
    const restamped = {
      id: 'a',
      data: { ...shared('a', 'lib-1').data, resolvedInputs: earlier, config: { values: { level: 'high' } } },
    }

    const stamped = stampSharedFunctionContracts([restamped], VERSIONS)

    expect(valuesOf(stamped[0])).toEqual({ level: 'high', verbose: false })
    expect(stamped[0].data.resolvedInputs).toEqual(PINNED)
  })

  it('keeps the rest of the Block config as it is', () => {
    const bound = { id: 'a', data: { ...shared('a', 'lib-1').data, config: { outputBindings: { token: 'auth' } } } }

    const stamped = stampSharedFunctionContracts([bound], VERSIONS)

    expect(configOf(stamped[0])).toEqual({ outputBindings: { token: 'auth' }, values: CHOICE_DEFAULTS })
  })

  it('writes the defaults on a new Block inside a Local Function body', () => {
    const stamped = stampSharedFunctionContracts([local('host', [shared('inner', 'lib-1')])], VERSIONS)

    expect(valuesOf(bodyOf(stamped[0])[0])).toEqual(CHOICE_DEFAULTS)
  })

  it('writes no values for a version whose inputs are all free entry', () => {
    const stamped = stampSharedFunctionContracts([shared('a', 'lib-1')], versionsOf('lib-1', version('1.0.0', WHO, OUT)))

    expect(valuesOf(stamped[0])).toBeUndefined()
  })

  it('changes nothing on a second stamp of the same version', () => {
    const once = stampSharedFunctionContracts([shared('a', 'lib-1')], VERSIONS)

    expect(stampSharedFunctionContracts(once, VERSIONS)).toBe(once)
  })
})
