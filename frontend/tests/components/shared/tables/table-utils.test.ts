import { describe, it, expect } from 'vitest'
import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
  isTerminalStatus,
} from '@/components/shared/tables/table-utils'

// Relative-time formatting moved to lib/timestamp-format.ts under the
// `relative` display style. Its tests live in tests/lib/timestamp-format.test.ts.

describe('getStatusColor', () => {
  it('returns "text-success" for passed', () => {
    expect(getStatusColor('passed')).toBe('text-success')
  })

  it('returns "text-error" for failed', () => {
    expect(getStatusColor('failed')).toBe('text-error')
  })

  it('returns "text-muted" for never_run', () => {
    expect(getStatusColor('never_run')).toBe('text-muted')
  })

  it('returns "text-info" for running', () => {
    expect(getStatusColor('running')).toBe('text-info')
  })

  it('returns "text-muted" for stopped', () => {
    expect(getStatusColor('stopped')).toBe('text-muted')
  })

  it('returns "text-muted" for skipped (mid-run termination)', () => {
    expect(getStatusColor('skipped')).toBe('text-muted')
  })

  it('returns "text-muted" for excluded (unselected at dispatch)', () => {
    expect(getStatusColor('excluded')).toBe('text-muted')
  })

  it('returns "text-warning" for warning (step raised a warning)', () => {
    expect(getStatusColor('warning')).toBe('text-warning')
  })

  it('returns "text-muted" for unknown status', () => {
    expect(getStatusColor('unknown_status')).toBe('text-muted')
  })
})

describe('getStatusDotColor', () => {
  it('returns "bg-success" for passed', () => {
    expect(getStatusDotColor('passed')).toBe('bg-success')
  })

  it('returns "bg-error" for failed', () => {
    expect(getStatusDotColor('failed')).toBe('bg-error')
  })

  it('returns "bg-muted" for never_run', () => {
    expect(getStatusDotColor('never_run')).toBe('bg-muted')
  })

  it('returns "bg-info" for running', () => {
    expect(getStatusDotColor('running')).toBe('bg-info')
  })

  it('returns "bg-muted" for stopped', () => {
    expect(getStatusDotColor('stopped')).toBe('bg-muted')
  })

  it('returns "bg-muted" for skipped (mid-run termination)', () => {
    expect(getStatusDotColor('skipped')).toBe('bg-muted')
  })

  it('returns "bg-muted" for excluded (unselected at dispatch)', () => {
    expect(getStatusDotColor('excluded')).toBe('bg-muted')
  })

  it('returns "bg-warning" for warning (step raised a warning)', () => {
    expect(getStatusDotColor('warning')).toBe('bg-warning')
  })

  it('returns "bg-muted" for unknown status', () => {
    expect(getStatusDotColor('unknown_status')).toBe('bg-muted')
  })
})

describe('getStatusLabel', () => {
  it('returns "Passed" for passed', () => {
    expect(getStatusLabel('passed')).toBe('Passed')
  })

  it('returns "Failed" for failed', () => {
    expect(getStatusLabel('failed')).toBe('Failed')
  })

  it('returns "Never Run" for never_run', () => {
    expect(getStatusLabel('never_run')).toBe('Never Run')
  })

  it('returns "Running" for running', () => {
    expect(getStatusLabel('running')).toBe('Running')
  })

  it('returns "Stopped" for stopped', () => {
    expect(getStatusLabel('stopped')).toBe('Stopped')
  })

  it('returns "Skipped" for skipped (mid-run termination)', () => {
    expect(getStatusLabel('skipped')).toBe('Skipped')
  })

  it('returns "Excluded" for excluded (unselected at dispatch)', () => {
    expect(getStatusLabel('excluded')).toBe('Excluded')
  })

  it('returns "Warning" for warning (step raised a warning)', () => {
    expect(getStatusLabel('warning')).toBe('Warning')
  })

  it('passes through unknown status values as-is', () => {
    expect(getStatusLabel('unknown_status')).toBe('unknown_status')
  })
})

describe('isTerminalStatus', () => {
  // skipped is a finished outcome (mid-run termination), so it is terminal.
  it.each(['passed', 'failed', 'stopped', 'skipped'])('is true for terminal status %s', (status) => {
    expect(isTerminalStatus(status)).toBe(true)
  })

  it.each(['running', 'paused', 'pending', 'never_run'])(
    'is false for non-terminal status %s',
    (status) => {
      expect(isTerminalStatus(status)).toBe(false)
    },
  )
})
