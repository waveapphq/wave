/**
 * Unit tests for the profile container transforms module.
 *
 * Focus is on the lowercase WAVE type alignment and float coercion paths
 * that aren't otherwise exercised by integration tests.
 */

import { describe, it, expect } from 'vitest'
import {
  convertValueToType,
  environmentValuesToParameters,
  headersRowsToRowObjects,
  parametersToConfig,
} from '@/features/profiles/container/transforms'
import type { Environment } from '@/features/profiles/api/types'
import type { Parameter } from '@/features/profiles/components/profile-form-modal'

describe('convertValueToType', () => {
  it('coerces an integer string to a number on the integer branch', () => {
    expect(convertValueToType('42', 'integer')).toBe(42)
  })

  it('coerces a float string to a number on the float branch', () => {
    expect(convertValueToType('1.5', 'float')).toBe(1.5)
  })

  it('never truncates text on the integer branch: text the rule refuses goes as typed (REQ-3.1.3.14)', () => {
    expect(convertValueToType('1.9', 'integer')).toBe('1.9')
  })

  it('returns null for empty integer/float input, never 0', () => {
    expect(convertValueToType('', 'integer')).toBeNull()
    expect(convertValueToType('', 'float')).toBeNull()
  })

  it('sends a number in its wire form: a JS number when exact, else the digit text', () => {
    expect(convertValueToType('8080', 'integer')).toBe(8080)
    expect(convertValueToType('2.5', 'float')).toBe(2.5)
    expect(convertValueToType('12345678901234567890', 'integer')).toBe('12345678901234567890')
    expect(convertValueToType('2.50', 'float')).toBe('2.50')
    expect(convertValueToType('0.0000001', 'float')).toBe('0.0000001')
  })

  it('parses booleans correctly', () => {
    expect(convertValueToType('true', 'boolean')).toBe(true)
    expect(convertValueToType('false', 'boolean')).toBe(false)
  })

  it('parses array, map, and table JSON', () => {
    expect(convertValueToType('[1,2]', 'array')).toEqual([1, 2])
    expect(convertValueToType('{"k":"v"}', 'map')).toEqual({ k: 'v' })
    expect(convertValueToType('{"headers":["a"],"rows":[["1"]]}', 'table')).toEqual({
      headers: ['a'],
      rows: [['1']],
    })
  })

  it('passes through plain strings', () => {
    expect(convertValueToType('hello', 'string')).toBe('hello')
  })
})

describe('environmentValuesToParameters - detectType', () => {
  const envs: Environment[] = [
    {
      id: 'env-1',
      name: 'env-1',
      description: null,
      tags: [],
      usage: 0,
    },
  ]

  it("infers 'integer' for legacy whole-number values", () => {
    const params = environmentValuesToParameters({ 'env-1': { count: 42 } }, envs)
    const count = params.find((p) => p.name === 'count')!
    expect(count.type).toBe('integer')
  })

  it("infers 'float' for legacy decimal values", () => {
    const params = environmentValuesToParameters({ 'env-1': { ratio: 1.5 } }, envs)
    const ratio = params.find((p) => p.name === 'ratio')!
    expect(ratio.type).toBe('float')
  })

  it("infers 'boolean', 'array', 'map' from legacy values", () => {
    const params = environmentValuesToParameters(
      { 'env-1': { flag: true, list: [1, 2], cfg: { k: 'v' } } },
      envs,
    )
    expect(params.find((p) => p.name === 'flag')!.type).toBe('boolean')
    expect(params.find((p) => p.name === 'list')!.type).toBe('array')
    expect(params.find((p) => p.name === 'cfg')!.type).toBe('map')
  })
})

