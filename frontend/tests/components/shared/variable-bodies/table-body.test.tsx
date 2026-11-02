/**
 * Tests for TableBody - the shared table mini-grid Visual body (VMGR-26).
 *
 * Contract under test:
 *   - semantic <table> with <th scope="col"> headers, sticky uppercase header
 *   - FIRST column is a dedicated muted 0-based row-index "#" column with
 *     aria-label "Row index"; data columns follow
 *   - consumes the normalized render model: accepts BOTH array-of-row-objects
 *     and the {columns, rows} dict
 *   - per-cell tint by the cell value's OWN type; strings quoted
 *   - horizontal scroll wrapper
 *   - empty value: centered muted italic "no rows"
 *   - variant='initial': dim + italic wrapper
 *   - 500-row Visual cap + muted "+ N more - switch to Code view" line
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TableBody } from '@/components/shared/variable-bodies/table-body'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'

function nullLookClasses(): string[] {
  expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

const DICT_VALUE = {
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'name', type: 'string' },
    { name: 'active', type: 'boolean' },
  ],
  rows: [
    [1, 'alpha', true],
    [2, 'beta', false],
  ],
}

const ROW_OBJECTS_VALUE = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
]

function renderBody(value: unknown, variant: 'current' | 'initial' = 'current') {
  return render(<TableBody value={value} variant={variant} />)
}

function getRoot(): HTMLElement {
  return screen.getByTestId('table-body')
}

describe('TableBody - grid structure', () => {
  it('renders a semantic table with th scope="col" headers', () => {
    renderBody(DICT_VALUE)
    expect(screen.getByRole('table')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader')
    for (const th of headers) {
      expect(th).toHaveAttribute('scope', 'col')
    }
  })

  it('renders the "#" row-index header FIRST, then data columns in order', () => {
    renderBody(DICT_VALUE)
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent?.trim())).toEqual([
      '#',
      'id',
      'name',
      'active',
    ])
  })

  it('labels the "#" header "Row index" for screen readers', () => {
    renderBody(DICT_VALUE)
    expect(
      screen.getByRole('columnheader', { name: 'Row index' }),
    ).toBeInTheDocument()
  })

  it('renders the header sticky and uppercase', () => {
    renderBody(DICT_VALUE)
    const header = screen.getByRole('columnheader', { name: 'Row index' })
    expect(header.className).toMatch(/sticky/)
    expect(header.className).toMatch(/uppercase/)
  })

  it('renders a muted right-aligned 0-based index cell per row', () => {
    renderBody(DICT_VALUE)
    const indexes = screen.getAllByTestId('table-row-index')
    expect(indexes.map((el) => el.textContent)).toEqual(['0', '1'])
    for (const cell of indexes) {
      expect(cell.className).toMatch(/muted/)
      expect(cell.className).toMatch(/text-right/)
    }
  })

  it('wraps the grid for horizontal scrolling', () => {
    renderBody(DICT_VALUE)
    expect(getRoot().innerHTML).toMatch(/overflow-x/)
  })
})

describe('TableBody - accepted input shapes', () => {
  it('renders the {columns, rows} dict shape', () => {
    renderBody(DICT_VALUE)
    expect(screen.getByText('"alpha"')).toBeInTheDocument()
    expect(screen.getByText('"beta"')).toBeInTheDocument()
  })

  it('renders the array-of-row-objects shape', () => {
    renderBody(ROW_OBJECTS_VALUE)
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent?.trim())).toEqual([
      '#',
      'id',
      'name',
    ])
    expect(screen.getByText('"alpha"')).toBeInTheDocument()
  })

  it('renders garbage input as the empty state (defensive model)', () => {
    renderBody('not-a-table')
    expect(screen.getByText('no rows')).toBeInTheDocument()
  })
})

describe('TableBody - per-cell tinting', () => {
  it('tints each cell by its own value type', () => {
    renderBody(DICT_VALUE)
    // '2' (row 2 id) is the unambiguous integer cell: '1' always double-matches
    // the 0-based row-index column pinned to ['0', '1'] by the structure test.
    expect(screen.getByText('2').className).toMatch(/violet/)
    expect(screen.getByText('"alpha"').className).toMatch(/sky/)
    expect(screen.getByText('true').className).toMatch(/orange/)
  })

  it('renders float cells pink and null cells muted', () => {
    renderBody({
      columns: [
        { name: 'ratio', type: 'float' },
        { name: 'note', type: 'string' },
      ],
      rows: [[2.5, null]],
    })
    expect(screen.getByText('2.5').className).toMatch(/pink/)
    expect(screen.getByText('null').className).toMatch(/muted/)
  })

  it('renders nested map cells as compact one-line JSON in emerald', () => {
    renderBody({
      columns: [{ name: 'meta', type: 'string' }],
      rows: [[{ a: 1 }]],
    })
    expect(screen.getByText('{"a":1}').className).toMatch(/emerald/)
  })

  it('renders nested array cells as compact one-line JSON in amber', () => {
    renderBody({
      columns: [{ name: 'tags', type: 'string' }],
      rows: [[[1, 2]]],
    })
    expect(screen.getByText('[1,2]').className).toMatch(/amber/)
  })
})

describe('TableBody - empty state', () => {
  it('renders the centered muted italic "no rows" line for a zero-row table', () => {
    renderBody({ columns: [{ name: 'a', type: 'string' }], rows: [] })
    const empty = screen.getByText('no rows')
    expect(empty.className).toMatch(/italic/)
    expect(empty.className).toMatch(/muted/)
  })

  it('keeps "no rows" for an empty table, never null (REQ-3.1.3.20)', () => {
    renderBody([])
    expect(screen.getByText('no rows')).toHaveTextContent(/^no rows$/)
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })
})

describe('TableBody - null cells (VMGR-93)', () => {
  it('renders a null cell as null with the one null look', () => {
    renderBody({
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'note', type: 'string' },
      ],
      rows: [[7, null]],
    })
    const cell = screen.getByText('null')
    expect(cell).toHaveTextContent(/^null$/)
    expect(cell).toHaveClass(...nullLookClasses())
  })

  it('keeps a cell holding the text "null" a quoted string, without the null look', () => {
    renderBody([{ note: 'null' }])
    const cell = screen.getByText('"null"')
    const classes = nullLookClasses()
    expect(classes.every((name) => cell.classList.contains(name))).toBe(false)
  })
})

describe('TableBody - empty table with columns (VMGR-31)', () => {
  it('keeps the column header above the "no rows" line, so the columns it was set up with show', () => {
    renderBody({
      columns: [
        { name: '@timestamp', type: 'string' },
        { name: 'log.level', type: 'string' },
        { name: 'message', type: 'string' },
      ],
      rows: [],
    })
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())).toEqual([
      '#',
      '@timestamp',
      'log.level',
      'message',
    ])
    expect(screen.getByText('no rows')).toBeInTheDocument()
  })

  it('shows no header for a value with no columns', () => {
    renderBody({ columns: [], rows: [] })
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
    expect(screen.getByText('no rows')).toBeInTheDocument()
  })
})

describe('TableBody - initial variant', () => {
  it('dims and italicizes the whole body', () => {
    renderBody(DICT_VALUE, 'initial')
    expect(getRoot().className).toMatch(/italic/)
    expect(getRoot().className).toMatch(/opacity/)
  })

  it('keeps the current variant un-dimmed', () => {
    renderBody(DICT_VALUE, 'current')
    expect(getRoot().className).not.toMatch(/italic/)
    expect(getRoot().className).not.toMatch(/opacity-70/)
  })
})

describe('TableBody - 500-row Visual cap', () => {
  function bigTable(rowCount: number) {
    return {
      columns: [{ name: 'n', type: 'integer' }],
      rows: Array.from({ length: rowCount }, (_, i) => [i * 1000]),
    }
  }

  it('renders only the first 500 rows', () => {
    renderBody(bigTable(503))
    expect(screen.getAllByTestId('table-row-index')).toHaveLength(500)
    expect(screen.getByText('499000')).toBeInTheDocument()
    expect(screen.queryByText('500000')).not.toBeInTheDocument()
  })

  it('renders the muted overflow line with the exact remainder copy', () => {
    renderBody(bigTable(503))
    const overflow = screen.getByTestId('body-overflow-line')
    expect(overflow).toHaveTextContent('+ 3 more - switch to Code view')
    expect(overflow.className).toMatch(/muted/)
  })

  it('shows no overflow line at exactly 500 rows', () => {
    renderBody(bigTable(500))
    expect(screen.queryByTestId('body-overflow-line')).not.toBeInTheDocument()
  })
})
