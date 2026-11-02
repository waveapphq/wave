/**
 * CanvasBreadcrumbBar - Function (drill) segment behavior.
 *
 * Contract:
 *   - A segment with type === 'function' renders inside the bar's path with
 *     the violet color tokens (text-violet-400 / text-violet-300) and the
 *     FunctionSquare icon (from BreadcrumbSegmentIcon's 'function' case).
 *   - Clicking an intermediate function segment fires onNavigate with the
 *     segment's href (which the parent uses to dispatch popDrillTo).
 *   - The leaf function segment is rendered as a non-link (no onNavigate
 *     fired on click).
 *   - When the back arrow is clicked AND the deepest segment is a function
 *     (i.e. drillPath non-empty), onBack fires. The bar does not own the
 *     pop semantics; the parent (live/breadcrumb-bar.tsx) reads drillPath
 *     length to dispatch popDrillOne vs navigate. We only assert onBack
 *     fires here.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import { CanvasBreadcrumbBar } from '@/features/workbench/common/canvas/chrome/canvas-breadcrumb-bar'

type BarProps = Parameters<typeof CanvasBreadcrumbBar>[0]
type Segment = BarProps['path'][number]

function renderBar(props: BarProps) {
  return render(
    <MemoryRouter>
      <CanvasBreadcrumbBar {...props} />
    </MemoryRouter>,
  )
}

describe('CanvasBreadcrumbBar - function segment rendering', () => {
  it('renders a function segment with the FunctionSquare icon', () => {
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: 'fn-depth-1' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle' })
    // FunctionSquare lucide icon: matched by its lucide class on the SVG.
    // lucide-react v0.555 renames FunctionSquare → SquareFunction internally,
    // so the rendered class is `lucide-square-function`.
    const path_ = screen.getByTestId('breadcrumb-path')
    expect(path_.querySelector('.lucide-square-function')).not.toBeNull()
  })

  it('applies the violet color tokens to function segment icons', () => {
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: 'fn-depth-1' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle' })

    // For the leaf, the segment is rendered as BreadcrumbPage (a span with
    // aria-current="page") wrapping the icon and label. For intermediate
    // segments, an anchor wraps them. closest() targets either.
    const fnSegment = screen.getByText('Function_1').closest('a, [aria-current="page"]')
    expect(fnSegment).not.toBeNull()
    // The icon is wrapped in a span whose color is the violet token. The
    // existing BreadcrumbSegmentIcon writes the color into the style attribute.
    const iconWrapper = fnSegment?.querySelector('span[style*="color"]') as HTMLElement | null
    expect(iconWrapper).not.toBeNull()
    // JSDOM normalizes hex (#A78BFA) to rgb(167, 139, 250); accept either form.
    const style = iconWrapper?.getAttribute('style')?.toLowerCase() ?? ''
    expect(style === '' ? '' : style).toMatch(/(a78bfa|rgb\(\s*167\s*,\s*139\s*,\s*250\s*\))/)
  })
})

describe('CanvasBreadcrumbBar - function segment click semantics', () => {
  it('fires onNavigate when an intermediate function segment is clicked', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200', href: '/tests/test-1' },
      // Intermediate function segment (one above the leaf): clickable.
      { type: 'function', label: 'Function_1', href: '#drill-1', id: 'fn-depth-1' },
      { type: 'function', label: 'Helper_2', id: 'fn-depth-2' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle', onNavigate })

    await user.click(screen.getByText('Function_1'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('#drill-1')
  })

  it('does not fire onNavigate when the LEAF function segment is clicked', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200', href: '/tests/test-1' },
      { type: 'function', label: 'Function_1', id: 'fn-depth-1' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle', onNavigate })

    await user.click(screen.getByText('Function_1'))
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('CanvasBreadcrumbBar - back arrow with drill', () => {
  it('fires onBack when the back arrow is clicked while a function segment is the leaf', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200', href: '/tests/test-1' },
      { type: 'function', label: 'Function_1', id: 'fn-depth-1' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle', onBack })

    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('CanvasBreadcrumbBar - function segment styling', () => {
  it('intermediate function segments are rendered as links (anchor element)', () => {
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200', href: '/tests/test-1' },
      { type: 'function', label: 'Function_1', href: '#drill-1', id: 'fn-depth-1' },
      { type: 'function', label: 'Helper_2', id: 'fn-depth-2' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle' })

    const intermediate = screen.getByText('Function_1').closest('a')
    expect(intermediate).not.toBeNull()
  })

  it('leaf function segment is rendered as the BreadcrumbPage (non-link, aria-current)', () => {
    const path: Segment[] = [
      { type: 'test', label: 'API Health 200', href: '/tests/test-1' },
      { type: 'function', label: 'Function_1', id: 'fn-depth-1' },
    ]
    renderBar({ path, backHref: '/tests', status: 'idle' })

    // BreadcrumbPage renders as a span (Radix), not an anchor.
    expect(screen.getByText('Function_1').closest('a')).toBeNull()
  })
})
