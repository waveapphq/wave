import { describe, it, expect } from 'vitest'
import {
  validateVariableValue,
  hasVariableErrors,
  validateAndParseScalarValue,
  inferColumnType,
  formatValue,
  parseArrayCode,
  parseMapCode,
  parseStringMapCode,
  arrayErrorMessages,
  describeCellError,
  parseItemValue,
  mapEntryErrorMessages,
  serializeTableForCode,
  serializeArrayForCode,
  serializeMapForCode,
  overCapNumberLines,
  inferStoredElementType,
  serializeComplexForCode,
} from '@/lib/variable-validation'
import type { VariableRow } from '@/lib/variable-types'
import { MASK_PLACEHOLDER, SECRET_ENVELOPE_PREFIX } from '@/lib/secret-envelope'

describe('variable-validation - serialize / parse / validate edge branches', () => {
  it('flags a float cell exceeding the significant-digit cap', () => {
    expect(describeCellError(`0.${'1'.repeat(40)}`, 'float')).toContain('significant digits')
  })

  it('parseItemValue keeps an incomplete integer as its exact text', () => {
    expect(parseItemValue('-', 'integer')).toBe('-')
  })

  it('reports a duplicate map key once even across three collisions', () => {
    const entries = [
      { key: 'a', value: '1', type: 'integer' as const },
      { key: 'a', value: '2', type: 'integer' as const },
      { key: 'a', value: '3', type: 'integer' as const },
    ]
    const messages = mapEntryErrorMessages(entries)
    expect(messages.filter((m) => m.includes('Duplicate key "a"'))).toHaveLength(1)
  })

  it('serializes a table whose value is not a row list as raw JSON', () => {
    expect(serializeTableForCode({ not: 'a-table' }, [])).toBe(
      JSON.stringify({ not: 'a-table' }, null, 2),
    )
  })

  it('serializes an empty table row as {}', () => {
    expect(serializeTableForCode([{}], [])).toBe('[\n  {}\n]')
  })

  it('renders a non-string nested array element as JSON', () => {
    expect(serializeArrayForCode([['a']], ['array'])).toBe('[\n  ["a"]\n]')
  })

  it('renders a non-numeric value in a numeric column without treating it as a number', () => {
    expect(serializeArrayForCode([true], ['integer'])).toContain('true')
  })

  it('defaults a missing element / value type to string when serializing', () => {
    expect(serializeArrayForCode(['x'], [])).toBe('[\n  "x"\n]')
    expect(serializeMapForCode({ a: 'x' }, {})).toBe('{\n  "a": "x"\n}')
  })

  it('refuses an object as array code with "Must be a JSON array"', () => {
    expect(() => parseArrayCode('{"a":1}')).toThrow(/^Must be a JSON array$/)
  })

  it('refuses a list as map code with "Must be a JSON object"', () => {
    expect(() => parseMapCode('[1,2]')).toThrow(/^Must be a JSON object$/)
  })

  it('locates an over-cap number past an escaped string and whitespace before its key', () => {
    const lines = overCapNumberLines('{\n  "a": "x\\"y",\n  "big" : 12345678901234567890\n}')
    expect(lines.get('big')).toBe(3)
  })
})

describe('parseArrayCode / parseMapCode - nested values keep verbatim text', () => {
  it('keeps a nested array element verbatim, reserializing its string + number leaves', () => {
    const { items, types } = parseArrayCode('[\n  ["hi", 1]\n]')
    expect(types).toEqual(['array'])
    expect(items).toEqual(['["hi", 1]'])
  })

  it('keeps a nested map value verbatim (boolean leaf)', () => {
    const { value, types } = parseMapCode('{\n  "flags": { "on": true }\n}')
    expect(types).toEqual({ flags: 'map' })
    expect(value).toEqual({ flags: '{"on": true}' })
  })
})

