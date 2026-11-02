import { describe, it, expect } from 'vitest'
import { formatDuration } from '../../src/lib/format-duration'

describe('formatDuration', () => {
  it('returns - for null', () => {
    expect(formatDuration(null)).toBe('-')
  })

  it('returns - for undefined', () => {
    expect(formatDuration(undefined as unknown as number)).toBe('-')
  })

  it('formats sub-minute seconds without a minutes prefix', () => {
    expect(formatDuration(5)).toBe('5s')
  })

  it('preserves up to 3 decimals in the seconds field', () => {
    expect(formatDuration(5.25)).toBe('5.25s')
  })

  it('trims trailing zero decimals', () => {
    expect(formatDuration(5.5)).toBe('5.5s')
  })

  it('falls back to 0 when the truncated seconds collapse to only zeros', () => {
    // 0.0001 -> slice to 3 decimals "0.00" -> trailing ".00" stripped ->
    // empty string -> the `|| '0'` branch kicks in.
    expect(formatDuration(0.0001)).toBe('0s')
  })

  it('formats sub-hour minutes and seconds', () => {
    expect(formatDuration(65)).toBe('1m 5s')
  })

  it('formats whole minutes without a seconds suffix', () => {
    expect(formatDuration(120)).toBe('2m')
  })

  it('formats whole hours without a minutes suffix', () => {
    expect(formatDuration(3600)).toBe('1h')
  })

  it('formats hours + minutes when both are non-zero', () => {
    expect(formatDuration(3660)).toBe('1h 1m')
  })
})
