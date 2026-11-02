/**
 * OpenSearch Stats entries: labels, words, column names and the Stat change rule (OS-7, REQ-3.3.3.2).
 */

import { PLAIN_INTEGER, plainNumberText, withoutTrailingZeros } from '@/lib/number-rule'

export type StatKind =
  | 'count'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'percentile'
  | 'unique_count'
  | 'increase'
  | 'custom'

export interface StatEntry {
  stat: StatKind
  field?: string
  /** The number wire form: a JS number when exact, else its digit text (REQ-3.1.3.14). */
  percent?: number | string
  json?: string
  name?: string
}

export type StatFieldTypes = 'numeric' | 'aggregatable'

const DEFAULT_PERCENT = 95

const STAT_LABELS: Record<StatKind, string> = {
  count: 'Count',
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  percentile: 'Percentile',
  unique_count: 'Unique count',
  increase: 'Increase',
  custom: 'Custom (JSON)',
}

const FIELD_TYPES: Record<StatKind, StatFieldTypes | null> = {
  count: null,
  sum: 'numeric',
  average: 'numeric',
  min: 'numeric',
  max: 'numeric',
  percentile: 'numeric',
  unique_count: 'aggregatable',
  increase: 'numeric',
  custom: null,
}

export const STAT_OPTIONS: readonly { value: StatKind; label: string }[] = (
  Object.keys(STAT_LABELS) as StatKind[]
).map((value) => ({ value, label: STAT_LABELS[value] }))

const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th']

export function statLabel(stat: StatKind): string {
  return STAT_LABELS[stat]
}

/** The field kind the stat's Field offers, or null when the stat takes no field. */
export function statFieldTypes(stat: StatKind): StatFieldTypes | null {
  return FIELD_TYPES[stat]
}

export function statTakesPercent(stat: StatKind): boolean {
  return stat === 'percentile'
}

/** A percent in plain digits, its exact value in shortest form as the run names its column (95, 99.9, 0.0000001). */
export function formatPercent(percent: number | string): string {
  const text = plainNumberText(percent)
  return text.includes('.') ? withoutTrailingZeros(text).replace(/\.$/, '') : text
}

/** 1st, 2nd, 3rd, 11th, 21st; a non-integral number takes th (99.9th). */
export function ordinal(n: number | string): string {
  const text = formatPercent(n)
  const teen = text.at(-2) === '1'
  const suffix = PLAIN_INTEGER.test(text) && !teen ? ORDINAL_SUFFIXES[Number(text.at(-1))] : 'th'
  return `${text}${suffix}`
}

function customColumn(entry: StatEntry, position: number): string {
  const name = (entry.name ?? '').trim()
  return name === '' ? `custom ${position}` : name
}

function fieldOf(entry: StatEntry): string {
  return (entry.field ?? '').trim()
}

/** The entry trigger's words: `Sum of bytes`, `95th percentile of latency_ms`, `Custom: custom 3`. */
export function statEntryWords(entry: StatEntry, position: number): string {
  const { stat, percent = DEFAULT_PERCENT } = entry
  const label = STAT_LABELS[stat]
  if (stat === 'custom') return `Custom: ${customColumn(entry, position)}`
  if (FIELD_TYPES[stat] === null) return label
  const field = fieldOf(entry)
  if (field === '') return `${label} (no field)`
  return statTakesPercent(stat) ? `${ordinal(percent)} percentile of ${field}` : `${label} of ${field}`
}

/** The Results column the entry makes, or null while a stat that needs a field has none. */
export function statColumnName(entry: StatEntry, position: number): string | null {
  const { stat, percent = DEFAULT_PERCENT } = entry
  if (stat === 'custom') return customColumn(entry, position)
  if (FIELD_TYPES[stat] === null) return stat
  const field = fieldOf(entry)
  if (field === '') return null
  const noun = statTakesPercent(stat) ? `percentile ${formatPercent(percent)}` : STAT_LABELS[stat].toLowerCase()
  return `${noun} of ${field}`
}

/** The Add stat entry. */
export function newStatEntry(): StatEntry {
  return { stat: 'sum', field: '' }
}

/** The entry after its Stat changes: keeps what the new stat takes, drops the rest. */
export function changeStat(entry: StatEntry, stat: StatKind): StatEntry {
  if (stat === 'custom') {
    const { json, name } = entry
    return { stat, ...definedOnly({ json, name }) }
  }
  if (FIELD_TYPES[stat] === null) return { stat }
  const next: StatEntry = { stat, field: entry.field ?? '' }
  return statTakesPercent(stat) ? { ...next, percent: entry.percent ?? DEFAULT_PERCENT } : next
}

function definedOnly<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>
}
