/**
 * Tests for output-binding-rules.
 */

import { describe, it, expect } from 'vitest'
import {
  isOutputBindable,
  describeBindingRejection,
} from '@/features/workbench/lib/validation/output-binding-rules'

describe('isOutputBindable', () => {
  it('accepts a valid Python identifier', () => {
    expect(isOutputBindable('my_var')).toBe(true)
    expect(isOutputBindable('_alpha')).toBe(true)
    expect(isOutputBindable('var123')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isOutputBindable('')).toBe(false)
  })

  it('rejects a name starting with a digit', () => {
    expect(isOutputBindable('123abc')).toBe(false)
  })

  it('rejects a name with a hyphen', () => {
    expect(isOutputBindable('bad-name')).toBe(false)
  })

  it('rejects a dotted reference (system.foo)', () => {
    expect(isOutputBindable('system.foo')).toBe(false)
  })

  it('rejects the reserved namespace placeholders', () => {
    expect(isOutputBindable('system')).toBe(false)
    expect(isOutputBindable('suite')).toBe(false)
    expect(isOutputBindable('regression')).toBe(false)
  })
})

describe('describeBindingRejection', () => {
  it('returns null for an acceptable name', () => {
    expect(describeBindingRejection('my_var')).toBeNull()
  })

  it('returns null for an empty string', () => {
    // The combobox treats empty as "no binding" - the row's null binding is
    // separate from a rejected typed value.
    expect(describeBindingRejection('')).toBeNull()
  })

  it('describes the namespace rejection for a reserved name', () => {
    const msg = describeBindingRejection('system')
    expect(msg).toMatch(/read-only namespace/)
  })

  it('describes the dotted-reference rejection', () => {
    const msg = describeBindingRejection('system.foo')
    expect(msg).toMatch(/namespace or profile reference/)
  })

  it('describes the invalid-identifier rejection', () => {
    const msg = describeBindingRejection('123-bad')
    expect(msg).toMatch(/not a valid variable name/)
  })
})
