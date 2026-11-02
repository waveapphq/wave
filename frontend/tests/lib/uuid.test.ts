import { describe, it, expect, vi, afterEach } from 'vitest'

import { randomUUID } from '@/lib/uuid'

const V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const originalRandomUUID = crypto.randomUUID

afterEach(() => {
  crypto.randomUUID = originalRandomUUID
})

describe('randomUUID', () => {
  it('delegates to crypto.randomUUID when available', () => {
    crypto.randomUUID = vi.fn().mockReturnValue('native-uuid-value')
    expect(randomUUID()).toBe('native-uuid-value')
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
  })

  it('resolves crypto.randomUUID at call time so test stubs installed later apply', () => {
    crypto.randomUUID = vi.fn().mockReturnValue('late-stub-value')
    expect(randomUUID()).toBe('late-stub-value')
  })

  it('generates a v4 UUID via getRandomValues when crypto.randomUUID is unavailable', () => {
    // Insecure contexts (plain-HTTP LAN origins) omit randomUUID but keep getRandomValues.
    ;(crypto as { randomUUID?: () => string }).randomUUID = undefined
    const id = randomUUID()
    expect(id).toMatch(V4_PATTERN)
  })

  it('generates unique values in the fallback path', () => {
    ;(crypto as { randomUUID?: () => string }).randomUUID = undefined
    const ids = new Set(Array.from({ length: 100 }, () => randomUUID()))
    expect(ids.size).toBe(100)
  })

  it('sets the version and variant bits regardless of the random bytes drawn', () => {
    ;(crypto as { randomUUID?: () => string }).randomUUID = undefined
    const getRandomValues = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(0xff)
        return array
      })
    const id = randomUUID()
    expect(id).toMatch(V4_PATTERN)
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    getRandomValues.mockRestore()
  })
})
