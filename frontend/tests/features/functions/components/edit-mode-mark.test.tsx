/**
 * Tests for `EditModeMark` (REQ-3.1.2.2, FN-VER-1).
 *
 * The red SVG asterisk that overlays the lifecycle badge in edit mode:
 *   - Stand-alone component so it can be unit-tested in isolation
 *   - SVG path (3-stroke asterisk) at 2.4px stroke width, rounded line caps
 *   - Color: text-red-600 in light, text-red-400 in dark (via currentColor)
 *   - 14x14 wrapper; transform: translate(50%, -50%) positions the visible
 *     center on the badge's top-right corner
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { EditModeMark } from '@/features/functions/components/edit-mode-mark'


describe('EditModeMark - rendering', () => {
  it('renders an SVG element', () => {
    const { container } = render(<EditModeMark />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('uses currentColor on the stroke so theme styling controls the color', () => {
    const { container } = render(<EditModeMark />)
    const path = container.querySelector('svg path')
    // stroke="currentColor" so Tailwind text-red-600/text-red-400
    // (set on the parent wrapper) drives the visible color.
    expect(path?.getAttribute('stroke')).toBe('currentColor')
  })

  it('uses rounded line caps for the asterisk strokes', () => {
    const { container } = render(<EditModeMark />)
    const path = container.querySelector('svg path')
    expect(path?.getAttribute('stroke-linecap')).toBe('round')
  })

  it('renders the three asterisk strokes via a single path with three M..L segments', () => {
    const { container } = render(<EditModeMark />)
    const path = container.querySelector('svg path')
    const d = path?.getAttribute('d') ?? ''
    // Three Move-Line segments for the three asterisk arms (vertical +
    // two diagonals).
    const moveCount = (d.match(/M/g) ?? []).length
    expect(moveCount).toBe(3)
  })

  it('has 16x16 viewBox so the wrapper can size it via CSS', () => {
    const { container } = render(<EditModeMark />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
  })

  it('does not fill the strokes (open asterisk, not solid)', () => {
    const { container } = render(<EditModeMark />)
    const path = container.querySelector('svg path')
    expect(path?.getAttribute('fill')).toBe('none')
  })
})
