import { describe, it, expect } from 'vitest'
import {
  formatCellText,
  formatValue,
  JsonNumberText,
  numberShapeType,
  plainJsonText,
  sameStoredValue,
  valueToText,
} from '@/lib/variable-format'

// A number shows in plain digits on every surface, never exponent notation (REQ-3.1.3.14).

describe('JsonNumberText', () => {
  it('holds the exact source text and prints as it', () => {
    const number = new JsonNumberText('12345678901234567890')
    expect(number.text).toBe('12345678901234567890')
    expect(String(number)).toBe('12345678901234567890')
  })
})

describe('plainJsonText - compact', () => {
  it('writes what JSON.stringify writes for plain values', () => {
    const value = { a: 1, b: [true, null, 'x'], c: { d: 2.5 }, e: [], f: {} }
    expect(plainJsonText(value)).toBe(JSON.stringify(value))
  })

  it('writes a JS number in plain digits, never exponent notation', () => {
    expect(plainJsonText([1e21, 1e-7, -2.5e-8])).toBe('[1000000000000000000000,0.0000001,-0.000000025]')
  })

  it('writes a held number text exactly as written', () => {
    expect(plainJsonText({ id: new JsonNumberText('12345678901234567890'), r: new JsonNumberText('1.50') })).toBe(
      '{"id":12345678901234567890,"r":1.50}',
    )
  })

  it('writes a number that is not finite as null, as JSON.stringify does', () => {
    expect(plainJsonText([Number.NaN, Number.POSITIVE_INFINITY])).toBe('[null,null]')
  })

  it('skips an undefined member and writes an undefined or missing item as null', () => {
    const holes = new Array<unknown>(1)
    holes.push(1)
    expect(plainJsonText({ a: undefined, b: [undefined, 2], c: holes })).toBe('{"b":[null,2],"c":[null,1]}')
  })

  it('gives undefined for a whole undefined value, as JSON.stringify does', () => {
    expect(plainJsonText(undefined)).toBeUndefined()
  })

  it('leaves a value with its own JSON form to JSON.stringify', () => {
    const at = new Date('2026-10-24T10:00:00Z')
    expect(plainJsonText({ at })).toBe('{"at":"2026-10-24T10:00:00.000Z"}')
  })

  it('writes a map made with no prototype like any other map', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare.n = 1e21
    expect(plainJsonText(bare)).toBe('{"n":1000000000000000000000}')
  })
})

describe('plainJsonText - indented', () => {
  it('writes what JSON.stringify writes with two spaces for plain values', () => {
    const value = { a: 1, b: [true, { c: 'x' }], e: [], f: {} }
    expect(plainJsonText(value, '  ')).toBe(JSON.stringify(value, null, 2))
  })

  it('indents a held number text and a large JS number in plain digits', () => {
    expect(plainJsonText({ n: [new JsonNumberText('2.0'), 1e21] }, '  ')).toBe(
      '{\n  "n": [\n    2.0,\n    1000000000000000000000\n  ]\n}',
    )
  })
})

describe('valueToText - plain numbers', () => {
  it('writes a JS number in plain digits', () => {
    expect(valueToText(1e21)).toBe('1000000000000000000000')
    expect(valueToText(0.0000001)).toBe('0.0000001')
    expect(valueToText(42)).toBe('42')
  })

  it('writes a number inside a list or map in plain digits', () => {
    expect(valueToText({ big: 1e21 })).toBe('{"big":1000000000000000000000}')
  })

  it('keeps text and true / false as they are', () => {
    expect(valueToText('1e21')).toBe('1e21')
    expect(valueToText(true)).toBe('true')
  })

  it('shows a float variable stored as a small JS number in plain digits', () => {
    expect(formatValue(0.0000001, 'float')).toBe('0.0000001')
  })
})

describe('formatCellText - plain numbers', () => {
  it('writes a number cell and a number inside a nested cell in plain digits', () => {
    expect(formatCellText(1e-7)).toBe('0.0000001')
    expect(formatCellText([1e21])).toBe('[1000000000000000000000]')
  })

  it('keeps a string cell quoted and a null cell as null', () => {
    expect(formatCellText('7')).toBe('"7"')
    expect(formatCellText(null)).toBe('null')
  })
})

describe('sameStoredValue', () => {
  it('reads a JS number and the digit text of that exact number as the same value', () => {
    expect(sameStoredValue(5, '5')).toBe(true)
    expect(sameStoredValue('1.50', 1.5)).toBe(true)
    expect(sameStoredValue(1e21, '1000000000000000000000')).toBe(true)
  })

  it('tells numbers apart that one JS double cannot', () => {
    expect(sameStoredValue(9007199254740992, '9007199254740993')).toBe(false)
  })

  it('never reads text that is not a plain number, or a number that is not finite, as a number', () => {
    expect(sameStoredValue(5, ' 5')).toBe(false)
    expect(sameStoredValue(Number.NaN, 'NaN')).toBe(false)
  })

  it('compares two texts and two structures by their JSON', () => {
    expect(sameStoredValue('1.0', '1')).toBe(false)
    expect(sameStoredValue({ a: [1] }, { a: [1] })).toBe(true)
    expect(sameStoredValue([5], ['5'])).toBe(false)
  })

  it('reads the same value as itself, NaN included', () => {
    expect(sameStoredValue(Number.NaN, Number.NaN)).toBe(true)
  })
})

describe('numberShapeType', () => {
  it('reads a whole JS number as an integer and any other as a float', () => {
    expect(numberShapeType(3)).toBe('integer')
    expect(numberShapeType(-0)).toBe('integer')
    expect(numberShapeType(2.5)).toBe('float')
  })
})
