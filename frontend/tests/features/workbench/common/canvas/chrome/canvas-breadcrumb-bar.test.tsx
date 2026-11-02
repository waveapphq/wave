/**
 * CanvasBreadcrumbBar Tests (REQ-5.2.1.25)
 *
 * Tests the refactored canvas breadcrumb bar that:
 *   - Renders BreadcrumbSegment[] using shadcn Breadcrumb primitives.
 *   - Hides the back arrow when backHref is null, shows otherwise.
 *   - Renders each segment with a BreadcrumbSegmentIcon + TruncatedName
 *     inside BreadcrumbLink (clickable) or BreadcrumbPage (current).
 *   - When the path overflows, collapses ALL parent segments into a single
 *     actionable `...` button that opens an EntityListPopover.
 *   - When the leaf still overflows after collapse, truncates the leaf and
 *     surfaces the multiline Radix tooltip on hover.
 *   - Preserves the reset button behavior and status pill. The reset link fires
 *     onReset directly; the artifact-guarded "Reset Session?" confirmation is
 *     owned by the live container (see container.reset-guard.test.tsx).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CanvasBreadcrumbBar } from '@/features/workbench/common/canvas/chrome/canvas-breadcrumb-bar'

type SegmentType = 'execution-root' | 'execution' | 'test' | 'suite' | 'regression'

interface BreadcrumbSegment {
  type: SegmentType
  label: string
  href?: string
  id?: string
  isPending?: boolean
}

function renderBar(props: Parameters<typeof CanvasBreadcrumbBar>[0]) {
  return render(
    <MemoryRouter>
      <CanvasBreadcrumbBar {...props} />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Width helpers for the overflow cascade
// ---------------------------------------------------------------------------

function withSizes(scrollWidth: number, clientWidth: number, body: () => Promise<void> | void) {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth
    },
  })
  return Promise.resolve(body()).finally(() => {
    if (scrollDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollDescriptor)
    }
    if (clientDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientDescriptor)
    }
  })
}

describe('CanvasBreadcrumbBar - pending state', () => {
  // Runs early so the leaked `HTMLElement.prototype.scrollWidth` mock from the
  // overflow-cascade tests below doesn't keep `shouldCollapse=true` here and
  // hide the pending rendering behind the collapse button.
  it('renders skeleton placeholders for pendingParents alongside the loaded leaf', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({
      path,
      backHref: '/suites/s1',
      status: 'idle',
      pendingParents: [{ type: 'regression' }, { type: 'suite' }],
    })
    const bar = screen.getByTestId('breadcrumb-path')
    expect(within(bar).getByTestId('breadcrumb-pending-regression')).toBeInTheDocument()
    expect(within(bar).getByTestId('breadcrumb-pending-suite')).toBeInTheDocument()
    expect(within(bar).getByText('API Health 200')).toBeInTheDocument()
  })

  it('renders a skeleton in the SegmentLink when a parent segment is marked isPending', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'suite', label: '', href: '/suites/s1', isPending: true },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/suites/s1', status: 'idle' })
    const bar = screen.getByTestId('breadcrumb-path')
    expect(bar.querySelector('.bg-muted')).not.toBeNull()
  })

  it('renders a skeleton in the leaf when it is marked isPending', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'test', label: '', isPending: true },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle' })
    const bar = screen.getByTestId('breadcrumb-path')
    expect(bar.querySelector('.bg-muted')).not.toBeNull()
  })
})

describe('CanvasBreadcrumbBar - basic rendering', () => {
  it('renders the bar container, path, and status pill', () => {
    const path: BreadcrumbSegment[] = [{ type: 'test', label: 'Draft Workflow' }]
    renderBar({ path, backHref: null, status: 'idle' })
    expect(screen.getByTestId('canvas-breadcrumb')).toBeInTheDocument()
    expect(screen.getByTestId('breadcrumb-path')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-status')).toBeInTheDocument()
  })

  it('renders the leaf label inside a BreadcrumbPage (non-link, aria-current)', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/suites/s1', status: 'idle' })
    const page = screen.getByText('API Health 200').closest('[aria-current="page"]')
    expect(page).not.toBeNull()
  })

  it('renders intermediate segments as clickable links', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/suites/s1', status: 'idle' })
    // Suite is intermediate → link, Test is leaf → not link
    expect(screen.getByText('Healthchecks').closest('a')).not.toBeNull()
    expect(screen.getByText('API Health 200').closest('a')).toBeNull()
  })

  it('separates segments with the / divider per BC compliance checklist', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/executions', status: 'idle' })
    const bar = screen.getByTestId('breadcrumb-path')
    expect(within(bar).getAllByText('/').length).toBeGreaterThan(0)
  })
})

describe('CanvasBreadcrumbBar - back arrow', () => {
  it('hides the back arrow when backHref is null', () => {
    const path: BreadcrumbSegment[] = [{ type: 'test', label: 'Draft Workflow' }]
    renderBar({ path, backHref: null, status: 'idle' })
    expect(screen.queryByTestId('breadcrumb-back-arrow')).not.toBeInTheDocument()
  })

  it('shows the back arrow when backHref is set', () => {
    const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]
    renderBar({ path, backHref: '/tests', status: 'idle' })
    expect(screen.getByTestId('breadcrumb-back-arrow')).toBeInTheDocument()
  })

  it('fires onBack when the back arrow is clicked', async () => {
    const onBack = vi.fn()
    const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]
    const user = userEvent.setup()
    renderBar({ path, backHref: '/tests', status: 'idle', onBack })
    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('CanvasBreadcrumbBar - segment navigation', () => {
  it('calls onNavigate(href) when an intermediate segment is clicked', async () => {
    const onNavigate = vi.fn()
    const path: BreadcrumbSegment[] = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    const user = userEvent.setup()
    renderBar({ path, backHref: '/suites/s1', status: 'idle', onNavigate })
    await user.click(screen.getByText('Healthchecks'))
    expect(onNavigate).toHaveBeenCalledWith('/suites/s1')
  })

  it('does not call onNavigate when the leaf segment is clicked', async () => {
    const onNavigate = vi.fn()
    const path: BreadcrumbSegment[] = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    const user = userEvent.setup()
    renderBar({ path, backHref: '/suites/s1', status: 'idle', onNavigate })
    await user.click(screen.getByText('API Health 200'))
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('CanvasBreadcrumbBar - overflow cascade', () => {
  it('State A (fits): renders all parent segments inline', () => {
    // Default jsdom widths report scrollWidth = clientWidth = 0; the bar
    // sees no overflow and renders state A.
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'regression', label: 'Smoke', href: '/executions/exec-reg' },
      { type: 'suite', label: 'Healthchecks', href: '/executions/exec-suite' },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/executions/exec-suite', status: 'idle' })
    expect(screen.queryByTestId('breadcrumb-collapse-button')).not.toBeInTheDocument()
    expect(screen.getByText('Executions')).toBeInTheDocument()
    expect(screen.getByText('Smoke')).toBeInTheDocument()
    expect(screen.getByText('Healthchecks')).toBeInTheDocument()
  })

  it('State B (overflow): collapses ALL parents into a single `...` button', async () => {
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'regression', label: 'Smoke', href: '/executions/exec-reg' },
      { type: 'suite', label: 'Healthchecks', href: '/executions/exec-suite' },
      { type: 'test', label: 'API Health 200' },
    ]
    // Force a path-width > container-width so the overflow hook trips.
    await withSizes(900, 200, async () => {
      renderBar({ path, backHref: '/executions/exec-suite', status: 'idle' })
      expect(await screen.findByTestId('breadcrumb-collapse-button')).toBeInTheDocument()
      // Parent links are not in the inline path
      const bar = screen.getByTestId('breadcrumb-path')
      expect(within(bar).queryByText('Smoke')).not.toBeInTheDocument()
      expect(within(bar).queryByText('Healthchecks')).not.toBeInTheDocument()
      // Leaf remains
      expect(within(bar).getByText('API Health 200')).toBeInTheDocument()
    })
  })

  it('State B: clicking `...` opens a popover listing the parent segments', async () => {
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'regression', label: 'Smoke', href: '/executions/exec-reg' },
      { type: 'suite', label: 'Healthchecks', href: '/executions/exec-suite' },
      { type: 'test', label: 'API Health 200' },
    ]
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    await withSizes(900, 200, async () => {
      renderBar({ path, backHref: '/executions/exec-suite', status: 'idle', onNavigate })
      const button = await screen.findByTestId('breadcrumb-collapse-button')
      await user.click(button)
      const popover = await screen.findByTestId('breadcrumb-parents-list')
      expect(within(popover).getByText('Executions')).toBeInTheDocument()
      expect(within(popover).getByText('Smoke')).toBeInTheDocument()
      expect(within(popover).getByText('Healthchecks')).toBeInTheDocument()
    })
  })

  it('State C (leaf clip): leaf surfaces a multiline Radix tooltip on hover', async () => {
    const longName = 'A very long test execution name that absolutely refuses to fit anywhere'
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'suite', label: 'Healthchecks', href: '/executions/exec-suite' },
      { type: 'test', label: longName },
    ]
    const user = userEvent.setup()
    await withSizes(1200, 200, async () => {
      renderBar({ path, backHref: '/executions/exec-suite', status: 'idle' })
      const leaf = screen.getByText(longName)
      await user.hover(leaf)
      const tooltip = await screen.findByRole('tooltip')
      expect(tooltip).toHaveTextContent(longName)
    })
  })
})

describe('CanvasBreadcrumbBar - reset button (preserved behavior)', () => {
  const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]

  it('shows disabled reset in idle / running / paused', () => {
    for (const status of ['idle', 'running', 'paused'] as const) {
      const { unmount } = renderBar({ path, backHref: '/tests', status })
      expect(screen.getByTestId('breadcrumb-reset-link')).toBeDisabled()
      unmount()
    }
  })

  it('shows enabled reset in passed / failed / stopped / skipped', () => {
    for (const status of ['passed', 'failed', 'stopped', 'skipped'] as const) {
      const { unmount } = renderBar({ path, backHref: '/tests', status })
      expect(screen.getByTestId('breadcrumb-reset-link')).not.toBeDisabled()
      unmount()
    }
  })

  it('fires onReset directly on click - no internal dialog (re-homed to the container)', async () => {
    const onReset = vi.fn()
    const user = userEvent.setup()
    renderBar({ path, backHref: '/tests', status: 'passed', onReset })
    await user.click(screen.getByTestId('breadcrumb-reset-link'))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Reset Workflow?')).not.toBeInTheDocument()
  })

  it('does not fire onReset while the link is disabled', async () => {
    const onReset = vi.fn()
    const user = userEvent.setup()
    renderBar({ path, backHref: '/tests', status: 'running', onReset })
    await user.click(screen.getByTestId('breadcrumb-reset-link'))
    expect(onReset).not.toHaveBeenCalled()
  })

  it('hides the reset button entirely when showReset=false (history mode)', () => {
    renderBar({ path, backHref: '/executions', status: 'passed', showReset: false })
    expect(screen.queryByTestId('breadcrumb-reset-link')).not.toBeInTheDocument()
  })
})

describe('CanvasBreadcrumbBar - status pill (preserved behavior)', () => {
  const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]

  const cases: Array<{ status: 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped'; label: string; colorClass: string }> = [
    { status: 'idle', label: 'Idle', colorClass: 'text-muted-foreground' },
    { status: 'running', label: 'Running', colorClass: 'text-blue-500' },
    { status: 'paused', label: 'Paused', colorClass: 'text-amber-500' },
    { status: 'passed', label: 'Passed', colorClass: 'text-green-500' },
    { status: 'failed', label: 'Failed', colorClass: 'text-red-500' },
    { status: 'skipped', label: 'Skipped', colorClass: 'text-amber-500' },
  ]

  it.each(cases)('renders $label status with its color class', ({ status, label, colorClass }) => {
    const { unmount } = renderBar({ path, backHref: '/tests', status })
    const pill = screen.getByTestId('workflow-status')
    expect(pill).toHaveAttribute('data-status', status)
    expect(pill).toHaveTextContent(label)
    expect(pill).toHaveClass(colorClass)
    unmount()
  })
})

describe('CanvasBreadcrumbBar - per-segment icons', () => {
  it('renders an icon for each segment, including the leaf', () => {
    const path: BreadcrumbSegment[] = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'regression', label: 'Smoke', href: '/executions/exec-reg' },
      { type: 'suite', label: 'Healthchecks', href: '/executions/exec-suite' },
      { type: 'test', label: 'API Health 200' },
    ]
    renderBar({ path, backHref: '/executions/exec-suite', status: 'idle' })
    const bar = screen.getByTestId('breadcrumb-path')
    // Each segment renders an SVG icon. We don't pin a specific icon name -
    // BreadcrumbSegmentIcon's own test covers the icon-per-type contract.
    expect(bar.querySelectorAll('svg').length).toBeGreaterThanOrEqual(path.length)
  })
})

describe('CanvasBreadcrumbBar - session artifacts chip (ARTIF-14)', () => {
  const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]

  it('renders no chip when onOpenArtifacts is not provided (history / read-only mode)', () => {
    renderBar({ path, backHref: null, status: 'idle' })

    expect(screen.queryByRole('button', { name: 'Session artifacts' })).not.toBeInTheDocument()
  })

  it('renders the chip with the "Artifacts" label when a handler is provided', () => {
    renderBar({ path, backHref: null, status: 'idle', onOpenArtifacts: vi.fn() })

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    expect(chip).toHaveTextContent('Artifacts')
  })

  it('shows no count badge at count 0 while keeping the chip visible', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      artifactsCount: 0,
      onOpenArtifacts: vi.fn(),
    })

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    expect(within(chip).queryByText('0')).not.toBeInTheDocument()
  })

  it('shows the count badge when the session holds artifacts', () => {
    renderBar({
      path,
      backHref: null,
      status: 'passed',
      artifactsCount: 3,
      onOpenArtifacts: vi.fn(),
    })

    const chip = screen.getByRole('button', { name: 'Session artifacts' })
    expect(within(chip).getByText('3')).toBeInTheDocument()
  })

  it('fires onOpenArtifacts when the chip is clicked', async () => {
    const user = userEvent.setup()
    const onOpenArtifacts = vi.fn()
    renderBar({ path, backHref: null, status: 'idle', onOpenArtifacts })

    await user.click(screen.getByRole('button', { name: 'Session artifacts' }))

    expect(onOpenArtifacts).toHaveBeenCalledTimes(1)
  })

  it('keeps the chip enabled regardless of the reset link disabled state', () => {
    // Reset is disabled while idle; the chip must still open the (empty) sheet.
    renderBar({ path, backHref: null, status: 'idle', onOpenArtifacts: vi.fn() })

    expect(screen.getByTestId('breadcrumb-reset-link')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Session artifacts' })).toBeEnabled()
  })
})

/** Tailwind height / width tokens on a chip's icon - the chip's visual size. */
function iconSizeTokens(chip: HTMLElement): string[] {
  const className = chip.querySelector('svg')?.getAttribute('class') ?? ''
  return className
    .split(/\s+/)
    .filter((token) => /^[hw]-/.test(token))
    .sort((a, b) => a.localeCompare(b))
}

