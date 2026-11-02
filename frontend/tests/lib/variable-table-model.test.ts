/**
 * Tests for the table render model normalizer and the `isTableShape`
 * predicate.
 *
 * Contract under test:
 *   - `toTableRenderModel` accepts BOTH stored table shapes the render edge
 *     sees: array-of-row-objects (FE design-time values) and the
 *     `{columns: [{name, type}], rows: [[...]]}` dict (the new workbench
 *     session variables endpoint / core Table serialization)
 *   - anything else (array-of-arrays, summary envelopes, scalars, garbage)
 *     normalizes to the defensive EMPTY model
 *   - `isTableShape` recognizes exactly those two table shapes for the
 *     type-mismatch guard: array of plain non-array objects (empty array
 *     passes) OR a `{columns: unknown[], rows: unknown[]}` dict
 *   - value-model canonization is out of scope - this is render-edge only
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'

import { isTableShape, toStoredTable, toTableRenderModel } from '@/lib/variable-table-model'

const EMPTY_MODEL = { columns: [], rows: [] }

describe('toTableRenderModel - columns/rows dict shape', () => {
  it('preserves column names, column types, and row arrays', () => {
    const value = {
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
      rows: [
        [1, 'alpha'],
        [2, 'beta'],
      ],
    }

    expect(toTableRenderModel(value)).toEqual({
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
      rows: [
        [1, 'alpha'],
        [2, 'beta'],
      ],
    })
  })

  it('preserves the column schema of a zero-row table', () => {
    const value = {
      columns: [
        { name: 'col_a', type: 'string' },
        { name: 'col_b', type: 'float' },
      ],
      rows: [],
    }

    const model = toTableRenderModel(value)
    expect(model.columns.map((c) => c.name)).toEqual(['col_a', 'col_b'])
    expect(model.rows).toEqual([])
  })

  it('accepts column entries without a type', () => {
    const value = { columns: [{ name: 'a' }], rows: [['x']] }

    const model = toTableRenderModel(value)
    expect(model.columns).toHaveLength(1)
    expect(model.columns[0].name).toBe('a')
    expect(model.columns[0].type).toBeUndefined()
    expect(model.rows).toEqual([['x']])
  })
})

describe('toTableRenderModel - array-of-row-objects shape', () => {
  it('derives columns from the first row keys in key order', () => {
    const value = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]

    const model = toTableRenderModel(value)
    expect(model.columns.map((c) => c.name)).toEqual(['id', 'name'])
  })

  it('converts row objects to value arrays in column order', () => {
    const value = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]

    expect(toTableRenderModel(value).rows).toEqual([
      [1, 'alpha'],
      [2, 'beta'],
    ])
  })

  it('normalizes an empty array to the empty model', () => {
    expect(toTableRenderModel([])).toEqual(EMPTY_MODEL)
  })
})

describe('toTableRenderModel - defensive empty model', () => {
  it('normalizes array-of-arrays to the empty model', () => {
    expect(
      toTableRenderModel([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual(EMPTY_MODEL)
  })

  it('normalizes the table summary envelope to the empty model', () => {
    // {rows, cols, changed} is the WS push summary - never a renderable table.
    expect(toTableRenderModel({ rows: 3, cols: 4, changed: true })).toEqual(
      EMPTY_MODEL,
    )
  })

  it.each([
    ['a string', 'nonsense'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['a non-table object', { foo: 1 }],
  ])('normalizes %s to the empty model', (_label, value) => {
    expect(toTableRenderModel(value)).toEqual(EMPTY_MODEL)
  })
})

// ===========================================================================
// isTableShape (the valueMatchesType table rule)
// ===========================================================================

describe('isTableShape - accepted table shapes', () => {
  it('accepts an array of plain row objects', () => {
    expect(
      isTableShape([
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
      ]),
    ).toBe(true)
  })

  it('accepts a single-row object array', () => {
    expect(isTableShape([{ id: 1 }])).toBe(true)
  })

  it('accepts the empty array (zero-row table)', () => {
    expect(isTableShape([])).toBe(true)
  })

  it('accepts the {columns, rows} dict (core Table serialization)', () => {
    expect(
      isTableShape({
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
        ],
        rows: [
          [1, 'alpha'],
          [2, 'beta'],
        ],
      }),
    ).toBe(true)
  })

  it('accepts the bare empty {columns: [], rows: []} dict', () => {
    expect(isTableShape({ columns: [], rows: [] })).toBe(true)
  })
})

describe('isTableShape - rejections', () => {
  it('rejects an array of scalars', () => {
    expect(isTableShape([1, 2])).toBe(false)
  })

  it('rejects an array of arrays', () => {
    expect(
      isTableShape([
        [1, 2],
        [3, 4],
      ]),
    ).toBe(false)
  })

  it('rejects an array with a null member', () => {
    expect(isTableShape([{ id: 1 }, null])).toBe(false)
  })

  it('rejects an array mixing row objects and scalars', () => {
    expect(isTableShape([{ id: 1 }, 2])).toBe(false)
  })

  it('rejects a plain map (non-table dict)', () => {
    expect(isTableShape({ foo: 1 })).toBe(false)
  })

  it('rejects the table summary envelope {rows, cols, changed}', () => {
    expect(isTableShape({ rows: 3, cols: 4, changed: true })).toBe(false)
  })

  it('rejects a dict whose columns is not an array', () => {
    expect(isTableShape({ columns: 'id,name', rows: [] })).toBe(false)
  })

  it('rejects a dict missing rows', () => {
    expect(isTableShape({ columns: [] })).toBe(false)
  })

  it.each([
    ['a string', 'nonsense'],
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isTableShape(value)).toBe(false)
  })
})

describe('toStoredTable - the {columns, rows} form a table is stored in (REQ-3.5.5.4)', () => {
  const SCHEMA = [
    { name: 'id', type: 'integer' },
    { name: 'price', type: 'float' },
    { name: 'active', type: 'boolean' },
  ]

  it('stores row objects as rows under the schema columns, cells as written', () => {
    const rows = [
      { id: '7', price: '2.50', active: true },
      { id: null, price: '3', active: false },
    ]
    expect(toStoredTable(rows, SCHEMA)).toEqual({
      columns: SCHEMA,
      rows: [
        ['7', '2.50', true],
        [null, '3', false],
      ],
    })
  })

  it('orders each row by the schema, not by its own key order', () => {
    expect(toStoredTable([{ active: true, price: '1', id: '2' }], SCHEMA)).toEqual({
      columns: SCHEMA,
      rows: [['2', '1', true]],
    })
  })

  it('keeps the columns of a table with no rows', () => {
    expect(toStoredTable([], SCHEMA)).toEqual({ columns: SCHEMA, rows: [] })
  })

  it('re-stores a {columns, rows} value under the schema types', () => {
    const value = { columns: [{ name: 'id', type: 'string' }], rows: [['7']] }
    expect(toStoredTable(value, [{ name: 'id', type: 'integer' }])).toEqual({
      columns: [{ name: 'id', type: 'integer' }],
      rows: [['7']],
    })
  })

  it.each([
    ['a list that is not rows', [1, 2]],
    ['a map that is not a table', { a: 1 }],
    ['text', 'nonsense'],
    ['null', null],
  ])('leaves %s as it is', (_label, value) => {
    expect(toStoredTable(value, SCHEMA)).toBe(value)
  })

  it('leaves a table with no column to type as it is', () => {
    const empty: unknown[] = []
    expect(toStoredTable(empty, [])).toBe(empty)
  })
})
