/**
 * OpenSearch From / To values: parse, words, build and resolve (OS-4, REQ-3.3.2.3). Every time is UTC.
 */

import { pluralize } from '@/lib/pluralize'
import { formatTimestamp } from '@/lib/timestamp-format'
import { valueToText } from '@/lib/variable-format'

export type TimeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y'

type DateMathUnit = TimeUnit | 'H'

export interface RelativeControls {
  amount: number
  unit: TimeUnit
  direction: 'ago' | 'from-now'
  round: boolean
}

export type ParsedTimeValue =
  | { kind: 'blank' }
  | { kind: 'now' }
  | ({ kind: 'relative' } & RelativeControls)
  | { kind: 'date-math'; text: string }
  | { kind: 'absolute'; epochMs: number; zoneless: boolean }
  | { kind: 'epoch-seconds'; text: string }
  | { kind: 'invalid'; text: string }

export type TimeTab = 'absolute' | 'relative' | 'now'

export interface TimeValueDescription {
  words: string
  tab: TimeTab
  hint: string | null
  error: string | null
}

export interface TimeRow {
  label: string
  defaultValue: unknown
}

const NO_ZONE_HINT = 'No zone given: read as UTC'

const UNIT_NAMES: Record<TimeUnit, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
}

const RELATIVE_PATTERN = /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/
const DATE_MATH_PATTERN = /^now(?:[+-]\d+[smhHdwMy]|\/[smhHdwMy])*$/
const DATE_MATH_STEP = /([+-])(\d+)([smhHdwMy])|\/([smhHdwMy])/g
const EPOCH_SECONDS_PATTERN = /^\d{10,11}$/
// Up to 15 digits stays inside the range a Date can hold
const EPOCH_MS_PATTERN = /^\d{1,15}$/
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_CLOCK_PATTERN = /^[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
const ISO_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/

const DATE_MATH_KINDS = new Set<ParsedTimeValue['kind']>(['now', 'relative', 'date-math'])

const UNIT_MS: Record<DateMathUnit, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  H: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 0,
  y: 0,
}
const UNIT_MONTHS: Record<DateMathUnit, number> = { s: 0, m: 0, h: 0, H: 0, d: 0, w: 0, M: 1, y: 12 }
// How many of year, month, day, hour, minute, second a rounding keeps
const ROUND_KEEP: Record<DateMathUnit, number> = { y: 1, M: 2, w: 3, d: 3, h: 4, H: 4, m: 5, s: 6 }
const WEEK_ALIGN: Record<DateMathUnit, number> = { s: 0, m: 0, h: 0, H: 0, d: 0, w: 1, M: 0, y: 0 }
const PART_FLOORS = [0, 0, 1, 0, 0, 0]

function timeText(value: unknown): string {
  return value === undefined || value === null ? '' : valueToText(value).trim()
}

function relativeOf([, sign, amount, unit, roundUnit]: RegExpExecArray, text: string): ParsedTimeValue {
  if (unit === undefined) {
    return { kind: 'relative', amount: 0, unit: roundUnit as TimeUnit, direction: 'ago', round: true }
  }
  if (roundUnit !== undefined && roundUnit !== unit) return { kind: 'date-math', text }
  return {
    kind: 'relative',
    amount: Number(amount),
    unit: unit as TimeUnit,
    direction: sign === '-' ? 'ago' : 'from-now',
    round: roundUnit !== undefined,
  }
}

function offsetMs(zone: string): number {
  const match = OFFSET_PATTERN.exec(zone)
  if (match === null) return 0
  const [, sign, hours, minutes] = match
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000
}

// Date, then optionally a clock after T or a space, then a zone only after a clock
function isoParts(text: string): string[] | null {
  const date = ISO_DATE_PATTERN.exec(text.slice(0, 10))
  const rest = text.slice(10)
  if (date === null || rest === '') return date
  const zone = ISO_ZONE_PATTERN.exec(rest)?.[0] ?? ''
  const clock = ISO_CLOCK_PATTERN.exec(rest.slice(0, rest.length - zone.length))
  return clock === null ? null : [...date, ...clock.slice(1), zone]
}

function parseIso(text: string): ParsedTimeValue | null {
  const match = isoParts(text)
  if (match === null) return null
  const [, year, month, day, hours = '00', minutes = '00', seconds = '00', fraction = '', zone = ''] = match
  const wall = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  const wallMs = Date.UTC(+year, +month - 1, +day, +hours, +minutes, +seconds)
  // A rolled-over date (month 13, February 30) does not read back as written
  if (new Date(wallMs).toISOString().slice(0, 19) !== wall) return null
  const epochMs = wallMs + Number(fraction.slice(0, 3).padEnd(3, '0')) - offsetMs(zone)
  return { kind: 'absolute', epochMs, zoneless: zone === '' }
}

