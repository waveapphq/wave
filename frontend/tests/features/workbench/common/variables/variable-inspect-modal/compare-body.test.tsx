/**
 * Tests for CompareBody - the inspect modal's two-pane side-by-side shell
 * (REQ-3.1.3.11 Compare Mode block).
 *
 * Contract under test:
 *   - a 1fr/1fr CSS grid holding an Initial (left) pane and a Current (right)
 *     pane, each rendering the already-built body ReactNode handed to it
 *   - a small uppercase muted label above each pane (the host supplies the
 *     label text, plain "Initial" / "Current" or the expression
 *     "Initial - source" / "Current - evaluated")
 *   - a hairline divider (border-l) on the second pane only
 *   - per-pane horizontal-scroll wrappers when tableGrid is set, so each table
 *     mini-grid scrolls inside its own pane rather than spanning the sheet
 *
 * CompareBody renders NO value logic itself - it is a pure layout shell; the
 * host resolves both bodies and passes them in.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { CompareBody } from '@/features/workbench/common/variables/variable-inspect-modal/compare-body'

interface CompareBodyOverrides {
  initialLabel?: string
  currentLabel?: string
  tableGrid?: boolean
  stacked?: boolean
  fill?: boolean
}

function renderCompareBody(overrides: CompareBodyOverrides = {}) {
  return render(
    <CompareBody
      initialNode={<div data-testid="stub-initial">left-pane-payload</div>}
      currentNode={<div data-testid="stub-current">right-pane-payload</div>}
      initialLabel={overrides.initialLabel ?? 'Initial'}
      currentLabel={overrides.currentLabel ?? 'Current'}
      tableGrid={overrides.tableGrid ?? false}
      stacked={overrides.stacked}
      fill={overrides.fill}
    />,
  )
}

function panes() {
  return {
    body: screen.getByTestId('compare-body'),
    initial: screen.getByTestId('compare-pane-initial'),
    current: screen.getByTestId('compare-pane-current'),
  }
}

describe('CompareBody - layout', () => {
  it('renders both panes inside a 1fr/1fr grid', () => {
    renderCompareBody()
    const { body, initial, current } = panes()
    expect(body.className).toMatch(/grid-cols-2/)
    expect(initial).toBeInTheDocument()
    expect(current).toBeInTheDocument()
  })

  it('draws the hairline divider on the current (second) pane only', () => {
    renderCompareBody()
    const { initial, current } = panes()
    expect(current.className).toMatch(/border-l/)
    expect(initial.className).not.toMatch(/border-l/)
  })
})

describe('CompareBody - stacked (compact scalars)', () => {
  it('stacks the labeled values vertically instead of the 1fr/1fr grid', () => {
    renderCompareBody({ stacked: true })
    const { body, initial, current } = panes()
    expect(body.className).not.toMatch(/grid-cols-2/)
    expect(initial).toBeInTheDocument()
    expect(current).toBeInTheDocument()
  })

  it('keeps both labels and drops the side-by-side divider', () => {
    renderCompareBody({ stacked: true })
    expect(screen.getByText('Initial')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(panes().current.className).not.toMatch(/border-l/)
  })
})

describe('CompareBody - fill (CodeMirror panes scale with the watcher)', () => {
  it('bounds the grid to h-full and makes both panes flex columns when fill is set', () => {
    renderCompareBody({ fill: true })
    const { body, initial, current } = panes()
    expect(body.className).toContain('h-full')
    expect(body.className).not.toContain('min-h-full')
    expect(initial.className).toMatch(/flex-col/)
    expect(current.className).toMatch(/flex-col/)
  })

  it('fills the body height (min-h-full) so the divider spans the modal, without flexing panes', () => {
    // The inter-pane divider must extend with the resized modal height,
    // so even content panes fill the grid height (min-h-full, not flex).
    renderCompareBody()
    const { body, initial } = panes()
    expect(body.className).toContain('min-h-full')
    expect(initial.className).not.toMatch(/flex-col/)
  })
})

describe('CompareBody - pane content', () => {
  it('renders the initial node in the left pane', () => {
    renderCompareBody()
    const { initial } = panes()
    expect(within(initial).getByTestId('stub-initial')).toBeInTheDocument()
    expect(within(initial).queryByTestId('stub-current')).not.toBeInTheDocument()
  })

  it('renders the current node in the right pane', () => {
    renderCompareBody()
    const { current } = panes()
    expect(within(current).getByTestId('stub-current')).toBeInTheDocument()
    expect(within(current).queryByTestId('stub-initial')).not.toBeInTheDocument()
  })
})

describe('CompareBody - pane labels', () => {
  it('renders the supplied labels above each pane', () => {
    renderCompareBody()
    const { initial, current } = panes()
    expect(within(initial).getByText('Initial')).toBeInTheDocument()
    expect(within(current).getByText('Current')).toBeInTheDocument()
  })

  it('styles the labels small uppercase and muted (not dimmed with the value)', () => {
    renderCompareBody()
    const { initial } = panes()
    const label = within(initial).getByText('Initial')
    expect(label.className).toMatch(/uppercase/)
    expect(label.className).toMatch(/muted/)
  })

  it('renders the expression-variant labels when the host supplies them', () => {
    renderCompareBody({
      initialLabel: 'Initial - source',
      currentLabel: 'Current - evaluated',
    })
    const { initial, current } = panes()
    expect(within(initial).getByText('Initial - source')).toBeInTheDocument()
    expect(within(current).getByText('Current - evaluated')).toBeInTheDocument()
  })
})

describe('CompareBody - table grid', () => {
  it('wraps each pane in its own horizontal-scroll container when tableGrid is set', () => {
    renderCompareBody({ tableGrid: true })
    const { initial, current } = panes()
    expect(initial.querySelector('.overflow-x-auto')).not.toBeNull()
    expect(current.querySelector('.overflow-x-auto')).not.toBeNull()
  })

  it('adds no per-pane horizontal scroll when tableGrid is false', () => {
    renderCompareBody({ tableGrid: false })
    const { body } = panes()
    expect(body.querySelectorAll('.overflow-x-auto')).toHaveLength(0)
  })
})