// Code view: a whole text that is not a list / map is refused like invalid JSON (VMGR-96).
describe('parseArrayCode / parseMapCode / parseStringMapCode - whole text that is not a list or map (VMGR-96)', () => {
  const NOT_A_LIST = [
    ['a whole null', 'null'],
    ['a whole number', '5'],
    ['a whole string', '"x"'],
    ['a whole boolean', 'true'],
  ] as const

  it.each(NOT_A_LIST)('parseArrayCode refuses %s with "Must be a JSON array"', (_label, text) => {
    expect(() => parseArrayCode(text)).toThrow(/^Must be a JSON array$/)
  })

  it.each(NOT_A_LIST)('parseMapCode refuses %s with "Must be a JSON object"', (_label, text) => {
    expect(() => parseMapCode(text)).toThrow(/^Must be a JSON object$/)
  })

  it('parseMapCode refuses a whole null with expressions allowed', () => {
    expect(() => parseMapCode('null', true)).toThrow(/^Must be a JSON object$/)
  })

  it.each(NOT_A_LIST)('parseStringMapCode refuses %s with "Must be a JSON object"', (_label, text) => {
    expect(() => parseStringMapCode(text)).toThrow(/^Must be a JSON object$/)
  })

  it('keeps an empty list and an empty map (empty is not null)', () => {
    expect(parseArrayCode('[]')).toEqual({ items: [], types: [], exprIndices: [] })
    expect(parseMapCode('{}')).toEqual({ value: {}, types: {}, exprKeys: [] })
    expect(parseStringMapCode('{}')).toEqual({ value: {}, exprKeys: [], errors: [] })
  })
})

describe('parseArrayCode / parseMapCode - a null inside the text stays null (REQ-3.1.3.19)', () => {
  it('keeps a null array item null beside a typed item', () => {
    const { items, types } = parseArrayCode('[1, null]')
    expect(items).toEqual(['1', null])
    expect(types).toHaveLength(2)
    expect(types[0]).toBe('integer')
  })

  it('keeps a null map value null beside a typed value', () => {
    const { value, types } = parseMapCode('{"a": null, "b": 2}')
    expect(value).toEqual({ a: null, b: '2' })
    expect(types.b).toBe('integer')
  })

  it('keeps a null map value null beside an expression value', () => {
    const { value, exprKeys } = parseMapCode('{"a": null, "b": {{ x }}}', true)
    expect(value).toEqual({ a: null, b: 'x' })
    expect(exprKeys).toEqual(['b'])
  })

  it('keeps a text item reading "null" an ordinary string', () => {
    expect(parseArrayCode('["null"]')).toEqual({ items: ['null'], types: ['string'], exprIndices: [] })
  })
})

describe('arrayErrorMessages - a null item fits any element type (REQ-3.1.3.19)', () => {
  it.each(['string', 'integer', 'float', 'boolean', 'array', 'map'] as const)(
    'reports no problem for a null %s item',
    (type) => {
      expect(arrayErrorMessages([null], [type])).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// validateVariableValue - empty values
// ---------------------------------------------------------------------------

describe('validateVariableValue - empty values', () => {
  const types = ['string', 'boolean', 'array', 'map', 'table'] as const

  for (const type of types) {
    it(`returns null for empty value with type "${type}"`, () => {
      expect(validateVariableValue(type, '')).toBeNull()
    })
  }

  it('refuses an empty integer with the exact message (VMGR-95)', () => {
    expect(validateVariableValue('integer', '')).toBe('Must be an integer')
  })

  it('refuses an empty float with the exact message (VMGR-95)', () => {
    expect(validateVariableValue('float', '')).toBe('Must be a number')
  })
})

describe('validateVariableValue - a stored null (REQ-3.1.3.20)', () => {
  const types = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

  it.each(types)('keeps a stored null valid for type "%s"', (type) => {
    expect(validateVariableValue(type, null)).toBeNull()
  })

  it.each(['integer', 'float'] as const)('keeps an absent value valid for type "%s"', (type) => {
    expect(validateVariableValue(type, undefined)).toBeNull()
  })

  it('does not block Save for an integer or float row holding null', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'x', type: 'integer', secret: false, value: null as unknown as string },
      { id: '2', name: 'y', type: 'float', secret: false, value: null as unknown as string },
    ]
    expect(hasVariableErrors(rows)).toBe(false)
  })

  it('blocks Save for an integer row whose number box was emptied', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'x', type: 'string', secret: false, value: 'hello' },
      { id: '2', name: 'y', type: 'integer', secret: false, value: '' },
    ]
    expect(hasVariableErrors(rows)).toBe(true)
  })
})

