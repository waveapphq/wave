/**
 * function-block-fields - the Function adapter: a Function's declared inputs and outputs become the
 * Function Block's field list in the plugin field shape (REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.2.9,
 * REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.14, REQ-3.1.3.19).
 */

import { describe, it, expect } from 'vitest'
import type { FunctionInput, FunctionOutput } from '@/features/functions/api/types'
import {
  functionBlockDefinition,
  functionBlockInputs,
  functionBlockOutputs,
} from '@/features/functions/lib/function-block-fields'

type InputSpec = Partial<FunctionInput> & Pick<FunctionInput, 'name' | 'type'>
type OutputSpec = Partial<FunctionOutput> & Pick<FunctionOutput, 'name' | 'type'>

function input(spec: InputSpec): FunctionInput {
  return { required: false, default: null, description: '', ...spec } as FunctionInput
}

function outputOf(spec: OutputSpec): FunctionOutput {
  return { description: '', ...spec } as FunctionOutput
}

function inputsOf(...inputs: FunctionInput[]) {
  return functionBlockInputs({ inputs, outputs: [] })
}

function onlyInput(spec: InputSpec) {
  const [field] = inputsOf(input(spec))
  return field
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

// Python literal texts; none may reach a field.
const PYTHON_TEXTS = ["'low'", "'high'", "'hello'", 'True', 'False', 'None', "'k'"]

describe('functionBlockInputs - Required inputs', () => {
  it('gives a Required input no default, even when the definition declares one', () => {
    const field = onlyInput({ name: 'host', type: 'string', required: true, default: 'db.local' })

    expect(field.required).toBe(true)
    expect(field.defaultValue).toBeUndefined()
  })

  it('gives a Required list input no default either', () => {
    const field = onlyInput({ name: 'ids', type: 'array', required: true, default: [1, 2] })

    expect(field.defaultValue).toBeUndefined()
  })

  it('reads an input with no required flag as optional', () => {
    const field = functionBlockInputs({ inputs: [{ name: 'x', type: 'string' } as FunctionInput] })[0]

    expect(field.required).toBe(false)
  })
})

describe('functionBlockInputs - optional inputs keep their default as written', () => {
  it('keeps a text default', () => {
    expect(onlyInput({ name: 'greeting', type: 'string', default: 'hello' }).defaultValue).toBe('hello')
  })

  it('keeps a text default with its spaces, never trimmed', () => {
    expect(onlyInput({ name: 'pad', type: 'string', default: '  padded  ' }).defaultValue).toBe('  padded  ')
  })

  it('keeps an empty text default', () => {
    expect(onlyInput({ name: 'suffix', type: 'string', default: '' }).defaultValue).toBe('')
  })

  it('keeps a false default', () => {
    expect(onlyInput({ name: 'dry_run', type: 'boolean', default: false }).defaultValue).toBe(false)
  })

  it('keeps a zero default', () => {
    expect(onlyInput({ name: 'retries', type: 'integer', default: 0 }).defaultValue).toBe(0)
  })

  it('keeps a whole-number float default as the number it is', () => {
    expect(onlyInput({ name: 'ratio', type: 'float', default: 2 }).defaultValue).toBe(2)
  })

  it('keeps a list default with each item typed', () => {
    expect(onlyInput({ name: 'ids', type: 'array', default: [1, 'two', 3.5, true] }).defaultValue).toEqual([
      1,
      'two',
      3.5,
      true,
    ])
  })

  it('keeps a map default with each value typed', () => {
    expect(onlyInput({ name: 'opts', type: 'map', default: { k: 1, on: false } }).defaultValue).toEqual({
      k: 1,
      on: false,
    })
  })

  it('gives an optional input whose default is null no default', () => {
    expect(onlyInput({ name: 'note', type: 'string', default: null }).defaultValue).toBeUndefined()
  })

  it('passes the description through', () => {
    expect(onlyInput({ name: 'host', type: 'string', description: 'Where to connect' }).description).toBe(
      'Where to connect',
    )
  })
})

describe('functionBlockInputs - enum inputs (REQ-3.1.2.11)', () => {
  it('offers integer allowed values as numbers', () => {
    const field = onlyInput({ name: 'level', type: 'integer', required: true, enumValues: [1, 2], default: 1 })

    expect(field.type).toBe('integer')
    expect(field.enumValues).toEqual([1, 2])
  })

  it('offers float allowed values as numbers', () => {
    const field = onlyInput({ name: 'scale', type: 'float', required: true, enumValues: [2.5, 5], default: 2.5 })

    expect(field.type).toBe('float')
    expect(field.enumValues).toEqual([2.5, 5])
  })

  it('offers text allowed values as the texts themselves, never quoted', () => {
    const field = onlyInput({
      name: 'priority',
      type: 'string',
      required: true,
      enumValues: ['low', 'high'],
      default: 'low',
    })

    expect(field.type).toBe('string')
    expect(field.enumValues).toEqual(['low', 'high'])
  })

  it('offers 1, 2.5 and low each with its own type', () => {
    const fields = inputsOf(
      input({ name: 'a', type: 'integer', required: true, enumValues: [1], default: 1 }),
      input({ name: 'b', type: 'float', required: true, enumValues: [2.5], default: 2.5 }),
      input({ name: 'c', type: 'string', required: true, enumValues: ['low'], default: 'low' }),
    )

    expect(fields.map((field) => field.enumValues)).toEqual([[1], [2.5], ['low']])
    expect(fields.map((field) => typeof field.enumValues?.[0])).toEqual(['number', 'number', 'string'])
  })

  it('gives a Required enum input no default on the field', () => {
    const field = onlyInput({ name: 'priority', type: 'string', required: true, enumValues: ['low'], default: 'low' })

    expect(field.defaultValue).toBeUndefined()
  })
})

describe('functionBlockInputs - secret inputs (REQ-3.1.2.9, REQ-3.1.3.18)', () => {
  it('marks a secret input as a secret field', () => {
    expect(onlyInput({ name: 'token', type: 'string', secret: true }).secret).toBe(true)
  })

  it('gives a secret input no default, even when the definition declares one', () => {
    const field = onlyInput({ name: 'token', type: 'string', secret: true, default: 'hunter2' })

    expect(field.defaultValue).toBeUndefined()
  })

  it('leaves a plain input unmarked', () => {
    expect(onlyInput({ name: 'host', type: 'string' }).secret ?? false).toBe(false)
  })
})

describe('functionBlockInputs - a whole null (REQ-3.1.3.20, REQ-3.1.3.21)', () => {
  it.each(['string', 'integer', 'float', 'array', 'map', 'table'] as const)(
    'lets an optional %s input with no default take a whole null',
    (type) => {
      expect(onlyInput({ name: 'note', type, default: null }).acceptsNull).toBe(true)
    },
  )

  it('lets an optional input that declares no default at all take a whole null', () => {
    const field = functionBlockInputs({ inputs: [{ name: 'note', type: 'string' } as FunctionInput] })[0]

    expect(field.acceptsNull).toBe(true)
  })

  it('refuses a whole null on a Required input, with or without a declared default', () => {
    const fields = inputsOf(
      input({ name: 'host', type: 'string', required: true }),
      input({ name: 'port', type: 'integer', required: true, default: 22 }),
    )

    expect(fields.map((field) => field.acceptsNull)).toEqual([false, false])
  })

  it.each([
    ['a text', 'string', 'hello'],
    ['an empty text', 'string', ''],
    ['a zero', 'integer', 0],
    ['a false', 'boolean', false],
    ['an empty list', 'array', []],
  ] as const)('refuses a whole null on an optional input with %s default', (_kind, type, value) => {
    expect(onlyInput({ name: 'opt', type, default: value }).acceptsNull).toBe(false)
  })

  it('refuses a whole null on a secret input', () => {
    const fields = inputsOf(
      input({ name: 'token', type: 'string', secret: true }),
      input({ name: 'key', type: 'string', secret: true, default: 'hunter2' }),
    )

    expect(fields.map((field) => field.acceptsNull)).toEqual([false, false])
  })

  it('refuses a whole null on an optional enum input, which always declares its default', () => {
    const field = onlyInput({ name: 'level', type: 'integer', enumValues: [1, 2], default: 1 })

    expect(field.acceptsNull).toBe(false)
  })
})

describe('functionBlockInputs - element types (REQ-3.1.3.19)', () => {
  it('marks list and map inputs as typed, so each item keeps its declared type', () => {
    const fields = inputsOf(input({ name: 'ids', type: 'array' }), input({ name: 'opts', type: 'map' }))

    expect(fields.map((field) => field.typedValues)).toEqual([true, true])
  })

  it('leaves text, number, true / false and table inputs untyped', () => {
    const fields = inputsOf(
      input({ name: 's', type: 'string' }),
      input({ name: 'i', type: 'integer' }),
      input({ name: 'f', type: 'float' }),
      input({ name: 'b', type: 'boolean' }),
      input({ name: 't', type: 'table' }),
    )

    expect(fields.map((field) => field.typedValues)).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})

describe('functionBlockInputs - the field list as a whole', () => {
  it('keeps the declared order', () => {
    const fields = inputsOf(
      input({ name: 'zeta', type: 'string' }),
      input({ name: 'alpha', type: 'integer' }),
      input({ name: 'mid', type: 'boolean', default: true }),
    )

    expect(fields.map((field) => [field.name, field.type])).toEqual([
      ['zeta', 'string'],
      ['alpha', 'integer'],
      ['mid', 'boolean'],
    ])
  })

  it('holds no Python literal text anywhere', () => {
    const fields = inputsOf(
      input({ name: 'priority', type: 'string', required: true, enumValues: ['low', 'high'], default: 'low' }),
      input({ name: 'greeting', type: 'string', default: 'hello' }),
      input({ name: 'flag', type: 'boolean', default: true }),
      input({ name: 'off', type: 'boolean', default: false }),
      input({ name: 'opts', type: 'map', default: { k: 1 } }),
      input({ name: 'note', type: 'string', default: null }),
    )

    const text = JSON.stringify(fields)
    for (const python of PYTHON_TEXTS) expect(text, python).not.toContain(python)
  })

  it('returns an empty list for a definition with no inputs', () => {
    expect(functionBlockInputs({ outputs: [] })).toEqual([])
  })

  it('leaves the definition as it was', () => {
    const definition = {
      inputs: [
        input({ name: 'host', type: 'string', required: true, default: 'db.local' }),
        input({ name: 'ids', type: 'array', default: [1, 2] }),
        input({ name: 'priority', type: 'integer', required: true, enumValues: [1, 2], default: 1 }),
        input({ name: 'token', type: 'string', secret: true }),
      ],
      outputs: [outputOf({ name: 'total', type: 'integer', secret: true })],
    }
    const before = structuredClone(definition)
    deepFreeze(definition)

    functionBlockInputs(definition)
    functionBlockOutputs(definition)

    expect(definition).toEqual(before)
  })

  it('never hands back the definition list itself', () => {
    const inputs = [input({ name: 'ids', type: 'array', default: [1, 2] })]
    const fields = functionBlockInputs({ inputs })

    expect(fields).not.toBe(inputs)
    expect(fields[0]).not.toBe(inputs[0])
  })
})

describe('functionBlockInputs / functionBlockOutputs - malformed declaration entries', () => {
  const MALFORMED = [null, 'host', 42, { type: 'string', required: false }] as unknown[]

  it('skips a null entry, a text, a number and an entry without a name among the inputs', () => {
    const fields = functionBlockInputs({
      inputs: [...MALFORMED, input({ name: 'port', type: 'integer' })] as FunctionInput[],
    })

    expect(fields.map((field) => field.name)).toEqual(['port'])
  })

  it('skips the same malformed entries among the outputs', () => {
    const fields = functionBlockOutputs({
      outputs: [...MALFORMED, outputOf({ name: 'total', type: 'integer' })] as FunctionOutput[],
    })

    expect(fields.map((field) => field.name)).toEqual(['total'])
  })

  it('returns an empty list when every entry is malformed', () => {
    expect(functionBlockInputs({ inputs: MALFORMED as FunctionInput[] })).toEqual([])
    expect(functionBlockOutputs({ outputs: MALFORMED as FunctionOutput[] })).toEqual([])
  })
})

describe('functionBlockOutputs', () => {
  it('maps each output to the plugin output shape: name, type, description', () => {
    const [field] = functionBlockOutputs({ outputs: [outputOf({ name: 'total', type: 'integer', description: 'Sum' })] })

    expect(field).toMatchObject({ name: 'total', type: 'integer', description: 'Sum' })
    expect(field.secret ?? false).toBe(false)
  })

  it('carries the secret mark that seeds the Secret box (REQ-3.1.2.9)', () => {
    const [field] = functionBlockOutputs({ outputs: [outputOf({ name: 'token', type: 'string', secret: true })] })

    expect(field.secret).toBe(true)
  })

  it('leaves the Function-flow side of an output out: no default, no expression or template kind', () => {
    const [field] = functionBlockOutputs({
      outputs: [
        { name: 'greeting', type: 'string', description: '', isExpression: true, default: "'hi'" } as FunctionOutput,
      ],
    })

    expect(field).not.toHaveProperty('default')
    expect(field).not.toHaveProperty('defaultValue')
    expect(field).not.toHaveProperty('isExpression')
    expect(field).not.toHaveProperty('isTemplate')
  })

  it('keeps the declared order', () => {
    const fields = functionBlockOutputs({
      outputs: [outputOf({ name: 'b', type: 'string' }), outputOf({ name: 'a', type: 'map' })],
    })

    expect(fields.map((field) => [field.name, field.type])).toEqual([
      ['b', 'string'],
      ['a', 'map'],
    ])
  })

  it('returns an empty list for a definition with no outputs', () => {
    expect(functionBlockOutputs({ inputs: [] })).toEqual([])
  })
})

describe('functionBlockDefinition - which definition a Function Block reads', () => {
  const LOCAL_INPUTS = [input({ name: 'local_in', type: 'string' })]
  const DRAFT_INPUTS = [input({ name: 'draft_in', type: 'string' })]
  const PINNED_INPUTS = [input({ name: 'pinned_in', type: 'string' })]
  const PINNED_OUTPUTS = [outputOf({ name: 'pinned_out', type: 'string' })]

  it('reads a Local Function Block from its own definition', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { inputs: LOCAL_INPUTS, outputs: [], workflow: { nodes: [], edges: [] } },
    })

    expect(definition?.inputs).toEqual(LOCAL_INPUTS)
    expect(definition?.outputs).toEqual([])
  })

  it('reads a Shared Function Block in edit mode from its draft, not its pinned stamps', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-1',
      functionVersion: '1.0.0',
      editMode: true,
      draft: { inputs: DRAFT_INPUTS, outputs: [], workflow: { nodes: [], edges: [] } },
      resolvedInputs: PINNED_INPUTS,
      resolvedOutputs: PINNED_OUTPUTS,
    })

    expect(definition?.inputs).toEqual(DRAFT_INPUTS)
  })

  it('reads a pinned Shared Function Block from the contract stamps of the version it pins', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-1',
      functionVersion: '1.0.0',
      resolvedInputs: PINNED_INPUTS,
      resolvedOutputs: PINNED_OUTPUTS,
    })

    expect(definition?.inputs).toEqual(PINNED_INPUTS)
    expect(definition?.outputs).toEqual(PINNED_OUTPUTS)
  })

  it('keeps reading the pinned stamps when a draft is left over but edit mode is off', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-1',
      functionVersion: '1.0.0',
      editMode: false,
      draft: { inputs: DRAFT_INPUTS, outputs: [], workflow: { nodes: [], edges: [] } },
      resolvedInputs: PINNED_INPUTS,
      resolvedOutputs: PINNED_OUTPUTS,
    })

    expect(definition?.inputs).toEqual(PINNED_INPUTS)
  })

  it('reads a stamp with inputs only as having no outputs', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-1',
      functionVersion: '1.0.0',
      resolvedInputs: PINNED_INPUTS,
    })

    expect(definition?.inputs).toEqual(PINNED_INPUTS)
    expect(definition?.outputs ?? []).toEqual([])
  })

  it('has no definition for a pinned Shared Function Block whose contract is not read yet', () => {
    expect(
      functionBlockDefinition({
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'fn-1',
        functionVersion: '2.0.0',
      }),
    ).toBeNull()
  })

  it('has no definition for a Local Function Block without its body', () => {
    expect(functionBlockDefinition({ nodeType: 'function', functionLifecycle: 'local' })).toBeNull()
  })

  it('has no definition for a plugin or control Block', () => {
    expect(functionBlockDefinition({ nodeType: 'plugin', elementType: 'log' })).toBeNull()
    expect(functionBlockDefinition({ nodeType: 'control', elementType: 'delay' })).toBeNull()
  })

  it('feeds the adapter: a pinned Shared Block gets its fields from the pinned contract', () => {
    const definition = functionBlockDefinition({
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-1',
      functionVersion: '1.0.0',
      resolvedInputs: [input({ name: 'level', type: 'integer', required: true, enumValues: [1, 2], default: 1 })],
      resolvedOutputs: PINNED_OUTPUTS,
    })

    expect(definition).not.toBeNull()
    const fields = functionBlockInputs(definition!)
    expect(fields.map((field) => [field.name, field.enumValues, field.defaultValue])).toEqual([
      ['level', [1, 2], undefined],
    ])
    expect(functionBlockOutputs(definition!).map((field) => field.name)).toEqual(['pinned_out'])
  })
})
