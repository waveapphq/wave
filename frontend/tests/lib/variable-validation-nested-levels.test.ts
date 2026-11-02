/**
 * A List or Map entry opened in its own editor: its JSON text read as typed items,
 * and the items written back as the JSON the entry holds (no new storage shape).
 *
 * REQ-3.1.3.19: Declared element types for array and map values
 */

import { describe, it, expect } from 'vitest'

import { JsonNumberText } from '@/lib/variable-format'
import { entryText, nestedValueFromText, nestedValueText, opensNestedEditor } from '@/lib/variable-validation'

describe('opensNestedEditor', () => {
  it('opens a List or Map entry whose text is that structure', () => {
    expect(opensNestedEditor('[1, 2]', 'array')).toBe(true)
    expect(opensNestedEditor('{"a": 1}', 'map')).toBe(true)
  })

  it('opens no entry of another type, nor broken or mismatched JSON', () => {
    expect(opensNestedEditor('[1]', 'string')).toBe(false)
    expect(opensNestedEditor('[1,', 'array')).toBe(false)
    expect(opensNestedEditor('[1]', 'map')).toBe(false)
    expect(opensNestedEditor('{"a": 1}', 'array')).toBe(false)
  })
})

describe('nestedValueFromText - each item typed by its own JSON', () => {
  it('reads a string, a whole number, a fraction, a .0, true / false, a list and a map', () => {
    expect(nestedValueFromText('array', '["5", 5, 2.5, 2.0, true, [1, 2.0], {"a": 1}]')).toEqual({
      value: ['5', '5', '2.5', '2.0', true, '[1, 2.0]', '{"a": 1}'],
      types: ['string', 'integer', 'float', 'float', 'boolean', 'array', 'map'],
    })
  })

  it('keeps every digit of a 19-digit integer', () => {
    expect(nestedValueFromText('array', '[1234567890123456789]').value).toEqual(['1234567890123456789'])
  })

  it('reads a map entry by entry, a null staying null', () => {
    expect(nestedValueFromText('map', '{"b": 2.0, "s": "x", "n": null}')).toEqual({
      value: { b: '2.0', s: 'x', n: null },
      types: { b: 'float', s: 'string', n: 'string' },
    })
  })
})

describe('nestedValueText - the JSON the entry holds', () => {
  it('writes a whole float as 2.0 and a 19-digit integer with every digit', () => {
    expect(
      nestedValueText('array', ['2.0', '1234567890123456789', 'x', true, null], [
        'float',
        'integer',
        'string',
        'boolean',
        'string',
      ]),
    ).toBe('[2.0, 1234567890123456789, "x", true, null]')
  })

  it('keeps a float typed as a whole number a float', () => {
    expect(nestedValueText('array', ['3', '-7'], ['float', 'float'])).toBe('[3.0, -7.0]')
  })

  it('writes a number without its leading zeros, so the JSON stays valid', () => {
    expect(nestedValueText('array', ['007', '-00.50', '0'], ['integer', 'float', 'integer'])).toBe('[7, -0.50, 0]')
  })

  it('keeps a string that reads like a number a string, and a deeper list or map as written', () => {
    expect(nestedValueText('array', ['5', '[1,2.0]', '{"a":1}'], ['string', 'array', 'map'])).toBe(
      '["5", [1,2.0], {"a":1}]',
    )
  })

  it('leaves a number item that does not read as a number to its own check', () => {
    expect(nestedValueText('array', ['abc', 4], ['integer', 'integer'])).toBe('["abc", 4]')
  })

  it('writes a map entry by entry', () => {
    expect(nestedValueText('map', { b: '2', s: 'x' }, { b: 'float', s: 'string' })).toBe('{"b": 2.0, "s": "x"}')
  })

  it('types the items by their shape when no types come with them', () => {
    expect(nestedValueText('array', ['x', true], undefined)).toBe('["x", true]')
    expect(nestedValueText('map', { k: true }, undefined)).toBe('{"k": true}')
  })

  it('reads back what it writes: a nested edit round-trips', () => {
    const text = '[2.0, 1234567890123456789, "5", {"k": 1.0}]'
    const { value, types } = nestedValueFromText('array', text)
    expect(nestedValueText('array', value, types)).toBe(text)
  })
})

describe('entryText - the text a list item or map entry shows', () => {
  it('writes a List or Map held as a structure as one spaced line, the form a nested Save writes', () => {
    expect(entryText({ a: 'x', n: 1, l: [true, null] })).toBe('{"a": "x", "n": 1, "l": [true, null]}')
    expect(entryText([1, { k: 'v' }])).toBe('[1, {"k": "v"}]')
    expect(entryText({})).toBe('{}')
    expect(entryText([])).toBe('[]')
  })

  it('keeps every digit of an exact number inside a structure', () => {
    expect(entryText([new JsonNumberText('1234567890123456789'), { f: new JsonNumberText('2.50') }])).toBe(
      '[1234567890123456789, {"f": 2.50}]',
    )
  })

  it('leaves text, numbers and true / false as they are, typed JSON text included', () => {
    expect(entryText('{"a":1}')).toBe('{"a":1}')
    expect(entryText(5)).toBe('5')
    expect(entryText(false)).toBe('false')
  })

  it('reads a nested structure of a List or Map entry in the same spaced form', () => {
    expect(nestedValueFromText('map', '{"m": {"a":1,"b":[2,3]}}').value).toEqual({ m: '{"a": 1, "b": [2, 3]}' })
  })
})
