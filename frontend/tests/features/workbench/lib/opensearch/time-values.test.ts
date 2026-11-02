/** OpenSearch From / To values (OS-4, REQ-3.3.2.3); TZ is pinned to America/Los_Angeles, so zone-less-as-local fails. */

import { describe, it, expect } from 'vitest'
import {
  buildAbsoluteValue,
  buildRelativeValue,
  describeTimeValue,
  parseTimeValue,
  resolveTimeValue,
  type RelativeControls,
} from '@/features/workbench/lib/opensearch/time-values'

const FROM = { label: 'From', defaultValue: 'now-15m' }
const TO = { label: 'To', defaultValue: 'now' }
const NOW = new Date('2026-09-26T12:34:56.789Z')
const NO_ZONE_HINT = 'No zone given: read as UTC'
const FROM_EPOCH_SECONDS = 'From reads as epoch seconds: for seconds, multiply by 1000'
const TO_EPOCH_SECONDS = 'To reads as epoch seconds: for seconds, multiply by 1000'
const FROM_NOT_A_TIME = 'From is not a time: use Absolute, Relative or Now'
const TO_NOT_A_TIME = 'To is not a time: use Absolute, Relative or Now'

// 2026-09-25T10:42:05Z
const SEP_25_MS = Date.UTC(2026, 8, 25, 10, 42, 5)

function relativeControls(value: string): RelativeControls {
  const parsed = parseTimeValue(value)
  if (parsed.kind !== 'relative') throw new Error(`${value} did not parse as a relative value`)
  return { amount: parsed.amount, unit: parsed.unit, direction: parsed.direction, round: parsed.round }
}

describe('parseTimeValue', () => {
  describe('blank', () => {
    it.each([undefined, null, '', '   '])('reads %j as blank', (value) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'blank' })
    })
  })

  describe('now', () => {
    it('reads now as the Now value', () => {
      expect(parseTimeValue('now')).toEqual({ kind: 'now' })
    })

    it('ignores spaces around the value', () => {
      expect(parseTimeValue('  now  ')).toEqual({ kind: 'now' })
    })
  })

  describe('relative values the Relative tab can show', () => {
    it.each([
      ['now-15m', { amount: 15, unit: 'm', direction: 'ago', round: false }],
      ['now-1h', { amount: 1, unit: 'h', direction: 'ago', round: false }],
      ['now+2d', { amount: 2, unit: 'd', direction: 'from-now', round: false }],
      ['now-30s', { amount: 30, unit: 's', direction: 'ago', round: false }],
      ['now-2w', { amount: 2, unit: 'w', direction: 'ago', round: false }],
      ['now-3M', { amount: 3, unit: 'M', direction: 'ago', round: false }],
      ['now+1y', { amount: 1, unit: 'y', direction: 'from-now', round: false }],
      ['now-120s', { amount: 120, unit: 's', direction: 'ago', round: false }],
      ['now-15m/m', { amount: 15, unit: 'm', direction: 'ago', round: true }],
      ['now+2d/d', { amount: 2, unit: 'd', direction: 'from-now', round: true }],
      ['now/d', { amount: 0, unit: 'd', direction: 'ago', round: true }],
      ['now/M', { amount: 0, unit: 'M', direction: 'ago', round: true }],
    ])('reads %s as a relative value', (value, controls) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'relative', ...controls })
    })

    it('ignores spaces around the value', () => {
      expect(parseTimeValue(' now-15m ')).toEqual({
        kind: 'relative',
        amount: 15,
        unit: 'm',
        direction: 'ago',
        round: false,
      })
    })
  })

  describe('other date math', () => {
    it.each(['now-1d+2h', 'now-1d/d+2h', 'now-15m/h'])(
      'keeps %s as date math the Relative controls cannot show',
      (value) => {
        expect(parseTimeValue(value)).toEqual({ kind: 'date-math', text: value })
      },
    )
  })

  describe('fixed times', () => {
    it.each([
      ['2026-09-25T10:42:05Z', SEP_25_MS, false],
      ['2026-09-25T10:42:05.123Z', SEP_25_MS + 123, false],
      ['2026-09-25T12:42:05+02:00', SEP_25_MS, false],
      ['2026-09-25T05:42:05-05:00', SEP_25_MS, false],
      ['2026-09-25T10:42:05', SEP_25_MS, true],
      ['2026-09-25T10:42:05.123', SEP_25_MS + 123, true],
      ['2026-09-25 10:42:05', SEP_25_MS, true],
      ['2026-09-25', Date.UTC(2026, 8, 25), true],
    ])('reads the timestamp %s as a fixed time in UTC', (value, epochMs, zoneless) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'absolute', epochMs, zoneless })
    })

    it.each([
      ['1790332925000', SEP_25_MS],
      [1790332925000, SEP_25_MS],
      ['179033292500', 179033292500],
      ['179033292', 179033292],
      ['0', 0],
    ])('reads %j as epoch milliseconds', (value, epochMs) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'absolute', epochMs, zoneless: false })
    })
  })

  describe('epoch seconds', () => {
    it.each([
      ['1790332925', '1790332925'],
      ['17903329250', '17903329250'],
      [1790332925, '1790332925'],
    ])('reads %j (10 or 11 digits) as epoch seconds', (value, text) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'epoch-seconds', text })
    })
  })

  describe('not a time', () => {
    it.each([
      'yesterday',
      'now-',
      'now-15',
      'now-15x',
      'now15m',
      '2026-13-45T10:00:00Z',
      '-1790332925000',
      '{{ start_time }}',
    ])('reads %s as not a time', (value) => {
      expect(parseTimeValue(value)).toEqual({ kind: 'invalid', text: value })
    })

    it('reads a number with a fraction as not a time', () => {
      expect(parseTimeValue(1790332925000.5)).toEqual({ kind: 'invalid', text: '1790332925000.5' })
    })
  })
})

