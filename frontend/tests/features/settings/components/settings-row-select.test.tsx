/**
 * SettingsRowSelect Component Tests
 *
 * The select of a settings row (SETTINGS-18, NET-11): it lists its options,
 * reports a choice, can be disabled, and its trigger takes the row's id and
 * aria-describedby so the row label and help line reach it.
 *
 * Component: frontend/src/features/settings/components/settings-row-select.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import { SettingsRowSelect } from '@/features/settings/components/settings-row-select'

type Zone = 'local' | 'utc'
type Level = 'DEBUG' | 'INFO' | 'WARN'

const ZONE_OPTIONS: ReadonlyArray<{ value: Zone; label: string }> = [
  { value: 'local', label: 'Browser local' },
  { value: 'utc', label: 'UTC' },
]

const LEVEL_OPTIONS: ReadonlyArray<{ value: Level; label: string }> = [
  { value: 'DEBUG', label: 'DEBUG' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARN', label: 'WARN' },
]

const ZONE_LABEL = 'Time Zone'
const ZONE_HELP = 'How timestamps are shown in this browser.'

interface ZoneSelectOptions {
  value?: Zone
  disabled?: boolean
  id?: string
  describedBy?: string
  translate?: 'no'
}

function renderZoneSelect({
  value = 'local',
  disabled = false,
  id,
  describedBy,
  translate,
}: ZoneSelectOptions = {}) {
  const onChange = vi.fn<(value: Zone) => void>()
  const view = render(
    <SettingsRowSelect
      data-testid="timezone-select"
      className="w-44"
      value={value}
      options={ZONE_OPTIONS}
      disabled={disabled}
      onChange={onChange}
      id={id}
      aria-describedby={describedBy}
      translate={translate}
    />,
  )
  return { ...view, onChange }
}

function trigger(): HTMLElement {
  return screen.getByRole('combobox')
}

function optionLabels(): Array<string | undefined> {
  return screen.getAllByRole('option').map((option) => option.textContent?.trim())
}

describe('SettingsRowSelect', () => {
  describe('Value and options', () => {
    it.each([
      { value: 'local', label: 'Browser local', other: 'UTC' },
      { value: 'utc', label: 'UTC', other: 'Browser local' },
    ] as const)('shows "$label" in the trigger for the value $value', ({ value, label, other }) => {
      renderZoneSelect({ value })

      expect(trigger()).toHaveTextContent(label)
      expect(trigger()).not.toHaveTextContent(other)
    })

    it('lists no option until it is opened', () => {
      renderZoneSelect()

      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    })

    it('lists its options in the order given once opened', async () => {
      const user = userEvent.setup()
      renderZoneSelect()

      await user.click(trigger())

      expect(optionLabels()).toEqual(['Browser local', 'UTC'])
    })

    it('lists the options of another value type the same way', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn<(value: Level) => void>()
      render(
        <SettingsRowSelect
          data-testid="log-level-select"
          className="w-32"
          value="INFO"
          options={LEVEL_OPTIONS}
          disabled={false}
          onChange={onChange}
        />,
      )

      await user.click(trigger())

      expect(optionLabels()).toEqual(['DEBUG', 'INFO', 'WARN'])
    })
  })

  describe('Choosing', () => {
    it('reports the value of the chosen option', async () => {
      const user = userEvent.setup()
      const { onChange } = renderZoneSelect({ value: 'local' })

      await user.click(trigger())
      await user.click(screen.getByRole('option', { name: 'UTC' }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('utc')
    })

    it('reports the value, not the label, of the chosen option', async () => {
      const user = userEvent.setup()
      const { onChange } = renderZoneSelect({ value: 'utc' })

      await user.click(trigger())
      await user.click(screen.getByRole('option', { name: 'Browser local' }))

      expect(onChange).toHaveBeenCalledWith('local')
    })

    it('does not change the shown value on its own', async () => {
      const user = userEvent.setup()
      renderZoneSelect({ value: 'local' })

      await user.click(trigger())
      await user.click(screen.getByRole('option', { name: 'UTC' }))

      expect(trigger()).toHaveTextContent('Browser local')
    })

    it('reports nothing when it is only opened', async () => {
      const user = userEvent.setup()
      const { onChange } = renderZoneSelect()

      await user.click(trigger())

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Disabled', () => {
    it('disables the trigger', () => {
      renderZoneSelect({ disabled: true })

      expect(trigger()).toBeDisabled()
    })

    it('does not open and reports nothing when a disabled trigger is clicked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderZoneSelect({ disabled: true })

      await user.click(trigger())

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('still shows the current value while disabled', () => {
      renderZoneSelect({ disabled: true, value: 'utc' })

      expect(trigger()).toHaveTextContent('UTC')
    })

    it('enables the trigger when it is not disabled', () => {
      renderZoneSelect({ disabled: false })

      expect(trigger()).toBeEnabled()
    })
  })

  describe('Trigger attributes', () => {
    it('puts its data-testid on the trigger', () => {
      renderZoneSelect()

      expect(screen.getByTestId('timezone-select')).toBe(trigger())
    })

    it('puts its className on the trigger', () => {
      renderZoneSelect()

      expect(trigger()).toHaveClass('w-44')
    })

    it('puts the id on the trigger', () => {
      renderZoneSelect({ id: 'timezone-control' })

      expect(trigger()).toHaveAttribute('id', 'timezone-control')
    })

    it('puts aria-describedby on the trigger', () => {
      render(<p id="timezone-help">{ZONE_HELP}</p>)
      renderZoneSelect({ describedBy: 'timezone-help' })

      expect(trigger()).toHaveAttribute('aria-describedby', 'timezone-help')
      expect(trigger()).toHaveAccessibleDescription(ZONE_HELP)
    })

    it('leaves the trigger without a description when none is given', () => {
      renderZoneSelect()

      expect(trigger()).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('Page translation', () => {
    it('keeps the trigger and the open list out of page translation when asked to', async () => {
      const user = userEvent.setup()
      renderZoneSelect({ translate: 'no' })

      expect(trigger()).toHaveAttribute('translate', 'no')
      await user.click(trigger())

      expect(screen.getByRole('listbox')).toHaveAttribute('translate', 'no')
    })

    it('leaves the trigger and the open list translatable by default', async () => {
      const user = userEvent.setup()
      renderZoneSelect()

      expect(trigger()).not.toHaveAttribute('translate')
      await user.click(trigger())

      expect(screen.getByRole('listbox')).not.toHaveAttribute('translate')
    })
  })

  describe('Inside a settings row', () => {
    function renderRow(help?: string) {
      const onChange = vi.fn<(value: Zone) => void>()
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={ZONE_LABEL}
            help={help}
            control={
              <SettingsRowSelect
                data-testid="timezone-select"
                className="w-44"
                value="local"
                options={ZONE_OPTIONS}
                disabled={false}
                onChange={onChange}
              />
            }
          />
        </SettingsRowGroup>,
      )
      return { onChange }
    }

    it('is named by the row label, which points at the trigger', () => {
      renderRow()

      const select = screen.getByRole('combobox', { name: ZONE_LABEL })
      expect(select.id).not.toBe('')
      expect(screen.getByText(ZONE_LABEL, { selector: 'label' })).toHaveAttribute('for', select.id)
    })

    it('is described by the row help line', () => {
      renderRow(ZONE_HELP)

      expect(screen.getByRole('combobox', { name: ZONE_LABEL })).toHaveAccessibleDescription(
        ZONE_HELP,
      )
    })

    it('has no description in a row with no help line', () => {
      renderRow()

      expect(screen.getByRole('combobox', { name: ZONE_LABEL })).not.toHaveAccessibleDescription()
    })

    it('still reports a choice', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow(ZONE_HELP)

      await user.click(screen.getByRole('combobox', { name: ZONE_LABEL }))
      await user.click(screen.getByRole('option', { name: 'UTC' }))

      expect(onChange).toHaveBeenCalledWith('utc')
    })
  })
})
