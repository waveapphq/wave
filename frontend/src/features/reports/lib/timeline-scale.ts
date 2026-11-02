/**
 * Pure math for the report timeline gantt (RVIEW-6, RVIEW-7).
 */

export interface TimelineRowSpan {
  started_at: string | null
  ended_at: string | null
}

export interface TimelineDomain {
  startMs: number
  endMs: number
  spanMs: number
}

export interface TrackPercents {
  leftPercent: number
  widthPercent: number
  openEnded: boolean
}

/** Minimum visible bar width (~3px on a typical track). */
export const MIN_BAR_PERCENT = 0.5

const ZERO_SPAN_PAD_MS = 1000

/** Time domain spanning all rows; null when no row carries a started_at. */
export function computeTimelineDomain(rows: readonly TimelineRowSpan[]): TimelineDomain | null {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    if (!row.started_at) continue
    const start = Date.parse(row.started_at)
    const end = row.ended_at ? Date.parse(row.ended_at) : start
    if (start < startMs) startMs = start
    if (end > endMs) endMs = end
  }
  if (!Number.isFinite(startMs)) {
    return null
  }
  if (endMs <= startMs) {
    endMs = startMs + ZERO_SPAN_PAD_MS
  }
  return { startMs, endMs, spanMs: endMs - startMs }
}

/** Percent position of one row's bar within the domain. */
export function toTrackPercents(row: TimelineRowSpan, domain: TimelineDomain): TrackPercents {
  if (!row.started_at) {
    return { leftPercent: 0, widthPercent: MIN_BAR_PERCENT, openEnded: false }
  }
  const startMs = Date.parse(row.started_at)
  const openEnded = !row.ended_at
  const endMs = openEnded ? domain.endMs : Date.parse(row.ended_at as string)
  const leftPercent = ((startMs - domain.startMs) / domain.spanMs) * 100
  const widthPercent = Math.max(((endMs - startMs) / domain.spanMs) * 100, MIN_BAR_PERCENT)
  return { leftPercent, widthPercent, openEnded }
}

/** Evenly spaced axis tick timestamps (ms) including both domain endpoints. */
export function axisTicks(domain: TimelineDomain, count = 2): number[] {
  const ticks: number[] = []
  for (let index = 0; index < count; index += 1) {
    ticks.push(domain.startMs + (domain.spanMs * index) / (count - 1))
  }
  return ticks
}
