/**
 * python-literal-text - the one Python literal formatter: the expression placeholder shows a field's
 * default in Python literal form (REQ-3.1.1.5, REQ-3.1.3.14).
 */

import { describe, it, expect } from 'vitest'
import { pythonLiteral, pythonString } from '@/lib/python-literal-text'

describe('pythonString', () => {
  it('wraps a text in single quotes', () => {
    expect(pythonString('hello')).toBe("'hello'")
  })

  it('writes an empty text as two quotes', () => {
    expect(pythonString('')).toBe("''")
  })

  it('escapes a single quote inside the text', () => {
    expect(pythonString("it's")).toBe(String.raw`'it\'s'`)
  })

  it('escapes a backslash before anything else', () => {
    expect(pythonString(String.raw`C:\temp`)).toBe(String.raw`'C:\\temp'`)
  })

  it('writes newline, carriage return and tab as their escapes', () => {
    expect(pythonString('a\nb\rc\td')).toBe(String.raw`'a\nb\rc\td'`)
  })

  it('leaves a double quote as it is', () => {
    expect(pythonString('say "hi"')).toBe(`'say "hi"'`)
  })
})

describe('pythonLiteral', () => {
  it("writes a text as 'hello'", () => {
    expect(pythonLiteral('hello')).toBe("'hello'")
  })

  it('writes true and false as True and False', () => {
    expect(pythonLiteral(true)).toBe('True')
    expect(pythonLiteral(false)).toBe('False')
  })

  it('writes null and undefined as None', () => {
    expect(pythonLiteral(null)).toBe('None')
    expect(pythonLiteral(undefined)).toBe('None')
  })

  it('writes an integer as its digits', () => {
    expect(pythonLiteral(2)).toBe('2')
    expect(pythonLiteral(-15)).toBe('-15')
    expect(pythonLiteral(0)).toBe('0')
  })

  it('writes a fractional number as its digits', () => {
    expect(pythonLiteral(2.5)).toBe('2.5')
  })

  it('writes a whole-number float as 2.0 when the field type is float', () => {
    expect(pythonLiteral(2, 'float')).toBe('2.0')
    expect(pythonLiteral(-3, 'float')).toBe('-3.0')
    expect(pythonLiteral(0, 'float')).toBe('0.0')
  })

  it('keeps a fractional float as it is when the field type is float', () => {
    expect(pythonLiteral(2.5, 'float')).toBe('2.5')
  })

  it('keeps a whole number bare when the field type is integer', () => {
    expect(pythonLiteral(2, 'integer')).toBe('2')
  })

  it('writes a list as [1, 2]', () => {
    expect(pythonLiteral([1, 2])).toBe('[1, 2]')
  })

  it('writes an empty list and an empty map as [] and {}', () => {
    expect(pythonLiteral([])).toBe('[]')
    expect(pythonLiteral({})).toBe('{}')
  })

  it("writes a map as {'k': 1}", () => {
    expect(pythonLiteral({ k: 1 })).toBe("{'k': 1}")
  })

  it("writes a list of maps as [{'id': 1}]", () => {
    expect(pythonLiteral([{ id: 1 }])).toBe("[{'id': 1}]")
  })

  it('writes every item of a mixed list in its own literal form', () => {
    expect(pythonLiteral(['a', 1, true, null, 2.5])).toBe("['a', 1, True, None, 2.5]")
  })

  it('writes nested lists and maps at every depth', () => {
    expect(pythonLiteral({ tags: ['x', 'y'], limits: { max: 10, on: false } })).toBe(
      "{'tags': ['x', 'y'], 'limits': {'max': 10, 'on': False}}",
    )
  })

  it('escapes quotes and newlines in map keys and list items', () => {
    expect(pythonLiteral({ "it's": 'a\nb' })).toBe(String.raw`{'it\'s': 'a\nb'}`)
    expect(pythonLiteral(["o'k"])).toBe(String.raw`['o\'k']`)
  })

  it('keeps the map entry order as written', () => {
    expect(pythonLiteral({ b: 1, a: 2 })).toBe("{'b': 1, 'a': 2}")
  })
})

// A number default shows as the number it is, in plain digits (REQ-3.1.3.14).
describe('pythonLiteral - number defaults', () => {
  it('writes a large or small JS number in plain digits', () => {
    expect(pythonLiteral(1e21, 'float')).toBe('1000000000000000000000.0')
    expect(pythonLiteral(0.0000001, 'float')).toBe('0.0000001')
    expect(pythonLiteral(1e21)).toBe('1000000000000000000000')
  })

  it('writes digit text of a number field bare, as the number it spells', () => {
    expect(pythonLiteral('5', 'integer')).toBe('5')
    expect(pythonLiteral('12345678901234567890', 'float')).toBe('12345678901234567890.0')
    expect(pythonLiteral('2.50', 'float')).toBe('2.50')
  })

  it('keeps text a number field cannot read as a number quoted', () => {
    expect(pythonLiteral('1e5', 'float')).toBe("'1e5'")
    expect(pythonLiteral('5', 'string')).toBe("'5'")
    expect(pythonLiteral('5')).toBe("'5'")
  })
})
