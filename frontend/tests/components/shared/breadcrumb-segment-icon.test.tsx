/**
 * BreadcrumbSegmentIcon Tests
 *
 * Tests for the small presentational component that renders the right
 * lucide icon + entity color for each breadcrumb segment type.
 * Colors and icons MUST match the sidebar conventions exactly
 * (see frontend/src/components/shared/app-sidebar.tsx):
 *   - execution / execution-root: Play, color #60A5FA
 *   - regression:                 GitBranch, color #A78BFA
 *   - suite:                      FolderKanban, color #F59E0B
 *   - test:                       TestTube (lucide TestTube2 alias TestTubeDiagonal), color #4ADE80
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BreadcrumbSegmentIcon } from '@/components/shared/breadcrumb-segment-icon'

type SegmentType = 'execution-root' | 'execution' | 'test' | 'suite' | 'regression'

const CASES: Array<{ type: SegmentType; testId: string; color: string }> = [
  { type: 'execution-root', testId: 'icon-execution-root', color: '#60A5FA' },
  { type: 'execution', testId: 'icon-execution', color: '#60A5FA' },
  { type: 'regression', testId: 'icon-regression', color: '#A78BFA' },
  { type: 'suite', testId: 'icon-suite', color: '#F59E0B' },
  { type: 'test', testId: 'icon-test', color: '#4ADE80' },
]

describe('BreadcrumbSegmentIcon', () => {
  it.each(CASES)('renders the entity color for type=$type', ({ type, testId, color }) => {
    render(<BreadcrumbSegmentIcon type={type} data-testid={testId} />)
    const node = screen.getByTestId(testId)
    // Color may be applied via inline style or via a className token. Both
    // expressions are accepted so the implementation has room to use the
    // shadcn icon `style.color` prop or a Tailwind arbitrary value token.
    const styleColor = node.getAttribute('style') ?? ''
    const className = node.className
    const matchesStyle = styleColor.toLowerCase().includes(color.toLowerCase())
    const matchesClass = className.toLowerCase().includes(color.toLowerCase())
    expect(matchesStyle || matchesClass).toBe(true)
  })

  it('renders an svg element per segment type', () => {
    CASES.forEach(({ type, testId }) => {
      const { unmount } = render(<BreadcrumbSegmentIcon type={type} data-testid={testId} />)
      const node = screen.getByTestId(testId)
      const svg = node.tagName.toLowerCase() === 'svg' ? node : node.querySelector('svg')
      expect(svg).not.toBeNull()
      unmount()
    })
  })

  it('overrides the entity color with statusColor (failed test tint)', () => {
    render(<BreadcrumbSegmentIcon type="test" statusColor="#EF4444" data-testid="icon-failed" />)
    const node = screen.getByTestId('icon-failed')
    const style = (node.getAttribute('style') ?? '').toLowerCase()
    const className = node.className.toLowerCase()
    expect(style.includes('#ef4444') || className.includes('#ef4444')).toBe(true)
  })

  it('forwards an optional className', () => {
    render(<BreadcrumbSegmentIcon type="suite" data-testid="icon-with-class" className="shrink-0" />)
    const node = screen.getByTestId('icon-with-class')
    expect(node.className).toContain('shrink-0')
  })

  it('renders a tinted tile (icon color + translucent background) when tile is set', () => {
    render(<BreadcrumbSegmentIcon type="regression" tile data-testid="tile" />)
    const node = screen.getByTestId('tile')
    // jsdom serializes the inline hex (#A78BFA) to rgb/rgba.
    const style = (node.getAttribute('style') ?? '').toLowerCase()

    expect(style).toContain('color: rgb(167, 139, 250)')
    expect(style).toContain('background-color: rgba(167, 139, 250')
    expect(node.querySelector('svg')).not.toBeNull()
    expect(node.className).toContain('h-8')
  })

  it('applies a custom tileClassName over the default size', () => {
    render(
      <BreadcrumbSegmentIcon type="suite" tile tileClassName="h-9 w-9" data-testid="tile-custom" />,
    )
    const node = screen.getByTestId('tile-custom')

    expect(node.className).toContain('h-9')
    expect(node.className).not.toContain('h-8')
  })

  it('uses unique icons per entity type (lookup is one-to-one)', () => {
    const rendered: string[] = []
    CASES.forEach(({ type, testId }) => {
      const { unmount } = render(<BreadcrumbSegmentIcon type={type} data-testid={testId} />)
      const node = screen.getByTestId(testId)
      const svg = node.tagName.toLowerCase() === 'svg' ? node : node.querySelector('svg')
      rendered.push(svg?.innerHTML ?? '')
      unmount()
    })
    // 'execution' and 'execution-root' share the Play icon by design;
    // collapse to a Set with the other 4 + 1 Play entry = 4 unique shapes.
    const unique = new Set(rendered)
    expect(unique.size).toBeGreaterThanOrEqual(4)
  })
})
