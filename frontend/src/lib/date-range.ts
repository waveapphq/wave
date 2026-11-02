import { endOfDay, startOfDay, subDays } from 'date-fns'

export type DateRangePreset = 'today' | 'last-7' | 'last-30' | 'last-90'

export type DateRangeValue =
  | { kind: 'all-time' }
  | { kind: 'preset'; preset: DateRangePreset }
  | { kind: 'custom'; from: string; to: string }

const VALID_PRESETS: ReadonlySet<DateRangePreset> = new Set([
  'today',
  'last-7',
  'last-30',
  'last-90',
])

export function parseDateRangeParam(param: string | null): DateRangeValue {
  if (!param) return { kind: 'all-time' }
  if (param.startsWith('preset:')) {
    const preset = param.slice('preset:'.length) as DateRangePreset
    if (VALID_PRESETS.has(preset)) {
      return { kind: 'preset', preset }
    }
    return { kind: 'all-time' }
  }
  if (param.startsWith('custom:')) {
    const rest = param.slice('custom:'.length)
    const sep = rest.indexOf('~')
    if (sep > 0) {
      const from = rest.slice(0, sep)
      const to = rest.slice(sep + 1)
      if (from && to) return { kind: 'custom', from, to }
    }
  }
  return { kind: 'all-time' }
}

export function serializeDateRange(value: DateRangeValue): string | null {
  if (value.kind === 'all-time') return null
  if (value.kind === 'preset') return `preset:${value.preset}`
  return `custom:${value.from}~${value.to}`
}

export interface ResolvedDateRange {
  from_date?: string
  to_date?: string
}

function daysBackForPreset(preset: DateRangePreset): number {
  if (preset === 'last-7') return 7
  if (preset === 'last-30') return 30
  return 90
}

export function resolveDateRange(
  value: DateRangeValue,
  now: Date = new Date(),
): ResolvedDateRange {
  if (value.kind === 'all-time') return {}
  if (value.kind === 'custom') {
    return { from_date: value.from, to_date: value.to }
  }
  if (value.preset === 'today') {
    return {
      from_date: startOfDay(now).toISOString(),
      to_date: endOfDay(now).toISOString(),
    }
  }
  const daysBack = daysBackForPreset(value.preset)
  return {
    from_date: subDays(now, daysBack).toISOString(),
    to_date: now.toISOString(),
  }
}
