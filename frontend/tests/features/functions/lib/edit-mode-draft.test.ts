/**
 * buildEditModeDraft mirrors the BE snapshot (`_snapshot_source_definition`)
 * so a client-built edit-mode draft validates identically at publish time.
 * The locked `name` (and `tags`) MUST travel with the draft, else the BE
 * name-lock / tag-removal rules reject every bump.
 */

import { describe, it, expect } from 'vitest'

import {
  buildEditModeDraft,
  foldLocalDefinitionIntoDraft,
  reconcileBindingsToContract,
} from '@/features/functions/lib/edit-mode-draft'
import type { FunctionDefinition } from '@/features/functions/api/types'

const definition: FunctionDefinition = {
  id: 'lib-1',
  name: 'F1-Func',
  description: 'desc',
  tags: ['a', 'b'],
  inputs: [{ name: 'msg', type: 'string', required: true, default: '', description: '' }],
  outputs: [{ name: 'out', type: 'string', description: '' }],
  dependencies: { functions: [], plugins: ['log'] },
  workflow: { nodes: [{ id: 'n1' }], edges: [] },
  metadata: { author: 'x', created_at: '', updated_at: '' },
}

describe('buildEditModeDraft', () => {
  it('mirrors the BE snapshot shape, carrying the locked name and tags', () => {
    expect(buildEditModeDraft(definition)).toEqual({
      name: 'F1-Func',
      description: 'desc',
      tags: ['a', 'b'],
      inputs: definition.inputs,
      outputs: definition.outputs,
      dependencies: definition.dependencies,
      workflow: definition.workflow,
    })
  })

  it('omits id and metadata (not part of a publishable draft)', () => {
    const draft = buildEditModeDraft(definition) as unknown as Record<string, unknown>
    expect(draft).not.toHaveProperty('id')
    expect(draft).not.toHaveProperty('metadata')
  })
})

describe('foldLocalDefinitionIntoDraft', () => {
  it('overlays the localDefinition body onto the prior draft, preserving other fields', () => {
    const prev = {
      name: 'F1-Func',
      tags: ['t'],
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
    }
    const localDef = {
      workflow: { nodes: [{ id: 'A' }], edges: [] },
      inputs: [{ name: 'x' }],
      outputs: [{ name: 'y' }],
      dependencies: { functions: ['f'], plugins: [] },
    }
    expect(foldLocalDefinitionIntoDraft(prev, localDef)).toEqual({
      name: 'F1-Func',
      tags: ['t'],
      workflow: { nodes: [{ id: 'A' }], edges: [] },
      inputs: [{ name: 'x' }],
      outputs: [{ name: 'y' }],
      dependencies: { functions: ['f'], plugins: [] },
    })
  })

  it('falls back to the prior draft fields when the localDefinition omits them', () => {
    const prev = {
      name: 'F',
      workflow: { nodes: [{ id: 'P' }], edges: [] },
      inputs: [{ name: 'pi' }],
      outputs: [{ name: 'po' }],
      dependencies: { functions: ['pf'], plugins: [] },
    }
    expect(foldLocalDefinitionIntoDraft(prev, {})).toEqual(prev)
  })

  it('uses empty defaults when neither localDefinition nor prior draft supply a field', () => {
    expect(foldLocalDefinitionIntoDraft(undefined, {})).toEqual({
      workflow: { nodes: [], edges: [] },
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
    })
  })
})

type Rec = Record<string, unknown>

interface ContractInput {
  name: string
  type?: string
  enumValues?: readonly unknown[]
  default?: unknown
  required?: boolean
}

interface Contract {
  inputs: ContractInput[]
  outputs: Array<{ name: string }>
}

/** The publish and version-switch step: drop what the contract breaks, then write each new choice input. */
type Reconcile = (data: Rec, contract: Contract, previous?: Contract) => Rec

const reconcile = reconcileBindingsToContract as unknown as Reconcile

/** A Function Block's node data: its input values and flags, plus the output side of its config. */
function functionBlock(values: Rec, config: Rec = {}, flags: Rec = {}): Rec {
  return { label: 'Call region_fn', nodeType: 'function', expressionFields: [], ...flags, config: { values, ...config } }
}

function contractOf(inputs: ContractInput[], outputs: Contract['outputs'] = []): Contract {
  return { inputs, outputs }
}

