/**
 * Tests for the centralized timestamp formatter.
 *
 * User-selectable Time Zone for UI timestamps.
 *
 * Vitest config pins TZ=America/Los_Angeles so browser-local mode produces
 * PDT (summer) / PST (winter) deterministically. Tests that need an unambiguous
 * abbreviation pick a date in the corresponding season.
 */

import { describe, it, expect } from 'vitest'
import { formatTimestamp, formatPublishedDate } from '@/lib/timestamp-format'

// Summer: 2026-07-15 - America/Los_Angeles is UTC-7 (PDT)
const SUMMER_UTC_ISO = '2026-07-15T18:32:14.027Z' // 11:32 PDT, 18:32 UTC
// Winter: 2026-01-15 - America/Los_Angeles is UTC-8 (PST)
const WINTER_UTC_ISO = '2026-01-15T18:32:14.027Z' // 10:32 PST, 18:32 UTC

describe('formatPublishedDate', () => {
  it('formats a full ISO timestamp as a UTC calendar date with no zone token', () => {
    expect(formatPublishedDate('2026-06-03T18:10:17Z')).toBe('Jun 3, 2026')
  })

  it('formats a date-only string', () => {
    expect(formatPublishedDate('2026-03-17')).toBe('Mar 17, 2026')
  })

  it.each([null, undefined, ''])('returns "" for %s', (value) => {
    expect(formatPublishedDate(value)).toBe('')
  })

  it('returns "" for an unparsable string', () => {
    expect(formatPublishedDate('not-a-date')).toBe('')
  })
})

