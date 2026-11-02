/**
 * From / To row: the one value field with the clock icon inside, its value as written or the row default in gray
 * while not set, expand opening the time picker (Save writes, Cancel / Escape / a click outside discard), the muted
 * UTC hint for a zone-less timestamp, the red time errors that block Save, and in {x} mode the expression box whose
 * expand opens the expression editor.
 *
 * Design Reference: OS-4, FIELD-9
 * REQ-3.3.2.3: Filter logs by time range
 * REQ-3.1.1.5: Block parameter configuration forms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

// The Edit value sheet is heavy (CodeMirror) and no From / To literal opens it.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import { HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'

const UTC_HINT = 'No zone given: read as UTC'

type User = ReturnType<typeof userEvent.setup>

/** The From / To row opt-in. */
type TimeParameter = Parameter & { timeValue: true }

const FROM_PARAM: TimeParameter = {
  name: 'from',
  label: 'From',
  type: 'string',
  required: false,
  defaultValue: 'now-15m',
  timeValue: true,
}

const TO_PARAM: TimeParameter = {
  name: 'to',
  label: 'To',
  type: 'string',
  required: false,
  defaultValue: 'now',
  timeValue: true,
}

const NO_VARIABLES: { name: string; type: string }[] = []
const NO_FIELDS: string[] = []

function row(name = 'from'): HTMLElement {
  return screen.getByTestId(`param-row-${name}`)
}

function expandButton(name = 'from'): HTMLElement {
  return screen.getByTestId(`param-expand-${name}`)
}

async function openPicker(user: User, label: 'From' | 'To' = 'From'): Promise<HTMLElement> {
  await user.click(expandButton(label.toLowerCase()))
  return screen.getByRole('dialog', { name: label })
}

/** Every text the row shows: its text nodes and the values of its text boxes. */
function shownTexts(container: HTMLElement): string[] {
  const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).map((box) => box.value)
  return [container.textContent ?? '', ...boxes]
}

function showsText(container: HTMLElement, text: string): boolean {
  return shownTexts(container).some((shown) => shown.includes(text))
}

/** The text box holding exactly this text, else the deepest element whose text it is. */
function elementShowing(container: HTMLElement, text: string): HTMLElement | undefined {
  const box = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).find(
    (candidate) => candidate.value === text,
  )
  if (box) return box
  return Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter((element) => element.textContent === text)
    .at(-1)
}

/** The gray of a not-set default (Text Muted) sits on the element or on a wrapper inside the row. */
function looksGray(element: HTMLElement, container: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains(HELD_DEFAULT_LOOK_CLASS)) return true
    if (node === container) return false
  }
  return false
}

function expectGrayDefault(container: HTMLElement, text: string) {
  const shown = elementShowing(container, text)
  expect(shown, `nothing in the row shows ${text}`).toBeDefined()
  expect(looksGray(shown as HTMLElement, container)).toBe(true)
}

/** The popover trigger of the time picker, if one is drawn. */
function queryTrigger(): HTMLElement | undefined {
  return screen
    .queryAllByRole('button', { hidden: true })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog')
}

interface RowHarnessProps {
  parameter?: TimeParameter
  initialValue?: unknown
  expressionFields?: string[]
  onChange?: (value: unknown) => void
  onValidationChange?: (name: string, error: string | null) => void
}

/** Holds the row value the way the config sheet does. */
function RowHarness({
  parameter = FROM_PARAM,
  initialValue,
  expressionFields = NO_FIELDS,
  onChange,
  onValidationChange,
}: Readonly<RowHarnessProps>) {
  const [value, setValue] = useState<unknown>(initialValue)
  return (
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={(next) => {
            onChange?.(next)
            setValue(next)
          }}
          availableVariables={NO_VARIABLES}
          onValidationChange={onValidationChange}
          expressionFields={expressionFields}
          onExpressionFieldsChange={vi.fn()}
          templateFields={NO_FIELDS}
          onTemplateFieldsChange={vi.fn()}
        />
      </tbody>
    </table>
  )
}

