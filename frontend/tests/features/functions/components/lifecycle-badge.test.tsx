/**
 * Tests for the edit-mode extension of `FunctionLifecycleBadge` (REQ-3.1.2.2,
 * FN-VER-1, FN-VER-2).
 *
 * The base behavior (L / S glyph + lifecycle tooltip) is covered by other tests
 * for this component; this file focuses on the new `editMode` prop:
 *
 *   - When editMode=true, the badge renders an EditModeMark overlay
 *   - The overlay is positioned at the top-right corner via translate(50%,-50%)
 *   - The overlay carries an accessible label naming the edit-mode state
 *     ("Function in edit mode - may differ from published vX.Y.Z.")
 *   - editMode=false (default) does NOT render the overlay
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FunctionLifecycleBadge } from '@/features/functions/components/lifecycle-badge'


describe('FunctionLifecycleBadge - default behavior preserved', () => {
  it('renders the S glyph for shared lifecycle without editMode', () => {
    render(<FunctionLifecycleBadge lifecycle="shared" />)
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('renders the L glyph for local lifecycle', () => {
    render(<FunctionLifecycleBadge lifecycle="local" />)
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('does NOT render the edit-mode mark when editMode prop is omitted', () => {
    const { container } = render(<FunctionLifecycleBadge lifecycle="shared" />)
    // The asterisk component carries the testid "edit-mode-mark".
    expect(container.querySelector('[data-testid="edit-mode-mark"]')).toBeNull()
  })

  it('does NOT render the edit-mode mark when editMode=false', () => {
    const { container } = render(
      <FunctionLifecycleBadge lifecycle="shared" editMode={false} />,
    )
    expect(container.querySelector('[data-testid="edit-mode-mark"]')).toBeNull()
  })
})


describe('FunctionLifecycleBadge - editMode=true overlay', () => {
  it('renders the EditModeMark overlay on the badge', () => {
    const { container } = render(
      <FunctionLifecycleBadge lifecycle="shared" editMode />,
    )
    const overlay = container.querySelector('[data-testid="edit-mode-mark"]')
    expect(overlay).not.toBeNull()
  })

  it('positions the overlay at the badge top-right via translate(50%,-50%)', () => {
    const { container } = render(
      <FunctionLifecycleBadge lifecycle="shared" editMode />,
    )
    const wrapper = container.querySelector(
      '[data-testid="edit-mode-mark-wrapper"]',
    ) as HTMLElement
    expect(wrapper).not.toBeNull()
    // translate(50%,-50%) so the visible center of the asterisk
    // sits on the badge's top-right corner. Tailwind ships this as
    // `translate-x-1/2 -translate-y-1/2` plus absolute positioning.
    const classes = wrapper.className
    expect(classes).toMatch(/translate-x-1\/2/)
    expect(classes).toMatch(/-translate-y-1\/2/)
    expect(classes).toMatch(/absolute/)
  })

  it('overlay names the source version in its accessible label when provided', () => {
    render(
      <FunctionLifecycleBadge
        lifecycle="shared"
        editMode
        editModeSourceVersion="1.4.2"
      />,
    )
    const overlay = screen.getByTestId('edit-mode-mark-wrapper')
    expect(overlay).toHaveAttribute(
      'aria-label',
      'Function in edit mode - may differ from published v1.4.2.',
    )
    expect(overlay.getAttribute('aria-label')).not.toMatch(/kebab/i)
  })

  it('overlay falls back to a generic label when the version is unknown', () => {
    render(<FunctionLifecycleBadge lifecycle="shared" editMode />)
    const overlay = screen.getByTestId('edit-mode-mark-wrapper')
    expect(overlay).toHaveAttribute(
      'aria-label',
      'Function in edit mode - may differ from the published version.',
    )
  })

  it('local lifecycle does NOT render the overlay even if editMode=true', () => {
    // Edit mode is a Published-Function concept; the prop is ignored on Local.
    const { container } = render(
      <FunctionLifecycleBadge lifecycle="local" editMode />,
    )
    expect(container.querySelector('[data-testid="edit-mode-mark"]')).toBeNull()
  })
})