describe('formatTimestamp', () => {
  describe('null / undefined / invalid input', () => {
    it.each(['time', 'datetime', 'date'] as const)(
      'returns "-" for null with style=%s',
      (style) => {
        expect(formatTimestamp(null, style, 'local')).toBe('-')
      }
    )

    it.each(['time', 'datetime', 'date'] as const)(
      'returns "-" for undefined with style=%s',
      (style) => {
        expect(formatTimestamp(undefined, style, 'local')).toBe('-')
      }
    )

    it('returns the original input when given an unparsable string', () => {
      expect(formatTimestamp('not-a-date', 'datetime', 'local')).toBe('not-a-date')
    })

    it.each(['time', 'datetime', 'date'] as const)(
      'returns "-" for empty string with style=%s (treated as missing)',
      (style) => {
        expect(formatTimestamp('', style, 'local')).toBe('-')
      }
    )

    it("returns 'Never' for empty string under style='relative'", () => {
      expect(formatTimestamp('', 'relative', 'local')).toBe('Never')
    })
  })

  describe("style='time' (HH:MM:SS.mmm + zone suffix)", () => {
    it('renders local time with PDT suffix in summer', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'time', 'local')).toBe('11:32:14.027 PDT')
    })

    it('renders local time with PST suffix in winter', () => {
      expect(formatTimestamp(WINTER_UTC_ISO, 'time', 'local')).toBe('10:32:14.027 PST')
    })

    it('renders UTC time with UTC suffix regardless of season', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'time', 'utc')).toBe('18:32:14.027 UTC')
      expect(formatTimestamp(WINTER_UTC_ISO, 'time', 'utc')).toBe('18:32:14.027 UTC')
    })

    it('zero-pads hours, minutes, seconds, and milliseconds', () => {
      // 04:05:06.007 UTC
      expect(formatTimestamp('2026-07-15T04:05:06.007Z', 'time', 'utc')).toBe(
        '04:05:06.007 UTC'
      )
    })
  })

  describe("style='datetime' (MMM d, HH:MM + zone suffix)", () => {
    it('renders local datetime with PDT suffix in summer', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'datetime', 'local')).toBe('Jul 15, 11:32 PDT')
    })

    it('renders local datetime with PST suffix in winter', () => {
      expect(formatTimestamp(WINTER_UTC_ISO, 'datetime', 'local')).toBe('Jan 15, 10:32 PST')
    })

    it('renders UTC datetime with UTC suffix', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'datetime', 'utc')).toBe('Jul 15, 18:32 UTC')
    })

    it('zero-pads single-digit hours and minutes', () => {
      // 2026-07-15 04:05 UTC
      expect(formatTimestamp('2026-07-15T04:05:00.000Z', 'datetime', 'utc')).toBe(
        'Jul 15, 04:05 UTC'
      )
    })
  })

  describe("style='full' (YYYY-MM-DD HH:MM:SS + zone suffix, report document style)", () => {
    it('renders local full datetime with PDT suffix in summer', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'full', 'local')).toBe('2026-07-15 11:32:14 PDT')
    })

    it('renders local full datetime with PST suffix in winter', () => {
      expect(formatTimestamp(WINTER_UTC_ISO, 'full', 'local')).toBe('2026-01-15 10:32:14 PST')
    })

    it('renders UTC full datetime with UTC suffix', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'full', 'utc')).toBe('2026-07-15 18:32:14 UTC')
    })

    it('zero-pads month, day, hours, minutes, and seconds', () => {
      expect(formatTimestamp('2026-03-05T04:05:06.000Z', 'full', 'utc')).toBe(
        '2026-03-05 04:05:06 UTC'
      )
    })
  })

  describe("style='date' (MMM d, YYYY + zone suffix)", () => {
    it('renders local date with PDT suffix in summer', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'date', 'local')).toBe('Jul 15, 2026 PDT')
    })

    it('renders local date with PST suffix in winter', () => {
      expect(formatTimestamp(WINTER_UTC_ISO, 'date', 'local')).toBe('Jan 15, 2026 PST')
    })

    it('renders UTC date with UTC suffix', () => {
      expect(formatTimestamp(SUMMER_UTC_ISO, 'date', 'utc')).toBe('Jul 15, 2026 UTC')
    })

    it('renders the UTC calendar day in UTC mode even when local mode would give the prior day', () => {
      // 2026-07-16T02:00:00Z = 2026-07-15 19:00 PDT (prior calendar day)
      const iso = '2026-07-16T02:00:00.000Z'
      expect(formatTimestamp(iso, 'date', 'local')).toBe('Jul 15, 2026 PDT')
      expect(formatTimestamp(iso, 'date', 'utc')).toBe('Jul 16, 2026 UTC')
    })
  })

  describe("style='relative' (timezone-agnostic arithmetic with date-style fallback)", () => {
    // All relative tests pin `now` so the deltas are deterministic regardless of host clock.
    const NOW = new Date('2026-07-15T18:32:14.027Z')

    it('returns "just now" for deltas under 60 seconds', () => {
      const iso = '2026-07-15T18:31:30.000Z' // 44 sec ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('just now')
      expect(formatTimestamp(iso, 'relative', 'utc', NOW)).toBe('just now')
    })

    it('returns "N min ago" for deltas under 60 minutes', () => {
      const iso = '2026-07-15T18:29:00.000Z' // 3 min ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('3 min ago')
    })

    it('returns "1 hour ago" for exactly one-hour delta (singular)', () => {
      const iso = '2026-07-15T17:30:00.000Z' // ~1 hour ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('1 hour ago')
    })

    it('returns "N hours ago" for multi-hour deltas (plural)', () => {
      const iso = '2026-07-15T15:30:00.000Z' // ~3 hours ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('3 hours ago')
    })

    it('returns "yesterday" for exactly 1-day delta', () => {
      const iso = '2026-07-14T18:00:00.000Z' // ~1 day ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('yesterday')
    })

    it('returns "N days ago" for 2-6 day deltas', () => {
      const iso = '2026-07-12T18:00:00.000Z' // ~3 days ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('3 days ago')
    })

    it('falls back to date style with PDT suffix for >7-day deltas in local mode', () => {
      const iso = '2026-06-15T18:00:00.000Z' // ~30 days ago
      expect(formatTimestamp(iso, 'relative', 'local', NOW)).toBe('Jun 15, 2026 PDT')
    })

    it('falls back to date style with UTC suffix for >7-day deltas in UTC mode', () => {
      const iso = '2026-06-15T18:00:00.000Z'
      expect(formatTimestamp(iso, 'relative', 'utc', NOW)).toBe('Jun 15, 2026 UTC')
    })

    it("returns 'Never' for null/undefined input under relative style", () => {
      expect(formatTimestamp(null, 'relative', 'local', NOW)).toBe('Never')
      expect(formatTimestamp(undefined, 'relative', 'local', NOW)).toBe('Never')
    })
  })

  describe("style='picker' (MMM d, YYYY @ HH:MM:SS in UTC, no zone token)", () => {
    it('renders the OpenSearch time picker wording in UTC', () => {
      expect(formatTimestamp('2026-09-25T10:42:05Z', 'picker', 'utc')).toBe('Sep 25, 2026 @ 10:42:05')
    })

    it('renders UTC in local mode too, with no zone token', () => {
      expect(formatTimestamp('2026-09-25T10:42:05Z', 'picker', 'local')).toBe('Sep 25, 2026 @ 10:42:05')
      expect(formatTimestamp(WINTER_UTC_ISO, 'picker', 'local')).toBe('Jan 15, 2026 @ 18:32:14.027')
    })

    it('renders the UTC calendar day even when the local zone is on the day before', () => {
      // 2026-07-16T02:00:00Z = 2026-07-15 19:00 PDT
      expect(formatTimestamp('2026-07-16T02:00:00.000Z', 'picker', 'local')).toBe('Jul 16, 2026 @ 02:00:00')
      expect(formatTimestamp('2026-07-16T02:00:00.000Z', 'picker', 'utc')).toBe('Jul 16, 2026 @ 02:00:00')
    })

    it('adds the milliseconds only when they are not zero', () => {
      expect(formatTimestamp('2026-09-25T10:42:05.000Z', 'picker', 'utc')).toBe('Sep 25, 2026 @ 10:42:05')
      expect(formatTimestamp('2026-09-25T10:42:05.123Z', 'picker', 'utc')).toBe('Sep 25, 2026 @ 10:42:05.123')
    })

    it('zero-pads the time and the milliseconds but not the day', () => {
      expect(formatTimestamp('2026-03-05T04:05:06.007Z', 'picker', 'utc')).toBe('Mar 5, 2026 @ 04:05:06.007')
      expect(formatTimestamp('2026-03-05T04:05:06.500Z', 'picker', 'utc')).toBe('Mar 5, 2026 @ 04:05:06.500')
    })

    it('converts an offset timestamp to UTC', () => {
      expect(formatTimestamp('2026-09-25T12:42:05+02:00', 'picker', 'local')).toBe('Sep 25, 2026 @ 10:42:05')
    })

    it.each([null, undefined, ''])('returns "-" for %j', (value) => {
      expect(formatTimestamp(value, 'picker', 'utc')).toBe('-')
    })

    it('returns the original input when given an unparsable string', () => {
      expect(formatTimestamp('not-a-date', 'picker', 'utc')).toBe('not-a-date')
    })
  })
})
