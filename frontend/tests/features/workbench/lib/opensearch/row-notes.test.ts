/** OpenSearch amber row notes (OS-2, OS-4, REQ-5.1.2, REQ-3.3.2.3); TZ is pinned to America/Los_Angeles. */

import { describe, it, expect } from 'vitest'
import type { RowNoteContext } from '@/features/workbench/lib/node-parameters/types'
import {
  apiKeySchemeNote,
  bearerSchemeNote,
  fromNote,
  tlsOnHttpNote,
} from '@/features/workbench/lib/opensearch/row-notes'

const NOW = new Date('2026-09-26T12:00:00.000Z')
const API_KEY_NOTE = 'Remove "ApiKey " at the start: WAVE adds it'
const BEARER_NOTE = 'Remove "Bearer " at the start: WAVE adds it'
const TLS_NOTE = 'Not used: the Cluster URL is http'
const FROM_AFTER_TO_NOTE = 'From is later than To: the search can find nothing'
const FROM_AFTER_NOW_NOTE = 'From is later than now: the search can find nothing'
const HTTP_URL = { url: 'http://opensearch.internal:9200' }
const HTTPS_URL = { url: 'https://opensearch.internal:9200' }

function ctx(overrides: Partial<RowNoteContext> = {}): RowNoteContext {
  return { value: undefined, isExpression: false, allValues: {}, now: NOW, ...overrides }
}

describe('apiKeySchemeNote', () => {
  it.each(['ApiKey abc123', 'apikey abc123', 'APIKEY abc123', 'aPiKeY abc123'])(
    'shows the note for the literal %j',
    (value) => {
      expect(apiKeySchemeNote(ctx({ value }))).toBe(API_KEY_NOTE)
    },
  )

  it('shows no note in expression mode', () => {
    expect(apiKeySchemeNote(ctx({ value: 'ApiKey abc123', isExpression: true }))).toBeNull()
  })

  it.each([
    undefined,
    null,
    '',
    'abc123',
    'ApiKeyabc123',
    'my ApiKey abc123',
    'Bearer abc123',
    'wave:enc:v1:sealed',
    42,
  ])('shows no note for %j', (value) => {
    expect(apiKeySchemeNote(ctx({ value }))).toBeNull()
  })
})

describe('bearerSchemeNote', () => {
  it.each(['Bearer eyJhbGciOi', 'bearer eyJhbGciOi', 'BEARER eyJhbGciOi', 'bEaReR eyJhbGciOi'])(
    'shows the note for the literal %j',
    (value) => {
      expect(bearerSchemeNote(ctx({ value }))).toBe(BEARER_NOTE)
    },
  )

  it('shows no note in expression mode', () => {
    expect(bearerSchemeNote(ctx({ value: 'Bearer eyJhbGciOi', isExpression: true }))).toBeNull()
  })

  it.each([
    undefined,
    null,
    '',
    'eyJhbGciOi',
    'Bearereyj',
    'my Bearer eyJhbGciOi',
    'ApiKey abc123',
    'wave:enc:v1:sealed',
    42,
  ])('shows no note for %j', (value) => {
    expect(bearerSchemeNote(ctx({ value }))).toBeNull()
  })
})

describe('tlsOnHttpNote', () => {
  describe('on an http Cluster URL', () => {
    it('shows the note for Verify Server Certificate turned off', () => {
      expect(tlsOnHttpNote(ctx({ value: false, allValues: HTTP_URL }))).toBe(TLS_NOTE)
    })

    it.each([true, undefined])('shows no note for Verify Server Certificate left %j', (value) => {
      expect(tlsOnHttpNote(ctx({ value, allValues: HTTP_URL }))).toBeNull()
    })

    it.each([
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----',
      'wave:enc:v1:sealed',
    ])('shows the note for a filled certificate or key row %j', (value) => {
      expect(tlsOnHttpNote(ctx({ value, allValues: HTTP_URL }))).toBe(TLS_NOTE)
    })

    it('shows the note for a certificate row filled with an expression', () => {
      expect(tlsOnHttpNote(ctx({ value: 'ca_pem', isExpression: true, allValues: HTTP_URL }))).toBe(TLS_NOTE)
    })

    it.each([undefined, null, '', '   '])('shows no note for the blank row %j', (value) => {
      expect(tlsOnHttpNote(ctx({ value, allValues: HTTP_URL }))).toBeNull()
    })

    it.each(['HTTP://opensearch.internal:9200', 'Http://opensearch.internal'])(
      'reads the scheme in any case: %s',
      (url) => {
        expect(tlsOnHttpNote(ctx({ value: 'wave:enc:v1:sealed', allValues: { url } }))).toBe(TLS_NOTE)
        expect(tlsOnHttpNote(ctx({ value: false, allValues: { url } }))).toBe(TLS_NOTE)
      },
    )
  })

  describe('on any other Cluster URL', () => {
    it.each([false, 'wave:enc:v1:sealed', '-----BEGIN CERTIFICATE-----'])(
      'shows no note for %j on an https URL',
      (value) => {
        expect(tlsOnHttpNote(ctx({ value, allValues: HTTPS_URL }))).toBeNull()
      },
    )

    it.each([
      {},
      { url: '' },
      { url: null },
      { url: 'cluster_url' },
      { url: 'httpx://opensearch.internal' },
      { url: 'opensearch.internal:9200' },
    ])('shows no note when the Cluster URL is %j', (allValues) => {
      expect(tlsOnHttpNote(ctx({ value: false, allValues }))).toBeNull()
      expect(tlsOnHttpNote(ctx({ value: 'wave:enc:v1:sealed', allValues }))).toBeNull()
    })
  })
})

