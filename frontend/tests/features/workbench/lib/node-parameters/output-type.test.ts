/**
 * Tests for resolveOutputType / resolveOutputTypes (K8SREAD-6).
 *
 * An output whose declared type follows other fields carries a `typeWhen` rule
 * list. The first rule whose every condition matches decides the type; nothing
 * matching leaves the declared type in place. An unset field falls back to the
 * declaring block's own parameter default.
 */

import { describe, it, expect } from 'vitest'

import {
  resolveOutputType,
  resolveOutputTypes,
  type ParamDefault,
} from '@/features/workbench/lib/node-parameters/output-type'
import type { OutputParam, OutputTypeRule } from '@/features/workbench/lib/node-parameters/types'

const FORMAT_RULES: OutputTypeRule[] = [
  { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
]

const TWO_CONDITION_RULES: OutputTypeRule[] = [
  {
    when: [
      { field: 'output_format', values: ['map'] },
      { field: 'search_by', values: ['selector', 'list'] },
    ],
    type: 'array',
  },
  { when: [{ field: 'output_format', values: ['map'] }], type: 'map' },
]

describe('resolveOutputType', () => {
  it('returns the declared type when there is no rule list', () => {
    expect(resolveOutputType('map', undefined, {})).toBe('map')
  })

  it('returns the declared type for an empty rule list', () => {
    expect(resolveOutputType('map', [], {})).toBe('map')
  })

  it('lets the first matching rule win when two match', () => {
    const rules: OutputTypeRule[] = [
      { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
      { when: [{ field: 'output_format', values: ['table'] }], type: 'string' },
    ]
    expect(resolveOutputType('map', rules, { output_format: 'table' })).toBe('table')
  })

  it('requires both conditions of a two-condition rule', () => {
    expect(
      resolveOutputType('map', TWO_CONDITION_RULES, { output_format: 'map', search_by: 'list' }),
    ).toBe('array')
    expect(
      resolveOutputType('map', TWO_CONDITION_RULES, { output_format: 'map', search_by: 'name' }),
    ).toBe('map')
  })

  it('resolves an unset field through the inputs list defaultValue', () => {
    const inputs: ParamDefault[] = [{ name: 'output_format', defaultValue: 'table' }]
    expect(resolveOutputType('map', FORMAT_RULES, {}, inputs)).toBe('table')
  })

  it('returns the declared type for an unset field with no inputs argument', () => {
    expect(resolveOutputType('map', FORMAT_RULES, {})).toBe('map')
  })

  it('returns the declared type when the input carries no defaultValue', () => {
    const inputs: ParamDefault[] = [{ name: 'output_format' }]
    expect(resolveOutputType('map', FORMAT_RULES, {}, inputs)).toBe('map')
  })

  it('returns the declared type for a null value', () => {
    expect(resolveOutputType('map', FORMAT_RULES, { output_format: null })).toBe('map')
  })

  it('compares a non-string value as its string form', () => {
    const rules: OutputTypeRule[] = [{ when: [{ field: 'limit', values: ['1'] }], type: 'array' }]
    expect(resolveOutputType('map', rules, { limit: 1 })).toBe('array')
  })

  it('compares a structure by its content, not as "[object Object]"', () => {
    const rules: OutputTypeRule[] = [
      { when: [{ field: 'shape', values: ['{"a":1}'] }], type: 'array' },
    ]
    expect(resolveOutputType('map', rules, { shape: { a: 1 } })).toBe('array')
    expect(resolveOutputType('map', rules, { shape: { b: 2 } })).toBe('map')
  })

  it('returns the declared type for an expression string', () => {
    expect(resolveOutputType('map', FORMAT_RULES, { output_format: '${fmt}' })).toBe('map')
  })

  it('returns the declared type for an unmapped literal', () => {
    expect(resolveOutputType('map', FORMAT_RULES, { output_format: 'xml' })).toBe('map')
  })

  it('matches a rule with an empty when array unconditionally', () => {
    const rules: OutputTypeRule[] = [{ when: [], type: 'string' }]
    expect(resolveOutputType('map', rules, {})).toBe('string')
  })
})

describe('resolveOutputTypes', () => {
  it('returns one resolved entry per output', () => {
    const outputs: OutputParam[] = [
      { name: 'result', type: 'map', typeWhen: FORMAT_RULES },
      { name: 'count', type: 'integer' },
    ]

    const resolved = resolveOutputTypes(outputs, { output_format: 'yaml' })

    expect(resolved.size).toBe(2)
    expect(resolved.get('result')).toBe('string')
    expect(resolved.get('count')).toBe('integer')
  })
})