/** Reads a From / To literal; numbers are read as their digits. */
export function parseTimeValue(value: unknown): ParsedTimeValue {
  const text = timeText(value)
  if (text === '') return { kind: 'blank' }
  if (text === 'now') return { kind: 'now' }
  const relative = RELATIVE_PATTERN.exec(text)
  if (relative !== null) return relativeOf(relative, text)
  if (DATE_MATH_PATTERN.test(text)) return { kind: 'date-math', text }
  if (EPOCH_SECONDS_PATTERN.test(text)) return { kind: 'epoch-seconds', text }
  if (EPOCH_MS_PATTERN.test(text)) return { kind: 'absolute', epochMs: Number(text), zoneless: false }
  return parseIso(text) ?? { kind: 'invalid', text }
}

/** True for `now` and every other date-math value, which moves with the clock. */
export function isDateMath(parsed: ParsedTimeValue): boolean {
  return DATE_MATH_KINDS.has(parsed.kind)
}

function relativeWords({ amount, unit, direction, round }: RelativeControls): string {
  const unitName = UNIT_NAMES[unit]
  const when = direction === 'ago' ? 'ago' : 'from now'
  const base = amount === 0 ? 'now' : `${pluralize(amount, unitName)} ${when}`
  return round ? `${base}, rounded to the ${unitName}` : base
}

function shown(words: string, tab: TimeTab): TimeValueDescription {
  return { words, tab, hint: null, error: null }
}

/** The row trigger: the value in words, the tab its popover opens on, the muted hint and the red error. */
export function describeTimeValue(value: unknown, { label, defaultValue }: TimeRow): TimeValueDescription {
  const parsed = parseTimeValue(value)
  const read = parsed.kind === 'blank' ? parseTimeValue(defaultValue) : parsed
  switch (read.kind) {
    case 'relative':
      return shown(relativeWords(read), 'relative')
    case 'date-math':
      return shown(read.text, 'relative')
    case 'absolute':
      return {
        ...shown(formatTimestamp(new Date(read.epochMs).toISOString(), 'picker', 'utc'), 'absolute'),
        hint: read.zoneless ? NO_ZONE_HINT : null,
      }
    case 'epoch-seconds':
      return { ...shown(read.text, 'absolute'), error: `${label} reads as epoch seconds: for seconds, multiply by 1000` }
    case 'invalid':
      return { ...shown(read.text, 'absolute'), error: `${label} is not a time: use Absolute, Relative or Now` }
    default:
      return shown('now', 'now')
  }
}

/** The Relative tab's value: `now-15m`, `now+2d/d`, `now` for amount 0. */
export function buildRelativeValue({ amount, unit, direction, round }: RelativeControls): string {
  const sign = direction === 'ago' ? '-' : '+'
  const base = amount === 0 ? 'now' : `now${sign}${amount}${unit}`
  return round ? `${base}/${unit}` : base
}

/** The Absolute tab's value: `YYYY-MM-DDTHH:MM:SSZ`, milliseconds dropped. */
export function buildAbsoluteValue(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

// Calendar months, the day clamped to the target month's last day
function addMonths(ms: number, months: number): number {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  )
}

// Down to the start of the unit; weeks start on Monday
function roundDown(ms: number, unit: DateMathUnit): number {
  const date = new Date(ms)
  const mondayShift = WEEK_ALIGN[unit] * ((date.getUTCDay() + 6) % 7)
  const parts = [
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - mondayShift,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ]
  const [year, month, day, hours, minutes, seconds] = parts.map((part, index) =>
    index < ROUND_KEEP[unit] ? part : PART_FLOORS[index],
  )
  return Date.UTC(year, month, day, hours, minutes, seconds)
}

function addUnits(ms: number, count: number, unit: DateMathUnit): number {
  return addMonths(ms + count * UNIT_MS[unit], count * UNIT_MONTHS[unit])
}

function applyDateMath(steps: string, startMs: number): number {
  let ms = startMs
  for (const [, sign, amount, unit, roundUnit] of steps.matchAll(DATE_MATH_STEP)) {
    ms =
      roundUnit === undefined
        ? addUnits(ms, Number(`${sign}${amount}`), unit as DateMathUnit)
        : roundDown(ms, roundUnit as DateMathUnit)
  }
  return ms
}

/** The instant a value stands for at `now`; null for a blank value or one that is not a time. */
export function resolveTimeValue(value: unknown, now: Date): Date | null {
  const parsed = parseTimeValue(value)
  if (parsed.kind === 'absolute') return new Date(parsed.epochMs)
  if (!isDateMath(parsed)) return null
  return new Date(applyDateMath(timeText(value).slice('now'.length), now.getTime()))
}
