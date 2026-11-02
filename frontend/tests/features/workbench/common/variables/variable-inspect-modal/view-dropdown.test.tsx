/**
 * Tests for ViewDropdown - the inspect modal's footer View selector
 * (VMGR-27, VMGR-29).
 *
 * Contract under test:
 *   - TEXT label trigger reflecting the selected view (no icon-only glyphs)
 *   - menu items "Visual" / "Code" as plain text with a check on the
 *     selected entry
 *   - aria-label "Inspect view" + data-testid "view-dropdown"
 *   - onValueChange fires with the picked view
 *
 * The upward-opening menu (side="top") matches ModeDropdown and is asserted
 * visually in Playwright coverage, mirroring the mode-dropdown precedent.
 *
 * The host passes the per-watcher-kind `options` list (plus `disabled`
 * for the Initial lock). This file keeps covering the base Visual/Code
 * family through the new contract; the per-kind option matrices and the
 * disabled lock live in the modal host tests.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ViewDropdown,
  type InspectView,
} from '@/features/workbench/common/variables/variable-inspect-modal/view-dropdown'

const VISUAL_CODE: InspectView[] = ['visual', 'code']

function renderDropdown(
  value: InspectView = 'visual',
  onValueChange: (value: InspectView) => void = vi.fn(),
) {
  return render(
    <ViewDropdown value={value} onValueChange={onValueChange} options={VISUAL_CODE} />,
  )
}

describe('ViewDropdown - trigger', () => {
  it('renders the trigger with the view-dropdown testid', () => {
    renderDropdown()
    expect(screen.getByTestId('view-dropdown')).toBeInTheDocument()
  })

  it('labels the trigger "Inspect view" for screen readers', () => {
    renderDropdown()
    expect(screen.getByTestId('view-dropdown')).toHaveAttribute(
      'aria-label',
      'Inspect view',
    )
  })

  it('shows the text label "Visual" when value is visual', () => {
    renderDropdown('visual')
    expect(screen.getByTestId('view-dropdown')).toHaveTextContent('Visual')
  })

  it('shows the text label "Code" when value is code', () => {
    renderDropdown('code')
    expect(screen.getByTestId('view-dropdown')).toHaveTextContent('Code')
  })
})

describe('ViewDropdown - menu items', () => {
  it('lists exactly the Visual and Code options', async () => {
    const user = userEvent.setup()
    renderDropdown('visual')

    await user.click(screen.getByTestId('view-dropdown'))

    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Visual',
      'Code',
    ])
  })

  it('does NOT list an Expression item when the host passes only Visual/Code', async () => {
    const user = userEvent.setup()
    renderDropdown('visual')

    await user.click(screen.getByTestId('view-dropdown'))
    await screen.findAllByRole('option')

    expect(
      screen.queryByRole('option', { name: /expression/i }),
    ).not.toBeInTheDocument()
  })

  it('marks the selected view with the check (aria-selected)', async () => {
    const user = userEvent.setup()
    renderDropdown('code')

    await user.click(screen.getByTestId('view-dropdown'))

    const code = await screen.findByRole('option', { name: 'Code' })
    const visual = screen.getByRole('option', { name: 'Visual' })
    expect(code).toHaveAttribute('aria-selected', 'true')
    expect(visual).not.toHaveAttribute('aria-selected', 'true')
  })
})

describe('ViewDropdown - selection', () => {
  it('fires onValueChange with "code" when Code is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderDropdown('visual', onValueChange)

    await user.click(screen.getByTestId('view-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Code' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('code')
  })

  it('fires onValueChange with "visual" when Visual is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderDropdown('code', onValueChange)

    await user.click(screen.getByTestId('view-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Visual' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('visual')
  })
})

// ===========================================================================
// Per-item disabled +
// tooltip. While editing literal complex in Code view with invalid JSON, the
// host disables the Visual item (Code -> Visual would lose the edit) and shows
// the immediate tooltip "Fix JSON errors to switch to Visual"; Visual -> Code
// is always safe. The trigger stays enabled so Code remains pickable.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

const INVALID_JSON_TOOLTIP = 'Fix JSON errors to switch to Visual'

describe('ViewDropdown - per-item disabled (invalid-JSON guard)', () => {
  function renderWithDisabledVisual(onValueChange = vi.fn()) {
    render(
      <ViewDropdown
        value="code"
        onValueChange={onValueChange}
        options={VISUAL_CODE}
        disabledOptions={['visual']}
        disabledOptionTooltip={INVALID_JSON_TOOLTIP}
      />,
    )
    return { onValueChange }
  }

  it('keeps the trigger enabled so Code stays selectable', () => {
    renderWithDisabledVisual()
    expect(screen.getByTestId('view-dropdown')).not.toBeDisabled()
  })

  it('marks the disabled Visual item aria-disabled with the guard tooltip', async () => {
    const user = userEvent.setup()
    renderWithDisabledVisual()

    await user.click(screen.getByTestId('view-dropdown'))
    const visual = await screen.findByRole('option', { name: 'Visual' })
    expect(visual).toHaveAttribute('aria-disabled', 'true')
    // SHELL-7a: the guard reason comes from the shared tooltip now.
    expect(visual).not.toHaveAttribute('title')
    fireEvent.focus(visual.querySelector('.inline-flex') as HTMLElement)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      INVALID_JSON_TOOLTIP,
    )
  })

  it('shows an inline alert icon on the locked Visual item and none on Code', async () => {
    const user = userEvent.setup()
    renderWithDisabledVisual()

    await user.click(screen.getByTestId('view-dropdown'))
    const visual = await screen.findByRole('option', { name: 'Visual' })
    expect(within(visual).getByTestId('view-locked-alert')).toBeInTheDocument()
    expect(
      within(screen.getByRole('option', { name: 'Code' })).queryByTestId('view-locked-alert'),
    ).not.toBeInTheDocument()
  })

  it('does not fire onValueChange when the disabled Visual item is clicked', async () => {
    const user = userEvent.setup()
    const { onValueChange } = renderWithDisabledVisual()

    await user.click(screen.getByTestId('view-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Visual' }))

    expect(onValueChange).not.toHaveBeenCalled()
  })
})
