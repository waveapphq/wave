import { describe, it, expect } from 'vitest'
import {
  formatValue,
  formatScalarMetric,
  truncateValue,
  getValueColorClass,
  valueMatchesType,
  nestedJsonTextType,
  formatElementCellText,
  inferElementRenderType,
  realizeNestedText,
  isNullValue,
  NULL_LOOK_CLASS,
} from '@/lib/variable-format'
import * as variableFormat from '@/lib/variable-format'
import { VARIABLE_TYPES, type VariableType } from '@/lib/variable-types'

// ===========================================================================
// formatValue
// ===========================================================================

describe('formatValue', () => {
  describe('string type', () => {
    it('renders the string value raw (no wrapping quotes)', () => {
      expect(formatValue('hello', 'string')).toBe('hello')
    })

    it('renders an empty string as empty', () => {
      expect(formatValue('', 'string')).toBe('')
    })
  })

  describe('integer type', () => {
    it('converts integer to string', () => {
      expect(formatValue(42, 'integer')).toBe('42')
    })

    it('handles zero', () => {
      expect(formatValue(0, 'integer')).toBe('0')
    })

    it('handles negative integer', () => {
      expect(formatValue(-7, 'integer')).toBe('-7')
    })
  })

  describe('float type', () => {
    it('converts float to string', () => {
      expect(formatValue(3.14, 'float')).toBe('3.14')
    })

    it('handles zero float', () => {
      expect(formatValue(0.0, 'float')).toBe('0')
    })
  })

  describe('boolean type', () => {
    it('converts true to string', () => {
      expect(formatValue(true, 'boolean')).toBe('true')
    })

    it('converts false to string', () => {
      expect(formatValue(false, 'boolean')).toBe('false')
    })
  })

  describe('array type', () => {
    it('shows plural items count for multiple items', () => {
      expect(formatValue([1, 2, 3], 'array')).toBe('[3 items]')
    })

    it('shows singular item count for one item', () => {
      expect(formatValue([1], 'array')).toBe('[1 item]')
    })

    it('shows zero items for empty array', () => {
      expect(formatValue([], 'array')).toBe('[0 items]')
    })

    it('treats non-array value as empty array', () => {
      expect(formatValue('not-an-array', 'array')).toBe('[0 items]')
    })

    it('formats a null array as null, not as an empty one', () => {
      expect(formatValue(null, 'array')).toBe('null')
    })

    it('reads count from the runtime push envelope {count, changed}', () => {
      // The backend's variable_push service sends arrays as a count
      // summary, not as the literal list. The formatter must use the
      // summary count so panel rows do not regress to "[0 items]".
      expect(formatValue({ count: 2, changed: true }, 'array')).toBe('[2 items]')
      expect(formatValue({ count: 1, changed: true }, 'array')).toBe('[1 item]')
      expect(formatValue({ count: 0, changed: true }, 'array')).toBe('[0 items]')
    })
  })

  describe('map type', () => {
    it('shows plural keys count for multiple keys', () => {
      expect(formatValue({ a: 1, b: 2 }, 'map')).toBe('{2 keys}')
    })

    it('shows singular key count for one key', () => {
      expect(formatValue({ a: 1 }, 'map')).toBe('{1 key}')
    })

    it('shows zero keys for empty map', () => {
      expect(formatValue({}, 'map')).toBe('{0 keys}')
    })

    it('formats a null map as null, not as an empty one', () => {
      expect(formatValue(null, 'map')).toBe('null')
    })

    it('treats non-object as empty map', () => {
      expect(formatValue('not-a-map', 'map')).toBe('{0 keys}')
    })

    it('reads count from the runtime push envelope {count, changed}', () => {
      expect(formatValue({ count: 3, changed: true }, 'map')).toBe('{3 keys}')
      expect(formatValue({ count: 1, changed: true }, 'map')).toBe('{1 key}')
      expect(formatValue({ count: 0, changed: true }, 'map')).toBe('{0 keys}')
    })
  })

  describe('table type', () => {
    it('formats table from rows/cols summary object', () => {
      expect(formatValue({ rows: 3, cols: 5 }, 'table')).toBe('3\u00D75 table')
    })

    it('formats table from array of objects', () => {
      const value = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]
      expect(formatValue(value, 'table')).toBe('2\u00D72 table')
    })

    it('formats table from array of arrays', () => {
      const value = [
        [1, 2, 3],
        [4, 5, 6],
      ]
      expect(formatValue(value, 'table')).toBe('2\u00D73 table')
    })

    it('formats empty array as 0x0 table', () => {
      expect(formatValue([], 'table')).toBe('0\u00D70 table')
    })

    it('formats non-array non-object as 0x0 table', () => {
      expect(formatValue('not-a-table', 'table')).toBe('0\u00D70 table')
    })

    it('handles array with scalar first row as 0 columns', () => {
      // firstRow is a number, not an array or object
      expect(formatValue([42, 43], 'table')).toBe('2\u00D70 table')
    })

    it('formats a null table as null, not as a 0x0 table', () => {
      expect(formatValue(null, 'table')).toBe('null')
    })

    it('formats the stored {columns, rows} form by its rows and columns (REQ-3.5.5.4)', () => {
      const value = {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
          { name: 'active', type: 'boolean' },
        ],
        rows: [
          [1, null, true],
          [null, 'beta', null],
        ],
      }
      expect(formatValue(value, 'table')).toBe('2×3 table')
    })

    it('keeps the column count of a stored {columns, rows} table with no rows', () => {
      const value = { columns: [{ name: 'id', type: 'integer' }], rows: [] }
      expect(formatValue(value, 'table')).toBe('0×1 table')
    })
  })

  describe('live push envelope', () => {
    // One envelope shape reaches every complex row: the backend measures the
    // value and the DECLARED type picks which measurement is read.
    const envelope = { count: 4, rows: 4, cols: 9, changed: true }

    it('reads the item count for a variable declared array', () => {
      expect(formatValue(envelope, 'array')).toBe('[4 items]')
    })

    it('reads the dimensions for a variable declared table', () => {
      expect(formatValue(envelope, 'table')).toBe('4\u00D79 table')
    })

    it('reads the key count for a variable declared map', () => {
      expect(formatValue({ count: 3, rows: 0, cols: 0, changed: true }, 'map')).toBe('{3 keys}')
    })
  })

  describe('secret values', () => {
    it('returns masked value for secret string', () => {
      expect(formatValue('secret-password', 'string', true)).toBe('********')
    })

    it('returns masked value for secret integer', () => {
      expect(formatValue(42, 'integer', true)).toBe('********')
    })

    it('returns masked value for secret array', () => {
      expect(formatValue([1, 2, 3], 'array', true)).toBe('********')
    })

    it('returns masked value for secret map', () => {
      expect(formatValue({ a: 1 }, 'map', true)).toBe('********')
    })

    it('returns masked value for secret boolean', () => {
      expect(formatValue(true, 'boolean', true)).toBe('********')
    })

    it('returns masked value for secret table', () => {
      expect(formatValue({ rows: 2, cols: 3 }, 'table', true)).toBe('********')
    })

    it('shows a secret holding nothing (empty) as empty, never masked', () => {
      expect(formatValue('', 'string', true)).toBe('')
      expect(formatValue('', 'array', true)).toBe('')
    })

    it('shows a null secret as null, never masked', () => {
      expect(formatValue(null, 'string', true)).toBe('null')
      expect(formatValue(null, 'array', true)).toBe('null')
    })

    it.each([
      ['whitespace', '   '],
      ['a sealed envelope', 'wave:enc:v1:abc'],
      ['the mask', '********'],
    ])('masks a secret holding %s', (_label, value) => {
      expect(formatValue(value, 'string', true)).toBe('********')
    })
  })

  describe('unset values (declared, never given a value)', () => {
    it('renders null instead of the literal word undefined', () => {
      expect(formatValue(undefined, 'string')).toBe('null')
    })

    it('renders null for every declared type', () => {
      for (const type of ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as VariableType[]) {
        expect(formatValue(undefined, type)).toBe('null')
      }
    })

    it('a secret with no value reads null, not a hidden value', () => {
      expect(formatValue(undefined, 'string', true)).toBe('null')
    })

    it('an empty string is still a value, not unset', () => {
      expect(formatValue('', 'string')).toBe('')
    })

    it('null is still a value, not unset', () => {
      expect(formatValue(null, 'string')).toBe('null')
    })
  })

  describe('a structure under a scalar declaration', () => {
    it('renders a map as its compact JSON, never "[object Object]"', () => {
      expect(formatValue({ a: 1 }, 'string')).toBe('{"a":1}')
      expect(formatValue({ a: 1 }, 'integer')).toBe('{"a":1}')
    })

    it('renders a list as its compact JSON', () => {
      expect(formatValue([1, 2], 'string')).toBe('[1,2]')
    })
  })

  describe('unknown/default type', () => {
    it('converts value to string for unknown type', () => {
      // Cast to bypass TS type checking for the unknown type case
      expect(formatValue(42, 'unknown' as never)).toBe('42')
    })

    it('renders an object as its compact JSON for unknown type', () => {
      expect(formatValue({ a: 1 }, 'unknown' as never)).toBe('{"a":1}')
    })
  })
})

