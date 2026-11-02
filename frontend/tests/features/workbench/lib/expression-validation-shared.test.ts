/**
 * Shared Validators Tests
 *
 * Tests for the shared validateMethodCalls and validateIdentifiers functions
 * used by both validate-complex.ts and validate-function-call.ts.
 */

import { describe, it, expect } from 'vitest'
import { validateMethodCalls, validateIdentifiers } from '@/features/workbench/lib/expression-validation/shared-validators'
import { buildValidationContext } from '@/features/workbench/lib/expression-validation/validation-context'

function makeCtx(vars: string[] = [], opts?: { isField?: boolean }) {
  return buildValidationContext(
    new Set(vars),
    undefined,
    opts?.isField,
  )
}

describe('validateMethodCalls', () => {
  it('returns null for valid method calls', () => {
    const ctx = makeCtx(['my_list'])
    // "upper" is a valid string method
    const result = validateMethodCalls('my_list.upper()', 0, 16, ctx)
    expect(result).toBeNull()
  })

  it('returns issue for invalid method name', () => {
    const ctx = makeCtx(['x'])
    const result = validateMethodCalls('x.nonexistent_method()', 0, 22, ctx)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('invalid_function')
    expect(result!.message).toContain('nonexistent_method')
    expect(result!.message).toContain('is not a valid method')
  })

  it('returns issue for field-blocked method in field expression', () => {
    const ctx = makeCtx(['my_list'], { isField: true })
    // "append" modifies data and should be blocked in field expressions
    const result = validateMethodCalls('my_list.append(1)', 0, 17, ctx)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('blocked_function')
    expect(result!.message).toContain('modifies data')
    expect(result!.message).toContain('not allowed in field expressions')
  })

  it('allows mutation methods in non-field expressions', () => {
    const ctx = makeCtx(['my_list'], { isField: false })
    const result = validateMethodCalls('my_list.append(1)', 0, 17, ctx)
    expect(result).toBeNull()
  })

  it('validates argument count when checkArgCount is true', () => {
    const ctx = makeCtx(['s'])
    // "center" requires at least 1 argument: str.center(width[, fillchar])
    const result = validateMethodCalls('s.center()', 0, 10, ctx, { checkArgCount: true })
    expect(result).not.toBeNull()
    expect(result!.type).toBe('invalid_function')
    expect(result!.message).toContain('center')
    expect(result!.message).toContain('got 0')
  })

  it('skips argument count check when checkArgCount is not set', () => {
    const ctx = makeCtx(['s'])
    // Without checkArgCount, the wrong arg count should NOT produce an error
    const result = validateMethodCalls('s.center()', 0, 10, ctx)
    expect(result).toBeNull()
  })

  it('returns null for empty expression with no method calls', () => {
    const ctx = makeCtx(['x'])
    const result = validateMethodCalls('x + 1', 0, 5, ctx)
    expect(result).toBeNull()
  })
})

describe('validateIdentifiers', () => {
  it('returns empty array for known variables', () => {
    const ctx = makeCtx(['my_var', 'other_var'])
    const result = validateIdentifiers('my_var + other_var', 0, 18, ctx)
    expect(result).toEqual([])
  })

  it('returns issue for unknown variable with default label', () => {
    const ctx = makeCtx(['totally_different'])
    const result = validateIdentifiers('zzz_mystery', 0, 11, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('unknown_variable')
    expect(result[0].message).toBe("Identifier 'zzz_mystery' is not defined")
    expect(result[0].identifier).toBe('zzz_mystery')
  })

  it('uses custom identifierLabel in error messages', () => {
    const ctx = makeCtx(['totally_different'])
    const result = validateIdentifiers('zzz_mystery', 0, 11, ctx, { identifierLabel: 'Variable' })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe("Variable 'zzz_mystery' is not defined")
  })

  it('provides suggestion for similar variable names', () => {
    const ctx = makeCtx(['message'])
    const result = validateIdentifiers('mssage', 0, 6, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].suggestion).toBe('message')
    expect(result[0].message).toContain("Did you mean 'message'")
  })

  it('provides suggestion with custom label', () => {
    const ctx = makeCtx(['message'])
    const result = validateIdentifiers('mssage', 0, 6, ctx, { identifierLabel: 'Variable' })
    expect(result).toHaveLength(1)
    expect(result[0].message).toContain("Variable 'mssage' not defined")
    expect(result[0].message).toContain("Did you mean 'message'")
  })

  it('skips duplicate identifiers', () => {
    const ctx = makeCtx([])
    const result = validateIdentifiers('x + x', 0, 5, ctx)
    // Only one issue for 'x', not two
    expect(result).toHaveLength(1)
    expect(result[0].identifier).toBe('x')
  })

  it('skips known builtin names', () => {
    const ctx = makeCtx([])
    // "len" is a known builtin
    const result = validateIdentifiers('len', 0, 3, ctx)
    expect(result).toEqual([])
  })

  it('skips local variables from lambda/comprehension scopes', () => {
    const ctx = makeCtx(['data'])
    // 'x' is a local variable in the comprehension
    const result = validateIdentifiers('[x for x in data]', 0, 18, ctx)
    expect(result).toEqual([])
  })

  it('skips keyword argument names', () => {
    const ctx = makeCtx(['data'])
    // 'key' is a keyword argument name, not a variable reference
    const result = validateIdentifiers('sorted(data, key=lambda x: x)', 0, 30, ctx)
    expect(result).toEqual([])
  })

  it('returns multiple issues for multiple unknown identifiers', () => {
    const ctx = makeCtx([])
    const result = validateIdentifiers('abc + xyz', 0, 9, ctx)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const identifiers = result.map(r => r.identifier)
    expect(identifiers).toContain('abc')
    expect(identifiers).toContain('xyz')
  })
})
