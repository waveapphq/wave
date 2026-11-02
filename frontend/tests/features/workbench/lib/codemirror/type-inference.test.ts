/**
 * Tests for type-inference shared module.
 *
 * This module provides type inference functions used by both
 * the inline expression editor (CodeMirror) and the modal expression editor.
 */

import { describe, it, expect } from 'vitest'
import {
  hasRequiredParams,
  WAVE_TO_PYTHON,
  mapTypeToPython,
  inferExpressionType,
  getTypeBeforeDot,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/type-inference'

// ============================================
// hasRequiredParams
// ============================================

describe('hasRequiredParams', () => {
  it('returns true for function with required parameter', () => {
    expect(hasRequiredParams('abs(x)')).toBe(true)
  })

  it('returns false for method with no parameters', () => {
    expect(hasRequiredParams('.upper()')).toBe(false)
  })

  it('returns false for method with only optional parameters', () => {
    expect(hasRequiredParams('.strip(chars=None)')).toBe(false)
  })

  it('returns true for function with mixed required and optional parameters', () => {
    expect(hasRequiredParams('round(number, ndigits=None)')).toBe(true)
  })

  it('returns false for function with only *args and **kwargs', () => {
    expect(hasRequiredParams('print(*args, **kwargs)')).toBe(false)
  })

  it('returns false for empty parens', () => {
    expect(hasRequiredParams('abs()')).toBe(false)
  })

  it('returns false when no parens match', () => {
    expect(hasRequiredParams('no_parens')).toBe(false)
  })
})

// ============================================
// WAVE_TO_PYTHON
// ============================================

describe('WAVE_TO_PYTHON', () => {
  it('maps string to str', () => {
    expect(WAVE_TO_PYTHON['string']).toBe('str')
  })

  it('maps integer to int', () => {
    expect(WAVE_TO_PYTHON['integer']).toBe('int')
  })

  it('maps float to float', () => {
    expect(WAVE_TO_PYTHON['float']).toBe('float')
  })

  it('maps boolean to bool', () => {
    expect(WAVE_TO_PYTHON['boolean']).toBe('bool')
  })

  it('maps array to list', () => {
    expect(WAVE_TO_PYTHON['array']).toBe('list')
  })

  it('maps map to dict', () => {
    expect(WAVE_TO_PYTHON['map']).toBe('dict')
  })

  it('maps table to table', () => {
    expect(WAVE_TO_PYTHON['table']).toBe('table')
  })

  it('contains exactly 7 WAVE types', () => {
    expect(Object.keys(WAVE_TO_PYTHON)).toEqual([
      'string',
      'integer',
      'float',
      'boolean',
      'array',
      'map',
      'table',
    ])
  })
})

// ============================================
// mapTypeToPython
// ============================================

describe('mapTypeToPython', () => {
  it('maps string to str', () => {
    expect(mapTypeToPython('string')).toBe('str')
  })

  it('maps integer to int', () => {
    expect(mapTypeToPython('integer')).toBe('int')
  })

  it('maps float to float', () => {
    expect(mapTypeToPython('float')).toBe('float')
  })

  it('maps number to "int | float"', () => {
    expect(mapTypeToPython('number')).toBe('int | float')
  })

  it('maps boolean to bool', () => {
    expect(mapTypeToPython('boolean')).toBe('bool')
  })

  it('maps object to dict', () => {
    expect(mapTypeToPython('object')).toBe('dict')
  })

  it('maps array to list', () => {
    expect(mapTypeToPython('array')).toBe('list')
  })

  it('maps list to list', () => {
    expect(mapTypeToPython('list')).toBe('list')
  })

  it('maps dict to dict', () => {
    expect(mapTypeToPython('dict')).toBe('dict')
  })

  it('maps map to dict', () => {
    expect(mapTypeToPython('map')).toBe('dict')
  })

  it('maps table to "list[dict]"', () => {
    expect(mapTypeToPython('table')).toBe('list[dict]')
  })

  it('maps unknown type to "Any"', () => {
    expect(mapTypeToPython('unknown')).toBe('Any')
  })
})

// ============================================
// inferExpressionType
// ============================================

describe('inferExpressionType', () => {
  const variables: AvailableVariable[] = [
    { name: 'endpoint', type: 'string' },
    { name: 'count', type: 'integer' },
    { name: 'ratio', type: 'float' },
    { name: 'items', type: 'array' },
    { name: 'config', type: 'map' },
  ]

  it('infers str for single-quoted string literal', () => {
    expect(inferExpressionType("'hello'", variables)).toBe('str')
  })

  it('infers str for double-quoted string literal', () => {
    expect(inferExpressionType('"hello"', variables)).toBe('str')
  })

  it('infers int for integer literal', () => {
    expect(inferExpressionType('42', variables)).toBe('int')
  })

  it('infers float for float literal', () => {
    expect(inferExpressionType('3.14', variables)).toBe('float')
  })

  it('infers list for list literal', () => {
    expect(inferExpressionType('[1,2,3]', variables)).toBe('list')
  })

  it('infers dict for dict literal', () => {
    expect(inferExpressionType("{'a': 1}", variables)).toBe('dict')
  })

  it('infers return type of builtin function call', () => {
    expect(inferExpressionType('len([1,2])', variables)).toBe('int')
  })

  it('infers type from variable reference', () => {
    expect(inferExpressionType('endpoint', variables)).toBe('str')
  })

  it('infers int from integer variable', () => {
    expect(inferExpressionType('count', variables)).toBe('int')
  })

  it('infers list from array variable', () => {
    expect(inferExpressionType('items', variables)).toBe('list')
  })

  it('infers dict from map variable', () => {
    expect(inferExpressionType('config', variables)).toBe('dict')
  })

  it('returns undefined for unknown expression', () => {
    expect(inferExpressionType('unknown_name', variables)).toBeUndefined()
  })

  it('handles whitespace around expression', () => {
    expect(inferExpressionType('  42  ', variables)).toBe('int')
  })

  it('uses variable type as PythonType fallback for unmapped types', () => {
    const vars: AvailableVariable[] = [{ name: 'x', type: 'str' }]
    expect(inferExpressionType('x', vars)).toBe('str')
  })
})

// ============================================
// getTypeBeforeDot
// ============================================

describe('getTypeBeforeDot', () => {
  const variables: AvailableVariable[] = [
    { name: 'endpoint', type: 'string' },
    { name: 'items', type: 'array' },
    { name: 'config', type: 'map' },
  ]

  it('returns str for string literal', () => {
    expect(getTypeBeforeDot("'hello'", variables)).toBe('str')
  })

  it('returns undefined for integer number', () => {
    expect(getTypeBeforeDot('42', variables)).toBeUndefined()
  })

  it('returns undefined for float number', () => {
    expect(getTypeBeforeDot('3.14', variables)).toBeUndefined()
  })

  it('returns list for list literal', () => {
    expect(getTypeBeforeDot('[1,2]', variables)).toBe('list')
  })

  it('returns dict for dict literal', () => {
    expect(getTypeBeforeDot("{'a':1}", variables)).toBe('dict')
  })

  it('returns return type for function call', () => {
    expect(getTypeBeforeDot('str(42)', variables)).toBe('str')
  })

  it('traces type through method chain with string variable', () => {
    // x.upper() where x is a string variable -> str type -> upper returns str
    expect(getTypeBeforeDot('endpoint.upper()', variables)).toBe('str')
  })

  it('returns type for simple variable', () => {
    expect(getTypeBeforeDot('endpoint', variables)).toBe('str')
  })

  it('returns list for array variable', () => {
    expect(getTypeBeforeDot('items', variables)).toBe('list')
  })

  it('returns dict for map variable', () => {
    expect(getTypeBeforeDot('config', variables)).toBe('dict')
  })

  it('returns str for bare type name "str"', () => {
    expect(getTypeBeforeDot('str', [])).toBe('str')
  })

  it('returns list for bare type name "list"', () => {
    expect(getTypeBeforeDot('list', [])).toBe('list')
  })

  it('returns dict for bare type name "dict"', () => {
    expect(getTypeBeforeDot('dict', [])).toBe('dict')
  })

  it('returns set for bare type name "set"', () => {
    expect(getTypeBeforeDot('set', [])).toBe('set')
  })

  it('returns undefined for unknown expression', () => {
    expect(getTypeBeforeDot('unknown_thing', [])).toBeUndefined()
  })

  it('handles whitespace around expression', () => {
    expect(getTypeBeforeDot("  'hello'  ", variables)).toBe('str')
  })

  it('traces type through function call in method chain', () => {
    // str(42).upper() - note: the greedy regex catches this as a function call
    // before reaching the chain block, but the result is still correct
    expect(getTypeBeforeDot('str(42).upper()', variables)).toBe('str')
  })

  it('traces type through chain with function base and property access', () => {
    // str(42).something - property access without () means type is undefined
    // This tests the chain path where base is a function call
    expect(getTypeBeforeDot('str(42).something', variables)).toBeUndefined()
  })

  it('returns undefined for property access without call in chain', () => {
    // endpoint.something (no parens on something) - can't determine type
    expect(getTypeBeforeDot('endpoint.something', variables)).toBeUndefined()
  })

  it('uses variable type as PythonType fallback for unmapped types in chain base', () => {
    const vars: AvailableVariable[] = [{ name: 'x', type: 'str' }]
    expect(getTypeBeforeDot('x', vars)).toBe('str')
  })

  it('returns "object" for namespace prefix "system"', () => {
    const vars: AvailableVariable[] = [
      { name: 'system', type: 'object', source: 'System Variables' },
    ]
    // Namespace objects have type "object" which has no Python methods,
    // so no method suggestions appear after "system." - only field completions
    expect(getTypeBeforeDot('system', vars)).toBe('object')
  })

  it('returns "object" for namespace prefix "suite"', () => {
    const vars: AvailableVariable[] = [
      { name: 'suite', type: 'object', source: 'Suite' },
    ]
    expect(getTypeBeforeDot('suite', vars)).toBe('object')
  })
})