// ===========================================================================
// Null values (REQ-3.1.3.20, VMGR-93)
// ===========================================================================

describe('isNullValue', () => {
  it.each([
    ['null', null],
    ['undefined (no value key)', undefined],
  ])('is true for %s', (_label, value) => {
    expect(isNullValue(value)).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['an empty list', []],
    ['an empty map', {}],
    ['zero', 0],
    ['false', false],
    ['the text "null"', 'null'],
  ])('is false for %s', (_label, value) => {
    expect(isNullValue(value)).toBe(false)
  })
})

// Text Muted (--color-text-muted): the one gray of the default, null and <empty string> in both themes.
const TEXT_MUTED = 'text-[color:var(--color-text-muted)]'

describe('NULL_LOOK_CLASS', () => {
  it('draws the table cell chip look: Text Muted gray, italic, mono (VMGR-93)', () => {
    expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
    expect(NULL_LOOK_CLASS.split(/\s+/)).toEqual(expect.arrayContaining(['font-mono', 'italic', TEXT_MUTED]))
    expect(NULL_LOOK_CLASS.split(/\s+/)).not.toContain('text-muted-foreground')
  })
})

describe('the <empty string> marker (FIELD-4)', () => {
  it('reads <empty string>', () => {
    expect(variableFormat.EMPTY_STRING_TEXT).toBe('<empty string>')
  })

  it('is italic in the Text Muted gray, like null', () => {
    expect(variableFormat.EMPTY_STRING_LOOK_CLASS).toEqual(expect.any(String))
    expect(variableFormat.EMPTY_STRING_LOOK_CLASS.split(/\s+/)).toEqual(
      expect.arrayContaining(['italic', TEXT_MUTED]),
    )
  })

  it('cannot be selected', () => {
    expect(variableFormat.EMPTY_STRING_LOOK_CLASS).toEqual(expect.any(String))
    expect(variableFormat.EMPTY_STRING_LOOK_CLASS.split(/\s+/)).toContain('select-none')
  })
})