function valuesOf(data: Rec): Rec {
  return (data.config as Rec).values as Rec
}

function configOf(data: Rec): Rec {
  return data.config as Rec
}

describe('reconcileBindingsToContract - names the contract no longer declares', () => {
  it('returns the same Block data when every value still fits the contract', () => {
    const data = functionBlock(
      { region: 'eu', count: 3 },
      { outputBindings: { token: 'tok' }, outputSecretFields: ['token'] },
    )
    const contract = contractOf(
      [
        { name: 'region', type: 'string' },
        { name: 'count', type: 'integer' },
      ],
      [{ name: 'token' }],
    )

    expect(reconcile(data, contract)).toBe(data)
  })

  it('drops the value of an input the contract no longer declares and keeps the rest', () => {
    const data = functionBlock({ region: 'eu', gone: 'x' })

    const next = reconcile(data, contractOf([{ name: 'region', type: 'string' }]))

    expect(valuesOf(next)).toEqual({ region: 'eu' })
  })

  it('drops the expression flags of an input the contract no longer declares', () => {
    const data = functionBlock({ region: 'zone_var', gone: { key: 'other_var' } }, {}, { expressionFields: ['region', 'gone.key'] })

    const next = reconcile(data, contractOf([{ name: 'region', type: 'string' }]))

    expect(valuesOf(next)).toEqual({ region: 'zone_var' })
    expect(next.expressionFields).toEqual(['region'])
  })

  it('drops the binding of an output the contract no longer declares, keeping the other config fields', () => {
    const data = functionBlock({ retries: 2 }, { outputBindings: { status: 'st', gone: 'g' } })

    const next = reconcile(data, contractOf([{ name: 'retries', type: 'integer' }], [{ name: 'status' }]))

    expect(configOf(next)).toEqual({ values: { retries: 2 }, outputBindings: { status: 'st' } })
  })

  it('returns a Block with no values and no config as it is', () => {
    const data: Rec = { label: 'Call region_fn', nodeType: 'function' }

    expect(reconcile(data, contractOf([{ name: 'region', type: 'string' }], [{ name: 'token' }]))).toBe(data)
  })

  it('leaves a new input unset, with no value filled in for it', () => {
    const data = functionBlock({ region: 'eu' })
    const contract = contractOf([
      { name: 'region', type: 'string' },
      { name: 'must', type: 'integer' },
    ])

    const next = reconcile(data, contract)

    expect(next).toBe(data)
    expect(valuesOf(next)).not.toHaveProperty('must')
  })
})

describe('reconcileBindingsToContract - a version switch drops stale secret output names (REQ-3.1.2.9)', () => {
  it('drops a secret output name the target version no longer declares', () => {
    const data = functionBlock({}, { outputSecretFields: ['token', 'old_token'] })

    const next = reconcile(data, contractOf([], [{ name: 'token' }, { name: 'status' }]))

    expect(configOf(next).outputSecretFields).toEqual(['token'])
  })

  it('drops it together with the stale output binding, keeping the other config fields', () => {
    const data = functionBlock(
      { region: 'eu', retries: 2 },
      {
        outputBindings: { token: 'tok', old_token: 'old' },
        outputSecretFields: ['token', 'old_token'],
      },
    )

    const next = reconcile(
      data,
      contractOf(
        [
          { name: 'region', type: 'string' },
          { name: 'retries', type: 'integer' },
        ],
        [{ name: 'token' }],
      ),
    )

    expect(configOf(next)).toEqual({
      values: { region: 'eu', retries: 2 },
      outputBindings: { token: 'tok' },
      outputSecretFields: ['token'],
    })
  })

  it('keeps an empty secret list when every saved secret output is gone', () => {
    const data = functionBlock({}, { outputSecretFields: ['old_token'] })

    const next = reconcile(data, contractOf([], [{ name: 'status' }]))

    expect(configOf(next).outputSecretFields).toEqual([])
  })

  it('leaves a never-saved secret list unset, so declared secret outputs still open ticked', () => {
    const data = functionBlock({}, { outputBindings: { token: 'tok', gone: 'g' } })

    const next = reconcile(data, contractOf([], [{ name: 'token' }]))

    expect(configOf(next)).toEqual({ values: {}, outputBindings: { token: 'tok' } })
    expect(configOf(next)).not.toHaveProperty('outputSecretFields')
  })
})

