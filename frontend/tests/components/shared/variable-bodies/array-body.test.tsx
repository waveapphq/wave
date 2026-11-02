/**
 * Tests for ArrayBody - the shared array Visual value body (VMGR-24).
 *
 * Contract under test:
 *   - muted right-aligned 0-based index column + value rows
 *   - per-element tint by the value's OWN type; strings quoted; nested
 *     maps/arrays as compact one-line tinted JSON; null muted
 *   - full untruncated values
 *   - empty value: centered muted italic "no items"
 *   - variant='initial': dim + italic wrapper
 *   - 500-item Visual cap + muted "+ N more - switch to Code view" line
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { ArrayBody } from '@/components/shared/variable-bodies/array-body'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'

function renderBody(value: unknown, variant: 'current' | 'initial' = 'current') {
  return render(<ArrayBody value={value} variant={variant} />)
}

function getRoot(): HTMLElement {
  return screen.getByTestId('array-body')
}

function nullLookClasses(): string[] {
  expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

describe('ArrayBody - indexed rows', () => {
  it('renders one row per element with a 0-based index column', () => {
    renderBody(['alpha', 'beta', 'gamma'])
    const rows = screen.getAllByTestId('array-row')
    expect(rows).toHaveLength(3)
    const indexes = screen.getAllByTestId('array-index')
    expect(indexes.map((el) => el.textContent)).toEqual(['0', '1', '2'])
  })

  it('renders the index column muted and right-aligned', () => {
    renderBody(['alpha'])
    const index = screen.getByTestId('array-index')
    expect(index.className).toMatch(/muted/)
    expect(index.className).toMatch(/text-right/)
  })

  it('renders the full untruncated element value', () => {
    const long = 'x'.repeat(300)
    renderBody([long])
    expect(getRoot().textContent).toContain(long)
    expect(getRoot().textContent).not.toContain('…')
  })
})

describe('ArrayBody - per-element tinting', () => {
  it('renders string elements quoted in sky', () => {
    renderBody(['alpha'])
    const value = screen.getByText('"alpha"')
    expect(value.className).toMatch(/sky/)
  })

  it('renders integer elements in violet', () => {
    renderBody([42])
    expect(screen.getByText('42').className).toMatch(/violet/)
  })

  it('renders float elements in pink', () => {
    renderBody([4.5])
    expect(screen.getByText('4.5').className).toMatch(/pink/)
  })

  it('renders boolean elements in orange', () => {
    renderBody([true])
    expect(screen.getByText('true').className).toMatch(/orange/)
  })

  it('renders null elements muted', () => {
    renderBody([null])
    expect(screen.getByText('null').className).toMatch(/muted/)
  })

  it('renders nested maps as compact one-line JSON in emerald', () => {
    renderBody([{ a: 1 }])
    const nested = screen.getByText('{"a":1}')
    expect(nested.className).toMatch(/emerald/)
  })

  it('renders nested arrays as compact one-line JSON in amber', () => {
    renderBody([[1, 2]])
    const nested = screen.getByText('[1,2]')
    expect(nested.className).toMatch(/amber/)
  })

  // A nested map/array round-trips through storage as VERBATIM JSON
  // TEXT (a string), not a JS object - the backend realizes it. The read body
  // must show that text as the nested structure (emerald/amber), NOT a quoted,
  // escaped string, so a saved array-of-map keeps its shape on inspect.
  it('renders a nested map stored as verbatim JSON text unquoted in emerald', () => {
    renderBody(['{"a":1}'])
    const nested = screen.getByText('{"a":1}')
    expect(nested.className).toMatch(/emerald/)
  })

  it('renders a nested array stored as verbatim JSON text unquoted in amber', () => {
    renderBody(['[1,2]'])
    const nested = screen.getByText('[1,2]')
    expect(nested.className).toMatch(/amber/)
  })

  it('keeps a non-JSON bracketed string a quoted string (not demoted to a structure)', () => {
    renderBody(['[x]'])
    const plain = screen.getByText('"[x]"')
    expect(plain.className).toMatch(/sky/)
  })

  it('tints a mixed array per element', () => {
    renderBody(['alpha', 7, false])
    expect(screen.getByText('"alpha"').className).toMatch(/sky/)
    expect(screen.getByText('7').className).toMatch(/violet/)
    expect(screen.getByText('false').className).toMatch(/orange/)
  })
})

describe('ArrayBody - empty state', () => {
  it('renders the centered muted italic "no items" line', () => {
    renderBody([])
    const empty = screen.getByText('no items')
    expect(empty.className).toMatch(/italic/)
    expect(empty.className).toMatch(/muted/)
    expect(getRoot().innerHTML).toMatch(/center/)
  })

  it('renders garbage input as the empty state (defensive)', () => {
    renderBody('not-an-array')
    expect(screen.getByText('no items')).toBeInTheDocument()
    expect(screen.queryAllByTestId('array-row')).toHaveLength(0)
  })

  it('renders no element rows for an empty array', () => {
    renderBody([])
    expect(screen.queryAllByTestId('array-row')).toHaveLength(0)
  })

  it('keeps "no items" for an empty array, never null (REQ-3.1.3.20)', () => {
    renderBody([])
    expect(screen.getByText('no items')).toHaveTextContent(/^no items$/)
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })
})

describe('ArrayBody - null items (VMGR-93)', () => {
  it('renders a null item as null with the one null look', () => {
    renderBody(['alpha', null])
    const item = screen.getByText('null')
    expect(item).toHaveTextContent(/^null$/)
    expect(item).toHaveClass(...nullLookClasses())
  })

  it('renders a null item under a declared element type with the null look (REQ-3.1.3.19)', () => {
    render(<ArrayBody value={[null]} variant="current" elementTypes={['integer']} />)
    const item = screen.getByText('null')
    expect(item).toHaveTextContent(/^null$/)
    expect(item).toHaveClass(...nullLookClasses())
  })

  it('keeps an item holding the text "null" a quoted string, without the null look', () => {
    renderBody(['null'])
    const item = screen.getByText('"null"')
    const classes = nullLookClasses()
    expect(classes.every((name) => item.classList.contains(name))).toBe(false)
  })
})

describe('ArrayBody - initial variant', () => {
  it('dims and italicizes the whole body', () => {
    renderBody(['alpha'], 'initial')
    expect(getRoot().className).toMatch(/italic/)
    expect(getRoot().className).toMatch(/opacity/)
  })

  it('keeps the current variant un-dimmed', () => {
    renderBody(['alpha'], 'current')
    expect(getRoot().className).not.toMatch(/italic/)
    expect(getRoot().className).not.toMatch(/opacity-70/)
  })
})

describe('ArrayBody - 500-item Visual cap', () => {
  it('renders only the first 500 items', () => {
    renderBody(Array.from({ length: 502 }, (_, i) => `item-${i}`))
    const rows = screen.getAllByTestId('array-row')
    expect(rows).toHaveLength(500)
    expect(screen.getByText('"item-499"')).toBeInTheDocument()
    expect(screen.queryByText('"item-500"')).not.toBeInTheDocument()
  })

  it('renders the muted overflow line with the exact remainder copy', () => {
    renderBody(Array.from({ length: 502 }, (_, i) => i * 1000))
    const overflow = screen.getByTestId('body-overflow-line')
    expect(overflow).toHaveTextContent('+ 2 more - switch to Code view')
    expect(overflow.className).toMatch(/muted/)
  })

  it('renders the overflow line as plain text, not a control', () => {
    renderBody(Array.from({ length: 501 }, (_, i) => i * 1000))
    const overflow = screen.getByTestId('body-overflow-line')
    expect(within(overflow).queryByRole('button')).not.toBeInTheDocument()
    expect(overflow.tagName).not.toBe('BUTTON')
  })

  it('shows no overflow line at exactly 500 items', () => {
    renderBody(Array.from({ length: 500 }, (_, i) => i * 1000))
    expect(screen.queryByTestId('body-overflow-line')).not.toBeInTheDocument()
  })
})

describe('ArrayBody - declared element types (REQ-3.1.3.19)', () => {
  it('renders each item as its declared type', () => {
    render(<ArrayBody value={['16', '07']} variant="current" elementTypes={['integer', 'string']} />)
    const text = screen.getByTestId('array-body').textContent ?? ''
    expect(text).toContain('16')
    expect(text).not.toContain('"16"')
    expect(text).toContain('"07"')
  })

  it('reads the items by their stored shape when the element types are not a list', () => {
    render(<ArrayBody value={['16']} variant="current" elementTypes={{ 0: 'integer' }} />)
    expect(screen.getByTestId('array-body').textContent).toContain('"16"')
  })
})