describe('describeTimeValue', () => {
  describe('row trigger table (From)', () => {
    it.each([
      [undefined, '15 minutes ago', 'relative'],
      ['', '15 minutes ago', 'relative'],
      ['   ', '15 minutes ago', 'relative'],
      ['now', 'now', 'now'],
      ['now-15m', '15 minutes ago', 'relative'],
      ['now-1h', '1 hour ago', 'relative'],
      ['now+2d', '2 days from now', 'relative'],
      ['now-1m', '1 minute ago', 'relative'],
      ['now-15m/m', '15 minutes ago, rounded to the minute', 'relative'],
      ['now/d', 'now, rounded to the day', 'relative'],
      ['now-1d+2h', 'now-1d+2h', 'relative'],
      ['2026-09-25T10:42:05Z', 'Sep 25, 2026 @ 10:42:05', 'absolute'],
      ['1790332925000', 'Sep 25, 2026 @ 10:42:05', 'absolute'],
      [1790332925000, 'Sep 25, 2026 @ 10:42:05', 'absolute'],
      ['2026-09-25T10:42:05.123Z', 'Sep 25, 2026 @ 10:42:05.123', 'absolute'],
    ])('shows %j as %s with no row message', (value, words, tab) => {
      expect(describeTimeValue(value, FROM)).toEqual({ words, tab, hint: null, error: null })
    })

    it('shows a zone-less timestamp in UTC with the muted hint', () => {
      expect(describeTimeValue('2026-09-25T10:42:05', FROM)).toEqual({
        words: 'Sep 25, 2026 @ 10:42:05',
        tab: 'absolute',
        hint: NO_ZONE_HINT,
        error: null,
      })
    })

    it('shows epoch seconds as the digits with the red error', () => {
      expect(describeTimeValue('1790332925', FROM)).toEqual({
        words: '1790332925',
        tab: 'absolute',
        hint: null,
        error: FROM_EPOCH_SECONDS,
      })
    })

    it('shows anything else as the text with the red error', () => {
      expect(describeTimeValue('yesterday', FROM)).toEqual({
        words: 'yesterday',
        tab: 'absolute',
        hint: null,
        error: FROM_NOT_A_TIME,
      })
    })
  })

  describe('row trigger table (To)', () => {
    it.each([undefined, '', '   '])('shows a blank To (%j) as its default now on the Now tab', (value) => {
      expect(describeTimeValue(value, TO)).toEqual({ words: 'now', tab: 'now', hint: null, error: null })
    })

    it('names To in the epoch seconds error', () => {
      expect(describeTimeValue('1790332925', TO).error).toBe(TO_EPOCH_SECONDS)
    })

    it('names To in the not-a-time error', () => {
      expect(describeTimeValue('yesterday', TO).error).toBe(TO_NOT_A_TIME)
    })

    it('shows a relative To in words', () => {
      expect(describeTimeValue('now-1h', TO)).toEqual({
        words: '1 hour ago',
        tab: 'relative',
        hint: null,
        error: null,
      })
    })
  })

  describe('relative words', () => {
    it.each([
      ['now-1s', '1 second ago'],
      ['now-30s', '30 seconds ago'],
      ['now-1m', '1 minute ago'],
      ['now-15m', '15 minutes ago'],
      ['now-1h', '1 hour ago'],
      ['now-6h', '6 hours ago'],
      ['now-1d', '1 day ago'],
      ['now-7d', '7 days ago'],
      ['now-1w', '1 week ago'],
      ['now-2w', '2 weeks ago'],
      ['now-1M', '1 month ago'],
      ['now-3M', '3 months ago'],
      ['now-1y', '1 year ago'],
      ['now-2y', '2 years ago'],
      ['now+1s', '1 second from now'],
      ['now+5m', '5 minutes from now'],
      ['now+1h', '1 hour from now'],
      ['now+2d', '2 days from now'],
      ['now+1w', '1 week from now'],
      ['now+6M', '6 months from now'],
      ['now+1y', '1 year from now'],
      ['now-120s', '120 seconds ago'],
    ])('words %s as %s', (value, words) => {
      expect(describeTimeValue(value, FROM).words).toBe(words)
    })

    it.each([
      ['now-30s/s', '30 seconds ago, rounded to the second'],
      ['now-15m/m', '15 minutes ago, rounded to the minute'],
      ['now-1h/h', '1 hour ago, rounded to the hour'],
      ['now-1d/d', '1 day ago, rounded to the day'],
      ['now-2w/w', '2 weeks ago, rounded to the week'],
      ['now-1M/M', '1 month ago, rounded to the month'],
      ['now-1y/y', '1 year ago, rounded to the year'],
      ['now+2d/d', '2 days from now, rounded to the day'],
      ['now/s', 'now, rounded to the second'],
      ['now/m', 'now, rounded to the minute'],
      ['now/h', 'now, rounded to the hour'],
      ['now/d', 'now, rounded to the day'],
      ['now/w', 'now, rounded to the week'],
      ['now/M', 'now, rounded to the month'],
      ['now/y', 'now, rounded to the year'],
    ])('words the rounded value %s as %s', (value, words) => {
      expect(describeTimeValue(value, FROM).words).toBe(words)
    })

    it.each(['now-1d+2h', 'now-1d/d+2h', 'now-15m/h'])('shows other date math %s as written', (value) => {
      expect(describeTimeValue(value, FROM)).toEqual({
        words: value,
        tab: 'relative',
        hint: null,
        error: null,
      })
    })
  })

  describe('fixed time words (always UTC)', () => {
    it('shows the UTC calendar day even when the local zone is on the day before', () => {
      // 02:00 UTC is 19:00 the day before in America/Los_Angeles
      expect(describeTimeValue('2026-09-26T02:00:00Z', FROM).words).toBe('Sep 26, 2026 @ 02:00:00')
    })

    it('converts an offset timestamp to UTC with no hint', () => {
      expect(describeTimeValue('2026-09-25T12:42:05+02:00', FROM)).toEqual({
        words: 'Sep 25, 2026 @ 10:42:05',
        tab: 'absolute',
        hint: null,
        error: null,
      })
    })

    it('adds the milliseconds only when they are not zero', () => {
      expect(describeTimeValue('2026-09-25T10:42:05.000Z', FROM).words).toBe('Sep 25, 2026 @ 10:42:05')
      expect(describeTimeValue('2026-09-25T10:42:05.007Z', FROM).words).toBe('Sep 25, 2026 @ 10:42:05.007')
      expect(describeTimeValue(String(SEP_25_MS + 123), FROM).words).toBe('Sep 25, 2026 @ 10:42:05.123')
    })

    it.each([
      ['2026-09-25T10:42:05', 'Sep 25, 2026 @ 10:42:05'],
      ['2026-09-25 10:42:05', 'Sep 25, 2026 @ 10:42:05'],
      ['2026-09-25T10:42:05.123', 'Sep 25, 2026 @ 10:42:05.123'],
      ['2026-09-25', 'Sep 25, 2026 @ 00:00:00'],
    ])('reads the zone-less %s as UTC and shows the hint', (value, words) => {
      expect(describeTimeValue(value, FROM)).toEqual({
        words,
        tab: 'absolute',
        hint: NO_ZONE_HINT,
        error: null,
      })
    })

    it.each(['2026-09-25T10:42:05Z', '2026-09-25T12:42:05+02:00', '1790332925000', 1790332925000])(
      'shows no hint for %j, which carries its zone',
      (value) => {
        expect(describeTimeValue(value, FROM).hint).toBeNull()
      },
    )

    it.each([undefined, '', 'now', 'now-15m', 'now/d', 'now-1d+2h', '1790332925', 'yesterday'])(
      'shows no hint for %j',
      (value) => {
        expect(describeTimeValue(value, FROM).hint).toBeNull()
      },
    )
  })

  describe('row errors', () => {
    it.each(['1790332925', '17903329250', 1790332925])('refuses %j as epoch seconds', (value) => {
      const described = describeTimeValue(value, FROM)
      expect(described.error).toBe(FROM_EPOCH_SECONDS)
      expect(described.words).toBe(String(value))
      expect(described.tab).toBe('absolute')
    })

    it.each(['yesterday', 'now-', 'now-15', 'now-15x', 'now15m', '2026-13-45T10:00:00Z', '-1790332925000'])(
      'refuses %s as not a time',
      (value) => {
        const described = describeTimeValue(value, FROM)
        expect(described.error).toBe(FROM_NOT_A_TIME)
        expect(described.words).toBe(value)
        expect(described.tab).toBe('absolute')
      },
    )

    it('refuses a variable reference typed as a literal: a variable goes through the expression toggle', () => {
      expect(describeTimeValue('{{ start_time }}', FROM).error).toBe(FROM_NOT_A_TIME)
    })

    it.each([
      undefined,
      null,
      '',
      '   ',
      'now',
      'now-15m',
      'now-2H',
      'now-1d/d',
      'now-0m',
      'now-15m/h',
      'now-1d+2h',
      '2026-09-25T10:42:05Z',
      '2026-09-25T10:42:05',
      '1790332925000',
      1790332925000,
      '179033292',
      ' now-15m ',
    ])('accepts %j with no error', (value) => {
      expect(describeTimeValue(value, FROM).error).toBeNull()
    })
  })
})