describe('reconcileBindingsToContract - a value that no longer fits its input is dropped (FNCFG-9)', () => {
  it('drops a literal that no longer fits the input type and leaves the field empty', () => {
    const next = reconcile(functionBlock({ count: 'abc', other: 'kept' }), contractOf([
      { name: 'count', type: 'integer' },
      { name: 'other', type: 'string' },
    ]))

    expect(valuesOf(next)).toEqual({ other: 'kept' })
  })

  it('drops a pick the allowed values no longer hold and leaves the field empty, never on the default', () => {
    const level = { name: 'level', type: 'string', required: true, enumValues: ['low', 'mid'], default: 'low' }

    const next = reconcile(functionBlock({ level: 'high', other: 'kept' }), contractOf([level, { name: 'other', type: 'string' }]))

    expect(valuesOf(next)).toEqual({ other: 'kept' })
  })

  it('keeps an expression as written, whatever the input type', () => {
    const data = functionBlock({ count: 'count_var + 1' }, {}, { expressionFields: ['count'] })

    expect(reconcile(data, contractOf([{ name: 'count', type: 'boolean' }]))).toBe(data)
  })

  it('drops only the broken value: the other values, flags and the config stay as they were', () => {
    const config = { outputBindings: { status: 'st' }, outputSecretFields: [] }
    const data = functionBlock({ region: 'eu', count: 3, next_id: 'last_id + 1' }, config, { expressionFields: ['next_id'] })
    const contract = contractOf(
      [
        { name: 'region', type: 'integer' },
        { name: 'count', type: 'float' },
        { name: 'next_id', type: 'string' },
      ],
      [{ name: 'status' }],
    )

    const next = reconcile(data, contract)

    expect(configOf(next)).toEqual({ values: { count: 3, next_id: 'last_id + 1' }, ...config })
    expect(next.expressionFields).toEqual(['next_id'])
    expect(next.label).toBe('Call region_fn')
  })
})

const KEPT_IN: ContractInput = { name: 'kept_in', type: 'string', required: false }
const TIER: ContractInput = { name: 'tier', type: 'string', required: true, enumValues: ['gold', 'silver'], default: 'silver' }
const VERBOSE: ContractInput = { name: 'verbose', type: 'boolean', required: false, default: false }
const STRICT: ContractInput = { name: 'strict', type: 'boolean', required: true, default: true }
const NOTE: ContractInput = { name: 'note', type: 'string', required: false, default: 'hello' }

describe('reconcileBindingsToContract - a new choice-list or true / false input starts on its default (FNCFG-9, REQ-3.1.2.10)', () => {
  it('writes the default of each choice-list and true / false input the target contract adds, Required included', () => {
    const data = functionBlock({ kept_in: 'kept_var' }, {}, { expressionFields: ['kept_in'] })

    const next = reconcile(data, contractOf([KEPT_IN, TIER, VERBOSE, STRICT, NOTE]), contractOf([KEPT_IN]))

    expect(valuesOf(next)).toEqual({ kept_in: 'kept_var', tier: 'silver', verbose: false, strict: true })
    expect(next.expressionFields).toEqual(['kept_in'])
  })

  it('keeps the value of an input renamed in the draft and writes only the inputs that are new', () => {
    const data = functionBlock({ tier: 'gold' })

    const next = reconcile(data, contractOf([TIER, VERBOSE]), contractOf([{ ...TIER, name: 'level' }]))

    expect(valuesOf(next)).toEqual({ tier: 'gold', verbose: false })
  })

  it('never puts the default in place of a pick the target contract no longer allows', () => {
    const narrowed = { ...TIER, enumValues: ['silver', 'bronze'] }
    const data = functionBlock({ tier: 'gold' })

    const next = reconcile(data, contractOf([narrowed, VERBOSE]), contractOf([TIER]))

    expect(valuesOf(next)).toEqual({ verbose: false })
  })

  it('writes nothing when no previous contract is known', () => {
    const data = functionBlock({ kept_in: 'kept_var' })

    expect(reconcile(data, contractOf([KEPT_IN, TIER, VERBOSE]))).toBe(data)
  })
})
