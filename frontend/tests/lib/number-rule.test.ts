/**
 * The one number rule every numeric field shares (REQ-3.1.3.14): an integer is
 * `-?[0-9]+` with at most 19 digits, a float is `-?[0-9]+(.[0-9]+)?` with at most
 * 28 significant digits, a JS number travels only when it keeps every digit, and a
 * number always prints in plain digits.
 */

import { describe, it, expect } from 'vitest'

import {
  acceptsNumericInput,
  compareNumbers,
  exactJsNumber,
  floatSignificantDigits,
  integerDigitCount,
  MAX_FLOAT_INPUT_CHARS,
  MAX_FLOAT_SIG_DIGITS,
  MAX_INTEGER_DIGITS,
  numberProblemMessage,
  numberProblemShort,
  numberTextProblem,
  numberValueProblem,
  plainNumberText,
  PLAIN_FLOAT,
  PLAIN_INTEGER,
  sameNumber,
  wireNumber,
  withoutTrailingZeros,
} from '@/lib/number-rule'

const NINETEEN = '1234567890123456789'
const TWENTY = '12345678901234567890'
const TWENTY_EIGHT = '1.234567890123456789012345678'
const TWENTY_NINE = '1.2345678901234567890123456789'

describe('the caps', () => {
  it('holds an integer to 19 digits and a float to 28 significant digits', () => {
    expect(MAX_INTEGER_DIGITS).toBe(19)
    expect(MAX_FLOAT_SIG_DIGITS).toBe(28)
    expect(MAX_FLOAT_INPUT_CHARS).toBe(40)
  })
})

describe('PLAIN_INTEGER and PLAIN_FLOAT', () => {
  it.each(['0', '-7', '007', TWENTY])('reads %j as integer text', (text) => {
    expect(PLAIN_INTEGER.test(text)).toBe(true)
  })

  it.each(['', '-', '+7', ' 7', '7\n', '1_000', '1.0', '1e3', '٣'])(
    'does not read %j as integer text',
    (text) => {
      expect(PLAIN_INTEGER.test(text)).toBe(false)
    },
  )

  it.each(['0', '-2.50', '30', TWENTY_NINE])('reads %j as float text', (text) => {
    expect(PLAIN_FLOAT.test(text)).toBe(true)
  })

  it.each(['', '.5', '5.', '1e5', '1.2.3', 'NaN', 'Infinity', ' 1.5'])(
    'does not read %j as float text',
    (text) => {
      expect(PLAIN_FLOAT.test(text)).toBe(false)
    },
  )
})

describe('plainNumberText', () => {
  it.each([
    [30, '30'],
    [-7, '-7'],
    [1.5, '1.5'],
    [0.000001, '0.000001'],
    [1e-7, '0.0000001'],
    [-1.5e-7, '-0.00000015'],
    [1e21, '1000000000000000000000'],
    [-1.25e22, '-12500000000000000000000'],
    [123456789012345680000, '123456789012345680000'],
    [-0, '0'],
  ] as const)('prints the number %j as %j', (value, text) => {
    expect(plainNumberText(value)).toBe(text)
  })

  it('leaves text as it is', () => {
    expect(plainNumberText(' 2.50 ')).toBe(' 2.50 ')
  })
})

describe('integerDigitCount', () => {
  it.each([
    ['123', 3],
    ['-123', 3],
    ['007', 3],
    [NINETEEN, MAX_INTEGER_DIGITS],
    [-45, 2],
    [1e21, 22],
  ] as const)('counts %j as %j digits, the sign aside', (value, count) => {
    expect(integerDigitCount(value)).toBe(count)
  })
})

describe('floatSignificantDigits', () => {
  it.each([
    ['3.14', 3],
    ['-0.000099', 2],
    ['100', 3],
    ['2.50', 3],
    ['0', 0],
    [TWENTY_NINE, 29],
    [1.5, 2],
    [123, 3],
    [1e-7, 1],
    [1e21, 22],
  ] as const)('counts %j as %j significant digits', (value, count) => {
    expect(floatSignificantDigits(value)).toBe(count)
  })
})

