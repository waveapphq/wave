/** Tests for the Variable Setter row checks: name (VARSET-8) and expression (REQ-3.4.3.8). */

import { describe, it, expect } from 'vitest'

import {
  validateExpression,
  validateName,
  validateRow,
} from '@/features/workbench/common/variables/variable-setter-editor/validation'
import type {
  AvailableVariable,
  VariableRow,
} from '@/features/workbench/common/variables/variable-setter-editor/types'
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'

describe('validateName - Function input read-only guard', () => {
  it('rejects a name matching a Function input', () => {
    const vars = [{ name: 'x', type: 'string', source: 'Function input' }] as AvailableVariable[]
    const result = validateName('x', ['x'], 0, vars)
    expect(result.error).toBe("'x' is a Function input and is read-only inside the body")
  })

  it('allows a name matching a writable (non-input) variable', () => {
    const vars = [{ name: 'x', type: 'string', source: 'Function output' }] as AvailableVariable[]
    const result = validateName('x', ['x'], 0, vars)
    expect(result.error).toBeNull()
  })
})

describe('validateExpression - an expression row needs an expression (REQ-3.4.3.8)', () => {
  it.each([
    ['empty text', ''],
    ['spaces only', '   '],
    ['a stored null', null],
    ['no value', undefined],
  ])('refuses %s with "Expression is required"', (_label, value) => {
    expect(validateExpression(value)).toEqual({ error: 'Expression is required' })
  })

  it('accepts an expression', () => {
    expect(validateExpression('attempt + 1')).toEqual({ error: null })
  })

  it('accepts an expression that gives null', () => {
    expect(validateExpression('None')).toEqual({ error: null })
  })
})

// A literal number row keeps the one number rule (REQ-3.1.3.14).
describe('validateRow - a literal number row', () => {
  const row = (type: string, value: unknown): VariableRow => ({
    key: 'k',
    name: 'retries',
    value,
    type,
    isExpression: false,
  })
  const valueError = (type: string, value: unknown) => validateRow(row(type, value), ['retries'], 0, []).error

  it.each([
    ['integer', '-', 'Enter a valid integer value'],
    ['float', '1.', 'Enter a valid float value'],
  ])('names unfinished %s text %j with the window message', (type, value, message) => {
    expect(valueError(type, value)).toBe(message)
  })

  it('names an integer past 19 digits, as text or as a JS number', () => {
    expect(valueError('integer', '12345678901234567890')).toBe('Maximum 19 digits')
    expect(valueError('integer', 1e21)).toBe('Maximum 19 digits')
  })

  it('names a JS number that is no whole number in an integer row', () => {
    expect(valueError('integer', 2.5)).toBe('Integer cannot contain decimal point')
  })

  it('takes a JS number in plain digits and exact digit text', () => {
    expect(valueError('float', 0.0000001)).toBeNull()
    expect(valueError('integer', '9007199254740993')).toBeNull()
  })

  it.each([
    ['integer', ' 30 ', 'Must be a valid integer'],
    ['float', '2.5 ', 'Must be a valid number'],
  ])('names %s text with a space around its digits as no number, as the server does', (type, value, message) => {
    expect(valueError(type, value)).toBe(message)
  })

  it('leaves a stored null, a sealed secret and another type alone', () => {
    expect(valueError('integer', null)).toBeNull()
    expect(valueError('integer', MASK_PLACEHOLDER)).toBeNull()
    expect(valueError('string', '-')).toBeNull()
  })
})
