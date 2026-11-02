/**
 * VariableComboboxBase: overflow + width fix tests
 *
 * Pins:
 *   - Popover width = `var(--radix-popover-trigger-width)` with a 320px floor.
 *   - Item name span has `min-w-0` so `truncate` (text-overflow: ellipsis)
 *     actually engages inside the flex row.
 *   - Long names render with `truncate` and a native `title` attribute hover.
 *   - Type label and "OUT" badge stay visible (`shrink-0`).
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  VariableComboboxBase,
  type ComboboxVariable,
} from '@/features/workbench/common/element-config/shared/variable-combobox-base'

const longName = 'a_very_long_variable_name_that_definitely_overflows_the_dropdown_box'

const testVariables: ComboboxVariable[] = [
  { name: longName, type: 'string', source: 'http-1', isOutputBinding: true },
  { name: 'short', type: 'integer' },
]

describe('VariableComboboxBase overflow + popover width', () => {
  it('popover content uses the trigger width with a 320px floor', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value=""
        onChange={vi.fn()}
        variables={testVariables}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    // Radix exposes the trigger width via a CSS var; assert the popover style
    // declares both that var as the width and a 320px min-width baseline.
    const popover = await screen.findByRole('listbox', { hidden: true }).catch(
      () => screen.getByRole('dialog'),
    )
    // The PopoverContent is the closest element with the width style; locate it
    // by walking up from the listbox until we find an element with min-width.
    let el: HTMLElement | null = popover as HTMLElement
    while (el && !el.style.minWidth) el = el.parentElement
    expect(el).not.toBeNull()
    const style = el!.getAttribute('style') ?? ''
    expect(style).toContain('--radix-popover-trigger-width')
    expect(style).toMatch(/min-width:\s*320px/i)
  })

  it('item name span carries min-w-0 so truncate engages', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value=""
        onChange={vi.fn()}
        variables={testVariables}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const nameEl = await screen.findByText(longName)
    expect(nameEl.className).toContain('min-w-0')
    expect(nameEl.className).toContain('truncate')
  })

  it('item name reveals the full name through the shared tooltip (SHELL-7a)', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value=""
        onChange={vi.fn()}
        variables={testVariables}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const nameEl = await screen.findByText(longName)
    // The browser's own popup is gone; the hint comes from the one tooltip.
    expect(nameEl).not.toHaveAttribute('title')
    fireEvent.focus(nameEl)
    const popup = document.querySelector('[data-slot="tooltip-content"]')
    expect(popup).toHaveTextContent(longName)
  })

  it('"OUT" badge stays shrink-0 next to a long name', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value=""
        onChange={vi.fn()}
        variables={testVariables}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const badge = await screen.findByText('OUT')
    expect(badge.className).toContain('shrink-0')
  })
})
