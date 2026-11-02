/** OpenSearch Stats entries (OS-7, REQ-3.3.3.2). */

import { describe, it, expect } from 'vitest'
import {
  STAT_OPTIONS,
  changeStat,
  formatPercent,
  newStatEntry,
  ordinal,
  statColumnName,
  statEntryWords,
  statFieldTypes,
  statLabel,
  statTakesPercent,
  type StatEntry,
  type StatKind,
} from '@/features/workbench/lib/opensearch/stat-entries'

const FIELD_STATS: StatKind[] = ['sum', 'average', 'min', 'max', 'percentile', 'unique_count', 'increase']

describe('Stat labels', () => {
  it('lists the Stat select options in order', () => {
    expect(STAT_OPTIONS).toEqual([
      { value: 'count', label: 'Count' },
      { value: 'sum', label: 'Sum' },
      { value: 'average', label: 'Average' },
      { value: 'min', label: 'Min' },
      { value: 'max', label: 'Max' },
      { value: 'percentile', label: 'Percentile' },
      { value: 'unique_count', label: 'Unique count' },
      { value: 'increase', label: 'Increase' },
      { value: 'custom', label: 'Custom (JSON)' },
    ])
  })

  it.each<[StatKind, string]>([
    ['count', 'Count'],
    ['sum', 'Sum'],
    ['average', 'Average'],
    ['min', 'Min'],
    ['max', 'Max'],
    ['percentile', 'Percentile'],
    ['unique_count', 'Unique count'],
    ['increase', 'Increase'],
    ['custom', 'Custom (JSON)'],
  ])('labels %s as %s', (stat, label) => {
    expect(statLabel(stat)).toBe(label)
  })
})

describe('entry words and column names', () => {
  it.each<[StatEntry, number, string, string]>([
    [{ stat: 'count' }, 1, 'Count', 'count'],
    [{ stat: 'sum', field: 'bytes' }, 1, 'Sum of bytes', 'sum of bytes'],
    [{ stat: 'average', field: 'latency_ms' }, 1, 'Average of latency_ms', 'average of latency_ms'],
    [{ stat: 'min', field: 'x' }, 1, 'Min of x', 'min of x'],
    [{ stat: 'max', field: 'x' }, 1, 'Max of x', 'max of x'],
    [
      { stat: 'percentile', field: 'latency_ms', percent: 95 },
      1,
      '95th percentile of latency_ms',
      'percentile 95 of latency_ms',
    ],
    [{ stat: 'percentile', field: 'x', percent: 99.9 }, 1, '99.9th percentile of x', 'percentile 99.9 of x'],
    [{ stat: 'unique_count', field: 'user.id' }, 1, 'Unique count of user.id', 'unique count of user.id'],
    [
      { stat: 'increase', field: 'requests_total' },
      1,
      'Increase of requests_total',
      'increase of requests_total',
    ],
    [
      { stat: 'custom', json: '{"percentiles": {"field": "latency_ms"}}', name: 'p99 via tdigest' },
      3,
      'Custom: p99 via tdigest',
      'p99 via tdigest',
    ],
    [{ stat: 'custom', json: '{"avg": {"field": "latency_ms"}}' }, 3, 'Custom: custom 3', 'custom 3'],
  ])('words %j at position %i as %s, column %s', (entry, position, words, column) => {
    expect(statEntryWords(entry, position)).toBe(words)
    expect(statColumnName(entry, position)).toBe(column)
  })

  describe('percentile words', () => {
    it.each([
      [1, '1st percentile of x', 'percentile 1 of x'],
      [2, '2nd percentile of x', 'percentile 2 of x'],
      [3, '3rd percentile of x', 'percentile 3 of x'],
      [50, '50th percentile of x', 'percentile 50 of x'],
      [99, '99th percentile of x', 'percentile 99 of x'],
      [100, '100th percentile of x', 'percentile 100 of x'],
      [0.5, '0.5th percentile of x', 'percentile 0.5 of x'],
      [99.99, '99.99th percentile of x', 'percentile 99.99 of x'],
    ])('words percent %d as %s', (percent, words, column) => {
      const entry: StatEntry = { stat: 'percentile', field: 'x', percent }
      expect(statEntryWords(entry, 1)).toBe(words)
      expect(statColumnName(entry, 1)).toBe(column)
    })
  })

  describe('Custom (JSON) naming', () => {
    it.each([
      [1, 'custom 1'],
      [2, 'custom 2'],
      [12, 'custom 12'],
    ])('names an unnamed custom entry at position %i %s', (position, column) => {
      const entry: StatEntry = { stat: 'custom', json: '{"avg": {"field": "x"}}' }
      expect(statColumnName(entry, position)).toBe(column)
      expect(statEntryWords(entry, position)).toBe(`Custom: ${column}`)
    })

    it.each(['', '   '])('names a custom entry with the blank name %j by its position', (name) => {
      const entry: StatEntry = { stat: 'custom', json: '{"avg": {"field": "x"}}', name }
      expect(statColumnName(entry, 2)).toBe('custom 2')
      expect(statEntryWords(entry, 2)).toBe('Custom: custom 2')
    })

    it('names a custom entry with no JSON yet the same way', () => {
      expect(statColumnName({ stat: 'custom' }, 4)).toBe('custom 4')
    })
  })

  describe('a stat that needs a field, field blank', () => {
    it.each<[StatKind, string]>([
      ['sum', 'Sum (no field)'],
      ['average', 'Average (no field)'],
      ['min', 'Min (no field)'],
      ['max', 'Max (no field)'],
      ['unique_count', 'Unique count (no field)'],
      ['increase', 'Increase (no field)'],
      ['percentile', 'Percentile (no field)'],
    ])('words %s with a blank field as %s and makes no column name', (stat, words) => {
      const entry: StatEntry = stat === 'percentile' ? { stat, field: '', percent: 95 } : { stat, field: '' }
      expect(statEntryWords(entry, 1)).toBe(words)
      expect(statColumnName(entry, 1)).toBeNull()
    })

    it('treats a missing field as blank', () => {
      expect(statEntryWords({ stat: 'sum' }, 1)).toBe('Sum (no field)')
      expect(statColumnName({ stat: 'sum' }, 1)).toBeNull()
    })

    it('treats a field of only spaces as blank', () => {
      expect(statEntryWords({ stat: 'sum', field: '   ' }, 1)).toBe('Sum (no field)')
      expect(statColumnName({ stat: 'sum', field: '   ' }, 1)).toBeNull()
    })
  })

  it('names a non-custom entry the same at any position', () => {
    expect(statColumnName({ stat: 'sum', field: 'bytes' }, 5)).toBe('sum of bytes')
    expect(statEntryWords({ stat: 'sum', field: 'bytes' }, 5)).toBe('Sum of bytes')
  })

  it('ignores a field on Count, which takes none', () => {
    expect(statEntryWords({ stat: 'count', field: 'bytes' }, 1)).toBe('Count')
    expect(statColumnName({ stat: 'count', field: 'bytes' }, 1)).toBe('count')
  })
})

