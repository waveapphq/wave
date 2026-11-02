/**
 * buildReportLogEntries Tests
 *
 * Adapter from the report JSON's raw log records to the shared console
 * primitives' LogEntry shape, mirroring the history console transform.
 * Banners keep their variant so suite/regression boundary rows render
 * with the banner styling.
 *
 * Module: frontend/src/features/reports/lib/report-log-entries.ts
 */

import { describe, it, expect } from 'vitest'
import { buildReportLogEntries } from '@/features/reports/lib/report-log-entries'

describe('buildReportLogEntries', () => {
  it('maps a full record through unchanged (besides level uppercasing)', () => {
    const [entry] = buildReportLogEntries([
      {
        id: 'log-1',
        timestamp: '2026-06-10T11:06:52.100Z',
        level: 'warn',
        message: 'careful',
        source: 'Http : Fetch_Status',
        blockId: 'node-fetch',
      },
    ])

    expect(entry).toEqual({
      id: 'log-1',
      timestamp: '2026-06-10T11:06:52.100Z',
      level: 'WARN',
      message: 'careful',
      source: 'Http : Fetch_Status',
      blockId: 'node-fetch',
      sequence: 0,
    })
  })

  it('falls back to INFO for unknown or missing levels', () => {
    expect(buildReportLogEntries([{ level: undefined }])[0].level).toBe('INFO')
    expect(buildReportLogEntries([{ level: 'weird' }])[0].level).toBe('INFO')
    expect(buildReportLogEntries([{ level: 'error' }])[0].level).toBe('ERROR')
    expect(buildReportLogEntries([{ level: 'FATAL' }])[0].level).toBe('FATAL')
    expect(buildReportLogEntries([{ level: 'DEBUG' }])[0].level).toBe('DEBUG')
  })

  it('defaults missing id, timestamp, message, and source', () => {
    const [entry] = buildReportLogEntries([{}, {}, {}]).slice(2)

    expect(entry.id).toBe('report-2')
    expect(entry.timestamp).toBe('')
    expect(entry.message).toBe('')
    expect(entry.source).toBe('')
  })

  it('uses the array index as the sequence so virtualization stays stable', () => {
    const result = buildReportLogEntries([{ message: 'a' }, { message: 'b' }])

    expect(result[0].sequence).toBe(0)
    expect(result[1].sequence).toBe(1)
  })

  it('preserves banner variants for suite and regression boundary rows', () => {
    const result = buildReportLogEntries([
      { message: 'suite start', variant: 'suite-banner' },
      { message: 'regression start', variant: 'regression-banner' },
      { message: 'plain' },
    ])

    expect(result[0].variant).toBe('suite-banner')
    expect(result[1].variant).toBe('regression-banner')
    expect(result[2].variant).toBeUndefined()
  })
})
