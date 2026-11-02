/**
 * Declared element types of array / map values (REQ-3.1.3.19): the sidecar guard,
 * the per-element type resolution the editors seed from, and the Code view that
 * writes and reads each element as its declared type.
 */

import { describe, it, expect } from 'vitest'

import {
  inferStoredElementType,
  isElementTypes,
  parseArrayCode,
  parseMapCode,
  resolveArrayTypes,
  resolveMapTypes,
  serializeComplexForCode,
  serializeMapForCode,
} from '@/lib/variable-validation'
import { declaredElementRenderType, formatDeclaredElementCell } from '@/lib/variable-format'

describe('isElementTypes', () => {
  it('accepts a list or a key -> type record of the six element types', () => {
    expect(isElementTypes(['string', 'integer', 'float', 'boolean', 'array', 'map'])).toBe(true)
    expect(isElementTypes({ n: 'integer', zip: 'string' })).toBe(true)
    expect(isElementTypes([])).toBe(true)
    expect(isElementTypes({})).toBe(true)
  })

  it('rejects an unknown type, a table, and anything that is not a list or record', () => {
    expect(isElementTypes(['integer', 'number'])).toBe(false)
    expect(isElementTypes({ t: 'table' })).toBe(false)
    expect(isElementTypes(null)).toBe(false)
    expect(isElementTypes(undefined)).toBe(false)
    expect(isElementTypes('integer')).toBe(false)
  })
})

describe('resolving element types', () => {
  it('reads an undeclared element by its stored shape', () => {
    expect(inferStoredElementType('16')).toBe('string')
    expect(inferStoredElementType('[1, 2]')).toBe('array')
    expect(inferStoredElementType(' {"a": 1}')).toBe('map')
    expect(inferStoredElementType(true)).toBe('boolean')
  })

  it('takes each array item\'s declared type, else its stored shape', () => {
    expect(resolveArrayTypes(['16', '1.0', '[1]', 'x'], ['integer', 'float'])).toEqual([
      'integer',
      'float',
      'array',
      'string',
    ])
    expect(resolveArrayTypes(['16'], { 0: 'integer' })).toEqual(['string'])
    expect(resolveArrayTypes(['16'], ['bogus'])).toEqual(['string'])
  })

  it('takes each map key\'s declared type, else its stored shape', () => {
    expect(resolveMapTypes({ n: '16', zip: '02134', b: false }, { n: 'integer' })).toEqual({
      n: 'integer',
      zip: 'string',
      b: 'boolean',
    })
    expect(resolveMapTypes({ n: '16' }, ['integer'])).toEqual({ n: 'string' })
    expect(resolveMapTypes({ n: '16' }, null)).toEqual({ n: 'string' })
  })
})

describe('Code view of declared element types', () => {
  it('writes a declared number bare and numeric-looking text quoted', () => {
    expect(
      serializeComplexForCode('map', { n: '16', zip: '02134' }, { n: 'integer', zip: 'string' }),
    ).toBe('{\n  "n": 16,\n  "zip": "02134"\n}')
    expect(serializeComplexForCode('array', ['1.0', '07'], ['float', 'string'])).toBe(
      '[\n  1.0,\n  "07"\n]',
    )
  })

  it('pretty-prints a value with no element types as before', () => {
    expect(serializeComplexForCode('map', { n: '16' })).toBe('{\n  "n": "16"\n}')
    expect(serializeComplexForCode('map', ['x'], { n: 'integer' })).toBe('[\n  "x"\n]')
    expect(serializeComplexForCode('array', { a: 1 }, ['integer'])).toBe('{\n  "a": 1\n}')
  })

  it('reads a number token by its own digits: 16 is an integer, 1.0 a float', () => {
    expect(parseArrayCode('[16, 1.0, "16"]')).toEqual({
      items: ['16', '1.0', '16'],
      types: ['integer', 'float', 'string'],
      exprIndices: [],
    })
  })

  it('reads a bare expression row as an expression key when expressions are allowed', () => {
    expect(parseMapCode('{"n": 16, "app": {{ \'a\' + \'b\' }}}', true)).toEqual({
      value: { n: '16', app: "'a' + 'b'" },
      types: { n: 'integer', app: 'string' },
      exprKeys: ['app'],
    })
  })

  it('writes an expression key bare beside typed rows', () => {
    expect(
      serializeMapForCode({ n: '16', app: "'a'" }, { n: 'integer', app: 'string' }, new Set(['app'])),
    ).toBe('{\n  "n": 16,\n  "app": {{ \'a\' }}\n}')
  })
})

describe('read cells of declared element types', () => {
  it('renders a declared element as its type, whatever its stored text looks like', () => {
    expect(formatDeclaredElementCell('16', 'integer')).toBe('16')
    expect(formatDeclaredElementCell(' 1.0 ', 'float')).toBe('1.0')
    expect(formatDeclaredElementCell('16', 'string')).toBe('"16"')
    expect(formatDeclaredElementCell(true, 'boolean')).toBe('true')
    expect(declaredElementRenderType('16', 'integer')).toBe('integer')
    expect(declaredElementRenderType('16', 'string')).toBe('string')
  })

  it('falls back to the stored shape without a declared type, and renders a missing value muted', () => {
    expect(formatDeclaredElementCell('16', undefined)).toBe('"16"')
    expect(declaredElementRenderType('16', 'bogus')).toBe('string')
    expect(declaredElementRenderType(null, 'integer')).toBe('null')
    expect(declaredElementRenderType(undefined, 'integer')).toBe('null')
  })
})