describe('ordinal', () => {
  it.each([
    [0, '0th'],
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [14, '14th'],
    [20, '20th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [24, '24th'],
    [95, '95th'],
    [99, '99th'],
    [100, '100th'],
    [101, '101st'],
    [102, '102nd'],
    [103, '103rd'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
    [121, '121st'],
  ])('writes %i as %s', (n, text) => {
    expect(ordinal(n)).toBe(text)
  })

  it.each([
    [99.9, '99.9th'],
    [0.5, '0.5th'],
    [21.1, '21.1th'],
    [2.2, '2.2th'],
    [3.3, '3.3th'],
  ])('gives the non-integral %d the th suffix: %s', (n, text) => {
    expect(ordinal(n)).toBe(text)
  })
})

// A percent shows in plain digits, in the shortest form of its exact value, as the run names its column (REQ-3.1.3.14).
describe('formatPercent and ordinal - plain digits', () => {
  it.each([
    [0.0000001, '0.0000001'],
    ['99.90', '99.9'],
    ['95.0', '95'],
    ['0.50', '0.5'],
    ['100', '100'],
    ['12345678901234567890', '12345678901234567890'],
  ])('writes %j as %s', (percent, text) => {
    expect(formatPercent(percent)).toBe(text)
  })

  it.each([
    ['21', '21st'],
    ['111', '111th'],
    ['95.0', '95th'],
    [0.0000001, '0.0000001th'],
  ])('writes the percent %j as %s', (percent, text) => {
    expect(ordinal(percent)).toBe(text)
  })

  it('names the column and the trigger by the exact value the run names its column by', () => {
    const entry = { stat: 'percentile' as const, field: 'latency_ms', percent: '99.90' }
    expect(statColumnName(entry, 1)).toBe('percentile 99.9 of latency_ms')
    expect(statEntryWords(entry, 1)).toBe('99.9th percentile of latency_ms')
  })
})

describe('formatPercent', () => {
  it.each([
    [95, '95'],
    [100, '100'],
    [0, '0'],
    [99.9, '99.9'],
    [99.99, '99.99'],
    [0.5, '0.5'],
    [12.5, '12.5'],
  ])('writes %d as %s', (percent, text) => {
    expect(formatPercent(percent)).toBe(text)
  })
})

describe('what each stat takes', () => {
  it.each<[StatKind, 'numeric' | 'aggregatable' | null]>([
    ['count', null],
    ['sum', 'numeric'],
    ['average', 'numeric'],
    ['min', 'numeric'],
    ['max', 'numeric'],
    ['percentile', 'numeric'],
    ['unique_count', 'aggregatable'],
    ['increase', 'numeric'],
    ['custom', null],
  ])('offers %s the field kind %s', (stat, types) => {
    expect(statFieldTypes(stat)).toBe(types)
  })

  it.each<[StatKind, boolean]>([
    ['count', false],
    ['sum', false],
    ['average', false],
    ['min', false],
    ['max', false],
    ['percentile', true],
    ['unique_count', false],
    ['increase', false],
    ['custom', false],
  ])('%s takes a percent: %s', (stat, takes) => {
    expect(statTakesPercent(stat)).toBe(takes)
  })
})

describe('newStatEntry', () => {
  it('makes the Add stat default: Sum with a blank field', () => {
    expect(newStatEntry()).toEqual({ stat: 'sum', field: '' })
  })

  it('makes a fresh entry each time', () => {
    expect(newStatEntry()).not.toBe(newStatEntry())
  })
})

describe('changeStat', () => {
  it.each(FIELD_STATS.filter((stat) => stat !== 'percentile'))('keeps the field when %s takes one', (stat) => {
    expect(changeStat({ stat: 'sum', field: 'bytes' }, stat)).toEqual({ stat, field: 'bytes' })
  })

  it('keeps the field and sets Percent to 95 when Percentile is first chosen', () => {
    expect(changeStat({ stat: 'sum', field: 'bytes' }, 'percentile')).toEqual({
      stat: 'percentile',
      field: 'bytes',
      percent: 95,
    })
  })

  it('keeps the percent when Percentile stays chosen', () => {
    expect(changeStat({ stat: 'percentile', field: 'x', percent: 99 }, 'percentile')).toEqual({
      stat: 'percentile',
      field: 'x',
      percent: 99,
    })
  })

  it('drops the percent when leaving Percentile', () => {
    const next = changeStat({ stat: 'percentile', field: 'x', percent: 99 }, 'max')
    expect(next).toEqual({ stat: 'max', field: 'x' })
    expect(next.percent).toBeUndefined()
  })

  it('drops the field when the new stat is Count', () => {
    const next = changeStat({ stat: 'sum', field: 'bytes' }, 'count')
    expect(next).toEqual({ stat: 'count' })
    expect(next.field).toBeUndefined()
  })

  it('drops the field and the percent when the new stat is Custom (JSON)', () => {
    const next = changeStat({ stat: 'percentile', field: 'x', percent: 99 }, 'custom')
    expect(next.stat).toBe('custom')
    expect(next.field).toBeUndefined()
    expect(next.percent).toBeUndefined()
  })

  it('drops the JSON and the name when leaving Custom (JSON)', () => {
    const next = changeStat({ stat: 'custom', json: '{"avg": {"field": "x"}}', name: 'mean x' }, 'sum')
    expect(next.stat).toBe('sum')
    expect(next.json).toBeUndefined()
    expect(next.name).toBeUndefined()
    expect(next.field ?? '').toBe('')
  })

  it('drops the JSON and the name when Custom (JSON) becomes Count', () => {
    expect(changeStat({ stat: 'custom', json: '{"avg": {"field": "x"}}', name: 'mean x' }, 'count')).toEqual({
      stat: 'count',
    })
  })

  it('keeps the JSON and the name when Custom (JSON) stays chosen', () => {
    const entry: StatEntry = { stat: 'custom', json: '{"avg": {"field": "x"}}', name: 'mean x' }
    expect(changeStat(entry, 'custom')).toEqual(entry)
  })

  it('sets Percent to 95 when Count becomes Percentile, with a blank field', () => {
    const next = changeStat({ stat: 'count' }, 'percentile')
    expect(next.stat).toBe('percentile')
    expect(next.percent).toBe(95)
    expect(next.field ?? '').toBe('')
  })

  it('leaves the entry it was given unchanged', () => {
    const entry: StatEntry = Object.freeze({ stat: 'percentile', field: 'x', percent: 99 })
    changeStat(entry, 'count')
    expect(entry).toEqual({ stat: 'percentile', field: 'x', percent: 99 })
  })
})