describe('numberTextProblem', () => {
  it.each([
    ['30', 'integer'],
    ['-0', 'integer'],
    ['007', 'integer'],
    [NINETEEN, 'integer'],
    [`-${NINETEEN}`, 'integer'],
    ['30', 'float'],
    ['2.50', 'float'],
    [TWENTY_EIGHT, 'float'],
    [`0.000${'1'.repeat(28)}`, 'float'],
  ] as const)('finds no problem in %j as %s', (text, type) => {
    expect(numberTextProblem(text, type)).toBeNull()
  })

  it.each([
    ['', 'integer'],
    ['-', 'integer'],
    [' 30', 'integer'],
    ['30 ', 'integer'],
    ['+30', 'integer'],
    ['3.0', 'integer'],
    ['1e3', 'integer'],
    ['', 'float'],
    ['1.', 'float'],
    ['.5', 'float'],
    ['1e5', 'float'],
    [' 2.5', 'float'],
    ['NaN', 'float'],
  ] as const)('finds %j is not a %s', (text, type) => {
    expect(numberTextProblem(text, type)).toBe('type')
  })

  it('finds integer text past 19 digits over the cap', () => {
    expect(numberTextProblem(TWENTY, 'integer')).toBe('integer-cap')
    expect(numberTextProblem(`-${TWENTY}`, 'integer')).toBe('integer-cap')
  })

  it('finds float text past 28 significant digits over the cap', () => {
    expect(numberTextProblem(TWENTY_NINE, 'float')).toBe('float-cap')
    expect(numberTextProblem('1'.repeat(29), 'float')).toBe('float-cap')
  })
})

describe('numberValueProblem', () => {
  it.each([
    [30, 'integer'],
    ['30', 'integer'],
    [30, 'float'],
    [2.5, 'float'],
    [1e-7, 'float'],
    ['2.50', 'float'],
  ] as const)('finds no problem in %j as %s', (value, type) => {
    expect(numberValueProblem(value, type)).toBeNull()
  })

  it.each([
    [1.5, 'integer'],
    [Number.NaN, 'integer'],
    [Number.NaN, 'float'],
    [Number.POSITIVE_INFINITY, 'float'],
    [Number.NEGATIVE_INFINITY, 'integer'],
    [true, 'integer'],
    [false, 'float'],
    [null, 'integer'],
    [undefined, 'float'],
    [[1], 'integer'],
    [{ a: 1 }, 'float'],
    ['abc', 'integer'],
    ['1e5', 'float'],
  ] as const)('finds %j is not a %s', (value, type) => {
    expect(numberValueProblem(value, type)).toBe('type')
  })

  it('counts a JS number by its plain digits against the caps', () => {
    expect(numberValueProblem(1e21, 'integer')).toBe('integer-cap')
    expect(numberValueProblem(TWENTY, 'integer')).toBe('integer-cap')
    expect(numberValueProblem(1e30, 'float')).toBe('float-cap')
    expect(numberValueProblem(TWENTY_NINE, 'float')).toBe('float-cap')
  })
})

describe('numberProblemMessage and numberProblemShort', () => {
  it.each([
    ['type', 'integer', 'Must be an integer', 'expected integer'],
    ['type', 'float', 'Must be a number', 'expected float'],
    ['integer-cap', 'integer', 'Maximum 19 digits', 'max 19 digits'],
    ['float-cap', 'float', 'Maximum 28 significant digits', 'max 28 significant digits'],
  ] as const)('names %s for a %s as %j and %j', (problem, type, message, short) => {
    expect(numberProblemMessage(problem, type)).toBe(message)
    expect(numberProblemShort(problem, type)).toBe(short)
  })
})

describe('acceptsNumericInput', () => {
  it('accepts valid partial input, including a lone sign / trailing dot', () => {
    expect(acceptsNumericInput('-', 'integer')).toBe(true)
    expect(acceptsNumericInput('', 'float')).toBe(true)
    expect(acceptsNumericInput('1.', 'float')).toBe(true)
    expect(acceptsNumericInput('-12.5', 'float')).toBe(true)
  })

  it('rejects non-numeric characters (no letters, no exponent, no double dot)', () => {
    expect(acceptsNumericInput('1a', 'integer')).toBe(false)
    expect(acceptsNumericInput('1.5', 'integer')).toBe(false)
    expect(acceptsNumericInput('1.2.3', 'float')).toBe(false)
    expect(acceptsNumericInput('1e5', 'float')).toBe(false)
    expect(acceptsNumericInput('+1', 'integer')).toBe(false)
  })

  it('rejects an over-cap length, with the leading sign free', () => {
    expect(acceptsNumericInput('1'.repeat(MAX_INTEGER_DIGITS), 'integer')).toBe(true)
    expect(acceptsNumericInput(`-${'1'.repeat(MAX_INTEGER_DIGITS)}`, 'integer')).toBe(true)
    expect(acceptsNumericInput('1'.repeat(MAX_INTEGER_DIGITS + 1), 'integer')).toBe(false)
    expect(acceptsNumericInput(`0.${'0'.repeat(MAX_FLOAT_INPUT_CHARS - 2)}`, 'float')).toBe(true)
    expect(acceptsNumericInput(`0.${'0'.repeat(MAX_FLOAT_INPUT_CHARS - 1)}`, 'float')).toBe(false)
  })

  it('rejects a float past the 28 significant-digit cap', () => {
    expect(acceptsNumericInput(`0.${'1'.repeat(MAX_FLOAT_SIG_DIGITS)}`, 'float')).toBe(true)
    expect(acceptsNumericInput(`0.${'1'.repeat(MAX_FLOAT_SIG_DIGITS + 1)}`, 'float')).toBe(false)
  })

  it('refuses a leading minus when negative numbers are off', () => {
    expect(acceptsNumericInput('-', 'integer', { negative: false })).toBe(false)
    expect(acceptsNumericInput('-5', 'float', { negative: false })).toBe(false)
    expect(acceptsNumericInput('5', 'integer', { negative: false })).toBe(true)
    expect(acceptsNumericInput('-5', 'integer', { negative: true })).toBe(true)
  })
})