describe('buildRelativeValue', () => {
  it.each<[RelativeControls, string]>([
    [{ amount: 15, unit: 'm', direction: 'ago', round: false }, 'now-15m'],
    [{ amount: 15, unit: 'm', direction: 'ago', round: true }, 'now-15m/m'],
    [{ amount: 2, unit: 'd', direction: 'from-now', round: false }, 'now+2d'],
    [{ amount: 2, unit: 'd', direction: 'from-now', round: true }, 'now+2d/d'],
    [{ amount: 1, unit: 'h', direction: 'ago', round: false }, 'now-1h'],
  ])('writes %j as %s', (controls, value) => {
    expect(buildRelativeValue(controls)).toBe(value)
  })

  it.each<[RelativeControls['unit'], string, string]>([
    ['s', 'now-5s', 'now+5s'],
    ['m', 'now-5m', 'now+5m'],
    ['h', 'now-5h', 'now+5h'],
    ['d', 'now-5d', 'now+5d'],
    ['w', 'now-5w', 'now+5w'],
    ['M', 'now-5M', 'now+5M'],
    ['y', 'now-5y', 'now+5y'],
  ])('writes the unit letter %s', (unit, ago, fromNow) => {
    expect(buildRelativeValue({ amount: 5, unit, direction: 'ago', round: false })).toBe(ago)
    expect(buildRelativeValue({ amount: 5, unit, direction: 'from-now', round: false })).toBe(fromNow)
    expect(buildRelativeValue({ amount: 5, unit, direction: 'ago', round: true })).toBe(`${ago}/${unit}`)
  })

  it('writes now for amount 0', () => {
    expect(buildRelativeValue({ amount: 0, unit: 'm', direction: 'ago', round: false })).toBe('now')
    expect(buildRelativeValue({ amount: 0, unit: 'h', direction: 'from-now', round: false })).toBe('now')
  })

  it('writes now/<unit> for amount 0 when rounded', () => {
    expect(buildRelativeValue({ amount: 0, unit: 'd', direction: 'ago', round: true })).toBe('now/d')
    expect(buildRelativeValue({ amount: 0, unit: 'w', direction: 'from-now', round: true })).toBe('now/w')
  })

  it.each(['now-15m', 'now-15m/m', 'now+2d', 'now/d', 'now-3M', 'now+1y/y'])(
    'writes back the value %s it was seeded from',
    (value) => {
      expect(buildRelativeValue(relativeControls(value))).toBe(value)
    },
  )
})