describe('validateVariableValue - a stored secret', () => {
  const typed = ['integer', 'float', 'array', 'map', 'table'] as const
  const stored = [
    ['masked', MASK_PLACEHOLDER],
    ['sealed', `${SECRET_ENVELOPE_PREFIX}c2VhbGVk`],
  ] as const

  describe.each(stored)('%s', (_label, value) => {
    it.each(typed)('counts as valid for type "%s"', (type) => {
      expect(validateVariableValue(type, value)).toBeNull()
    })

    it('does not block Save in Edit Variables', () => {
      const rows: VariableRow[] = typed.map((type, index) => ({
        id: String(index),
        name: `secret_${type}`,
        type,
        secret: true,
        value,
      }))
      expect(hasVariableErrors(rows)).toBe(false)
    })
  })

  it('still judges a typed-in value that is not a stored secret', () => {
    expect(validateVariableValue('integer', 'sk-not-a-number')).toBe('Must be an integer')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - string
// ---------------------------------------------------------------------------

describe('validateVariableValue - string', () => {
  it('returns null for any non-empty string value', () => {
    expect(validateVariableValue('string', 'hello')).toBeNull()
    expect(validateVariableValue('string', '123')).toBeNull()
    expect(validateVariableValue('string', 'true')).toBeNull()
    expect(validateVariableValue('string', '{}')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - integer
// ---------------------------------------------------------------------------

describe('validateVariableValue - integer', () => {
  it('returns null for valid integers', () => {
    expect(validateVariableValue('integer', '0')).toBeNull()
    expect(validateVariableValue('integer', '42')).toBeNull()
    expect(validateVariableValue('integer', '-7')).toBeNull()
    expect(validateVariableValue('integer', '1000')).toBeNull()
  })

  it('returns error for invalid integers', () => {
    expect(validateVariableValue('integer', '3.14')).toBe('Must be an integer')
    expect(validateVariableValue('integer', 'abc')).toBe('Must be an integer')
    expect(validateVariableValue('integer', '1e5')).toBe('Must be an integer')
    expect(validateVariableValue('integer', '--1')).toBe('Must be an integer')
    expect(validateVariableValue('integer', '1.0')).toBe('Must be an integer')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - float
// ---------------------------------------------------------------------------

describe('validateVariableValue - float', () => {
  it('returns null for valid plain-decimal floats', () => {
    expect(validateVariableValue('float', '3.14')).toBeNull()
    expect(validateVariableValue('float', '-2.5')).toBeNull()
    expect(validateVariableValue('float', '0')).toBeNull()
    expect(validateVariableValue('float', '42')).toBeNull()
  })

  it('returns null for a high-precision float beyond double precision (exactness)', () => {
    expect(validateVariableValue('float', '-2123.123213123123699999')).toBeNull()
  })

  it('rejects scientific/exponential notation - plain decimal only', () => {
    expect(validateVariableValue('float', '1e5')).toBe('Must be a number')
    expect(validateVariableValue('float', '1E5')).toBe('Must be a number')
    expect(validateVariableValue('float', '8.32423432e+3')).toBe('Must be a number')
  })

  it('returns error for invalid floats', () => {
    expect(validateVariableValue('float', 'abc')).toBe('Must be a number')
    expect(validateVariableValue('float', 'NaN')).toBe('Must be a number')
    expect(validateVariableValue('float', '--1')).toBe('Must be a number')
    expect(validateVariableValue('float', '1.2.3')).toBe('Must be a number')
  })

  it('tolerates a float persisted as a JS number without throwing (system/suite vars)', () => {
    // A system/suite/regression float is stored as a JS number, not a string, and
    // reaches the validator during the variable-editor render. It must validate,
    // not crash on value.replace.
    expect(validateVariableValue('float', 1.5 as unknown as string)).toBeNull()
    expect(validateVariableValue('float', 0 as unknown as string)).toBeNull()
    expect(
      hasVariableErrors([
        { id: '1', name: 'rate', type: 'float', secret: false, value: 1.5 as unknown as string },
      ]),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - boolean
// ---------------------------------------------------------------------------

describe('validateVariableValue - boolean', () => {
  it('returns null for "true" and "false"', () => {
    expect(validateVariableValue('boolean', 'true')).toBeNull()
    expect(validateVariableValue('boolean', 'false')).toBeNull()
  })

  it('returns error for anything other than "true" or "false"', () => {
    expect(validateVariableValue('boolean', 'True')).toBe('Must be true or false')
    expect(validateVariableValue('boolean', 'TRUE')).toBe('Must be true or false')
    expect(validateVariableValue('boolean', '1')).toBe('Must be true or false')
    expect(validateVariableValue('boolean', '0')).toBe('Must be true or false')
    expect(validateVariableValue('boolean', 'yes')).toBe('Must be true or false')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - array
// ---------------------------------------------------------------------------

describe('validateVariableValue - array', () => {
  it('returns null for valid JSON arrays', () => {
    expect(validateVariableValue('array', '[]')).toBeNull()
    expect(validateVariableValue('array', '[1, 2, 3]')).toBeNull()
    expect(validateVariableValue('array', '["a", "b"]')).toBeNull()
  })

  it('returns JSON format error for invalid JSON', () => {
    expect(validateVariableValue('array', 'not json')).toBe('Must be valid JSON format')
    expect(validateVariableValue('array', '[1, 2,')).toBe('Must be valid JSON format')
  })

  it('returns type error when valid JSON is not an array', () => {
    expect(validateVariableValue('array', '{}')).toBe('Must be a JSON array')
    expect(validateVariableValue('array', '{"a": 1}')).toBe('Must be a JSON array')
    expect(validateVariableValue('array', '"hello"')).toBe('Must be a JSON array')
    expect(validateVariableValue('array', '42')).toBe('Must be a JSON array')
    expect(validateVariableValue('array', 'null')).toBe('Must be a JSON array')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - map
// ---------------------------------------------------------------------------

describe('validateVariableValue - map', () => {
  it('returns null for valid JSON objects', () => {
    expect(validateVariableValue('map', '{}')).toBeNull()
    expect(validateVariableValue('map', '{"key": "value"}')).toBeNull()
    expect(validateVariableValue('map', '{"a": 1, "b": true}')).toBeNull()
  })

  it('returns JSON format error for invalid JSON', () => {
    expect(validateVariableValue('map', 'not json')).toBe('Must be valid JSON format')
    expect(validateVariableValue('map', '{key: "value"}')).toBe('Must be valid JSON format')
  })

  it('returns type error when valid JSON is an array', () => {
    expect(validateVariableValue('map', '[]')).toBe('Must be a JSON object')
    expect(validateVariableValue('map', '[1, 2]')).toBe('Must be a JSON object')
  })

  it('returns type error for null (valid JSON but not an object)', () => {
    expect(validateVariableValue('map', 'null')).toBe('Must be a JSON object')
  })

  it('returns type error for primitives', () => {
    expect(validateVariableValue('map', '"hello"')).toBe('Must be a JSON object')
    expect(validateVariableValue('map', '42')).toBe('Must be a JSON object')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - table
// ---------------------------------------------------------------------------

describe('validateVariableValue - table', () => {
  it('returns null for valid JSON arrays', () => {
    expect(validateVariableValue('table', '[]')).toBeNull()
    expect(validateVariableValue('table', '[{"id": 1}]')).toBeNull()
    expect(validateVariableValue('table', '[{"a": 1}, {"b": 2}]')).toBeNull()
  })

  it('returns JSON format error for invalid JSON', () => {
    expect(validateVariableValue('table', 'not json')).toBe('Must be valid JSON format')
    expect(validateVariableValue('table', '[1, 2,')).toBe('Must be valid JSON format')
  })

  it('returns type error when valid JSON is not an array', () => {
    expect(validateVariableValue('table', '{}')).toBe('Must be a JSON array of objects')
    expect(validateVariableValue('table', '"hello"')).toBe('Must be a JSON array of objects')
    expect(validateVariableValue('table', '42')).toBe('Must be a JSON array of objects')
    expect(validateVariableValue('table', 'null')).toBe('Must be a JSON array of objects')
  })
})

// ---------------------------------------------------------------------------
// validateVariableValue - actual (non-string) values
//
// Entity-scope variables round-trip as actual JS values (arrays / objects /
// numbers / booleans), NOT JSON strings. An already-structured value must
// validate by SHAPE, never through JSON.parse.
// ---------------------------------------------------------------------------

describe('validateVariableValue - actual (non-string) values', () => {
  const u = (v: unknown) => v as unknown as string

  it('accepts an actual array / map / table value by shape', () => {
    expect(validateVariableValue('array', u(['h1', 'h2']))).toBeNull()
    expect(validateVariableValue('map', u({ a: 1 }))).toBeNull()
    expect(validateVariableValue('table', u([{ id: 1 }]))).toBeNull()
  })

  it('flags an actual value of the wrong shape for its complex type', () => {
    expect(validateVariableValue('array', u({ a: 1 }))).toBe('Must be a JSON array')
    expect(validateVariableValue('map', u([1, 2]))).toBe('Must be a JSON object')
    expect(validateVariableValue('table', u({ a: 1 }))).toBe('Must be a JSON array of objects')
  })

  it('accepts an actual number / boolean scalar', () => {
    expect(validateVariableValue('integer', u(42))).toBeNull()
    expect(validateVariableValue('boolean', u(true))).toBeNull()
    expect(validateVariableValue('boolean', u(false))).toBeNull()
  })

  it('flags an actual scalar that is wrong for its type', () => {
    expect(validateVariableValue('integer', u(3.14))).toBe('Must be an integer')
  })

  it('does not disable Save for an entity row holding an actual array', () => {
    expect(
      hasVariableErrors([
        { id: '1', name: 'hosts', type: 'array', secret: false, value: u(['a', 'b']) },
      ]),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasVariableErrors
// ---------------------------------------------------------------------------

describe('hasVariableErrors', () => {
  it('returns false for empty rows array', () => {
    expect(hasVariableErrors([])).toBe(false)
  })

  it('returns false when all rows are valid', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'x', type: 'string', secret: false, value: 'hello' },
      { id: '2', name: 'y', type: 'integer', secret: false, value: '42' },
      { id: '3', name: 'z', type: 'boolean', secret: false, value: 'true' },
    ]
    expect(hasVariableErrors(rows)).toBe(false)
  })

  it('returns false when all rows have empty values (no errors)', () => {
    const rows: VariableRow[] = [
      { id: '2', name: 'y', type: 'boolean', secret: false, value: '' },
    ]
    expect(hasVariableErrors(rows)).toBe(false)
  })

  it('returns true when one row has a validation error', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'x', type: 'string', secret: false, value: 'hello' },
      { id: '2', name: 'y', type: 'integer', secret: false, value: 'not-an-int' },
    ]
    expect(hasVariableErrors(rows)).toBe(true)
  })

  it('returns true when multiple rows have validation errors', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'x', type: 'integer', secret: false, value: 'bad' },
      { id: '2', name: 'y', type: 'boolean', secret: false, value: 'yes' },
    ]
    expect(hasVariableErrors(rows)).toBe(true)
  })
})

// ===========================================================================
// Design-time edit validators and the value codec in lib/variable-validation.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

// ---------------------------------------------------------------------------
// validateAndParseScalarValue - scalar value parse for the edit body
// ---------------------------------------------------------------------------

describe('validateAndParseScalarValue - string', () => {
  it('accepts any string verbatim', () => {
    expect(validateAndParseScalarValue('string', 'hello', '', false)).toEqual({
      valid: true,
      value: 'hello',
    })
  })

  it('keeps an empty string as an empty string', () => {
    expect(validateAndParseScalarValue('string', '', '', false)).toEqual({
      valid: true,
      value: '',
    })
  })
})

describe('validateAndParseScalarValue - integer', () => {
  it('parses a valid integer as its exact string', () => {
    expect(validateAndParseScalarValue('integer', '', '42', false)).toEqual({
      valid: true,
      value: '42',
    })
  })

  it('keeps a large integer exact (string, never a rounded JS number)', () => {
    expect(
      validateAndParseScalarValue('integer', '', '1111111111111199999', false),
    ).toEqual({ valid: true, value: '1111111111111199999' })
  })

  it('parses a negative integer as its exact string', () => {
    expect(validateAndParseScalarValue('integer', '', '-7', false)).toEqual({
      valid: true,
      value: '-7',
    })
  })

  it('refuses an empty integer field with the exact message (VMGR-95)', () => {
    expect(validateAndParseScalarValue('integer', '', '', false)).toEqual({
      valid: false,
      error: 'Must be a valid integer',
    })
  })

  it('refuses a whitespace-only integer field with the exact message', () => {
    expect(validateAndParseScalarValue('integer', '', '   ', false)).toEqual({
      valid: false,
      error: 'Must be a valid integer',
    })
  })

  it('rejects a decimal point with the exact message', () => {
    expect(validateAndParseScalarValue('integer', '', '3.14', false)).toEqual({
      valid: false,
      error: 'Integer cannot contain decimal point',
    })
  })

  it('rejects a non-numeric integer with the exact message', () => {
    expect(validateAndParseScalarValue('integer', '', 'abc', false)).toEqual({
      valid: false,
      error: 'Must be a valid integer',
    })
  })

  it('rejects valid-prefix garbage instead of truncating it', () => {
    expect(validateAndParseScalarValue('integer', '', '12x34', false)).toEqual({
      valid: false,
      error: 'Must be a valid integer',
    })
  })
})

describe('validateAndParseScalarValue - float', () => {
  // A float is kept as its exact trimmed STRING (never Number()), so a
  // value past double precision (~15-17 sig digits) survives verbatim.
  it('keeps a valid float as its exact string', () => {
    expect(validateAndParseScalarValue('float', '', '3.14', false)).toEqual({
      valid: true,
      value: '3.14',
    })
  })

  it('keeps a high-precision float exact (no JS-number rounding)', () => {
    expect(validateAndParseScalarValue('float', '', '-2123.123213123123699999', false)).toEqual({
      valid: true,
      value: '-2123.123213123123699999',
    })
  })

  it('keeps a dot-less float as its exact string', () => {
    expect(validateAndParseScalarValue('float', '', '123', false)).toEqual({
      valid: true,
      value: '123',
    })
  })

  it('refuses an empty float field with the exact message (VMGR-95)', () => {
    expect(validateAndParseScalarValue('float', '', '', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })

  it('refuses a whitespace-only float field with the exact message', () => {
    expect(validateAndParseScalarValue('float', '', '   ', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })

  it('accepts exactly 28 significant digits', () => {
    const value = '1.' + '9'.repeat(27) // 1 + 27 = 28 significant digits
    expect(validateAndParseScalarValue('float', '', value, false)).toEqual({
      valid: true,
      value,
    })
  })

  it('rejects more than 28 significant digits with the exact message', () => {
    const value = '1.' + '9'.repeat(28) // 1 + 28 = 29 significant digits
    expect(validateAndParseScalarValue('float', '', value, false)).toEqual({
      valid: false,
      error: 'Maximum 28 significant digits',
    })
  })

  it('rejects scientific/exponential notation', () => {
    expect(validateAndParseScalarValue('float', '', '1e3', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
    expect(validateAndParseScalarValue('float', '', '1E3', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })

  it('rejects a leading plus sign (only a leading minus is plain decimal)', () => {
    expect(validateAndParseScalarValue('float', '', '+1.5', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })

  it('rejects a non-numeric float with the exact message', () => {
    expect(validateAndParseScalarValue('float', '', 'abc', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })

  it('rejects valid-prefix garbage instead of truncating it (0.1234x5678)', () => {
    expect(validateAndParseScalarValue('float', '', '0.1234x5678', false)).toEqual({
      valid: false,
      error: 'Must be a valid number',
    })
  })
})

describe('validateAndParseScalarValue - boolean', () => {
  it('returns the boolean field value true', () => {
    expect(validateAndParseScalarValue('boolean', '', '', true)).toEqual({
      valid: true,
      value: true,
    })
  })

  it('returns the boolean field value false', () => {
    expect(validateAndParseScalarValue('boolean', '', '', false)).toEqual({
      valid: true,
      value: false,
    })
  })
})

describe('validateAndParseScalarValue - complex type fallthrough', () => {
  // Complex types are never edited through the scalar parser; the fallthrough
  // returns the string field so the call is total over VariableEditType.
  it.each(['array', 'map', 'table'] as const)(
    'returns the string field for the %s fallthrough',
    (type) => {
      expect(validateAndParseScalarValue(type, 'raw', '', false)).toEqual({
        valid: true,
        value: 'raw',
      })
    },
  )
})

// ---------------------------------------------------------------------------
// inferColumnType - column type inference from a sample value
// ---------------------------------------------------------------------------

describe('inferColumnType', () => {
  it('infers string for null, undefined, and empty', () => {
    expect(inferColumnType(null)).toBe('string')
    expect(inferColumnType(undefined)).toBe('string')
    expect(inferColumnType('')).toBe('string')
  })

  it('infers boolean from a boolean value', () => {
    expect(inferColumnType(true)).toBe('boolean')
    expect(inferColumnType(false)).toBe('boolean')
  })

  it('infers integer and float from numbers', () => {
    expect(inferColumnType(42)).toBe('integer')
    expect(inferColumnType(4.5)).toBe('float')
  })

  it('infers boolean from "true"/"false" strings', () => {
    expect(inferColumnType('true')).toBe('boolean')
    expect(inferColumnType('false')).toBe('boolean')
  })

  it('infers integer and float from numeric strings', () => {
    expect(inferColumnType('42')).toBe('integer')
    expect(inferColumnType('3.14')).toBe('float')
    expect(inferColumnType('  7  ')).toBe('integer')
  })

  it('infers string for non-numeric, non-boolean strings', () => {
    expect(inferColumnType('hello')).toBe('string')
    expect(inferColumnType('   ')).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// formatValue - the codec's display text (visual array/map editing)
// ---------------------------------------------------------------------------

describe('formatValue (codec)', () => {
  it('formats null as "null" and undefined as empty', () => {
    expect(formatValue(null)).toBe('null')
    expect(formatValue(undefined)).toBe('')
  })

  it('formats strings verbatim', () => {
    expect(formatValue('hello')).toBe('hello')
    expect(formatValue('')).toBe('')
  })

  it('formats numbers, booleans, objects, and arrays as JSON', () => {
    expect(formatValue(42)).toBe('42')
    expect(formatValue(3.14)).toBe('3.14')
    expect(formatValue(true)).toBe('true')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
    expect(formatValue([1, 2, 3])).toBe('[1,2,3]')
  })
})

describe('inferStoredElementType - re-typing a persisted array item / map value', () => {
  it('recognizes a nested map held as verbatim JSON text as a map', () => {
    // A saved array-of-map round-trips its element as JSON TEXT (the backend
    // realizes it), so the stored string must re-type as 'map', not 'string'.
    expect(inferStoredElementType('{"a":1}')).toBe('map')
  })

  it('recognizes a nested array held as verbatim JSON text as an array', () => {
    expect(inferStoredElementType('[1,2,3]')).toBe('array')
  })

  it('still recognizes a real nested object / array (in-memory, not text)', () => {
    expect(inferStoredElementType({ a: 1 })).toBe('map')
    expect(inferStoredElementType([1, 2])).toBe('array')
  })

  it('keeps a non-JSON bracketed string a string (not demoted to a structure)', () => {
    expect(inferStoredElementType('[x]')).toBe('string')
    expect(inferStoredElementType('{not json}')).toBe('string')
  })

  it('types plain scalars by their runtime shape', () => {
    expect(inferStoredElementType('hello')).toBe('string')
    expect(inferStoredElementType(7)).toBe('integer')
    expect(inferStoredElementType(1.5)).toBe('float')
    expect(inferStoredElementType(true)).toBe('boolean')
  })
})

describe('serializeComplexForCode - read Code view pretty-prints, realizing verbatim nested text', () => {
  it('renders an array element held as JSON text as the structure, not an escaped string', () => {
    const out = serializeComplexForCode('array', ['{"a":1}'])
    expect(out).toContain('"a": 1') // pretty, unescaped
    expect(out).not.toContain('\\')
  })

  it('renders a map value held as JSON text as the structure', () => {
    const out = serializeComplexForCode('map', { cfg: '{"a":1}' })
    expect(out).toContain('"cfg"')
    expect(out).toContain('"a": 1')
    expect(out).not.toContain('\\')
  })

  it('pretty-prints a real nested object (runtime value) unchanged - guards v-vmgr-04', () => {
    const out = serializeComplexForCode('array', [{ retries: 3, host: 'srv-a' }])
    expect(out).toContain('"retries": 3')
    expect(out).toContain('"host": "srv-a"')
  })

  it('keeps a genuine (non-JSON) string element quoted', () => {
    expect(serializeComplexForCode('array', ['[x]'])).toContain('"[x]"')
  })

  it('serializes a table value as array-of-rows JSON', () => {
    expect(serializeComplexForCode('table', [{ a: 1 }])).toBe('[\n  {\n    "a": 1\n  }\n]')
  })

  it('falls back to JSON.stringify for a non-complex / mismatched value', () => {
    expect(serializeComplexForCode('string', 'hello')).toBe('"hello"')
    expect(serializeComplexForCode('array', 'not-an-array')).toBe('"not-an-array"')
  })
})

// The window's value field writes a list, map or table out on one line, exact digits kept (REQ-3.1.3.14).
describe('serializeArrayForCode / serializeMapForCode / serializeTableForCode - one-line layout', () => {
  const ID_RATE = [
    { name: 'id', type: 'integer' },
    { name: 'rate', type: 'float' },
  ] as const

  it('writes a list on one line, each item by its element type', () => {
    expect(serializeArrayForCode(['1', '2', '3'], ['integer', 'integer', 'integer'], 'line')).toBe(
      '[1, 2, 3]',
    )
  })

  it('keeps exact digits, quotes text and leaves a null item null in a one-line list', () => {
    expect(
      serializeArrayForCode(
        ['1234567890123456789', '-0.1231231231232131231231231231', '02134', true, null],
        ['integer', 'float', 'string', 'boolean', 'string'],
        'line',
      ),
    ).toBe('[1234567890123456789, -0.1231231231232131231231231231, "02134", true, null]')
  })

  it('keeps a nested list or map item as its stored text on one line', () => {
    expect(serializeArrayForCode(['[1,2]', '{"a":1}'], ['array', 'map'], 'line')).toBe(
      '[[1,2], {"a":1}]',
    )
  })

  it('spaces a nested list or map on one line: ", " between items and ": " after keys', () => {
    expect(
      serializeArrayForCode(
        [{ stat: 'count' }, { stat: 'sum', field: 'bytes', tags: ['a', 1, null], skip: undefined }, [undefined, { x: true }]],
        ['map', 'map', 'array'],
        'line',
      ),
    ).toBe('[{"stat": "count"}, {"stat": "sum", "field": "bytes", "tags": ["a", 1, null]}, [null, {"x": true}]]')
    expect(serializeMapForCode({ parts: [{ kind: 'text' }] }, { parts: 'array' }, undefined, 'line')).toBe(
      '{"parts": [{"kind": "text"}]}',
    )
  })

  it('keeps a nested list or map compact in the pretty layout', () => {
    expect(serializeArrayForCode([{ stat: 'count' }], ['map'])).toBe('[\n  {"stat":"count"}\n]')
  })

  it('writes an empty list as []', () => {
    expect(serializeArrayForCode([], [], 'line')).toBe('[]')
  })

  it('writes a map on one line, each value by its element type', () => {
    expect(
      serializeMapForCode(
        { host: 'db.internal', port: '5432' },
        { host: 'string', port: 'integer' },
        undefined,
        'line',
      ),
    ).toBe('{"host": "db.internal", "port": 5432}')
  })

  it('writes an expression key bare on a one-line map', () => {
    expect(
      serializeMapForCode({ n: '16', app: "'a'" }, { n: 'integer', app: 'string' }, new Set(['app']), 'line'),
    ).toBe(`{"n": 16, "app": {{ 'a' }}}`)
  })

  it('writes an empty map as {}', () => {
    expect(serializeMapForCode({}, {}, undefined, 'line')).toBe('{}')
  })

  it('writes a table on one line as its rows, numbers by column type', () => {
    expect(
      serializeTableForCode(
        [
          { id: '1234567890123456789', rate: '-0.1231231231232131231231231231' },
          { id: '7', rate: '1.5' },
        ],
        [...ID_RATE],
        'line',
      ),
    ).toBe(
      '[{"id": 1234567890123456789, "rate": -0.1231231231232131231231231231}, {"id": 7, "rate": 1.5}]',
    )
  })

  it('writes a table stored with column types on one line as its rows', () => {
    expect(
      serializeTableForCode(
        { columns: [...ID_RATE], rows: [['7', '1.5']] },
        [...ID_RATE],
        'line',
      ),
    ).toBe('[{"id": 7, "rate": 1.5}]')
  })

  it('writes an empty table as [] and an empty row as {} on one line', () => {
    expect(serializeTableForCode([], [], 'line')).toBe('[]')
    expect(serializeTableForCode([{}], [], 'line')).toBe('[{}]')
  })

  it('writes a value that is not a table as its compact JSON on one line', () => {
    expect(serializeTableForCode({ not: 'a-table' }, [], 'line')).toBe('{"not":"a-table"}')
  })

  it('keeps the multi-line layout by default', () => {
    expect(serializeArrayForCode(['1'], ['integer'])).toBe('[\n  1\n]')
    expect(serializeMapForCode({ a: 'x' }, { a: 'string' })).toBe('{\n  "a": "x"\n}')
    expect(serializeTableForCode([{ id: '7' }], [{ name: 'id', type: 'integer' }])).toBe(
      '[\n  {\n    "id": 7\n  }\n]',
    )
  })
})

// A one-line list field draws an {x} item as a bare {{ expr }}, the way a map draws an {x} value (FIELD-6).
describe('serializeArrayForCode - items held as {x}', () => {
  it('writes an {x} item bare as {{ expr }} on one line while text items keep their quotes', () => {
    expect(
      serializeArrayForCode(['web-1', 'backup_host', 'web-3'], ['string', 'string', 'string'], 'line', new Set([1])),
    ).toBe('["web-1", {{ backup_host }}, "web-3"]')
  })

  it('writes an {x} item by its expression whatever its element type', () => {
    expect(serializeArrayForCode(['7', 'count + 1'], ['integer', 'integer'], 'line', new Set([1]))).toBe(
      '[7, {{ count + 1 }}]',
    )
  })

  it('keeps the quotes of a text item that reads like an expression', () => {
    expect(serializeArrayForCode(['{{ x }}', 'x'], ['string', 'string'], 'line', new Set([1]))).toBe(
      '["{{ x }}", {{ x }}]',
    )
  })

  it('writes an {x} item bare in the multi-line layout', () => {
    expect(serializeArrayForCode(['a', 'n'], ['string', 'string'], 'pretty', new Set([1]))).toBe(
      '[\n  "a",\n  {{ n }}\n]',
    )
  })
})