describe('exactJsNumber - the JS number of a plain number text, only when it keeps every digit (REQ-3.1.3.14)', () => {
  it.each([
    ['integer', '5000', 5000],
    ['integer', '-42', -42],
    ['integer', '9007199254740991', 9007199254740991],
    ['integer', '-9007199254740991', -9007199254740991],
    ['float', '2.5', 2.5],
    ['float', '0.000001', 0.000001],
    ['float', '-0.000099', -0.000099],
    ['float', '123456789012345', 123456789012345],
    ['float', '1234567890123456', 1234567890123456],
    ['float', '0.30000000000000004', 0.30000000000000004],
    ['float', '9007199254740992', 9007199254740992],
  ] as const)('reads %s text %j as %j', (type, text, number) => {
    expect(exactJsNumber(text, type)).toBe(number)
  })

  it.each([
    ['integer', ' -42 '],
    ['integer', '007'],
    ['integer', '-0'],
    ['integer', '9007199254740992'],
    ['integer', '9007199254740993'],
    ['integer', '1.5'],
    ['integer', 'abc'],
    ['integer', TWENTY],
    ['float', '2.50'],
    ['float', '30.0'],
    ['float', '0.0000001'],
    ['float', '1500000000000000000000'],
    ['float', '0.1000000000000000055511151231'],
    ['float', '1e5'],
    ['float', ''],
  ] as const)('reads no number from %s text %j', (type, text) => {
    expect(exactJsNumber(text, type)).toBeUndefined()
  })
})

describe('wireNumber', () => {
  it('sends a number that keeps every digit as a JS number', () => {
    expect(wireNumber('30', 'integer')).toBe(30)
    expect(wireNumber('-2.5', 'float')).toBe(-2.5)
  })

  it('sends any other text as it is', () => {
    expect(wireNumber('2.50', 'float')).toBe('2.50')
    expect(wireNumber(TWENTY, 'integer')).toBe(TWENTY)
    expect(wireNumber('-', 'integer')).toBe('-')
  })

  it('sends a fraction below 0.0001 as text, the form the server stores without an exponent', () => {
    expect(wireNumber('0.00001', 'float')).toBe('0.00001')
    expect(wireNumber('-0.000099', 'float')).toBe('-0.000099')
    expect(wireNumber('0.0001', 'float')).toBe(0.0001)
    expect(wireNumber('0', 'float')).toBe(0)
  })
})

describe('compareNumbers and sameNumber', () => {
  it.each([
    ['1', '2', -1],
    ['2', '1', 1],
    ['10', '9', 1],
    ['9', '10', -1],
    ['1.5', '1.50', 0],
    ['0.2', '0.19999999999999999999', 1],
    ['0.19999999999999999999', '0.2', -1],
    ['100.0000000000000001', '100', 1],
    ['65535.00000000000001', 65535, 1],
    ['007', 7, 0],
    ['-1', '1', -1],
    ['1', '-1', 1],
    ['-2', '-1', -1],
    ['-1', '-2', 1],
    ['-0.5', '-0.25', -1],
    ['-0', '0', 0],
    ['0', '-0.0', 0],
    [1e21, '1000000000000000000000', 0],
    [1e-7, '0.0000001', 0],
    [TWENTY, '12345678901234567891', -1],
  ] as const)('compares %j with %j as %j', (a, b, order) => {
    expect(compareNumbers(a, b)).toBe(order)
    expect(sameNumber(a, b)).toBe(order === 0)
  })
})

describe('withoutTrailingZeros', () => {
  it.each([
    ['1.2500', '1.25'],
    ['000', ''],
    ['10', '1'],
    ['abc', 'abc'],
    ['', ''],
  ])('cuts the trailing zeros of %s', (text, expected) => {
    expect(withoutTrailingZeros(text)).toBe(expected)
  })
})
