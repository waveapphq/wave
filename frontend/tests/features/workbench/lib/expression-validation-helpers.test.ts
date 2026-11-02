import { describe, expect, it } from 'vitest'
import { isKnownIdentifier, collectLocalNames } from '@/features/workbench/lib/expression-validation/validation-helpers'
import type { ValidationContext } from '@/features/workbench/lib/expression-validation/validation-context'

function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    availableVariableNames: new Set<string>(),
    allowedBuiltinNames: new Set<string>(),
    blockedBuiltinNames: new Set<string>(),
    fieldBlockedBuiltinNames: new Set<string>(),
    ...overrides,
  }
}

describe('isKnownIdentifier', () => {
  it('returns true for an available variable', () => {
    const ctx = makeContext({ availableVariableNames: new Set(['my_var']) })
    expect(isKnownIdentifier('my_var', ctx)).toBe(true)
  })

  it('returns true for an allowed builtin', () => {
    const ctx = makeContext({ allowedBuiltinNames: new Set(['len']) })
    expect(isKnownIdentifier('len', ctx)).toBe(true)
  })

  it('returns true for a blocked builtin', () => {
    const ctx = makeContext({ blockedBuiltinNames: new Set(['eval']) })
    expect(isKnownIdentifier('eval', ctx)).toBe(true)
  })

  it('returns false for a completely unknown identifier', () => {
    const ctx = makeContext()
    expect(isKnownIdentifier('unknown_thing', ctx)).toBe(false)
  })

  it('checks all three sets independently', () => {
    const ctx = makeContext({
      availableVariableNames: new Set(['a']),
      allowedBuiltinNames: new Set(['b']),
      blockedBuiltinNames: new Set(['c']),
    })
    expect(isKnownIdentifier('a', ctx)).toBe(true)
    expect(isKnownIdentifier('b', ctx)).toBe(true)
    expect(isKnownIdentifier('c', ctx)).toBe(true)
    expect(isKnownIdentifier('d', ctx)).toBe(false)
  })
})

describe('collectLocalNames', () => {
  it('returns empty sets for a simple expression without scopes', () => {
    const result = collectLocalNames('x + y')
    expect(result.localVariables.size).toBe(0)
    expect(result.kwargNames.size).toBe(0)
  })

  it('collects comprehension variables', () => {
    const result = collectLocalNames('[item for item in data]')
    expect(result.localVariables.has('item')).toBe(true)
  })

  it('collects keyword argument names', () => {
    const result = collectLocalNames('sorted(data, key=lambda x: x)')
    expect(result.kwargNames.has('key')).toBe(true)
  })

  it('collects both local variables and kwargs from a complex expression', () => {
    const result = collectLocalNames('sorted([x for x in items], key=lambda v: v)')
    expect(result.localVariables.has('x')).toBe(true)
    expect(result.kwargNames.has('key')).toBe(true)
  })

  it('returns sets (not arrays) for efficient lookup', () => {
    const result = collectLocalNames('x + 1')
    expect(result.localVariables).toBeInstanceOf(Set)
    expect(result.kwargNames).toBeInstanceOf(Set)
  })
})