describe('buildAbsoluteValue', () => {
  it('writes YYYY-MM-DDTHH:MM:SSZ', () => {
    expect(buildAbsoluteValue(new Date(SEP_25_MS))).toBe('2026-09-25T10:42:05Z')
  })

  it('drops the milliseconds', () => {
    expect(buildAbsoluteValue(new Date(SEP_25_MS + 123))).toBe('2026-09-25T10:42:05Z')
  })

  it('zero-pads month, day, hours, minutes and seconds', () => {
    expect(buildAbsoluteValue(new Date('2026-03-05T04:05:06Z'))).toBe('2026-03-05T04:05:06Z')
  })

  it('writes the UTC day and time, not the local ones', () => {
    // 02:00 UTC is 19:00 the day before in America/Los_Angeles
    expect(buildAbsoluteValue(new Date('2026-09-26T02:00:00Z'))).toBe('2026-09-26T02:00:00Z')
  })

  it('writes a value that reads back as the same fixed time', () => {
    expect(parseTimeValue(buildAbsoluteValue(new Date(SEP_25_MS)))).toEqual({
      kind: 'absolute',
      epochMs: SEP_25_MS,
      zoneless: false,
    })
  })
})

describe('resolveTimeValue', () => {
  it.each([
    ['now', '2026-09-26T12:34:56.789Z'],
    ['now-15m', '2026-09-26T12:19:56.789Z'],
    ['now-1h', '2026-09-26T11:34:56.789Z'],
    ['now+2d', '2026-09-28T12:34:56.789Z'],
    ['now-30s', '2026-09-26T12:34:26.789Z'],
    ['now-1w', '2026-09-19T12:34:56.789Z'],
    ['now-1M', '2026-08-26T12:34:56.789Z'],
    ['now-1y', '2025-09-26T12:34:56.789Z'],
    ['now-1d+2h', '2026-09-25T14:34:56.789Z'],
  ])('resolves %s against the given now', (value, iso) => {
    expect(resolveTimeValue(value, NOW)?.toISOString()).toBe(iso)
  })

  it.each([
    ['now-15m/m', '2026-09-26T12:19:00.000Z'],
    ['now/d', '2026-09-26T00:00:00.000Z'],
    ['now/h', '2026-09-26T12:00:00.000Z'],
  ])('rounds %s down to the start of the unit in UTC', (value, iso) => {
    expect(resolveTimeValue(value, NOW)?.toISOString()).toBe(iso)
  })

  it.each([
    ['2026-09-25T10:42:05Z', '2026-09-25T10:42:05.000Z'],
    ['2026-09-25T10:42:05', '2026-09-25T10:42:05.000Z'],
    ['1790332925000', '2026-09-25T10:42:05.000Z'],
    [1790332925000, '2026-09-25T10:42:05.000Z'],
  ])('resolves the fixed time %j to itself, zone-less read as UTC', (value, iso) => {
    expect(resolveTimeValue(value, NOW)?.toISOString()).toBe(iso)
  })

  it.each([undefined, '', '   ', '1790332925', 'yesterday'])('resolves %j to nothing', (value) => {
    expect(resolveTimeValue(value, NOW)).toBeNull()
  })
})