describe('one gray for the default, null and <empty string> (FIELD-2, FIELD-4, FIELD-5)', () => {
  it('gives all three the Text Muted gray', () => {
    const looks = [
      variableFormat.HELD_DEFAULT_LOOK_CLASS,
      variableFormat.NULL_LOOK_CLASS,
      variableFormat.EMPTY_STRING_LOOK_CLASS,
    ]
    for (const look of looks) {
      expect(look).toEqual(expect.any(String))
      expect(look.split(/\s+/)).toContain(TEXT_MUTED)
    }
  })

  it('has no separate gray look for a checkbox', () => {
    expect(Object.keys(variableFormat)).not.toContain('HELD_DEFAULT_CHECKBOX_CLASS')
  })
})

describe('formatValue - a null value', () => {
  it.each(VARIABLE_TYPES)('formats a null %s as null', (type) => {
    expect(formatValue(null, type)).toBe('null')
  })

  it.each(VARIABLE_TYPES)('formats a null %s secret as null, unmasked', (type) => {
    expect(formatValue(null, type, true)).toBe('null')
  })

  it('formats a string holding the text "null" as an ordinary string, measured like any text', () => {
    expect(formatValue('null', 'string')).toBe('null')
    expect(formatScalarMetric('null', 'string')).toBe('4 chars')
  })

  it('has no separate label for a variable with no value', () => {
    expect(Object.keys(variableFormat)).not.toContain('UNSET_VALUE_LABEL')
  })
})

