/**
 * Tests for ValueGrid - the shared resizable-column grid behind the map + table
 * Visual bodies. Covers the header/cell rendering, the empty state, and
 * the column-resize contract (drag grows the column, clamps at the minimum, and
 * a non-resizable column has no handle).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import {
  ValueGrid,
  type ValueGridColumn,
  type ValueGridRow,
} from '@/components/shared/variable-bodies/value-grid'

const COLUMNS: ValueGridColumn[] = [
  { key: 'k', header: 'Key', width: 100 },
  { key: 'v', header: 'Value', width: 200 },
]

const ROWS: ValueGridRow[] = [
  {
    id: 'r0',
    testId: 'vg-row',
    cells: [{ content: 'a', testId: 'vg-key' }, { content: 'b' }],
  },
]

function firstColWidth(container: HTMLElement): string {
  return (container.querySelector('col') as HTMLElement).style.width
}

describe('ValueGrid', () => {
  it('renders the column headers and the row cells', () => {
    render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={ROWS} variant="current" emptyLabel="empty" />,
    )
    expect(screen.getByRole('columnheader', { name: 'Key' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument()
    expect(screen.getByTestId('vg-key')).toHaveTextContent('a')
  })

  it('shows the empty label when there are no rows', () => {
    render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={[]} variant="current" emptyLabel="empty" />,
    )
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('shows no header with the empty label by default', () => {
    render(<ValueGrid data-testid="vg" columns={COLUMNS} rows={[]} variant="current" emptyLabel="empty" />)
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
  })

  it('keeps the header above the empty label when asked', () => {
    render(
      <ValueGrid
        data-testid="vg"
        columns={COLUMNS}
        rows={[]}
        variant="current"
        emptyLabel="empty"
        keepHeaderWhenEmpty
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Key' })).toBeInTheDocument()
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('grows a column when its resize handle is dragged', () => {
    const { container } = render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={ROWS} variant="current" emptyLabel="empty" />,
    )
    expect(firstColWidth(container)).toBe('100px')
    fireEvent.mouseDown(screen.getByTestId('vg-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 60 })
    fireEvent.mouseUp(document)
    expect(firstColWidth(container)).toBe('160px')
  })

  it('clamps the column width at the minimum', () => {
    const { container } = render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={ROWS} variant="current" emptyLabel="empty" />,
    )
    fireEvent.mouseDown(screen.getByTestId('vg-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: -10000 })
    fireEvent.mouseUp(document)
    expect(firstColWidth(container)).toBe('56px')
  })

  it('re-seeds the column widths when the column set changes', () => {
    const { container, rerender } = render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={ROWS} variant="current" emptyLabel="empty" />,
    )
    expect(container.querySelectorAll('col')).toHaveLength(2)
    // A new column SET (different keys) bumps the column signature, re-seeding the
    // widths from the new columns (the row-index re-seed effect).
    rerender(
      <ValueGrid
        data-testid="vg"
        columns={[...COLUMNS, { key: 't', header: 'Type', width: 80 }]}
        rows={[{ id: 'r0', cells: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }]}
        variant="current"
        emptyLabel="empty"
      />,
    )
    const cols = container.querySelectorAll('col')
    expect(cols).toHaveLength(3)
    expect((cols[2] as HTMLElement).style.width).toBe('80px') // seeded from the new column
  })

  it('omits the resize handle on a non-resizable column', () => {
    render(
      <ValueGrid
        data-testid="vg2"
        columns={[
          { key: 'idx', header: '#', width: 48, resizable: false },
          { key: 'v', header: 'V', width: 100 },
        ]}
        rows={[{ id: 'r', cells: [{ content: '0' }, { content: 'x' }] }]}
        variant="current"
        emptyLabel="e"
      />,
    )
    expect(screen.queryByTestId('vg2-col-resize-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('vg2-col-resize-1')).toBeInTheDocument()
  })
})

describe('ValueGrid - auto-fit columns (default + double-click)', () => {
  beforeAll(() => {
    // jsdom has no canvas text metrics; stub measureText (width = chars * 8) so
    // the metrics-available path (auto-fit) runs. Other tests have no stub, so
    // they exercise the no-metrics fallback to the configured width.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D)
  })
  afterAll(() => {
    vi.restoreAllMocks()
  })

  function renderFit() {
    return render(
      <ValueGrid
        data-testid="vg"
        columns={[{ key: 'k', header: 'Key', width: 300 }]}
        rows={[
          { id: 'r0', cells: [{ content: 'short' }] },
          { id: 'r1', cells: [{ content: 'a-much-longer-value' }] },
        ]}
        variant="current"
        emptyLabel="empty"
      />,
    )
  }

  // widest cell 'a-much-longer-value' = 19 chars * 8 = 152; + 16 pad + 8 buffer.
  const FIT = '176px'

  it('auto-fits each column to its widest cell by default (not the configured width)', () => {
    const { container } = renderFit()
    expect(firstColWidth(container)).toBe(FIT)
  })

  it('re-fits a manually-resized column on double-click', () => {
    const { container } = renderFit()
    fireEvent.mouseDown(screen.getByTestId('vg-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)
    expect(firstColWidth(container)).toBe('276px')
    fireEvent.doubleClick(screen.getByTestId('vg-col-resize-0'))
    expect(firstColWidth(container)).toBe(FIT)
  })

  it('keeps a non-resizable column at its configured width (the "#" index)', () => {
    const { container } = render(
      <ValueGrid
        data-testid="vg"
        columns={[
          { key: 'idx', header: '#', width: 40, resizable: false },
          { key: 'v', header: 'V', width: 300 },
        ]}
        rows={[{ id: 'r', cells: [{ content: '0' }, { content: 'a-much-longer-value' }] }]}
        variant="current"
        emptyLabel="empty"
      />,
    )
    const cols = container.querySelectorAll('col')
    expect((cols[0] as HTMLElement).style.width).toBe('40px') // fixed, not auto-fit
    expect((cols[1] as HTMLElement).style.width).toBe(FIT) // content column auto-fits
  })

  it('renders a non-string cell content (auto-fit measures it as empty)', () => {
    render(
      <ValueGrid
        data-testid="vg"
        columns={[{ key: 'k', header: 'Key', width: 300 }]}
        rows={[{ id: 'r', cells: [{ content: <span data-testid="vg-node">node</span> }] }]}
        variant="current"
        emptyLabel="empty"
      />,
    )
    expect(screen.getByTestId('vg-node')).toBeInTheDocument()
  })

  it('re-fits one column on double-click and leaves the others untouched', () => {
    const { container } = render(
      <ValueGrid
        data-testid="vg"
        columns={[
          { key: 'a', header: 'A', width: 100 },
          { key: 'b', header: 'B', width: 100 },
        ]}
        rows={[{ id: 'r', cells: [{ content: 'a-much-longer-value' }, { content: 'b' }] }]}
        variant="current"
        emptyLabel="empty"
      />,
    )
    const cols = () => container.querySelectorAll('col')
    // Drag column B wider, then double-click A's handle: A re-fits while B keeps
    // its dragged width (the fitColumn `: cur` branch for the other columns).
    fireEvent.mouseDown(screen.getByTestId('vg-col-resize-1'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 120 })
    fireEvent.mouseUp(document)
    const bWidth = (cols()[1] as HTMLElement).style.width
    fireEvent.doubleClick(screen.getByTestId('vg-col-resize-0'))
    expect((cols()[0] as HTMLElement).style.width).toBe(FIT)
    expect((cols()[1] as HTMLElement).style.width).toBe(bWidth)
  })
})

describe('ValueGrid - no canvas text metrics', () => {
  it('falls back to configured widths when getContext returns null', () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    const { container } = render(
      <ValueGrid data-testid="vg" columns={COLUMNS} rows={ROWS} variant="current" emptyLabel="empty" />,
    )
    // hasTextMetrics() is false (measureText returns 0 with no 2d context), so
    // each column keeps its configured width.
    expect(firstColWidth(container)).toBe('100px')
    spy.mockRestore()
  })
})
