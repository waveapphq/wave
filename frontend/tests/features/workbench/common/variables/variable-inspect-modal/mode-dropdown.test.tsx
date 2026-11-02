/**
 * Tests for ModeDropdown - the one value pill: the watcher footer's mode
 * selector and, in the variable window, the value switch on the Value label line.
 *
 * Contract under test:
 *   - TEXT label trigger reflecting the selected mode (no icon-only glyphs)
 *   - menu items "Initial" / "Current" / "Compare" as plain text with a check
 *     on the selected entry; the footer pill opens upward
 *   - onValueChange fires with the picked mode
 *   - the window passes its own options, labels (an input reads Default / Current),
 *     the label-line size (opens below) and the accessible name "Value to edit"
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ModeDropdown,
  type InspectMode,
} from '@/features/workbench/common/variables/variable-inspect-modal/mode-dropdown'

function renderDropdown(
  value: InspectMode = 'current',
  onValueChange: (value: InspectMode) => void = vi.fn(),
) {
  return render(<ModeDropdown value={value} onValueChange={onValueChange} />)
}

const WINDOW_OPTIONS: InspectMode[] = ['initial', 'current']
const INPUT_LABELS = { initial: 'Default' }

interface WindowPillOverrides {
  value?: InspectMode
  onValueChange?: (value: InspectMode) => void
  labels?: Partial<Record<InspectMode, string>>
}

// The pill as the variable window renders it on the Value label line.
function renderWindowPill(overrides: WindowPillOverrides = {}) {
  const onValueChange = vi.fn(overrides.onValueChange)
  render(
    <ModeDropdown
      value={overrides.value ?? 'initial'}
      onValueChange={onValueChange}
      options={WINDOW_OPTIONS}
      labels={overrides.labels}
      size="label"
      ariaLabel="Value to edit"
    />,
  )
  return { onValueChange, trigger: screen.getByRole('combobox') }
}

async function openedOptionTexts(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger)
  return (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
}

describe('ModeDropdown - trigger', () => {
  it('renders the trigger with the mode-dropdown testid', () => {
    renderDropdown()
    expect(screen.getByTestId('mode-dropdown')).toBeInTheDocument()
  })

  it('shows the text label "Current" when value is current', () => {
    renderDropdown('current')
    expect(screen.getByTestId('mode-dropdown')).toHaveTextContent('Current')
  })

  it('shows the text label "Initial" when value is initial', () => {
    renderDropdown('initial')
    expect(screen.getByTestId('mode-dropdown')).toHaveTextContent('Initial')
  })

  it('shows the text label "Compare" when value is compare', () => {
    renderDropdown('compare')
    expect(screen.getByTestId('mode-dropdown')).toHaveTextContent('Compare')
  })
})

describe('ModeDropdown - menu items', () => {
  it('lists Initial, Current, and Compare in that order', async () => {
    const user = userEvent.setup()
    renderDropdown('current')

    await user.click(screen.getByTestId('mode-dropdown'))

    const options = await screen.findAllByRole('option')
    const labels = options.map((o) => o.textContent?.trim())
    expect(labels).toEqual(['Initial', 'Current', 'Compare'])
  })

  it('exposes Compare as a selectable option', async () => {
    const user = userEvent.setup()
    renderDropdown('current')

    await user.click(screen.getByTestId('mode-dropdown'))
    await screen.findAllByRole('option')

    expect(
      screen.getByRole('option', { name: /compare/i }),
    ).toBeInTheDocument()
  })

  it('marks the selected mode with the check (aria-selected)', async () => {
    const user = userEvent.setup()
    renderDropdown('compare')

    await user.click(screen.getByTestId('mode-dropdown'))

    const compare = await screen.findByRole('option', { name: 'Compare' })
    const initial = screen.getByRole('option', { name: 'Initial' })
    expect(compare).toHaveAttribute('aria-selected', 'true')
    expect(initial).not.toHaveAttribute('aria-selected', 'true')
  })
})

describe('ModeDropdown - selection', () => {
  it('fires onValueChange with "initial" when Initial is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderDropdown('current', onValueChange)

    await user.click(screen.getByTestId('mode-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Initial' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('initial')
  })

  it('fires onValueChange with "current" when Current is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderDropdown('initial', onValueChange)

    await user.click(screen.getByTestId('mode-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Current' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('current')
  })

  it('fires onValueChange with "compare" when Compare is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderDropdown('current', onValueChange)

    await user.click(screen.getByTestId('mode-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Compare' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('compare')
  })
})

describe('ModeDropdown - the window value switch options (VMGR-108)', () => {
  it('lists only the options it is given, in their order: Initial then Current', async () => {
    const user = userEvent.setup()
    const { trigger } = renderWindowPill()
    expect(await openedOptionTexts(user, trigger)).toEqual(['Initial', 'Current'])
  })

  it('fires onValueChange with "current" when Current is picked from the two', async () => {
    const user = userEvent.setup()
    const { trigger, onValueChange } = renderWindowPill()
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Current' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('current')
  })
})

describe('ModeDropdown - an input reads Default / Current (VMGR-113)', () => {
  it('shows "Default" on the trigger for the initial value', () => {
    const { trigger } = renderWindowPill({ labels: INPUT_LABELS })
    expect(trigger).toHaveTextContent(/^Default$/)
  })

  it('lists Default then Current', async () => {
    const user = userEvent.setup()
    const { trigger } = renderWindowPill({ labels: INPUT_LABELS })
    expect(await openedOptionTexts(user, trigger)).toEqual(['Default', 'Current'])
  })

  it('reports the initial mode when Default is picked', async () => {
    const user = userEvent.setup()
    const { trigger, onValueChange } = renderWindowPill({ value: 'current', labels: INPUT_LABELS })
    expect(trigger).toHaveTextContent(/^Current$/)
    await user.click(trigger)
    await screen.findAllByRole('option')
    await user.click(screen.getByRole('option', { name: 'Default' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('initial')
  })

  it('marks Default as the selected entry while the initial value is shown', async () => {
    const user = userEvent.setup()
    const { trigger } = renderWindowPill({ labels: INPUT_LABELS })
    await user.click(trigger)
    await screen.findAllByRole('option')
    expect(screen.getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Current' })).not.toHaveAttribute('aria-selected', 'true')
  })
})

describe('ModeDropdown - where the menu opens', () => {
  it('opens below the Value label line in the label size', async () => {
    const user = userEvent.setup()
    const { trigger } = renderWindowPill()
    await user.click(trigger)
    expect(await screen.findByRole('listbox')).toHaveAttribute('data-side', 'bottom')
  })

  it('keeps the footer pill opening upward when no size is given', async () => {
    const user = userEvent.setup()
    renderDropdown('current')
    await user.click(screen.getByTestId('mode-dropdown'))
    expect(await screen.findByRole('listbox')).toHaveAttribute('data-side', 'top')
  })
})

describe('ModeDropdown - keyboard', () => {
  it('opens from the keyboard, closes on Escape, moves with the arrow keys and picks with Enter', async () => {
    const user = userEvent.setup()
    const { trigger, onValueChange } = renderWindowPill({ labels: INPUT_LABELS })
    await user.tab()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    await screen.findAllByRole('option')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onValueChange).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('current')
  })
})

describe('ModeDropdown - accessible name', () => {
  it('names the window pill "Value to edit" and shows the value it edits', () => {
    const { trigger } = renderWindowPill({ value: 'current' })
    expect(screen.getByRole('combobox', { name: 'Value to edit' })).toBe(trigger)
    expect(trigger).toHaveTextContent(/^Current$/)
  })

  it('keeps the watcher name "Inspect mode" when no name is given', () => {
    renderDropdown('initial')
    expect(screen.getByRole('combobox', { name: 'Inspect mode' })).toBe(screen.getByTestId('mode-dropdown'))
  })
})
