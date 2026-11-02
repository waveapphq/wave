// REQ-3.1.3.20: the Edit-value button preview reads null for a null value of every type (VMGR-93).

import { describe, it, expect } from 'vitest'

import { getValuePreview } from '@/lib/variable-value-preview'
import { VARIABLE_TYPES } from '@/lib/variable-types'

describe('getValuePreview - a null value', () => {
  it.each(VARIABLE_TYPES)('previews a null %s as null', (type) => {
    expect(getValuePreview(type, null)).toBe('null')
  })

  it.each(VARIABLE_TYPES)('previews no value of type %s as null', (type) => {
    expect(getValuePreview(type, undefined)).toBe('null')
  })
})

describe('getValuePreview - values next to null keep their preview', () => {
  it('previews an empty string as Edit…', () => {
    expect(getValuePreview('string', '')).toBe('Edit…')
  })

  it('previews a string in quotes', () => {
    expect(getValuePreview('string', 'hello')).toBe('"hello"')
  })

  it('previews a string holding the text "null" as a quoted string', () => {
    expect(getValuePreview('string', 'null')).toBe('"null"')
  })

  it('previews an empty list as 0 items', () => {
    expect(getValuePreview('array', [])).toBe('0 items')
  })

  it('previews a list by its item count', () => {
    expect(getValuePreview('array', [1, 2, 3])).toBe('3 items')
  })

  it('previews an empty map as 0 pairs', () => {
    expect(getValuePreview('map', {})).toBe('0 pairs')
  })
})

describe('getValuePreview - a table', () => {
  it('previews a table of row objects by its rows and columns', () => {
    expect(getValuePreview('table', [{ a: 1, b: 2 }, { a: 3, b: 4 }])).toBe('2 rows x 2 col')
  })

  it('previews a table stored with its column types by its rows and columns', () => {
    const stored = {
      columns: [
        { name: 'n', type: 'integer' },
        { name: 'zip', type: 'string' },
      ],
      rows: [['16', '02134']],
    }
    expect(getValuePreview('table', stored)).toBe('1 rows x 2 col')
  })

  it('previews a table stored with its column types and no rows by its columns', () => {
    expect(getValuePreview('table', { columns: [{ name: 'n', type: 'integer' }], rows: [] })).toBe(
      '0 rows x 1 col',
    )
  })

  it('previews an empty table as 0 rows x 0 col', () => {
    expect(getValuePreview('table', [])).toBe('0 rows x 0 col')
  })

  it('previews a table value that is no table as Edit…', () => {
    expect(getValuePreview('table', 'orders')).toBe('Edit…')
  })
})