// An unprovided field (K8SPROF-6) is stored as null and carries no type of its own.
describe('environmentValuesToParameters - an unprovided field', () => {
  const envs: Environment[] = [
    { id: 'env-1', name: 'env-1', description: null, tags: [], usage: 0 },
    { id: 'env-2', name: 'env-2', description: null, tags: [], usage: 0 },
  ]

  it("takes the type the profile type declares and opens empty", () => {
    const params = environmentValuesToParameters(
      { 'env-1': { port: null }, 'env-2': { port: null } },
      envs,
      { port: 'integer' },
    )
    expect(params).toEqual([
      expect.objectContaining({ name: 'port', type: 'integer', values: { 'env-1': '', 'env-2': '' } }),
    ])
  })

  it('takes its type from an environment that holds a value', () => {
    const params = environmentValuesToParameters(
      { 'env-1': { port: null }, 'env-2': { port: 9473 } },
      envs,
    )
    expect(params).toEqual([
      expect.objectContaining({ name: 'port', type: 'integer', values: { 'env-1': '', 'env-2': '9473' } }),
    ])
  })

  it('skips an environment that lacks the field', () => {
    const params = environmentValuesToParameters(
      { 'env-1': { host: 'h' }, 'env-2': { host: 'h', port: 9473 } },
      envs,
    )
    expect(params.find((p) => p.name === 'port')).toMatchObject({
      type: 'integer',
      values: { 'env-1': '', 'env-2': '9473' },
    })
  })

  it('reads as a string row when nothing names its type', () => {
    const params = environmentValuesToParameters({ 'env-1': { port: null } }, envs)
    expect(params[0].type).toBe('string')
  })

  it('reads a raw whole number as the float type the profile type declares', () => {
    const params = environmentValuesToParameters({ 'env-1': { ratio: 2 } }, envs, { ratio: 'float' })
    expect(params[0]).toMatchObject({ type: 'float', values: { 'env-1': '2' } })
  })

  it('reads a raw number as the integer type the profile type declares', () => {
    const params = environmentValuesToParameters({ 'env-1': { port: 2.5 } }, envs, { port: 'integer' })
    expect(params[0]).toMatchObject({ type: 'integer', values: { 'env-1': '2.5' } })
  })

  it('reads digit text as the integer type the profile type declares, as written', () => {
    const params = environmentValuesToParameters({ 'env-1': { port: '09473' } }, envs, { port: 'integer' })
    expect(params[0]).toMatchObject({ type: 'integer', values: { 'env-1': '09473', 'env-2': '' } })
  })

  it('reads digit text as the float type the profile type declares, as written', () => {
    const params = environmentValuesToParameters({ 'env-1': { ratio: '2.50' } }, envs, { ratio: 'float' })
    expect(params[0]).toMatchObject({ type: 'float', values: { 'env-1': '2.50', 'env-2': '' } })
  })

  it('reads text that is no number of the declared type as a string row', () => {
    const params = environmentValuesToParameters({ 'env-1': { port: '1.9' } }, envs, { port: 'integer' })
    expect(params[0]).toMatchObject({ type: 'string', values: { 'env-1': '1.9', 'env-2': '' } })
  })

  it('reads a value that is neither a number nor text by its shape, whatever the declared type', () => {
    const params = environmentValuesToParameters({ 'env-1': { port: true } }, envs, { port: 'integer' })
    expect(params[0].type).toBe('boolean')
  })

  it('opens a raw number in plain digits', () => {
    const params = environmentValuesToParameters({ 'env-1': { ratio: 1e-7 } }, envs, { ratio: 'float' })
    expect(params[0].values).toEqual({ 'env-1': '0.0000001', 'env-2': '' })
  })

  it('never overrides the type a stored value carries', () => {
    const params = environmentValuesToParameters(
      { 'env-1': { port: 9473 } },
      envs,
      { port: 'string' },
    )
    expect(params[0].type).toBe('integer')
  })
})

// ============================================================================
// Table adapter: convert the profile's stored { headers, rows } table
// shape <-> the shared complex-body row-object model only at the editor
// boundary. The stored shape and runtime binding are unchanged.
// ============================================================================

describe('headersRowsToRowObjects', () => {
  it('maps { headers, rows } to header-keyed row objects, preserving cell types', () => {
    expect(
      headersRowsToRowObjects({
        headers: ['host', 'port', 'active'],
        rows: [
          ['db.local', 5432, true],
          ['db2', 5433, false],
        ],
      }),
    ).toEqual([
      { host: 'db.local', port: 5432, active: true },
      { host: 'db2', port: 5433, active: false },
    ])
  })

  it('returns an empty array for a table that has columns but no rows', () => {
    expect(headersRowsToRowObjects({ headers: ['a', 'b'], rows: [] })).toEqual([])
  })

  it('does not throw on malformed input and returns an empty array', () => {
    expect(headersRowsToRowObjects(null as never)).toEqual([])
    expect(headersRowsToRowObjects({} as never)).toEqual([])
    expect(headersRowsToRowObjects({ headers: ['a'], rows: 'nope' } as never)).toEqual([])
  })

  it('treats a non-array row as an empty-cell row (header keys present)', () => {
    const result = headersRowsToRowObjects({ headers: ['a', 'b'], rows: [42] } as never)
    expect(result).toHaveLength(1)
    expect(Object.keys(result[0])).toEqual(['a', 'b'])
  })
})