describe('formatScalarMetric - a null value', () => {
  it('gives a null string no metric', () => {
    expect(formatScalarMetric(null, 'string')).toBeNull()
  })
})

// ===========================================================================
// truncateValue
// ===========================================================================

describe('truncateValue', () => {
  describe('string type', () => {
    it('returns formatted value as-is when raw string is within limit', () => {
      const raw = 'short'
      const formatted = `"${raw}"`
      expect(truncateValue(formatted, 'string', raw)).toBe(formatted)
    })

    it('truncates and adds ellipsis when raw string exceeds limit', () => {
      const raw = 'a'.repeat(150)
      const formatted = `"${raw}"`
      const result = truncateValue(formatted, 'string', raw)
      // Should truncate raw value to MAX_VALUE_LENGTH (100) and add ellipsis within quotes
      expect(result).toBe(`"${'a'.repeat(100)}\u2026"`)
    })

    it('returns formatted value when raw string is exactly at limit', () => {
      const raw = 'b'.repeat(100)
      const formatted = `"${raw}"`
      expect(truncateValue(formatted, 'string', raw)).toBe(formatted)
    })
  })

  describe('non-string types', () => {
    it('returns formatted value as-is when within limit', () => {
      expect(truncateValue('[3 items]', 'array', [1, 2, 3])).toBe('[3 items]')
    })

    it('truncates long non-string formatted value with ellipsis', () => {
      const longFormatted = 'x'.repeat(150)
      const result = truncateValue(longFormatted, 'integer', 42)
      expect(result).toBe('x'.repeat(100) + '\u2026')
    })

    it('returns formatted value when exactly at limit', () => {
      const exactLength = 'y'.repeat(100)
      expect(truncateValue(exactLength, 'float', 3.14)).toBe(exactLength)
    })

    it('handles boolean formatted value within limit', () => {
      expect(truncateValue('true', 'boolean', true)).toBe('true')
    })

    it('handles map formatted value within limit', () => {
      expect(truncateValue('{2 keys}', 'map', { a: 1, b: 2 })).toBe('{2 keys}')
    })

    it('handles table formatted value within limit', () => {
      expect(truncateValue('3\u00D75 table', 'table', null)).toBe('3\u00D75 table')
    })
  })
})

// ===========================================================================
// formatScalarMetric (inspect modal footer metric)
// ===========================================================================

describe('formatScalarMetric', () => {
  describe('string values', () => {
    it('returns "N chars" counting the raw value length', () => {
      expect(formatScalarMetric('hello', 'string')).toBe('5 chars')
    })

    it('returns "0 chars" for the empty string', () => {
      expect(formatScalarMetric('', 'string')).toBe('0 chars')
    })

    it('returns "1 char" for a one-character string', () => {
      expect(formatScalarMetric('a', 'string')).toBe('1 char')
    })

    it('counts long values in full (no truncation cap)', () => {
      expect(formatScalarMetric('x'.repeat(150), 'string')).toBe('150 chars')
    })

    it('coerces non-string runtime values before counting', () => {
      expect(formatScalarMetric(12345, 'string')).toBe('5 chars')
    })

    it('measures the compact JSON of a structure, not "[object Object]"', () => {
      expect(formatScalarMetric({ a: 1 }, 'string')).toBe('7 chars')
    })
  })

  describe('numeric and boolean values (empty center zone)', () => {
    it('returns null for integer values', () => {
      expect(formatScalarMetric(42, 'integer')).toBeNull()
    })

    it('returns null for float values', () => {
      expect(formatScalarMetric(3.14, 'float')).toBeNull()
    })

    it('returns null for boolean values', () => {
      expect(formatScalarMetric(true, 'boolean')).toBeNull()
    })
  })
})

