/**
 * parseFilename Tests
 *
 * The file name a download is saved under, read from Content-Disposition:
 * the encoded form carries a name the quoted form cannot (REQ-4.6.9).
 *
 * Module: frontend/src/lib/download-file.ts
 */

import { describe, it, expect } from 'vitest'
import { parseFilename } from '@/lib/download-file'

function responseWith(disposition?: string): Response {
  const headers = new Headers()
  if (disposition !== undefined) headers.set('content-disposition', disposition)
  return new Response(null, { headers })
}

describe('parseFilename', () => {
  it('reads the encoded name when the header carries both forms', () => {
    const response = responseWith(
      'attachment; filename="Gre .yaml"; filename*=UTF-8\'\'Gr%C3%BC%C3%9Fe%20%E6%B8%AC%E8%A9%A6.yaml',
    )
    expect(parseFilename(response)).toBe('Grüße 測試.yaml')
  })

  it('reads the encoded name when it is the only form', () => {
    expect(parseFilename(responseWith("attachment; filename*=UTF-8''%E6%B8%AC%E8%A9%A6.zip"))).toBe('測試.zip')
  })

  it('reads the encoded name in any letter case of the parameter', () => {
    expect(parseFilename(responseWith("inline; FILENAME*=utf-8''a%20b.log"))).toBe('a b.log')
  })

  it('reads the quoted name when the header has no encoded form', () => {
    expect(parseFilename(responseWith('attachment; filename="run.log"'))).toBe('run.log')
  })

  it('falls back to the quoted name when the encoded form cannot be decoded', () => {
    const response = responseWith('attachment; filename="run.log"; filename*=UTF-8\'\'%E6%B8')
    expect(parseFilename(response)).toBe('run.log')
  })

  it('returns null when the encoded form cannot be decoded and there is no quoted name', () => {
    expect(parseFilename(responseWith("attachment; filename*=UTF-8''%E6%B8"))).toBeNull()
  })

  it('returns null when the header has no file name', () => {
    expect(parseFilename(responseWith('attachment'))).toBeNull()
  })

  it('returns null when the header is missing', () => {
    expect(parseFilename(responseWith())).toBeNull()
  })
})
