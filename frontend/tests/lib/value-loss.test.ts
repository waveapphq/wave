/**
 * The one rule for whether a switch into or out of {x}, or a type change, loses a value,
 * shared by the Block row and every list and map entry (FIELD-7).
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 * REQ-3.1.3.19: Declared element types for array and map values
 */

import { describe, it, expect } from 'vitest'

import {
  clearedCount,
  emptyValueOf,
  expressionIsHeld,
  hasEmptyValue,
  plainValueIsHeld,
} from '@/lib/value-loss'
import type { VariableType } from '@/lib/variable-types'

const WITH_EMPTY: VariableType[] = ['string', 'array', 'map', 'table']
const WITHOUT_EMPTY: VariableType[] = ['integer', 'float', 'boolean']

describe('plainValueIsHeld - a type change or a switch into {x} asks first', () => {
  it('holds nothing in null or in the type default', () => {
    expect(plainValueIsHeld(null, 'string')).toBe(false)
    expect(plainValueIsHeld('', 'string')).toBe(false)
    expect(plainValueIsHeld('0', 'integer')).toBe(false)
    expect(plainValueIsHeld('0.0', 'float')).toBe(false)
    expect(plainValueIsHeld(0, 'float')).toBe(false)
    expect(plainValueIsHeld(false, 'boolean')).toBe(false)
    expect(plainValueIsHeld('[]', 'array')).toBe(false)
    expect(plainValueIsHeld([], 'array')).toBe(false)
    expect(plainValueIsHeld('{ }', 'map')).toBe(false)
  })

  it('holds text, a number other than 0, true, and a list or map with something in it', () => {
    expect(plainValueIsHeld('a', 'string')).toBe(true)
    expect(plainValueIsHeld(' ', 'string')).toBe(true)
    expect(plainValueIsHeld('5', 'integer')).toBe(true)
    expect(plainValueIsHeld(true, 'boolean')).toBe(true)
    expect(plainValueIsHeld('[1]', 'array')).toBe(true)
    expect(plainValueIsHeld({ a: 1 }, 'map')).toBe(true)
  })

  it('holds text the type refuses, as it is still something typed', () => {
    expect(plainValueIsHeld('abc', 'integer')).toBe(true)
    expect(plainValueIsHeld('[1,', 'array')).toBe(true)
    expect(plainValueIsHeld('[]', 'map')).toBe(true)
  })

  it("compares with the host's empty entry when it gives one", () => {
    const fresh = { stat: 'sum', field: '' }
    expect(plainValueIsHeld({ stat: 'sum', field: '' }, 'map', fresh)).toBe(false)
    expect(plainValueIsHeld({ stat: 'sum', field: 'bytes' }, 'map', fresh)).toBe(true)
  })
})

describe('expressionIsHeld - a switch out of {x} asks first', () => {
  it('holds a written expression only', () => {
    expect(expressionIsHeld(undefined)).toBe(false)
    expect(expressionIsHeld(null)).toBe(false)
    expect(expressionIsHeld('')).toBe(false)
    expect(expressionIsHeld('  ')).toBe(false)
    expect(expressionIsHeld('x + 1')).toBe(true)
    expect(expressionIsHeld({ a: 1 })).toBe(true)
  })
})

describe('clearedCount - what the type change warning counts', () => {
  it('counts the items or entries a list or map holds, and one for anything else', () => {
    expect(clearedCount('[1, 2, 3]', 'array')).toBe(3)
    expect(clearedCount({ a: 1, b: 2 }, 'map')).toBe(2)
    expect(clearedCount('[1,', 'array')).toBe(1)
    expect(clearedCount('abc', 'string')).toBe(1)
  })
})

describe('the empty value Clear & Empty leaves (FIELD-7)', () => {
  it('is offered for text, list, map and table values only', () => {
    expect(WITH_EMPTY.every(hasEmptyValue)).toBe(true)
    expect(WITHOUT_EMPTY.some(hasEmptyValue)).toBe(false)
  })

  it('is written as an expression in {x}, else as the value', () => {
    expect(emptyValueOf('string', true)).toBe("''")
    expect(emptyValueOf('array', true)).toBe('[]')
    expect(emptyValueOf('table', true)).toBe('[]')
    expect(emptyValueOf('map', true)).toBe('{}')
    expect(emptyValueOf('string', false)).toBe('')
    expect(emptyValueOf('array', false)).toEqual([])
    expect(emptyValueOf('map', false)).toEqual({})
  })
})