describe('fromNote', () => {
  describe('From later than To', () => {
    it.each([
      ['2026-09-25T10:00:00Z', '2026-09-25T09:00:00Z'],
      [1790332925000, '2026-09-25T10:00:00Z'],
      ['2026-09-25T11:00:00Z', '1790332925000'],
      ['2026-09-25T11:00:00Z', 1790332925000],
      ['2026-09-25T12:00:00+02:00', '2026-09-25T09:00:00Z'],
    ])('shows the note for From %j after To %j', (from, to) => {
      expect(fromNote(ctx({ value: from, allValues: { from, to } }))).toBe(FROM_AFTER_TO_NOTE)
    })

    it('reads a zone-less To as UTC', () => {
      // read as local time, To would be 17:00 UTC and no note would show
      expect(
        fromNote(ctx({ value: '2026-09-25T10:30:00Z', allValues: { to: '2026-09-25T10:00:00' } })),
      ).toBe(FROM_AFTER_TO_NOTE)
    })

    it('reads a zone-less From as UTC', () => {
      // read as local time, From would be 17:30 UTC, later than To
      expect(
        fromNote(ctx({ value: '2026-09-25T10:30:00', allValues: { to: '2026-09-25T12:00:00Z' } })),
      ).toBeNull()
    })

    it('shows no note when From equals To (both ends inclusive)', () => {
      expect(
        fromNote(ctx({ value: '2026-09-25T10:00:00Z', allValues: { to: '2026-09-25T10:00:00Z' } })),
      ).toBeNull()
    })

    it('shows no note when From is earlier than To', () => {
      expect(
        fromNote(ctx({ value: '2026-09-25T09:00:00Z', allValues: { to: '2026-09-25T10:00:00Z' } })),
      ).toBeNull()
    })

    it.each([undefined, '', 'now', 'now-2d', 'now/d', 'yesterday', '1790332925'])(
      'compares only fixed times: no note when To is %j',
      (to) => {
        expect(fromNote(ctx({ value: '2026-09-25T10:00:00Z', allValues: { to } }))).toBeNull()
      },
    )

    it('shows no note when From is an expression', () => {
      expect(
        fromNote(
          ctx({ value: '2026-09-25T10:00:00Z', isExpression: true, allValues: { to: '2026-09-25T09:00:00Z' } }),
        ),
      ).toBeNull()
    })
  })

  describe('From later than now', () => {
    it.each(['2026-09-27T00:00:00Z', '2026-09-26T12:00:00.001Z', Date.UTC(2026, 8, 27), String(Date.UTC(2026, 8, 27))])(
      'shows the note for the future From %j',
      (value) => {
        expect(fromNote(ctx({ value }))).toBe(FROM_AFTER_NOW_NOTE)
      },
    )

    it('shows no note when From equals now', () => {
      expect(fromNote(ctx({ value: '2026-09-26T12:00:00Z' }))).toBeNull()
    })

    it('shows no note when From is in the past', () => {
      expect(fromNote(ctx({ value: '2026-09-25T10:42:05Z' }))).toBeNull()
    })

    it('reads a zone-less From as UTC', () => {
      // read as local time, From would be 15:00 UTC, later than now
      expect(fromNote(ctx({ value: '2026-09-26T08:00:00' }))).toBeNull()
    })

    it('compares against the now it is given, not the clock', () => {
      expect(fromNote(ctx({ value: '2020-01-01T00:00:00Z', now: new Date('2019-12-31T00:00:00Z') }))).toBe(
        FROM_AFTER_NOW_NOTE,
      )
    })

    it('shows no note when From is an expression', () => {
      expect(fromNote(ctx({ value: '2026-09-27T00:00:00Z', isExpression: true }))).toBeNull()
    })

    it('shows the later-than-now note when From is before a future To', () => {
      expect(
        fromNote(ctx({ value: '2026-09-27T00:00:00Z', allValues: { to: '2026-09-28T00:00:00Z' } })),
      ).toBe(FROM_AFTER_NOW_NOTE)
    })

    it('shows the later-than-To note first when From is later than both', () => {
      expect(
        fromNote(ctx({ value: '2026-09-28T00:00:00Z', allValues: { to: '2026-09-27T00:00:00Z' } })),
      ).toBe(FROM_AFTER_TO_NOTE)
    })
  })

  describe('no note', () => {
    it.each(['yesterday', '1790332925'])('shows no note for %j, which the red row error covers', (value) => {
      expect(fromNote(ctx({ value, allValues: { to: '2026-09-25T09:00:00Z' } }))).toBeNull()
    })

    it('shows no note in expression mode', () => {
      expect(fromNote(ctx({ value: '2026-09-28T00:00:00Z', isExpression: true }))).toBeNull()
    })

    it.each([undefined, '', 'now-15m', 'now'])('shows no note for the relative or blank From %j', (value) => {
      expect(fromNote(ctx({ value, allValues: { to: '2026-09-25T09:00:00Z' } }))).toBeNull()
    })
  })
})