function renderRow(props: RowHarnessProps = {}) {
  const onChange = vi.fn()
  const onValidationChange = vi.fn()
  render(<RowHarness onChange={onChange} onValidationChange={onValidationChange} {...props} />)
  return { onChange, onValidationChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParameterRow with a From / To row', () => {
  describe('the one value field (FIELD-9)', () => {
    it('shows a set value as written, with the clock icon inside and the expand button beside it', () => {
      renderRow({ initialValue: 'now-1h' })

      expect(showsText(row(), 'now-1h')).toBe(true)
      expect(row().textContent).not.toContain('1 hour ago')
      expect(row().querySelector('svg.lucide-clock')).not.toBeNull()
      expect(expandButton()).toBeInTheDocument()
      expect(screen.queryByTestId('param-edit-from')).not.toBeInTheDocument()
    })

    it.each([['now-15m/m'], ['2026-09-25T10:42:05Z'], ['1790332925000']])(
      'shows %s as written, not in words',
      (value) => {
        renderRow({ initialValue: value })
        expect(elementShowing(row(), value)).toBeDefined()
      },
    )

    it('shows the From default in gray while not set', () => {
      renderRow()
      expectGrayDefault(row(), 'now-15m')
    })

    it('names a row with no label by its name and shows no gray text when it has no default', async () => {
      const user = userEvent.setup()
      const bare: TimeParameter = { name: 'since', type: 'string', required: false, timeValue: true }
      renderRow({ parameter: bare })

      expect(row('since').querySelector('input')).toHaveValue('')
      await user.click(expandButton('since'))
      expect(screen.getByRole('dialog', { name: 'since' })).toBeInTheDocument()
    })

    it("shows the To row's default in gray while not set", () => {
      renderRow({ parameter: TO_PARAM })
      expectGrayDefault(row('to'), 'now')
    })

    it('reads the gray default from the row, not from the label', () => {
      renderRow({ parameter: { ...FROM_PARAM, defaultValue: 'now-2h' } })
      expectGrayDefault(row(), 'now-2h')
    })
  })

  describe('expand opens the time picker', () => {
    it('opens the From picker and writes nothing', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: 'now-1h' })

      expect(await openPicker(user)).toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('opens the To picker for the To row', async () => {
      const user = userEvent.setup()
      renderRow({ parameter: TO_PARAM, initialValue: 'now' })

      expect(await openPicker(user, 'To')).toBeInTheDocument()
    })

    it('starts the draft on the value', async () => {
      const user = userEvent.setup()
      renderRow({ initialValue: 'now-1h' })

      const dialog = await openPicker(user)

      expect(within(dialog).getByLabelText('Amount')).toHaveValue('1')
      expect(within(dialog).getByText('now-1h')).toBeInTheDocument()
    })

    it('starts the draft on the row default while not set', async () => {
      const user = userEvent.setup()
      renderRow({ parameter: { ...FROM_PARAM, defaultValue: 'now-2h' } })

      const dialog = await openPicker(user)

      expect(within(dialog).getByLabelText('Amount')).toHaveValue('2')
      expect(within(dialog).getByText('now-2h')).toBeInTheDocument()
    })

    it('writes the draft through the row on Save, not before', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: 'now-1h' })
      const dialog = await openPicker(user)

      await user.click(within(dialog).getByRole('button', { name: 'Now' }))
      expect(onChange).not.toHaveBeenCalled()

      await user.click(within(dialog).getByTestId('time-picker-save'))

      expect(onChange).toHaveBeenLastCalledWith('now')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(elementShowing(row(), 'now')).toBeDefined()
    })

    it('writes a changed draft on a not-set field as the value', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow()
      const dialog = await openPicker(user)

      await user.click(within(dialog).getByRole('button', { name: 'Now' }))
      await user.click(within(dialog).getByTestId('time-picker-save'))

      expect(onChange).toHaveBeenLastCalledWith('now')
    })

    it('keeps a not-set field not set when Save finds the draft unchanged', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow()
      const dialog = await openPicker(user)

      await user.click(within(dialog).getByTestId('time-picker-save'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalledWith(expect.any(String))
      expectGrayDefault(row(), 'now-15m')
    })

    it('Cancel discards the draft', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: 'now-1h' })
      const dialog = await openPicker(user)
      await user.click(within(dialog).getByRole('button', { name: 'Now' }))

      await user.click(within(dialog).getByTestId('time-picker-cancel'))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
      expect(showsText(row(), 'now-1h')).toBe(true)
    })

    it('Escape discards the draft and returns focus to expand', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: 'now-1h' })
      const dialog = await openPicker(user)
      await user.click(within(dialog).getByRole('button', { name: 'Now' }))

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
      expect(expandButton()).toHaveFocus()
    })

    it('a click outside discards the draft', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: 'now-1h' })
      const dialog = await openPicker(user)
      await user.click(within(dialog).getByRole('button', { name: 'Now' }))

      await user.click(document.body)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves a blank value blank when the picker opens and closes', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ initialValue: '' })

      await openPicker(user)
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('keeps expand in a frozen sheet and opens the picker read-only, with no Save and no change', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <FreezableFieldset disabled>
          <RowHarness initialValue="now-15m" onChange={onChange} />
        </FreezableFieldset>,
      )
      expect(expandButton()).toBeEnabled()

      // user-event sends no click to anything inside a disabled fieldset; a browser still clicks a link there.
      fireEvent.click(expandButton())
      const dialog = screen.getByRole('dialog', { name: 'From' })
      expect(within(dialog).queryByTestId('time-picker-save')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(within(dialog).getByTestId('time-picker-cancel')).toHaveTextContent(/^Close$/)

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('the UTC hint', () => {
    it('shows the muted hint under a zone-less timestamp', () => {
      renderRow({ initialValue: '2026-09-25T10:42:05' })
      expect(screen.getByText(UTC_HINT)).toBeInTheDocument()
    })

    it.each([
      ['2026-09-25T10:42:05Z'],
      ['2026-09-25T12:42:05+02:00'],
      ['1790332925000'],
      ['now-15m'],
      ['now'],
      [''],
      ['yesterday'],
    ])('shows no hint for %j', (value) => {
      renderRow({ initialValue: value })
      expect(screen.queryByText(UTC_HINT)).not.toBeInTheDocument()
    })

    it('points the value field at the hint', () => {
      renderRow({ initialValue: '2026-09-25T10:42:05' })
      const hintId = screen.getByText(UTC_HINT).id
      expect(hintId).not.toBe('')
      expect(within(row()).getByRole('textbox').getAttribute('aria-describedby') ?? '').toContain(hintId)
    })
  })

  describe('the red errors (Save blocked)', () => {
    it.each([['1790332925'], ['17903329250']])(
      'names epoch seconds on the From row (%s)',
      (value) => {
        const { onValidationChange } = renderRow({ initialValue: value })
        const message = 'From reads as epoch seconds: for seconds, multiply by 1000'
        expect(screen.getByTestId('param-error-from').textContent).toBe(message)
        expect(onValidationChange).toHaveBeenLastCalledWith('from', message)
      },
    )

    it('names a value that is not a time on the From row', () => {
      const { onValidationChange } = renderRow({ initialValue: 'yesterday' })
      const message = 'From is not a time: use Absolute, Relative or Now'
      expect(screen.getByTestId('param-error-from').textContent).toBe(message)
      expect(onValidationChange).toHaveBeenLastCalledWith('from', message)
    })

    it('names the To row in its own errors', () => {
      renderRow({ parameter: TO_PARAM, initialValue: '1790332925' })
      expect(screen.getByTestId('param-error-to').textContent).toBe(
        'To reads as epoch seconds: for seconds, multiply by 1000',
      )
    })

    it('names a To value that is not a time', () => {
      renderRow({ parameter: TO_PARAM, initialValue: 'yesterday' })
      expect(screen.getByTestId('param-error-to').textContent).toBe(
        'To is not a time: use Absolute, Relative or Now',
      )
    })

    it('shows the error as an alert', () => {
      renderRow({ initialValue: 'yesterday' })
      expect(screen.getByTestId('param-error-from')).toHaveAttribute('role', 'alert')
    })

    it('points the value field at the error', () => {
      renderRow({ initialValue: 'yesterday' })
      const errorId = screen.getByTestId('param-error-from').id
      expect(errorId).not.toBe('')
      expect(within(row()).getByRole('textbox').getAttribute('aria-describedby') ?? '').toContain(errorId)
    })

    it('keeps the value in the field as written', () => {
      renderRow({ initialValue: '1790332925' })
      expect(elementShowing(row(), '1790332925')).toBeDefined()
    })

    it.each([
      ['now-15m'],
      ['now'],
      ['now-1d+2h'],
      ['2026-09-25T10:42:05Z'],
      ['2026-09-25T10:42:05'],
      ['1790332925000'],
      [''],
      [undefined],
    ])('reports no error for %j', (value) => {
      const { onValidationChange } = renderRow({ initialValue: value })
      expect(screen.queryByTestId('param-error-from')).not.toBeInTheDocument()
      expect(onValidationChange).toHaveBeenLastCalledWith('from', null)
    })

    it('clears the error once a picked time is saved', async () => {
      const user = userEvent.setup()
      const { onValidationChange } = renderRow({ initialValue: 'yesterday' })
      const dialog = await openPicker(user)

      await user.click(within(dialog).getByRole('button', { name: 'Now' }))
      await user.click(within(dialog).getByTestId('time-picker-save'))

      expect(screen.queryByTestId('param-error-from')).not.toBeInTheDocument()
      expect(onValidationChange).toHaveBeenLastCalledWith('from', null)
    })
  })

  describe('expression mode', () => {
    it('replaces the value field with the expression editor', () => {
      renderRow({ initialValue: 'start_time', expressionFields: ['from'] })
      expect(screen.getByTestId('param-input-from')).toBeInTheDocument()
      expect(queryTrigger()).toBeUndefined()
    })

    it('opens the expression editor from expand instead of the time picker', async () => {
      const user = userEvent.setup()
      renderRow({ initialValue: 'start_time', expressionFields: ['from'] })

      await user.click(expandButton())

      expect(await screen.findByTestId('expression-editor-modal')).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: 'From' })).not.toBeInTheDocument()
    })

    it('shows no words, hint or error for an expression', () => {
      const { onValidationChange } = renderRow({
        initialValue: '2026-09-25T10:42:05',
        expressionFields: ['from'],
      })
      expect(screen.queryByText('Sep 25, 2026 @ 10:42:05')).not.toBeInTheDocument()
      expect(screen.queryByText(UTC_HINT)).not.toBeInTheDocument()
      expect(screen.queryByTestId('param-error-from')).not.toBeInTheDocument()
      expect(onValidationChange).toHaveBeenLastCalledWith('from', null)
    })

    it('never names a non-time expression as a time error', () => {
      renderRow({ initialValue: 'yesterday', expressionFields: ['from'] })
      expect(screen.queryByTestId('param-error-from')).not.toBeInTheDocument()
    })
  })
})
