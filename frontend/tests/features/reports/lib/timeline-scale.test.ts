/**
 * timeline-scale Tests
 *
 * Pure math for the report timeline gantt (RVIEW-6, RVIEW-7): domain
 * computation over run/block rows, percent positioning per row with a
 * minimum visible bar width, open-ended handling for rows missing
 * ended_at, and axis tick generation.
 *
 * Module: frontend/src/features/reports/lib/timeline-scale.ts
 */

import { describe, it, expect } from 'vitest'
import {
  MIN_BAR_PERCENT,
  axisTicks,
  computeTimelineDomain,
  toTrackPercents,
} from '@/features/reports/lib/timeline-scale'

const T0 = '2026-06-10T11:00:00+00:00'
const T10 = '2026-06-10T11:00:10+00:00'
const T20 = '2026-06-10T11:00:20+00:00'
const T40 = '2026-06-10T11:00:40+00:00'

const ms = (iso: string) => new Date(iso).getTime()

describe('computeTimelineDomain', () => {
  it('returns null when no row has a started_at', () => {
    expect(computeTimelineDomain([])).toBeNull()
    expect(
      computeTimelineDomain([{ started_at: null, ended_at: null }]),
    ).toBeNull()
  })

  it('spans from the earliest start to the latest end', () => {
    const domain = computeTimelineDomain([
      { started_at: T10, ended_at: T20 },
      { started_at: T0, ended_at: T10 },
      { started_at: T20, ended_at: T40 },
    ])

    expect(domain).not.toBeNull()
    expect(domain!.startMs).toBe(ms(T0))
    expect(domain!.endMs).toBe(ms(T40))
    expect(domain!.spanMs).toBe(ms(T40) - ms(T0))
  })

  it('uses started_at as the end candidate for rows missing ended_at', () => {
    const domain = computeTimelineDomain([
      { started_at: T0, ended_at: T10 },
      { started_at: T20, ended_at: null },
    ])

    expect(domain!.endMs).toBe(ms(T20))
  })

  it('ignores rows without started_at when other rows have one', () => {
    const domain = computeTimelineDomain([
      { started_at: null, ended_at: null },
      { started_at: T10, ended_at: T20 },
    ])

    expect(domain!.startMs).toBe(ms(T10))
    expect(domain!.endMs).toBe(ms(T20))
  })

  it('pads a zero-span domain by one second so percent math never divides by zero', () => {
    const domain = computeTimelineDomain([{ started_at: T0, ended_at: T0 }])

    expect(domain!.startMs).toBe(ms(T0))
    expect(domain!.endMs).toBe(ms(T0) + 1000)
    expect(domain!.spanMs).toBe(1000)
  })
})

describe('toTrackPercents', () => {
  const domain = computeTimelineDomain([
    { started_at: T0, ended_at: T40 },
  ])!

  it('positions a row by its offset and duration within the domain', () => {
    const track = toTrackPercents({ started_at: T10, ended_at: T20 }, domain)

    expect(track.leftPercent).toBeCloseTo(25)
    expect(track.widthPercent).toBeCloseTo(25)
    expect(track.openEnded).toBe(false)
  })

  it('covers the full track for a row spanning the whole domain', () => {
    const track = toTrackPercents({ started_at: T0, ended_at: T40 }, domain)

    expect(track.leftPercent).toBeCloseTo(0)
    expect(track.widthPercent).toBeCloseTo(100)
  })

  it('clamps zero-duration rows to the minimum visible width', () => {
    const track = toTrackPercents({ started_at: T10, ended_at: T10 }, domain)

    expect(track.widthPercent).toBe(MIN_BAR_PERCENT)
  })

  it('extends rows missing ended_at to the domain end and flags them open-ended', () => {
    const track = toTrackPercents({ started_at: T20, ended_at: null }, domain)

    expect(track.openEnded).toBe(true)
    expect(track.leftPercent).toBeCloseTo(50)
    expect(track.widthPercent).toBeCloseTo(50)
  })

  it('clamps a row without started_at to a minimum-width bar at the track origin', () => {
    const track = toTrackPercents({ started_at: null, ended_at: null }, domain)

    expect(track.leftPercent).toBe(0)
    expect(track.widthPercent).toBe(MIN_BAR_PERCENT)
  })
})

describe('axisTicks', () => {
  const domain = computeTimelineDomain([{ started_at: T0, ended_at: T40 }])!

  it('returns the domain endpoints by default', () => {
    expect(axisTicks(domain)).toEqual([ms(T0), ms(T40)])
  })

  it('returns evenly spaced ticks including both endpoints', () => {
    const ticks = axisTicks(domain, 5)

    expect(ticks).toHaveLength(5)
    expect(ticks[0]).toBe(ms(T0))
    expect(ticks[4]).toBe(ms(T40))
    expect(ticks[1] - ticks[0]).toBeCloseTo(10000)
    expect(ticks[2] - ticks[1]).toBeCloseTo(10000)
  })
})

describe('MIN_BAR_PERCENT', () => {
  it('is a small positive percentage', () => {
    expect(MIN_BAR_PERCENT).toBeGreaterThan(0)
    expect(MIN_BAR_PERCENT).toBeLessThanOrEqual(2)
  })
})