// ===========================================================================
// getValueColorClass
// ===========================================================================

describe('formatScalarMetric - unset values', () => {
  it('reports no metric for a variable that carries no value', () => {
    expect(formatScalarMetric(undefined, 'string')).toBeNull()
    expect(formatScalarMetric(undefined, 'integer')).toBeNull()
  })

  it('still measures an empty string', () => {
    expect(formatScalarMetric('', 'string')).toBe('0 chars')
  })
})

describe('getValueColorClass', () => {
  describe('numeric types', () => {
    it('returns violet for integer type', () => {
      expect(getValueColorClass('integer')).toBe('text-violet-400')
    })

    it('returns pink for float type', () => {
      expect(getValueColorClass('float')).toBe('text-pink-400')
    })
  })

  describe('string type', () => {
    it('returns sky for string type', () => {
      expect(getValueColorClass('string')).toBe('text-sky-300')
    })
  })

  describe('boolean type', () => {
    it('returns orange for boolean type', () => {
      expect(getValueColorClass('boolean')).toBe('text-orange-400')
    })
  })

  describe('collection types', () => {
    it('returns amber for array type', () => {
      expect(getValueColorClass('array')).toBe('text-amber-300')
    })

    it('returns emerald for map type', () => {
      expect(getValueColorClass('map')).toBe('text-emerald-400')
    })

    it('returns blue-500 for table type', () => {
      expect(getValueColorClass('table')).toBe('text-blue-500')
    })
  })

  describe('secret override', () => {
    it('returns muted color for secret string', () => {
      expect(getValueColorClass('string', true)).toBe('text-muted-foreground')
    })

    it('returns muted color for secret integer', () => {
      expect(getValueColorClass('integer', true)).toBe('text-muted-foreground')
    })

    it('returns muted color for secret boolean', () => {
      expect(getValueColorClass('boolean', true)).toBe('text-muted-foreground')
    })

    it('returns muted color for secret array', () => {
      expect(getValueColorClass('array', true)).toBe('text-muted-foreground')
    })
  })

  describe('unknown type', () => {
    it('returns empty string for unknown type', () => {
      expect(getValueColorClass('unknown' as never)).toBe('')
    })
  })
})

// ===========================================================================
// valueMatchesType (type-mismatch guard; leniency mirrors the backend type gate)
// ===========================================================================

const ALL_TYPES: VariableType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'array',
  'map',
  'table',
]

