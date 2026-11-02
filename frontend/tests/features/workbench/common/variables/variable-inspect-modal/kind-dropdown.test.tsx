/**
 * Tests for KindDropdown - the value-editor sheet's footer Literal/Template
 * selector for a string value. It mirrors FormatDropdown's shared Select
 * wrapper: a TEXT label trigger + chevron (icon-only glyph triggers are
 * rejected project-wide), a plain-text menu with a check on the selected
 * entry, opening upward.
 *
 * Contract under test:
 *   - TEXT label trigger (no icon-only glyph), aria-label "Kind",
 *     data-testid "kind-dropdown"
 *   - shows "Literal" / "Template" by value
 *   - menu lists Literal / Template with a check on the selected entry
 *   - onValueChange fires with the picked kind ('literal' | 'template')
 *
 * The upward-opening menu (side="top") is asserted in Playwright,
 * mirroring the FormatDropdown / ViewDropdown precedent.
 *
 * REQ-3.1.3.15: Template variables
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { KindDropdown } from '@/features/workbench/common/variables/variable-inspect-modal/kind-dropdown'

interface RenderOptions {
  value?: 'literal' | 'template'
  onValueChange?: (value: 'literal' | 'template') => void
}

function renderDropdown({
  value = 'literal',
  onValueChange = vi.fn(),
}: RenderOptions = {}) {
  render(<KindDropdown value={value} onValueChange={onValueChange} />)
  return { onValueChange }
}

function trigger(): HTMLElement {
  return screen.getByTestId('kind-dropdown')
}

describe('KindDropdown - trigger', () => {
  it('renders the trigger with the kind-dropdown testid', () => {
    renderDropdown()
    expect(trigger()).toBeInTheDocument()
  })

  it('labels the trigger "Kind" for screen readers', () => {
    renderDropdown()
    expect(trigger()).toHaveAttribute('aria-label', 'Kind')
  })

  it('shows "Literal" when the value is literal', () => {
    renderDropdown({ value: 'literal' })
    expect(trigger()).toHaveTextContent('Literal')
  })

  it('shows "Template" when the value is template', () => {
    renderDropdown({ value: 'template' })
    expect(trigger()).toHaveTextContent('Template')
  })
})

describe('KindDropdown - menu items', () => {
  it('lists Literal and Template', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'literal' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Literal', 'Template'])
  })

  it('marks the selected kind with the check (aria-selected)', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'template' })

    await user.click(trigger())
    const template = await screen.findByRole('option', { name: 'Template' })
    const literal = screen.getByRole('option', { name: 'Literal' })
    expect(template).toHaveAttribute('aria-selected', 'true')
    expect(literal).not.toHaveAttribute('aria-selected', 'true')
  })
})

describe('KindDropdown - selection', () => {
  it('fires onValueChange with "template" when Template is picked', async () => {
    const user = userEvent.setup()
    const { onValueChange } = renderDropdown({ value: 'literal' })

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Template' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('template')
  })

  it('fires onValueChange with "literal" when Literal is picked', async () => {
    const user = userEvent.setup()
    const { onValueChange } = renderDropdown({ value: 'template' })

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Literal' }))

    expect(onValueChange).toHaveBeenCalledWith('literal')
  })
})
