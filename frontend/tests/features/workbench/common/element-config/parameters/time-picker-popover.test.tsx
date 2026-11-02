/**
 * The From / To popover: tabs Absolute / Relative / Now, the tab it opens on for each value, the draft each tab and
 * control edits, the Cancel / Save footer, and the keyboard. Every change edits a draft that starts on the value, or
 * on the row default when the value is blank; only Save writes it, and Cancel, Escape and a click outside discard it.
 *
 * Design Reference: OS-4, FIELD-9
 * REQ-3.3.2.3: Filter logs by time range
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TimePickerPopover } from '@/features/workbench/common/element-config/parameters/time-picker-popover'

const NOW = new Date('2026-09-25T10:42:05Z')
const fixedNow = () => NOW

type User = ReturnType<typeof userEvent.setup>

const TIME_SELECT_NAMES = new Set(['Hour', 'Minute', 'Second'])

const UNIT_LABELS = [
  'seconds ago',
  'minutes ago',
  'hours ago',
  'days ago',
  'weeks ago',
  'months ago',
  'years ago',
  'seconds from now',
  'minutes from now',
  'hours from now',
  'days from now',
  'weeks from now',
  'months from now',
  'years from now',
]

const RELATIVE_GRAMMAR = /^now([+-]\d+[smhdwMy])?(\/[smhdwMy])?$/

/** The declared OpenSearch From / To defaults. */
const ROW_DEFAULTS = { From: 'now-15m', To: 'now' } as const

interface HarnessProps {
  label?: 'From' | 'To'
  initialValue?: unknown
  defaultValue?: string
  onSave: (value: string) => void
  onCancel: () => void
}

/** Holds the row value and the open state the way the row does, so a reopened popover re-reads what was saved. */
function Harness({ label = 'From', initialValue, defaultValue, onSave, onCancel }: Readonly<HarnessProps>) {
  const [value, setValue] = useState<unknown>(initialValue)
  const [open, setOpen] = useState(false)
  return (
    <TimePickerPopover
      label={label}
      value={value}
      defaultValue={defaultValue ?? ROW_DEFAULTS[label]}
      open={open}
      onOpenChange={setOpen}
      onSave={(next: string) => {
        onSave(next)
        setValue(next)
        setOpen(false)
      }}
      onCancel={() => {
        onCancel()
        setOpen(false)
      }}
      now={fixedNow}
    >
      <button type="button" onClick={() => setOpen(true)}>{`Open ${label}`}</button>
    </TimePickerPopover>
  )
}

function renderPicker(props: Partial<Omit<HarnessProps, 'onSave' | 'onCancel'>> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(<Harness onSave={onSave} onCancel={onCancel} {...props} />)
  return { onSave, onCancel }
}

function openButton(label: 'From' | 'To' = 'From'): HTMLElement {
  return screen.getByRole('button', { name: `Open ${label}`, hidden: true })
}

async function open(user: User, label: 'From' | 'To' = 'From'): Promise<HTMLElement> {
  await user.click(openButton(label))
  return screen.getByRole('dialog', { name: label })
}

function tabButton(dialog: HTMLElement, name: 'Absolute' | 'Relative' | 'Now'): HTMLElement {
  return within(dialog).getByRole('button', { name })
}

function saveButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId('time-picker-save')
}

function cancelButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId('time-picker-cancel')
}

/** Clicks Save and expects the one write it makes. */
async function expectSaved(user: User, dialog: HTMLElement, onSave: ReturnType<typeof vi.fn>, written: string) {
  expect(onSave).not.toHaveBeenCalled()
  await user.click(saveButton(dialog))
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(written)
}

function pressedTab(dialog: HTMLElement): string | null {
  const strip = within(dialog).getByRole('group', { name: /mode$/ })
  const pressed = within(strip)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
  expect(pressed).toHaveLength(1)
  return pressed[0].textContent
}

/** Picks an option on a native select or a Radix select alike. */
async function choose(user: User, control: HTMLElement, label: string) {
  if (control instanceof HTMLSelectElement) {
    await user.selectOptions(control, label)
    return
  }
  await user.click(control)
  await user.click(await screen.findByRole('option', { name: label }))
}

function shownLabel(control: HTMLElement): string {
  if (control instanceof HTMLSelectElement) return control.selectedOptions[0]?.textContent ?? ''
  return control.textContent?.trim() ?? ''
}