describe('valueMatchesType', () => {
  describe('null and undefined pass every declared type (engine permits None)', () => {
    it.each(ALL_TYPES)('null passes declared %s', (type) => {
      expect(valueMatchesType(null, type)).toBe(true)
    })

    it.each(ALL_TYPES)('undefined passes declared %s', (type) => {
      expect(valueMatchesType(undefined, type)).toBe(true)
    })
  })

  describe('declared string', () => {
    it('passes string values', () => {
      expect(valueMatchesType('hello', 'string')).toBe(true)
      expect(valueMatchesType('', 'string')).toBe(true)
    })

    it('rejects non-string values', () => {
      expect(valueMatchesType(42, 'string')).toBe(false)
      expect(valueMatchesType(true, 'string')).toBe(false)
      expect(valueMatchesType({}, 'string')).toBe(false)
      expect(valueMatchesType([], 'string')).toBe(false)
    })
  })

  describe('declared boolean', () => {
    it('passes boolean values', () => {
      expect(valueMatchesType(true, 'boolean')).toBe(true)
      expect(valueMatchesType(false, 'boolean')).toBe(true)
    })

    it('rejects truthy and falsy non-booleans', () => {
      expect(valueMatchesType('true', 'boolean')).toBe(false)
      expect(valueMatchesType(1, 'boolean')).toBe(false)
      expect(valueMatchesType(0, 'boolean')).toBe(false)
    })
  })

  describe('declared integer', () => {
    it('passes whole numbers', () => {
      expect(valueMatchesType(42, 'integer')).toBe(true)
      expect(valueMatchesType(0, 'integer')).toBe(true)
      expect(valueMatchesType(-7, 'integer')).toBe(true)
    })

    it('passes numeric strings (integers are carried as exact strings)', () => {
      expect(valueMatchesType('42', 'integer')).toBe(true)
      expect(valueMatchesType('-7', 'integer')).toBe(true)
      expect(valueMatchesType('1111111111111199999', 'integer')).toBe(true)
    })

    it('rejects fractional numbers', () => {
      expect(valueMatchesType(3.14, 'integer')).toBe(false)
    })

    it('rejects booleans (bools are excluded from integer)', () => {
      expect(valueMatchesType(true, 'integer')).toBe(false)
      expect(valueMatchesType(false, 'integer')).toBe(false)
    })

    it('rejects non-numeric strings, NaN, and Infinity', () => {
      expect(valueMatchesType('abc', 'integer')).toBe(false)
      expect(valueMatchesType('3.14', 'integer')).toBe(false)
      expect(valueMatchesType(Number.NaN, 'integer')).toBe(false)
      expect(valueMatchesType(Number.POSITIVE_INFINITY, 'integer')).toBe(false)
    })
  })

  describe('declared float', () => {
    it('passes fractional numbers', () => {
      expect(valueMatchesType(3.14, 'float')).toBe(true)
    })

    it('passes integers (YAML 0 loads as int for a declared float)', () => {
      expect(valueMatchesType(42, 'float')).toBe(true)
      expect(valueMatchesType(0, 'float')).toBe(true)
    })

    it('rejects non-finite numbers', () => {
      expect(valueMatchesType(Number.NaN, 'float')).toBe(false)
      expect(valueMatchesType(Number.POSITIVE_INFINITY, 'float')).toBe(false)
      expect(valueMatchesType(Number.NEGATIVE_INFINITY, 'float')).toBe(false)
    })

    it('passes numeric strings (floats are carried as exact strings)', () => {
      // Floats are transported as exact digit-strings (precision past double),
      // so a numeric string is a valid float here, not a type mismatch.
      expect(valueMatchesType('3.14', 'float')).toBe(true)
      expect(valueMatchesType('123', 'float')).toBe(true)
      expect(valueMatchesType('-2123.123213123123699999', 'float')).toBe(true)
    })

    it('rejects non-numeric strings and booleans', () => {
      expect(valueMatchesType('abc', 'float')).toBe(false)
      expect(valueMatchesType(true, 'float')).toBe(false)
    })
  })

  describe('declared array', () => {
    it('passes arrays including the empty array', () => {
      expect(valueMatchesType([1, 2], 'array')).toBe(true)
      expect(valueMatchesType([], 'array')).toBe(true)
    })

    it('rejects non-arrays', () => {
      expect(valueMatchesType({}, 'array')).toBe(false)
      expect(valueMatchesType('[]', 'array')).toBe(false)
      expect(valueMatchesType(42, 'array')).toBe(false)
    })
  })

  describe('declared map', () => {
    it('passes plain non-array objects', () => {
      expect(valueMatchesType({}, 'map')).toBe(true)
      expect(valueMatchesType({ a: 1 }, 'map')).toBe(true)
    })

    it('passes envelope-shaped plain objects too', () => {
      expect(valueMatchesType({ count: 2, changed: true }, 'map')).toBe(true)
    })

    it('rejects arrays and scalars', () => {
      expect(valueMatchesType([], 'map')).toBe(false)
      expect(valueMatchesType('x', 'map')).toBe(false)
      expect(valueMatchesType(42, 'map')).toBe(false)
    })
  })

  describe('declared table (delegates to isTableShape)', () => {
    it('passes an array of plain row objects', () => {
      expect(valueMatchesType([{ id: 1 }, { id: 2 }], 'table')).toBe(true)
    })

    it('passes the empty array', () => {
      expect(valueMatchesType([], 'table')).toBe(true)
    })

    it('passes the {columns, rows} dict', () => {
      expect(
        valueMatchesType({ columns: [{ name: 'id' }], rows: [[1]] }, 'table'),
      ).toBe(true)
    })

    it('rejects non-table shapes', () => {
      expect(valueMatchesType([1, 2], 'table')).toBe(false)
      expect(valueMatchesType([[1]], 'table')).toBe(false)
      expect(valueMatchesType({ a: 1 }, 'table')).toBe(false)
      expect(valueMatchesType('table', 'table')).toBe(false)
    })
  })
})


