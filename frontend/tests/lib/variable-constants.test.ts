/**
 * Tests for variable-constants.ts
 */

import { describe, it, expect } from 'vitest'
import {
  VARIABLE_NAME_PATTERN,
  MAX_VARIABLE_NAME_LENGTH,
} from '@/lib/field-constraints'

describe('VARIABLE_NAME_PATTERN', () => {
  it('accepts valid Python identifiers', () => {
    expect(VARIABLE_NAME_PATTERN.test('foo')).toBe(true)
    expect(VARIABLE_NAME_PATTERN.test('_bar')).toBe(true)
    expect(VARIABLE_NAME_PATTERN.test('my_var_1')).toBe(true)
    expect(VARIABLE_NAME_PATTERN.test('A')).toBe(true)
    expect(VARIABLE_NAME_PATTERN.test('__private')).toBe(true)
  })

  it('rejects invalid identifiers', () => {
    expect(VARIABLE_NAME_PATTERN.test('1foo')).toBe(false)
    expect(VARIABLE_NAME_PATTERN.test('my-var')).toBe(false)
    expect(VARIABLE_NAME_PATTERN.test('my var')).toBe(false)
    expect(VARIABLE_NAME_PATTERN.test('')).toBe(false)
    expect(VARIABLE_NAME_PATTERN.test('foo.bar')).toBe(false)
  })
})

describe('MAX_VARIABLE_NAME_LENGTH', () => {
  it('is 64', () => {
    expect(MAX_VARIABLE_NAME_LENGTH).toBe(64)
  })
})

