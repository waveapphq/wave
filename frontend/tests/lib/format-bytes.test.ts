/**
 * formatBytes Tests
 *
 * Shared human-readable byte formatter used by the Reports list Report
 * column ("Generated 2 hours ago - 14.2 KB") and reused by the artifact
 * browser. Bytes render as integers; KB and above render one decimal.
 *
 * Module: frontend/src/lib/format-bytes.ts
 */

import { describe, it, expect } from 'vitest'
import { formatBytes } from '@/lib/format-bytes'

describe('formatBytes', () => {
  it('formats zero as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats values below 1024 as integer bytes', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats the KB boundary with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('formats kilobyte values with one decimal', () => {
    expect(formatBytes(14541)).toBe('14.2 KB')
  })

  it('stays in KB just below the MB boundary', () => {
    expect(formatBytes(1048575)).toBe('1024.0 KB')
  })

  it('formats the MB boundary with one decimal', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  it('formats megabyte values with one decimal', () => {
    expect(formatBytes(5452595)).toBe('5.2 MB')
  })

  it('formats the GB boundary with one decimal', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB')
  })
})
