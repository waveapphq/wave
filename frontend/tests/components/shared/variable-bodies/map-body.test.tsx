/**
 * Tests for MapBody - the shared map Visual value body (VMGR-25).
 *
 * Contract under test:
 *   - Key | Value table (shared ValueGrid); keys quoted + type-tinted like values
 *   - per-entry value tint by the value's OWN type; strings quoted; nested
 *     maps/arrays as compact one-line JSON
 *   - empty value: centered muted italic "no entries"
 *   - variant='initial': dim + italic wrapper
 *   - 500-entry Visual cap + muted "+ N more - switch to Code view" line
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { MapBody } from '@/components/shared/variable-bodies/map-body'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'

function renderBody(value: unknown, variant: 'current' | 'initial' = 'current') {
  return render(<MapBody value={value} variant={variant} />)
}

function getRoot(): HTMLElement {
  return screen.getByTestId('map-body')
}

function nullLookClasses(): string[] {
  expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

describe('MapBody - key/value rows', () => {
  it('renders one row per entry with quoted key cells', () => {
    renderBody({ host: 'localhost', port: 8000 })
    const rows = screen.getAllByTestId('map-row')
    expect(rows).toHaveLength(2)
    const keys = screen.getAllByTestId('map-key')
    expect(keys.map((el) => el.textContent)).toEqual(['"host"', '"port"'])
  })

  it('renders keys quoted and type-tinted like values (string color)', () => {
    renderBody({ host: 'localhost' })
    const key = screen.getByTestId('map-key')
    expect(key.textContent).toBe('"host"')
    expect(key.className).toMatch(/sky/)
  })

  it('renders the full untruncated entry value', () => {
    const long = 'y'.repeat(300)
    renderBody({ big: long })
    expect(getRoot().textContent).toContain(long)
    expect(getRoot().textContent).not.toContain('…')
  })
})

describe('MapBody - per-value tinting', () => {
  it('renders string values quoted in sky', () => {
    renderBody({ name: 'alpha' })
    expect(screen.getByText('"alpha"').className).toMatch(/sky/)
  })

  it('renders integer values in violet', () => {
    renderBody({ count: 42 })
    expect(screen.getByText('42').className).toMatch(/violet/)
  })

  it('renders float values in pink', () => {
    renderBody({ ratio: 2.5 })
    expect(screen.getByText('2.5').className).toMatch(/pink/)
  })

  it('renders boolean values in orange', () => {
    renderBody({ enabled: false })
    expect(screen.getByText('false').className).toMatch(/orange/)
  })

  it('renders null values muted', () => {
    renderBody({ nothing: null })
    expect(screen.getByText('null').className).toMatch(/muted/)
  })

  it('renders nested maps as compact one-line JSON in emerald', () => {
    renderBody({ nested: { a: 1 } })
    expect(screen.getByText('{"a":1}').className).toMatch(/emerald/)
  })

  it('renders nested arrays as compact one-line JSON in amber', () => {
    renderBody({ list: [1, 2] })
    expect(screen.getByText('[1,2]').className).toMatch(/amber/)
  })
})

describe('MapBody - empty state', () => {
  it('renders the centered muted italic "no entries" line', () => {
    renderBody({})
    const empty = screen.getByText('no entries')
    expect(empty.className).toMatch(/italic/)
    expect(empty.className).toMatch(/muted/)
    expect(getRoot().innerHTML).toMatch(/center/)
  })

  it('renders no entry rows for an empty map', () => {
    renderBody({})
    expect(screen.queryAllByTestId('map-row')).toHaveLength(0)
  })

  it.each([
    ['a string', 'not-a-map'],
    ['an array', [1, 2]],
  ])('renders %s input as the empty state (defensive)', (_label, value) => {
    renderBody(value)
    expect(screen.getByText('no entries')).toBeInTheDocument()
    expect(screen.queryAllByTestId('map-row')).toHaveLength(0)
  })

  it('keeps "no entries" for an empty map, never null (REQ-3.1.3.20)', () => {
    renderBody({})
    expect(screen.getByText('no entries')).toHaveTextContent(/^no entries$/)
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })
})

describe('MapBody - null map values (VMGR-93)', () => {
  it('renders a null map value as null with the one null look', () => {
    renderBody({ host: 'x', nothing: null })
    const cell = screen.getByText('null')
    expect(cell).toHaveTextContent(/^null$/)
    expect(cell).toHaveClass(...nullLookClasses())
  })

  it('renders a null value under a declared element type with the null look (REQ-3.1.3.19)', () => {
    render(<MapBody value={{ port: null }} variant="current" elementTypes={{ port: 'integer' }} />)
    const cell = screen.getByText('null')
    expect(cell).toHaveTextContent(/^null$/)
    expect(cell).toHaveClass(...nullLookClasses())
  })

  it('keeps a value holding the text "null" a quoted string, without the null look', () => {
    renderBody({ note: 'null' })
    const cell = screen.getByText('"null"')
    const classes = nullLookClasses()
    expect(classes.every((name) => cell.classList.contains(name))).toBe(false)
  })
})

describe('MapBody - initial variant', () => {
  it('dims and italicizes the whole body', () => {
    renderBody({ a: 1 }, 'initial')
    expect(getRoot().className).toMatch(/italic/)
    expect(getRoot().className).toMatch(/opacity/)
  })

  it('keeps the current variant un-dimmed', () => {
    renderBody({ a: 1 }, 'current')
    expect(getRoot().className).not.toMatch(/italic/)
    expect(getRoot().className).not.toMatch(/opacity-70/)
  })
})

describe('MapBody - 500-entry Visual cap', () => {
  function bigMap(size: number): Record<string, number> {
    return Object.fromEntries(
      Array.from({ length: size }, (_, i) => [`key_${i}`, i * 1000]),
    )
  }

  it('renders only the first 500 entries', () => {
    renderBody(bigMap(503))
    expect(screen.getAllByTestId('map-row')).toHaveLength(500)
    expect(screen.getByText('"key_499"')).toBeInTheDocument()
    expect(screen.queryByText('"key_500"')).not.toBeInTheDocument()
  })

  it('renders the muted overflow line with the exact remainder copy', () => {
    renderBody(bigMap(503))
    const overflow = screen.getByTestId('body-overflow-line')
    expect(overflow).toHaveTextContent('+ 3 more - switch to Code view')
    expect(overflow.className).toMatch(/muted/)
  })

  it('shows no overflow line at exactly 500 entries', () => {
    renderBody(bigMap(500))
    expect(screen.queryByTestId('body-overflow-line')).not.toBeInTheDocument()
  })
})