describe('nestedJsonTextType - recover a verbatim-JSON-text element type', () => {
  it('returns "map" for an object JSON string and "array" for an array JSON string', () => {
    expect(nestedJsonTextType('{"a":1}')).toBe('map')
    expect(nestedJsonTextType('  [1, 2] ')).toBe('array')
  })

  it('returns null for a non-JSON bracketed string, a scalar JSON, or a non-string', () => {
    expect(nestedJsonTextType('[x]')).toBeNull()
    expect(nestedJsonTextType('{oops}')).toBeNull()
    expect(nestedJsonTextType('123')).toBeNull()
    expect(nestedJsonTextType('"quoted"')).toBeNull()
    expect(nestedJsonTextType('plain')).toBeNull()
    expect(nestedJsonTextType(42)).toBeNull()
    expect(nestedJsonTextType(null)).toBeNull()
  })
})

describe('formatElementCellText / inferElementRenderType - array item / map value cells', () => {
  it('shows a nested array / map held as verbatim JSON text unquoted, tinted by structure', () => {
    expect(formatElementCellText('{"a":1}')).toBe('{"a":1}')
    expect(inferElementRenderType('{"a":1}')).toBe('map')
    expect(formatElementCellText('[1,2]')).toBe('[1,2]')
    expect(inferElementRenderType('[1,2]')).toBe('array')
  })

  it('falls back to the quoted string for a genuine (non-JSON) string element', () => {
    expect(formatElementCellText('[x]')).toBe('"[x]"')
    expect(inferElementRenderType('[x]')).toBe('string')
    expect(formatElementCellText('hello')).toBe('"hello"')
    expect(inferElementRenderType('hello')).toBe('string')
  })

  it('leaves a real object / scalar element to the base formatter', () => {
    expect(formatElementCellText({ a: 1 })).toBe('{"a":1}')
    expect(inferElementRenderType({ a: 1 })).toBe('map')
    expect(formatElementCellText(7)).toBe('7')
    expect(inferElementRenderType(7)).toBe('integer')
  })
})

describe('realizeNestedText - realize verbatim JSON-text elements for a pretty read view', () => {
  it('realizes a nested map / array held as JSON text into its structure', () => {
    expect(realizeNestedText(['{"a":1}'])).toEqual([{ a: 1 }])
    expect(realizeNestedText({ cfg: '[1,2]' })).toEqual({ cfg: [1, 2] })
  })

  it('recurses through real objects + arrays, realizing nested-text at any depth', () => {
    expect(realizeNestedText({ outer: ['{"b":2}'] })).toEqual({ outer: [{ b: 2 }] })
  })

  it('leaves real objects, scalars, and non-JSON strings untouched', () => {
    expect(realizeNestedText([{ retries: 3, host: 'srv-a' }])).toEqual([
      { retries: 3, host: 'srv-a' },
    ])
    expect(realizeNestedText('plain')).toBe('plain')
    expect(realizeNestedText('[x]')).toBe('[x]')
    expect(realizeNestedText(42)).toBe(42)
    expect(realizeNestedText(null)).toBeNull()
  })
})