// ============================================================================
// parametersToConfig: custom integer / float keep their EXACT digit-string
// (a JS Number rounds past 2^53 / ~17 sig digits); the backend coerces to
// int / Decimal at execution. Mirrors the Variable Setter / Manager pipeline.
// ============================================================================

function makeParam(overrides: Partial<Parameter> = {}): Parameter {
  return { id: 'p1', name: 'p', type: 'string', secret: false, values: {}, ...overrides }
}

describe('parametersToConfig - exact number strings', () => {
  it('keeps a custom integer value as an exact digit-string (no rounding)', () => {
    const params = [
      makeParam({ name: 'big', type: 'integer', values: { 'env-1': '12345678901234567890' } }),
    ]
    expect(parametersToConfig(params, 'env-1', 'custom').big).toEqual({
      type: 'integer',
      secret: false,
      value: '12345678901234567890',
    })
  })

  it('keeps a custom float value as an exact digit-string (no rounding)', () => {
    const params = [
      makeParam({ name: 'ratio', type: 'float', values: { 'env-1': '3.14159265358979311600' } }),
    ]
    expect(parametersToConfig(params, 'env-1', 'custom').ratio).toEqual({
      type: 'float',
      secret: false,
      value: '3.14159265358979311600',
    })
  })

  it.each(['integer', 'float'] as const)(
    'stores an empty %s on a typed profile as null, never zero (K8SPROF-6)',
    (type) => {
      const params = [makeParam({ name: 'port', type, values: { 'env-1': '' } })]
      expect(parametersToConfig(params, 'env-1', 'database')).toEqual({ port: null })
    },
  )

  it('stores a typed profile number as a number', () => {
    const params = [makeParam({ name: 'port', type: 'integer', values: { 'env-1': '9473' } })]
    expect(parametersToConfig(params, 'env-1', 'database')).toEqual({ port: 9473 })
  })

  it('still JSON-parses a non-scalar custom value', () => {
    const params = [makeParam({ name: 'list', type: 'array', values: { 'env-1': '[1,2]' } })]
    expect(parametersToConfig(params, 'env-1', 'custom').list).toEqual({
      type: 'array',
      secret: false,
      value: [1, 2],
    })
  })
})

describe('profile element types (REQ-3.1.3.19)', () => {
  const envs: Environment[] = [
    { id: 'env-1', name: 'env-1', description: null, tags: [], usage: 0 },
    { id: 'env-2', name: 'env-2', description: null, tags: [], usage: 0 },
  ]

  it('reads each environment\'s element types off its typed value', () => {
    const [param] = environmentValuesToParameters(
      {
        'env-1': { opts: { type: 'map', secret: false, value: { n: '16' }, elementTypes: { n: 'integer' } } },
        'env-2': { opts: { type: 'map', secret: false, value: { n: 'x' }, elementTypes: 'bogus' } },
      },
      envs,
    )
    expect(param.elementTypes).toEqual({ 'env-1': { n: 'integer' } })
  })

  it('reads no element types off values that carry none', () => {
    const [param] = environmentValuesToParameters(
      { 'env-1': { opts: { type: 'map', secret: false, value: { n: '16' } } } },
      envs,
    )
    expect(param).not.toHaveProperty('elementTypes')
  })

  it('stores an array / map with element types in the typed wrapper, on every profile type', () => {
    const params = [
      makeParam({
        name: 'driver_options',
        type: 'map',
        values: { 'env-1': '{"timeout":"16","app":"2024"}' },
        elementTypes: { 'env-1': { timeout: 'integer', app: 'string' } },
      }),
    ]
    const expected = {
      type: 'map',
      secret: false,
      value: { timeout: '16', app: '2024' },
      elementTypes: { timeout: 'integer', app: 'string' },
    }
    expect(parametersToConfig(params, 'env-1', 'database').driver_options).toEqual(expected)
    expect(parametersToConfig(params, 'env-1', 'custom').driver_options).toEqual(expected)
  })

  it('stores the plain form where the environment or the type carries no element types', () => {
    const params = [
      makeParam({
        name: 'driver_options',
        type: 'map',
        values: { 'env-2': '{"a":"1"}' },
        elementTypes: { 'env-1': { a: 'integer' } },
      }),
      makeParam({ name: 'name', type: 'string', values: { 'env-2': 'x' }, elementTypes: { 'env-2': ['integer'] } }),
    ]
    expect(parametersToConfig(params, 'env-2', 'database')).toEqual({
      driver_options: { a: '1' },
      name: 'x',
    })
  })
})
