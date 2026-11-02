/**
 * Tests for use-variable-name-validation.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  validateVariableName,
  useVariableNameValidation,
} from '@/features/workbench/hooks/use-variable-name-validation'

describe('validateVariableName - profile alias conflict', () => {
  it('flags a name that collides with a visible profile alias', () => {
    const conflictingAliases = new Map([['db_host', 'Profile: staging']])
    expect(validateVariableName('db_host', { conflictingAliases })).toBe(
      "'db_host' conflicts with profile alias from Profile: staging",
    )
  })

  it('does not flag the alias collision for the variable being renamed itself', () => {
    const conflictingAliases = new Map([['db_host', 'Profile: staging']])
    expect(
      validateVariableName('db_host', { conflictingAliases, variableName: 'db_host' }),
    ).toBeNull()
  })
})

describe('validateVariableName', () => {
  it('returns error for empty name', () => {
    expect(validateVariableName('')).toBe('Name is required')
    expect(validateVariableName('   ')).toBe('Name is required')
  })

  it('returns error for name exceeding max length', () => {
    const longName = 'a'.repeat(65)
    expect(validateVariableName(longName)).toBe('Name must be 64 characters or fewer')
  })

  it('returns error for invalid pattern', () => {
    expect(validateVariableName('1abc')).toBe(
      'Variable name must start with letter/underscore, contain only letters, numbers, underscores'
    )
    expect(validateVariableName('my-var')).toBe(
      'Variable name must start with letter/underscore, contain only letters, numbers, underscores'
    )
  })

  it('returns error for Python keyword', () => {
    expect(validateVariableName('if')).toBe('"if" is a Python keyword')
    expect(validateVariableName('for')).toBe('"for" is a Python keyword')
    expect(validateVariableName('class')).toBe('"class" is a Python keyword')
  })

  it('returns error for reserved namespace keyword', () => {
    expect(validateVariableName('system')).toBe(
      '"system" is reserved for namespace access. Use system.field_name in expressions.'
    )
    expect(validateVariableName('suite')).toBe(
      '"suite" is reserved for namespace access. Use suite.field_name in expressions.'
    )
    expect(validateVariableName('regression')).toBe(
      '"regression" is reserved for namespace access. Use regression.field_name in expressions.'
    )
  })

  it('returns null for valid name', () => {
    expect(validateVariableName('my_var')).toBeNull()
    expect(validateVariableName('_private')).toBeNull()
    expect(validateVariableName('Var123')).toBeNull()
  })

  it('rejects names with leading or trailing whitespace', () => {
    expect(validateVariableName('  my_var')).toBe('Name cannot have leading or trailing whitespace')
    expect(validateVariableName('my_var  ')).toBe('Name cannot have leading or trailing whitespace')
    expect(validateVariableName('  my_var  ')).toBe('Name cannot have leading or trailing whitespace')
  })

  it('returns error when name already exists', () => {
    const nameExists = vi.fn().mockReturnValue(true)
    expect(
      validateVariableName('taken', {
        variableId: 'v1',
        nameExists,
      })
    ).toBe('A variable with this name already exists')
    expect(nameExists).toHaveBeenCalledWith('taken', 'v1')
  })

  it('skips duplicate check when name matches current variableName', () => {
    const nameExists = vi.fn().mockReturnValue(true)
    expect(
      validateVariableName('current', {
        variableName: 'current',
        variableId: 'v1',
        nameExists,
      })
    ).toBeNull()
    expect(nameExists).not.toHaveBeenCalled()
  })

  it('skips duplicate check when variableId is not provided', () => {
    const nameExists = vi.fn().mockReturnValue(true)
    expect(
      validateVariableName('taken', {
        nameExists,
      })
    ).toBeNull()
    expect(nameExists).not.toHaveBeenCalled()
  })

  it('skips duplicate check when nameExists is not provided', () => {
    expect(
      validateVariableName('taken', {
        variableId: 'v1',
      })
    ).toBeNull()
  })

  it('accepts a name at exactly max length', () => {
    const exactName = 'a'.repeat(64)
    expect(validateVariableName(exactName)).toBeNull()
  })
})

const PARAMETER_RULE = 'Parameter name must start with a letter, contain only letters, numbers, underscores'

describe('validateVariableName - an input or output name starts with a letter (REQ-3.1.2.4)', () => {
  it.each(['_id', '_', '__private'])('refuses %j for a parameter', (name) => {
    expect(validateVariableName(name, { parameter: true })).toBe(PARAMETER_RULE)
  })

  it.each(['1abc', 'my-var', 'has space'])('reads the parameter rule for %j, which fails the name pattern', (name) => {
    expect(validateVariableName(name, { parameter: true })).toBe(PARAMETER_RULE)
  })

  it.each(['region', 'Var1', 'a_b_9'])('accepts %j for a parameter', (name) => {
    expect(validateVariableName(name, { parameter: true })).toBeNull()
  })

  it('still accepts a leading underscore for a variable', () => {
    expect(validateVariableName('_id', { parameter: false })).toBeNull()
  })

  it.each([
    ['', 'Name is required'],
    [' region', 'Name cannot have leading or trailing whitespace'],
    ['a'.repeat(65), 'Name must be 64 characters or fewer'],
    ['class', '"class" is a Python keyword'],
    ['suite', '"suite" is reserved for namespace access. Use suite.field_name in expressions.'],
  ])('keeps the other checks for a parameter: %j reads %s', (name, error) => {
    expect(validateVariableName(name, { parameter: true })).toBe(error)
  })

  it('keeps the name check for a parameter', () => {
    const nameExists = vi.fn().mockReturnValue(true)
    expect(validateVariableName('loc_n', { parameter: true, variableId: 'p1', nameExists })).toBe(
      'A variable with this name already exists',
    )
  })
})

describe('useVariableNameValidation', () => {
  it('returns a validateName callback that delegates to validateVariableName', () => {
    const { result } = renderHook(() => useVariableNameValidation())
    expect(result.current.validateName('')).toBe('Name is required')
    expect(result.current.validateName('my_var')).toBeNull()
  })

  it('passes options through to validateVariableName', () => {
    const nameExists = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() =>
      useVariableNameValidation({
        variableName: 'old_name',
        variableId: 'v1',
        nameExists,
      })
    )
    expect(result.current.validateName('new_name')).toBe(
      'A variable with this name already exists'
    )
    // Same name as current - should pass
    expect(result.current.validateName('old_name')).toBeNull()
  })

  it('memoizes the callback (same reference on re-render)', () => {
    const { result, rerender } = renderHook(() => useVariableNameValidation())
    const first = result.current.validateName
    rerender()
    expect(result.current.validateName).toBe(first)
  })
})
