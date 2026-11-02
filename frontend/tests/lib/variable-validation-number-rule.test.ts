import { describe, it, expect } from 'vitest'
import {
  inferColumnType,
  parseArrayCode,
  parseJsonExact,
  serializeArrayForCode,
  serializeComplexForCode,
  serializeMapForCode,
  serializeTableForCode,
  unfinishedNumberError,
  validateAndParseScalarValue,
  validateVariableValue,
} from '@/lib/variable-validation'
import { JsonNumberText } from '@/lib/variable-format'

// The one number rule every numeric field shares (REQ-3.1.3.14).

const TWENTY_DIGITS = '12345678901234567890'
const NINETEEN_DIGITS = '1234567890123456789'
const TWENTY_NINE_SIG = `1.${'2'.repeat(28)}`

describe('unfinishedNumberError', () => {
  it.each([
    ['-', 'integer', 'Enter a valid integer value'],
    ['-', 'float', 'Enter a valid float value'],
    ['1.', 'float', 'Enter a valid float value'],
    ['.', 'float', 'Enter a valid float value'],
  ] as const)('names text %j a %s box holds while it is typed', (text, type, message) => {
    expect(unfinishedNumberError(text, type)).toBe(message)
  })

  it.each([
    ['', 'integer'],
    ['5', 'integer'],
    ['1.5', 'float'],
    ['1.', 'integer'],
    ['abc', 'integer'],
    [TWENTY_DIGITS, 'integer'],
  ] as const)('leaves %j in a %s box to the other rules', (text, type) => {
    expect(unfinishedNumberError(text, type)).toBeNull()
  })

  it('leaves anything that is not text to the other rules', () => {
    expect(unfinishedNumberError(5, 'integer')).toBeNull()
  })
})

describe('validateVariableValue - numbers', () => {
  it('names an integer past 19 digits, as text or as a JS number', () => {
    expect(validateVariableValue('integer', TWENTY_DIGITS)).toBe('Maximum 19 digits')
    expect(validateVariableValue('integer', 1e21)).toBe('Maximum 19 digits')
  })

  it('takes an integer of 19 digits', () => {
    expect(validateVariableValue('integer', NINETEEN_DIGITS)).toBeNull()
  })

  it('names a float past 28 significant digits', () => {
    expect(validateVariableValue('float', TWENTY_NINE_SIG)).toBe('Maximum 28 significant digits')
  })

  it('takes a float stored as a small or large JS number, read in plain digits', () => {
    expect(validateVariableValue('float', 0.0000001)).toBeNull()
    expect(validateVariableValue('float', 1e21)).toBeNull()
  })

  it('names unfinished text with the window message', () => {
    expect(validateVariableValue('integer', '-')).toBe('Enter a valid integer value')
    expect(validateVariableValue('float', '2.')).toBe('Enter a valid float value')
  })

  it('keeps its own message for text that is no number at all', () => {
    expect(validateVariableValue('integer', 'abc')).toBe('Must be an integer')
    expect(validateVariableValue('float', '1e5')).toBe('Must be a number')
    expect(validateVariableValue('integer', 1.5)).toBe('Must be an integer')
    expect(validateVariableValue('integer', true)).toBe('Must be an integer')
  })

  it.each([true, false, 'true', 'false'])('takes true and false as a value or as text: %j', (value) => {
    expect(validateVariableValue('boolean', value)).toBeNull()
  })

  it('names a boolean that is neither true nor false', () => {
    expect(validateVariableValue('boolean', 'maybe')).toBe('Must be true or false')
    expect(validateVariableValue('boolean', 1)).toBe('Must be true or false')
  })

  it('takes any text for a string', () => {
    expect(validateVariableValue('string', '-')).toBeNull()
    expect(validateVariableValue('string', 5)).toBeNull()
  })
})

describe('validateAndParseScalarValue - the integer cap', () => {
  it('refuses an integer past 19 digits', () => {
    expect(validateAndParseScalarValue('integer', '', TWENTY_DIGITS, false)).toEqual({
      valid: false,
      error: 'Maximum 19 digits',
    })
  })

  it('keeps a 19-digit integer as its exact text', () => {
    expect(validateAndParseScalarValue('integer', '', `-${NINETEEN_DIGITS}`, false)).toEqual({
      valid: true,
      value: `-${NINETEEN_DIGITS}`,
    })
  })
})

describe('inferColumnType - plain number text only', () => {
  it.each(['0x10', '1e5', 'Infinity', '.5', '5.', '+5'])('reads %j as text', (text) => {
    expect(inferColumnType(text)).toBe('string')
  })

  it('reads plain digits as an integer and a plain decimal as a float', () => {
    expect(inferColumnType('-3')).toBe('integer')
    expect(inferColumnType('-3.25')).toBe('float')
  })
})

describe('parseJsonExact', () => {
  it('holds every number as the text it was written as', () => {
    expect(parseJsonExact(`{"id": ${TWENTY_DIGITS}, "r": [1.50, "x"]}`)).toEqual({
      id: new JsonNumberText(TWENTY_DIGITS),
      r: [new JsonNumberText('1.50'), 'x'],
    })
  })
})

describe('Code view serializers - plain digits', () => {
  it('writes a JS number item or value in plain digits', () => {
    expect(serializeArrayForCode([1e21, 0.0000001], ['integer', 'float'], 'line')).toBe(
      '[1000000000000000000000, 0.0000001]',
    )
    expect(serializeMapForCode({ n: 1e-7 }, { n: 'string' }, undefined, 'line')).toBe('{"n": 0.0000001}')
  })

  it('writes a nested list or map in plain digits on one line and pretty-printed', () => {
    expect(serializeArrayForCode([[1e21]], ['array'], 'line')).toBe('[[1000000000000000000000]]')
    expect(serializeArrayForCode([{ a: 1e21 }], ['map'])).toBe('[\n  {"a":1000000000000000000000}\n]')
  })

  it('writes a table cell in plain digits in a number column and in a text column', () => {
    const schema = [
      { name: 'n', type: 'float' as const },
      { name: 's', type: 'string' as const },
    ]
    expect(serializeTableForCode([{ n: 1e-7, s: 1e21 }], schema, 'line')).toBe(
      '[{"n": 0.0000001, "s": 1000000000000000000000}]',
    )
  })

  it('writes a table that is not a list of rows in plain digits, on one line or pretty-printed', () => {
    expect(serializeTableForCode({ n: 1e21 }, [], 'line')).toBe('{"n":1000000000000000000000}')
    expect(serializeTableForCode({ n: 1e21 }, [])).toBe('{\n  "n": 1000000000000000000000\n}')
  })

  it('writes the read Code view of a list with no element types in plain digits', () => {
    expect(serializeComplexForCode('array', [1e21, '{"a":0.0000001}'])).toBe(
      '[\n  1000000000000000000000,\n  {\n    "a": 0.0000001\n  }\n]',
    )
    expect(serializeComplexForCode('string', 1e-7)).toBe('0.0000001')
  })

  it('keeps an exact number of a parsed Code list as its text', () => {
    expect(parseArrayCode(`[${TWENTY_DIGITS}, 1.50]`).items).toEqual([TWENTY_DIGITS, '1.50'])
  })
})
