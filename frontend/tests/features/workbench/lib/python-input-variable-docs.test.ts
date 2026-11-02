/**
 * Tests for the documentation text the Python editor's completion panel shows
 * beside an Input Variable (PYRUN-19). The wording states the origin and the
 * Python type the script receives, which is PYRUN-5's mapping.
 */

import { describe, it, expect } from 'vitest'
import { pythonInputVariableDoc } from '@/features/workbench/lib/python-input-variable-docs'

const TABLE_ACCESS = 'Rows are dicts; iterate, index, len(); .columns and .rows.'

describe('pythonInputVariableDoc - scalar types', () => {
  it('names the origin and str for a string', () => {
    expect(pythonInputVariableDoc('string')).toBe('Input Variable. Arrives as a str.')
  })

  it('names the origin and int for an integer', () => {
    expect(pythonInputVariableDoc('integer')).toBe('Input Variable. Arrives as an int.')
  })

  it('names Decimal for a float, because a WAVE float is exact', () => {
    expect(pythonInputVariableDoc('float')).toBe('Input Variable. Arrives as a Decimal.')
  })

  it('names bool for a boolean', () => {
    expect(pythonInputVariableDoc('boolean')).toBe('Input Variable. Arrives as a bool.')
  })

  it('names None for a null', () => {
    expect(pythonInputVariableDoc('null')).toBe('Input Variable. Arrives as None.')
  })
})

describe('pythonInputVariableDoc - container types', () => {
  it('names list and its access forms for an array', () => {
    expect(pythonInputVariableDoc('array')).toBe(
      'Input Variable. Arrives as a list; iterate, index, len().',
    )
  })

  it('names dict and its access forms for a map', () => {
    expect(pythonInputVariableDoc('map')).toBe(
      'Input Variable. Arrives as a dict; index by key, .get(), .items().',
    )
  })
})

describe('pythonInputVariableDoc - table', () => {
  const ROWS = [
    { sensor: 'north', temp_c: 28.4, taken_at: '2026-09-18T08:00:00Z' },
    { sensor: 'south', temp_c: 31.2, taken_at: '2026-09-18T08:05:00Z' },
  ]

  it('counts and names the columns of a row-object table', () => {
    expect(pythonInputVariableDoc('table', ROWS)).toBe(
      `Input Variable. Arrives as a table with 3 columns: sensor, temp_c, taken_at. ${TABLE_ACCESS}`,
    )
  })

  it('reads the columns of a columns/rows table too', () => {
    const value = {
      columns: [{ name: 'id' }, { name: 'ok' }],
      rows: [[1, true]],
    }

    expect(pythonInputVariableDoc('table', value)).toBe(
      `Input Variable. Arrives as a table with 2 columns: id, ok. ${TABLE_ACCESS}`,
    )
  })

  it('says column in the singular for a one-column table', () => {
    expect(pythonInputVariableDoc('table', [{ id: 1 }])).toBe(
      `Input Variable. Arrives as a table with 1 column: id. ${TABLE_ACCESS}`,
    )
  })

  it('drops the column clause when the bound value is not a table', () => {
    expect(pythonInputVariableDoc('table', 'not a table')).toBe(
      `Input Variable. Arrives as a table. ${TABLE_ACCESS}`,
    )
  })

  it('drops the column clause when no value is bound', () => {
    expect(pythonInputVariableDoc('table')).toBe(
      `Input Variable. Arrives as a table. ${TABLE_ACCESS}`,
    )
  })

  it('carries every fact the completion panel is asked for', () => {
    const doc = pythonInputVariableDoc('table', ROWS)

    expect(doc).toContain('Input Variable')
    expect(doc).toContain('3 columns: sensor, temp_c, taken_at')
    expect(doc).toContain('Rows are dicts; iterate, index, len(); .columns and .rows')
  })
})

describe('pythonInputVariableDoc - unmapped type', () => {
  it('names the origin alone when the type has no Python mapping', () => {
    expect(pythonInputVariableDoc('widget')).toBe('Input Variable.')
  })
})