describe('CanvasBreadcrumbBar - Test Data chip (TDATA-3)', () => {
  const path: BreadcrumbSegment[] = [{ type: 'test', label: 'API Health 200' }]

  it('renders no chip when onOpenTestData is not provided', () => {
    renderBar({ path, backHref: null, status: 'idle', onOpenArtifacts: vi.fn() })

    expect(screen.queryByTestId('breadcrumb-testdata-chip')).not.toBeInTheDocument()
  })

  it('renders no chip in history / read-only mode, where neither handler is given', () => {
    renderBar({ path, backHref: null, status: 'idle' })

    expect(screen.queryByTestId('breadcrumb-testdata-chip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('breadcrumb-artifacts-chip')).not.toBeInTheDocument()
  })

  it('renders the chip with the "Test Data" label and a folder icon', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      onOpenArtifacts: vi.fn(),
    })

    const chip = screen.getByTestId('breadcrumb-testdata-chip')
    expect(chip.tagName).toBe('BUTTON')
    expect(chip).toHaveTextContent('Test Data')
    expect(chip.querySelector('svg[class*="lucide-folder"]')).not.toBeNull()
  })

  it('carries no count badge, whatever the artifact count is', () => {
    renderBar({
      path,
      backHref: null,
      status: 'passed',
      artifactsCount: 3,
      onOpenTestData: vi.fn(),
      onOpenArtifacts: vi.fn(),
    })

    const chip = screen.getByTestId('breadcrumb-testdata-chip')
    expect(within(chip).queryByText('3')).not.toBeInTheDocument()
    expect(chip.textContent).toBe('Test Data')
  })

  it('carries no state mark while nothing is uploading and nothing failed', () => {
    renderBar({ path, backHref: null, status: 'idle', onOpenTestData: vi.fn() })

    expect(screen.queryByTestId('breadcrumb-testdata-state')).not.toBeInTheDocument()
  })

  it('spins while a file is on its way in (TDATA-16)', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      testDataUploading: true,
    })

    const state = screen.getByTestId('breadcrumb-testdata-state')
    expect(state).toHaveAttribute('data-uploading', 'true')
    expect(state).toHaveAttribute('data-interrupted', 'false')
    expect(state.querySelector('svg[class*="animate-spin"]')).not.toBeNull()
    expect(state).toHaveTextContent('Uploading')
  })

  it('marks an upload that did not finish once the uploads are over (TDATA-16)', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      testDataInterrupted: true,
    })

    const state = screen.getByTestId('breadcrumb-testdata-state')
    expect(state).toHaveAttribute('data-uploading', 'false')
    expect(state).toHaveAttribute('data-interrupted', 'true')
    expect(state.querySelector('svg[class*="animate-spin"]')).toBeNull()
    expect(state).toHaveTextContent('An upload did not finish')
  })

  it('puts the mark inside the spinner while both are true (TDATA-16)', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      testDataUploading: true,
      testDataInterrupted: true,
    })

    const state = screen.getByTestId('breadcrumb-testdata-state')
    expect(state.querySelector('svg[class*="animate-spin"]')).not.toBeNull()
    expect(within(state).getByText('!')).toBeInTheDocument()
    expect(state).toHaveTextContent('Uploading; an upload did not finish')
  })

  it('announces the state as it changes, not as part of the chip name (TDATA-16)', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      testDataUploading: true,
    })

    const state = screen.getByTestId('breadcrumb-testdata-state')
    expect(within(state).getByText('Uploading')).toHaveAttribute('aria-live', 'polite')
  })

  it('sits immediately left of the Artifacts chip', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      onOpenArtifacts: vi.fn(),
    })

    const order = Array.from(
      document.querySelectorAll(
        '[data-testid="breadcrumb-testdata-chip"], [data-testid="breadcrumb-artifacts-chip"], [data-testid="breadcrumb-reset-link"]',
      ),
    ).map((element) => element.getAttribute('data-testid'))

    expect(order).toEqual([
      'breadcrumb-testdata-chip',
      'breadcrumb-artifacts-chip',
      'breadcrumb-reset-link',
    ])
  })

  it('is the same size as the Artifacts chip', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      onOpenArtifacts: vi.fn(),
    })

    const testData = screen.getByTestId('breadcrumb-testdata-chip')
    const artifacts = screen.getByTestId('breadcrumb-artifacts-chip')

    expect(testData.className).toBe(artifacts.className)
    expect(iconSizeTokens(testData)).toEqual(iconSizeTokens(artifacts))
  })

  it('fires onOpenTestData when the chip is clicked', async () => {
    const user = userEvent.setup()
    const onOpenTestData = vi.fn()
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData,
      onOpenArtifacts: vi.fn(),
    })

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))

    expect(onOpenTestData).toHaveBeenCalledTimes(1)
  })

  it('stays enabled while the reset link is disabled', () => {
    renderBar({
      path,
      backHref: null,
      status: 'idle',
      onOpenTestData: vi.fn(),
      onOpenArtifacts: vi.fn(),
    })

    expect(screen.getByTestId('breadcrumb-reset-link')).toBeDisabled()
    expect(screen.getByTestId('breadcrumb-testdata-chip')).toBeEnabled()
  })
})
