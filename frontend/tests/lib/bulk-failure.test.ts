/**
 * bulkFailureMessage - how a settled batch of writes is reported.
 *
 * Module: frontend/src/lib/bulk-failure.ts
 *
 * Nothing is reported when every call landed. When only some landed the
 * message says how many did before it gives the reason, so a partly
 * successful delete is never reported as a total failure.
 */

import { describe, it, expect } from 'vitest'
import { bulkFailureMessage } from '@/lib/bulk-failure'

const REMOVED = (done: number, total: number) => `${done} of ${total} artifacts were removed.`

const OK: PromiseSettledResult<unknown> = { status: 'fulfilled', value: undefined }

function failed(reason: unknown): PromiseSettledResult<unknown> {
  return { status: 'rejected', reason }
}

describe('bulkFailureMessage', () => {
  it('reports nothing for an empty batch', () => {
    expect(bulkFailureMessage([], REMOVED)).toBeNull()
  })

  it('reports nothing when every call landed', () => {
    expect(bulkFailureMessage([OK, OK], REMOVED)).toBeNull()
  })

  it('gives the reason on its own when every call failed', () => {
    expect(bulkFailureMessage([failed(new Error('gone')), failed(new Error('also gone'))], REMOVED))
      .toBe('gone')
  })

  it('names how many landed when only some failed', () => {
    const results = [OK, failed(new Error('gone')), OK]

    expect(bulkFailureMessage(results, REMOVED)).toBe(
      '2 of 3 artifacts were removed. The rest failed: gone',
    )
  })

  it('quotes the first reason when several failed', () => {
    const results = [OK, failed(new Error('first')), failed(new Error('second'))]

    expect(bulkFailureMessage(results, REMOVED)).toBe(
      '1 of 3 artifacts were removed. The rest failed: first',
    )
  })

  it('falls back to a generic reason when the rejection carries no message', () => {
    expect(bulkFailureMessage([failed({})], REMOVED)).toBe('Request failed')
  })
})