async function optionLabels(user: User, control: HTMLElement): Promise<string[]> {
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.options).map((option) => option.textContent ?? '')
  }
  await user.click(control)
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

function unitSelect(dialog: HTMLElement): HTMLElement {
  const unit = within(dialog)
    .getAllByRole('combobox')
    .find((control) => !TIME_SELECT_NAMES.has(control.getAttribute('aria-label') ?? ''))
  expect(unit).toBeDefined()
  return unit as HTMLElement
}

function amountBox(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByLabelText('Amount') as HTMLInputElement
}

function dateTimeBox(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByRole('textbox', { name: 'Date and time' }) as HTMLInputElement
}

function dayButton(dialog: HTMLElement, day: RegExp): HTMLElement {
  return within(within(dialog).getByRole('grid')).getByRole('button', { name: day })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TimePickerPopover', () => {
  describe('the popover', () => {
    it('is a dialog labeled after the row', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      expect(await open(user)).toBeInTheDocument()
    })

    it('labels the To popover To', async () => {
      const user = userEvent.setup()
      renderPicker({ label: 'To', initialValue: 'now' })
      expect(await open(user, 'To')).toBeInTheDocument()
    })

    it('offers the three tabs in order in a labeled strip', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      const strip = within(dialog).getByRole('group', { name: 'From mode' })
      expect(within(strip).getAllByRole('button').map((button) => button.textContent)).toEqual([
        'Absolute',
        'Relative',
        'Now',
      ])
    })

    it('names the To strip To mode', async () => {
      const user = userEvent.setup()
      renderPicker({ label: 'To', initialValue: 'now' })
      const dialog = await open(user, 'To')
      expect(within(dialog).getByRole('group', { name: 'To mode' })).toBeInTheDocument()
    })

    it('marks the trigger as opening a dialog and expanded while open', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      expect(openButton()).toHaveAttribute('aria-haspopup', 'dialog')
      expect(openButton()).toHaveAttribute('aria-expanded', 'false')

      await open(user)

      expect(openButton()).toHaveAttribute('aria-expanded', 'true')
    })

    it('ends under the expand button and opens below it, so it stays inside the window (FIELD-9)', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(dialog).toHaveAttribute('data-align', 'end')
      expect(dialog).toHaveAttribute('data-side', 'bottom')
    })
  })

  describe('the Cancel / Save footer (FIELD-9)', () => {
    it('ends with Cancel and then Save', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(cancelButton(dialog)).toHaveAccessibleName('Cancel')
      expect(saveButton(dialog)).toHaveAccessibleName('Save')
      expect(cancelButton(dialog).compareDocumentPosition(saveButton(dialog))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    })

    it('draws Cancel outlined and Save as the primary button', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(cancelButton(dialog)).toHaveClass('btn-secondary')
      expect(saveButton(dialog)).toHaveClass('btn-primary')
    })

    it('edits a draft: a tab switch writes nothing until Save, which writes it and closes', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Now'))

      expect(pressedTab(dialog)).toBe('Now')
      await expectSaved(user, dialog, onSave, 'now')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('Cancel discards the draft and closes', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)
      fireEvent.change(amountBox(dialog), { target: { value: '30' } })

      await user.click(cancelButton(dialog))

      expect(onSave).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('reopens on the saved value after Cancel, not on the discarded draft', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const first = await open(user)
      fireEvent.change(amountBox(first), { target: { value: '30' } })
      await user.click(cancelButton(first))

      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('15')
      expect(within(dialog).getByText('now-15m')).toBeInTheDocument()
    })

    it('Escape discards the draft: the next Save writes only the new draft', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const first = await open(user)
      await user.click(tabButton(first, 'Now'))

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const dialog = await open(user)
      expect(pressedTab(dialog)).toBe('Relative')
      fireEvent.change(amountBox(dialog), { target: { value: '30' } })
      await expectSaved(user, dialog, onSave, 'now-30m')
    })

    it('a click outside discards the draft: the next Save writes only the new draft', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const first = await open(user)
      await user.click(tabButton(first, 'Now'))

      await user.click(document.body)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const dialog = await open(user)
      expect(pressedTab(dialog)).toBe('Relative')
      fireEvent.change(amountBox(dialog), { target: { value: '30' } })
      await expectSaved(user, dialog, onSave, 'now-30m')
    })

    it('reopens on what Save wrote', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const first = await open(user)
      await user.click(tabButton(first, 'Now'))
      await user.click(saveButton(first))

      expect(pressedTab(await open(user))).toBe('Now')
    })
  })

  describe('the draft starts on the row default when the value is blank', () => {
    it('reads a blank From default from the row, not from the label', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '', defaultValue: 'now-2h' })
      const dialog = await open(user)

      expect(pressedTab(dialog)).toBe('Relative')
      expect(amountBox(dialog).value).toBe('2')
      expect(shownLabel(unitSelect(dialog))).toBe('hours ago')
      expect(within(dialog).getByText('now-2h')).toBeInTheDocument()
    })

    it('reads a blank To default from the row, not from the label', async () => {
      const user = userEvent.setup()
      renderPicker({ label: 'To', initialValue: undefined, defaultValue: 'now-30m' })
      const dialog = await open(user, 'To')

      expect(pressedTab(dialog)).toBe('Relative')
      expect(amountBox(dialog).value).toBe('30')
      expect(shownLabel(unitSelect(dialog))).toBe('minutes ago')
    })

    it('saves the instant of the row default when a blank row switches to Absolute', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '', defaultValue: 'now-2h' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Absolute'))

      await expectSaved(user, dialog, onSave, '2026-09-25T08:42:05Z')
    })
  })

  describe('the tab it opens on', () => {
    it.each([
      [undefined, 'Relative'],
      ['', 'Relative'],
      ['   ', 'Relative'],
      ['now', 'Now'],
      ['now-15m', 'Relative'],
      ['now+2d', 'Relative'],
      ['now-15m/m', 'Relative'],
      ['now/d', 'Relative'],
      ['now-1d+2h', 'Relative'],
      ['2026-09-25T10:42:05Z', 'Absolute'],
      ['1790332925000', 'Absolute'],
      ['2026-09-25T10:42:05', 'Absolute'],
      ['1790332925', 'Absolute'],
      ['yesterday', 'Absolute'],
    ])('opens From %j on %s', async (initialValue, tab) => {
      const user = userEvent.setup()
      renderPicker({ initialValue })
      expect(pressedTab(await open(user))).toBe(tab)
    })

    it.each([[undefined], [''], ['   ']])('opens a blank To (%j) on Now', async (initialValue) => {
      const user = userEvent.setup()
      renderPicker({ label: 'To', initialValue })
      expect(pressedTab(await open(user, 'To'))).toBe('Now')
    })
  })

  describe('opening writes nothing', () => {
    it.each([[undefined], [''], ['now-15m'], ['now'], ['2026-09-25T10:42:05Z'], ['yesterday']])(
      'writes nothing when %j opens and closes',
      async (initialValue) => {
        const user = userEvent.setup()
        const { onSave } = renderPicker({ initialValue })

        await open(user)
        await user.keyboard('{Escape}')

        expect(onSave).not.toHaveBeenCalled()
      },
    )

    it('writes nothing when the pressed tab is pressed again', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Relative'))

      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('switching tabs puts that tab value in the draft', () => {
    it("saves a blank From's default instant from Absolute", async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Absolute'))

      await expectSaved(user, dialog, onSave, '2026-09-25T10:27:05Z')
    })

    it.each([
      ['now-1h', '2026-09-25T09:42:05Z'],
      ['now-1d+2h', '2026-09-24T12:42:05Z'],
      ['now', '2026-09-25T10:42:05Z'],
    ])('resolves %s to its instant when Absolute is chosen', async (initialValue, written) => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Absolute'))

      await expectSaved(user, dialog, onSave, written)
    })

    it('saves 15 minutes ago when a fixed time switches to Relative', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-20T08:00:00Z' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Relative'))

      await expectSaved(user, dialog, onSave, 'now-15m')
    })

    it('saves 15 minutes ago when a blank To switches to Relative', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ label: 'To', initialValue: '' })
      const dialog = await open(user, 'To')

      await user.click(tabButton(dialog, 'Relative'))

      await expectSaved(user, dialog, onSave, 'now-15m')
    })

    it.each([['now-2h'], ['2026-09-20T08:00:00Z'], ['']])(
      'saves now when %j switches to Now',
      async (initialValue) => {
        const user = userEvent.setup()
        const { onSave } = renderPicker({ initialValue })
        const dialog = await open(user)

        await user.click(tabButton(dialog, 'Now'))

        await expectSaved(user, dialog, onSave, 'now')
      },
    )

    it('presses the tab it switched to', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-2h' })
      const dialog = await open(user)

      await user.click(tabButton(dialog, 'Now'))

      expect(pressedTab(dialog)).toBe('Now')
    })
  })

  describe('Relative', () => {
    it('keeps browser autocomplete off the Amount box', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(amountBox(dialog)).toHaveAttribute('autocomplete', 'off')
    })

    it('seeds the controls from the value', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('15')
      expect(shownLabel(unitSelect(dialog))).toBe('minutes ago')
      expect(within(dialog).getByRole('checkbox', { name: 'Round to the minute' })).not.toBeChecked()
      expect(within(dialog).getByText('now-15m')).toBeInTheDocument()
    })

    it('seeds a future value with its from-now unit', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now+2d' })
      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('2')
      expect(shownLabel(unitSelect(dialog))).toBe('days from now')
      expect(within(dialog).getByRole('checkbox', { name: 'Round to the day' })).toBeInTheDocument()
      expect(within(dialog).getByText('now+2d')).toBeInTheDocument()
    })

    it('ticks Round for a rounded value', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m/m' })
      const dialog = await open(user)

      expect(within(dialog).getByRole('checkbox', { name: 'Round to the minute' })).toBeChecked()
      expect(within(dialog).getByText('now-15m/m')).toBeInTheDocument()
    })

    it('seeds now rounded to the day as amount 0 in days', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now/d' })
      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('0')
      expect(shownLabel(unitSelect(dialog))).toBe('days ago')
      expect(within(dialog).getByRole('checkbox', { name: 'Round to the day' })).toBeChecked()
    })

    it('clears the controls for other date math and shows the text on the result line', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-1d+2h' })
      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('')
      expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
      expect(within(dialog).getByText('now-1d+2h')).toBeInTheDocument()
    })

    it('seeds a blank From as 15 minutes ago without writing it', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '' })
      const dialog = await open(user)

      expect(amountBox(dialog).value).toBe('15')
      expect(shownLabel(unitSelect(dialog))).toBe('minutes ago')
      expect(within(dialog).getByText('now-15m')).toBeInTheDocument()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('offers the fourteen units in order', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(await optionLabels(user, unitSelect(dialog))).toEqual(UNIT_LABELS)
    })

    it('announces the result line politely', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      expect(within(dialog).getByText('now-15m').closest('[aria-live="polite"]')).not.toBeNull()
    })

    it('shows a new amount on the result line and saves it', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      fireEvent.change(amountBox(dialog), { target: { value: '30' } })

      expect(within(dialog).getByText('now-30m')).toBeInTheDocument()
      await expectSaved(user, dialog, onSave, 'now-30m')
    })

    it('saves now for amount 0', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      fireEvent.change(amountBox(dialog), { target: { value: '0' } })

      await expectSaved(user, dialog, onSave, 'now')
    })

    it('saves now rounded for amount 0 with Round ticked', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m/m' })
      const dialog = await open(user)

      fireEvent.change(amountBox(dialog), { target: { value: '0' } })

      await expectSaved(user, dialog, onSave, 'now/m')
    })

    it.each([['-3'], ['1.5'], ['abc']])(
      'drops a key the whole-number rule refuses in amount %j (REQ-3.1.3.14)',
      async (amount) => {
        const user = userEvent.setup()
        renderPicker({ initialValue: 'now-15m' })
        const dialog = await open(user)

        fireEvent.change(amountBox(dialog), { target: { value: amount } })

        expect(amountBox(dialog)).toHaveValue('15')
      },
    )

    it.each([['-3'], ['1.5'], ['abc']])(
      'never saves a value outside the date-math grammar for amount %j',
      async (amount) => {
        const user = userEvent.setup()
        const { onSave } = renderPicker({ initialValue: 'now-15m' })
        const dialog = await open(user)

        fireEvent.change(amountBox(dialog), { target: { value: amount } })
        await user.click(saveButton(dialog))

        for (const [written] of onSave.mock.calls) {
          expect(written).toMatch(RELATIVE_GRAMMAR)
        }
      },
    )

    it.each([
      ['seconds ago', 'now-15s'],
      ['hours ago', 'now-15h'],
      ['days ago', 'now-15d'],
      ['weeks ago', 'now-15w'],
      ['months ago', 'now-15M'],
      ['years ago', 'now-15y'],
      ['seconds from now', 'now+15s'],
      ['minutes from now', 'now+15m'],
      ['hours from now', 'now+15h'],
      ['days from now', 'now+15d'],
      ['weeks from now', 'now+15w'],
      ['months from now', 'now+15M'],
      ['years from now', 'now+15y'],
    ])('saves %s as %s', async (unit, written) => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      await choose(user, unitSelect(dialog), unit)

      await expectSaved(user, dialog, onSave, written)
    })

    it('names the Round checkbox after the chosen unit', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      await choose(user, unitSelect(dialog), 'hours from now')

      expect(within(dialog).getByRole('checkbox', { name: 'Round to the hour' })).toBeInTheDocument()
    })

    it('appends the rounding unit when Round is ticked', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m' })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('checkbox', { name: 'Round to the minute' }))

      expect(within(dialog).getByText('now-15m/m')).toBeInTheDocument()
      await expectSaved(user, dialog, onSave, 'now-15m/m')
    })

    it('drops the rounding unit when Round is unticked', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: 'now-15m/m' })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('checkbox', { name: 'Round to the minute' }))

      await expectSaved(user, dialog, onSave, 'now-15m')
    })
  })

  describe('Absolute', () => {
    it('seeds the calendar, the time selects and the text box from the value', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      expect(within(dialog).getByText('September 2026')).toBeInTheDocument()
      expect(within(within(dialog).getByRole('grid')).getByRole('gridcell', { selected: true }).textContent).toBe('25')
      expect(shownLabel(within(dialog).getByRole('combobox', { name: 'Hour' }))).toBe('10')
      expect(shownLabel(within(dialog).getByRole('combobox', { name: 'Minute' }))).toBe('42')
      expect(shownLabel(within(dialog).getByRole('combobox', { name: 'Second' }))).toBe('05')
      expect(dateTimeBox(dialog).value).toBe('2026-09-25T10:42:05Z')
    })

    it('holds epoch milliseconds as the ISO value', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '1790332925000' })
      const dialog = await open(user)

      expect(dateTimeBox(dialog).value).toBe('2026-09-25T10:42:05Z')
    })

    it('selects the UTC day, not the local one', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T02:00:00Z' })
      const dialog = await open(user)

      expect(within(within(dialog).getByRole('grid')).getByRole('gridcell', { selected: true }).textContent).toBe('25')
      expect(shownLabel(within(dialog).getByRole('combobox', { name: 'Hour' }))).toBe('02')
    })

    it('saves the picked day with the time kept', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.click(dayButton(dialog, /September 26th, 2026/))

      await expectSaved(user, dialog, onSave, '2026-09-26T10:42:05Z')
    })

    it('saves the picked day in UTC for an early-morning time', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T02:00:00Z' })
      const dialog = await open(user)

      await user.click(dayButton(dialog, /September 27th, 2026/))

      await expectSaved(user, dialog, onSave, '2026-09-27T02:00:00Z')
    })

    it.each([
      ['Hour', '11', '2026-09-25T11:42:05Z'],
      ['Minute', '07', '2026-09-25T10:07:05Z'],
      ['Second', '59', '2026-09-25T10:42:59Z'],
    ])('saves a new %s', async (name, option, written) => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await choose(user, within(dialog).getByRole('combobox', { name }), option)

      await expectSaved(user, dialog, onSave, written)
    })

    it.each([
      ['Hour', 24, '23'],
      ['Minute', 60, '59'],
      ['Second', 60, '59'],
    ])('offers %s from 00 to the last value', async (name, count, last) => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      const labels = await optionLabels(user, within(dialog).getByRole('combobox', { name }))
      expect(labels).toHaveLength(count)
      expect(labels[0]).toBe('00')
      expect(labels.at(-1)).toBe(last)
    })

    it('names the month buttons and moves the month', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      expect(within(dialog).getByRole('button', { name: 'Go to the Next Month' })).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Go to the Previous Month' }))

      expect(within(dialog).getByText('August 2026')).toBeInTheDocument()
    })

    it.each([
      ['2026-09-24T08:00:00Z', '2026-09-24T08:00:00Z'],
      ['2026-09-24T08:00:00', '2026-09-24T08:00:00Z'],
      ['2026-09-24T10:00:00+02:00', '2026-09-24T08:00:00Z'],
      ['1790332925000', '2026-09-25T10:42:05Z'],
    ])('applies typed %s on Enter and saves it as %s', async (typed, written) => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), `${typed}{Enter}`)

      await expectSaved(user, dialog, onSave, written)
    })

    it('applies the typed value on blur and saves it', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), '2026-09-24T08:00:00Z')
      fireEvent.blur(dateTimeBox(dialog))

      await expectSaved(user, dialog, onSave, '2026-09-24T08:00:00Z')
    })

    it('writes nothing while the text is being typed', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), '2026-09-24T08:00:00Z')

      expect(onSave).not.toHaveBeenCalled()
    })

    it('names text that does not parse and writes nothing', async () => {
      const user = userEvent.setup()
      const { onSave } = renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), 'yesterday{Enter}')

      expect(within(dialog).getByText('Not a timestamp: use 2026-09-25T10:42:05Z')).toBeInTheDocument()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('announces the message as an alert tied to the box', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), 'yesterday{Enter}')

      const message = within(dialog).getByText('Not a timestamp: use 2026-09-25T10:42:05Z')
      expect(message).toHaveAttribute('role', 'alert')
      expect(dateTimeBox(dialog)).toHaveAttribute('aria-describedby', message.id)
    })

    it('keeps browser autocomplete and spellcheck off the Date and time box', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      expect(dateTimeBox(dialog)).toHaveAttribute('autocomplete', 'off')
      expect(dateTimeBox(dialog)).toHaveAttribute('spellcheck', 'false')
    })

    it('drops the message once the text parses', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), 'yesterday{Enter}')
      await user.clear(dateTimeBox(dialog))
      await user.type(dateTimeBox(dialog), '2026-09-24T08:00:00Z{Enter}')

      expect(within(dialog).queryByText('Not a timestamp: use 2026-09-25T10:42:05Z')).not.toBeInTheDocument()
    })
  })

  describe('Now', () => {
    it('shows a muted now line and no controls', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now' })
      const dialog = await open(user)

      expect(within(dialog).getByText('now')).toBeInTheDocument()
      expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('grid')).not.toBeInTheDocument()
    })
  })

  describe('keyboard and focus', () => {
    it('opens on Enter', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })

      openButton().focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('dialog', { name: 'From' })).toBeInTheDocument()
    })

    it('opens on Space', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })

      openButton().focus()
      await user.keyboard(' ')

      expect(screen.getByRole('dialog', { name: 'From' })).toBeInTheDocument()
    })

    it.each([
      ['From', '', 'Relative'],
      ['To', '', 'Now'],
      ['From', '2026-09-25T10:42:05Z', 'Absolute'],
    ] as const)('moves focus to the pressed tab (%s %j on %s)', async (label, initialValue, tab) => {
      const user = userEvent.setup()
      renderPicker({ label, initialValue })
      const dialog = await open(user, label)

      expect(tabButton(dialog, tab)).toHaveFocus()
    })

    it('walks the tab strip with Tab', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
      const dialog = await open(user)

      await user.tab()

      expect(tabButton(dialog, 'Relative')).toHaveFocus()
    })

    it('tabs from the last tab to Cancel and then to Save', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now' })
      const dialog = await open(user)
      expect(tabButton(dialog, 'Now')).toHaveFocus()

      await user.tab()
      expect(cancelButton(dialog)).toHaveFocus()

      await user.tab()
      expect(saveButton(dialog)).toHaveFocus()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      await open(user)

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
    })

    it('closes on a click outside', async () => {
      const user = userEvent.setup()
      renderPicker({ initialValue: 'now-15m' })
      await open(user)

      await user.click(document.body)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

// The time parts read like the Select trigger beside them: a chevron in place of the browser arrow (OS-4).
describe('TimePickerPopover - time part look', () => {
  it.each([['Hour'], ['Minute'], ['Second']])('draws a chevron over the %s select', async (name) => {
    const user = userEvent.setup()
    renderPicker({ initialValue: '2026-09-25T10:42:05Z' })
    const dialog = await open(user)

    const select = within(dialog).getByRole('combobox', { name })

    expect(select.parentElement?.querySelector('svg.lucide-chevron-down')).not.toBeNull()
    expect(select).toHaveClass('appearance-none')
  })
})
