/**
 * date-range helpers
 *
 * Parse / serialize round-trip for the `date` URL param and the
 * preset-to-API-window resolver used by the Executions list filter.
 */

import { describe, it, expect } from 'vitest'
import {
  parseDateRangeParam,
  serializeDateRange,
  resolveDateRange,
} from '@/lib/date-range'

describe('parseDateRangeParam', () => {
  it('defaults to all-time when param is null or empty', () => {
    expect(parseDateRangeParam(null)).toEqual({ kind: 'all-time' })
    expect(parseDateRangeParam('')).toEqual({ kind: 'all-time' })
  })

  it('parses known preset values', () => {
    expect(parseDateRangeParam('preset:last-7')).toEqual({
      kind: 'preset',
      preset: 'last-7',
    })
    expect(parseDateRangeParam('preset:today')).toEqual({
      kind: 'preset',
      preset: 'today',
    })
  })

  it('falls back to all-time on unknown preset', () => {
    expect(parseDateRangeParam('preset:bogus')).toEqual({ kind: 'all-time' })
  })

  it('parses custom ranges', () => {
    expect(parseDateRangeParam('custom:2026-04-01~2026-04-20')).toEqual({
      kind: 'custom',
      from: '2026-04-01',
      to: '2026-04-20',
    })
  })

  it('rejects malformed custom ranges', () => {
    // no separator, empty halves, and non-custom/non-preset prefixes all
    // fall back to all-time.
    expect(parseDateRangeParam('custom:2026-04-01')).toEqual({ kind: 'all-time' })
    expect(parseDateRangeParam('custom:~2026-04-20')).toEqual({ kind: 'all-time' })
    expect(parseDateRangeParam('custom:2026-04-01~')).toEqual({ kind: 'all-time' })
    expect(parseDateRangeParam('something-else')).toEqual({ kind: 'all-time' })
  })
})

describe('serializeDateRange', () => {
  it('returns null for all-time so the URL strips the param', () => {
    expect(serializeDateRange({ kind: 'all-time' })).toBeNull()
  })

  it('prefixes preset values', () => {
    expect(serializeDateRange({ kind: 'preset', preset: 'last-30' })).toBe(
      'preset:last-30',
    )
  })

  it('joins custom ranges with the ~ separator', () => {
    expect(
      serializeDateRange({
        kind: 'custom',
        from: '2026-04-01',
        to: '2026-04-20',
      }),
    ).toBe('custom:2026-04-01~2026-04-20')
  })
})

describe('resolveDateRange', () => {
  // Mid-day local-time anchor in summer (PDT, host TZ pinned in vite.config.ts).
  // 20:00 UTC = 13:00 PDT, well within the local 2026-07-15 calendar day, so
  // start/endOfDay computations don't span DST boundaries or wall-clock days.
  const NOW = new Date('2026-07-15T20:00:00Z')

  it('returns an empty window for all-time', () => {
    expect(resolveDateRange({ kind: 'all-time' }, NOW)).toEqual({})
  })

  it('passes custom range through as-is', () => {
    expect(
      resolveDateRange(
        { kind: 'custom', from: '2026-04-01', to: '2026-04-20' },
        NOW,
      ),
    ).toEqual({
      from_date: '2026-04-01',
      to_date: '2026-04-20',
    })
  })

  it('expands today to [00:00, 23:59]', () => {
    const result = resolveDateRange({ kind: 'preset', preset: 'today' }, NOW)
    expect(result.from_date).toBeDefined()
    expect(result.to_date).toBeDefined()
    // Endpoints are wall-clock midnight and end-of-day for the LOCAL calendar
    // day containing NOW, regardless of how that maps onto UTC.
    const from = new Date(result.from_date!)
    const to = new Date(result.to_date!)
    expect(from.getHours()).toBe(0)
    expect(from.getMinutes()).toBe(0)
    expect(from.getSeconds()).toBe(0)
    expect(to.getHours()).toBe(23)
    expect(to.getMinutes()).toBe(59)
    expect(to.getSeconds()).toBe(59)
    expect(from.getFullYear()).toBe(NOW.getFullYear())
    expect(from.getMonth()).toBe(NOW.getMonth())
    expect(from.getDate()).toBe(NOW.getDate())
    expect(to.getFullYear()).toBe(NOW.getFullYear())
    expect(to.getMonth()).toBe(NOW.getMonth())
    expect(to.getDate()).toBe(NOW.getDate())
  })

  it('computes the correct days-back window for each preset', () => {
    const last7 = resolveDateRange({ kind: 'preset', preset: 'last-7' }, NOW)
    const last30 = resolveDateRange({ kind: 'preset', preset: 'last-30' }, NOW)
    const last90 = resolveDateRange({ kind: 'preset', preset: 'last-90' }, NOW)

    const day = 24 * 60 * 60 * 1000
    expect(NOW.getTime() - new Date(last7.from_date!).getTime()).toBe(7 * day)
    expect(NOW.getTime() - new Date(last30.from_date!).getTime()).toBe(30 * day)
    expect(NOW.getTime() - new Date(last90.from_date!).getTime()).toBe(90 * day)

    // to_date is always "now"
    expect(last7.to_date).toBe(NOW.toISOString())
    expect(last30.to_date).toBe(NOW.toISOString())
    expect(last90.to_date).toBe(NOW.toISOString())
  })

  it('uses the current wall clock when no `now` is supplied', () => {
    const result = resolveDateRange({ kind: 'preset', preset: 'last-7' })
    expect(result.from_date).toBeDefined()
    expect(result.to_date).toBeDefined()
  })
})
