/**
 * Tests for variable-defaults.ts
 */

import { describe, it, expect } from 'vitest'
import { getDefaultValueForType } from '@/lib/variable-defaults'

describe('getDefaultValueForType', () => {
  it.each([
    ['string', ''],
    ['integer', 0],
    ['float', 0],
    ['boolean', false],
  ] as const)('returns %s default: %j', (type, expected) => {
    expect(getDefaultValueForType(type)).toBe(expected)
  })

  it.each([
    ['array', []],
    ['map', {}],
    ['table', []],
  ] as const)('returns fresh %s instance each call', (type, expected) => {
    const a = getDefaultValueForType(type)
    const b = getDefaultValueForType(type)
    expect(a).toEqual(expected)
    expect(a).not.toBe(b)
  })
})