describe('parseTimeValue timestamp shapes', () => {
  it.each([
    ['2026-09-25T10:42', Date.UTC(2026, 8, 25, 10, 42), true],
    ['2026-09-25 10:42Z', Date.UTC(2026, 8, 25, 10, 42), false],
    ['2026-09-25T10:42:05.123456789Z', SEP_25_MS + 123, false],
    ['2026-09-25T12:12:05+01:30', SEP_25_MS, false],
  ])('reads %s as a fixed time', (value, epochMs, zoneless) => {
    expect(parseTimeValue(value)).toEqual({ kind: 'absolute', epochMs, zoneless })
  })

  it.each([
    '2026-09-25T',
    '2026-09-25Z',
    '2026-09-25+02:00',
    '2026-09-25T10',
    '2026-09-25T10:42.5',
    '2026-09-25T10:42:05.1234567890Z',
    '2026-09-25T10:42:05ZZ',
    '2026-09-25T10:42:05+02:00Z',
    '2026-09-25T10:42:05+2:00',
    '2026-09-25x10:42:05',
    '2026-9-25',
  ])('reads %s as not a time', (value) => {
    expect(parseTimeValue(value)).toEqual({ kind: 'invalid', text: value })
  })

  it('reads a boolean as its words, not a time', () => {
    expect(parseTimeValue(true)).toEqual({ kind: 'invalid', text: 'true' })
  })

  it('reads a map as not a time, written as JSON', () => {
    expect(parseTimeValue({ from: 'now-15m' })).toEqual({ kind: 'invalid', text: '{"from":"now-15m"}' })
  })
})
