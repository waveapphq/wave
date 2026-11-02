/**
 * failure-detail - normalizing and rendering the context of a failed read.
 *
 * toFailureDetail reads an unknown thrown value structurally and never throws.
 * formatFailureDetail is the single source of the payload: the details panel
 * renders it and the copy control copies it.
 */

import { describe, it, expect } from 'vitest'

import { toFailureDetail, formatFailureDetail } from '@/lib/failure-detail'

const OCCURRED_AT = new Date(2026, 7, 10, 17, 42, 9).toISOString()

describe('toFailureDetail', () => {
  it('reads every field off an api-client error', () => {
    const error = Object.assign(new Error('Profile store unavailable'), {
      method: 'GET',
      path: '/environments/names',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 1421,
      requestId: '4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
      occurredAt: OCCURRED_AT,
    })

    expect(toFailureDetail(error)).toEqual({
      method: 'GET',
      path: '/environments/names',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 1421,
      requestId: '4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
      occurredAt: OCCURRED_AT,
      message: 'Profile store unavailable',
    })
  })

  it('leaves every absent field undefined on a bare Error', () => {
    expect(toFailureDetail(new Error('Network request failed'))).toEqual({
      method: undefined,
      path: undefined,
      status: undefined,
      statusText: undefined,
      durationMs: undefined,
      requestId: undefined,
      occurredAt: undefined,
      message: 'Network request failed',
    })
  })

  it('uses a thrown string as the message', () => {
    expect(toFailureDetail('something broke')).toEqual({ message: 'something broke' })
  })

  it('falls back for a blank string', () => {
    expect(toFailureDetail('   ')).toEqual({ message: 'Request failed' })
  })

  it('falls back for null', () => {
    expect(toFailureDetail(null)).toEqual({ message: 'Request failed' })
  })

  it('falls back for undefined', () => {
    expect(toFailureDetail(undefined)).toEqual({ message: 'Request failed' })
  })

  it('falls back for a non-object primitive', () => {
    expect(toFailureDetail(42)).toEqual({ message: 'Request failed' })
  })

  it('falls back when the object carries no message', () => {
    expect(toFailureDetail({ status: 503 }).message).toBe('Request failed')
  })

  it('ignores an empty-string message', () => {
    expect(toFailureDetail({ message: '' }).message).toBe('Request failed')
  })

  it('ignores fields carrying the wrong type', () => {
    const detail = toFailureDetail({
      method: 7,
      path: null,
      status: '500',
      statusText: '',
      durationMs: Number.NaN,
      requestId: {},
      occurredAt: false,
      message: 'Broken',
    })

    expect(detail).toEqual({
      method: undefined,
      path: undefined,
      status: undefined,
      statusText: undefined,
      durationMs: undefined,
      requestId: undefined,
      occurredAt: undefined,
      message: 'Broken',
    })
  })

  it('never throws when a field getter throws', () => {
    const hostile = {}
    Object.defineProperty(hostile, 'message', {
      enumerable: true,
      get() {
        throw new Error('hostile getter')
      },
    })

    expect(() => toFailureDetail(hostile)).not.toThrow()
    expect(toFailureDetail(hostile)).toEqual({ message: 'Request failed' })
  })
})

describe('formatFailureDetail', () => {
  it('emits the full payload, one field per line, then the message', () => {
    const payload = formatFailureDetail({
      method: 'GET',
      path: '/environments/names',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 1421,
      requestId: '4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
      occurredAt: OCCURRED_AT,
      message: 'Profile store unavailable',
    })

    expect(payload).toBe(
      [
        'GET  /environments/names',
        '500  Internal Server Error',
        '1421 ms',
        'request 4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
        '17:42:09 local',
        '',
        'Profile store unavailable',
      ].join('\n')
    )
  })

  it('pads the method to four characters so the paths line up', () => {
    expect(formatFailureDetail({ method: 'POST', path: '/profiles', message: 'x' })).toContain(
      'POST /profiles'
    )
    expect(formatFailureDetail({ method: 'PUT', path: '/profiles', message: 'x' })).toContain(
      'PUT  /profiles'
    )
  })

  it('keeps the message verbatim, including a multi-line trace', () => {
    const message = 'OSError: [Errno 5]\nTraceback (most recent call last):\n  File "routes.py"'
    expect(formatFailureDetail({ status: 500, message })).toBe(`500\n\n${message}`)
  })

  it('omits the status line entirely when there is no status', () => {
    const payload = formatFailureDetail({
      method: 'GET',
      path: '/environments/names',
      statusText: 'Internal Server Error',
      message: 'Failed to fetch',
    })

    expect(payload).toBe('GET  /environments/names\n\nFailed to fetch')
  })

  it('prints the status alone when there is no reason', () => {
    expect(formatFailureDetail({ status: 502, message: 'Bad gateway' })).toBe('502\n\nBad gateway')
  })

  it('prints the path alone when there is no method', () => {
    expect(formatFailureDetail({ path: '/environments/names', message: 'x' })).toBe(
      '/environments/names\n\nx'
    )
  })

  it('prints the method alone when there is no path', () => {
    expect(formatFailureDetail({ method: 'GET', message: 'x' })).toBe('GET\n\nx')
  })

  it('omits the duration line when there is no duration', () => {
    expect(formatFailureDetail({ requestId: 'abc', message: 'x' })).toBe('request abc\n\nx')
  })

  it('renders a sub-second duration without padding', () => {
    expect(formatFailureDetail({ durationMs: 12, message: 'x' })).toBe('12 ms\n\nx')
  })

  it('renders occurredAt as local wall-clock time', () => {
    const payload = formatFailureDetail({
      occurredAt: new Date(2026, 0, 2, 3, 4, 5).toISOString(),
      message: 'x',
    })

    expect(payload).toBe('03:04:05 local\n\nx')
  })

  it('omits the time line when occurredAt is not a real date', () => {
    expect(formatFailureDetail({ occurredAt: 'not-a-date', message: 'x' })).toBe('x')
  })

  it('returns the message alone when no field is present', () => {
    expect(formatFailureDetail({ message: 'Failed to fetch' })).toBe('Failed to fetch')
  })
})
