/**
 * A Stats entry: the trigger reading the entry in words and the popover with Stat, Percent, Field, Custom (JSON) and
 * the column name line. Every change writes the entry at once; changing Stat keeps the field when the new stat takes
 * one and drops what it does not take.
 *
 * Design Reference: OS-7
 * REQ-3.3.3.2: OpenSearch statistics validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState, type ContextType } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

// The Edit value sheet stand-in: exposes what the Custom (JSON) button hands it.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  return {
    ValueEditorSheet: ({ label, value, allowTemplate, allowedFormats, onRun, onSave, onClose }: any) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-label={label}
          data-value={JSON.stringify(value)}
          data-allow-template={String(!!allowTemplate)}
          data-allowed-formats={(allowedFormats ?? []).join(',')}
          data-has-on-run={String(!!onRun)}
        >
          <button type="button" data-testid="sheet-save" onClick={() => onSave('{"sum":{"field":"x"}}', false)}>
            Save
          </button>
          <button type="button" data-testid="sheet-close" onClick={onClose}>
            Close
          </button>
        </div>,
        document.body,
      ),
  }
})

import { StatEntryPopover } from '@/features/workbench/common/element-config/parameters/stat-entry-popover'
import { FieldSuggestContext } from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import { EntryBox } from '@/components/shared/variable-bodies/body-parts'
import { SAMPLE_AGGREGATION_JSON, SAMPLE_FIELDS, SAMPLE_INDEXES } from '../../../opensearch-fixtures'

type User = ReturnType<typeof userEvent.setup>
type FieldSuggestValue = ContextType<typeof FieldSuggestContext>

const SETTLED: FieldSuggestValue = {
  fields: SAMPLE_FIELDS,
  indexes: SAMPLE_INDEXES,
  state: 'settled',
  start: vi.fn(),
}

const STAT_LABELS = [
  'Count',
  'Sum',
  'Average',
  'Min',
  'Max',
  'Percentile',
  'Unique count',
  'Increase',
  'Custom (JSON)',
]

const NO_VARIABLES: { name: string; type: string }[] = []

interface HarnessProps {
  index?: number
  initialValue?: unknown
  defaultOpen?: boolean
  readOnly?: boolean
  onChange: (entry: unknown) => void
}

/** Holds the entry the way the Stats editor row does, so the popover re-reads what it wrote. */
function Harness({ index = 1, initialValue, defaultOpen, readOnly, onChange }: Readonly<HarnessProps>) {
  const [value, setValue] = useState<unknown>(initialValue)
  return (
    <FieldSuggestContext value={SETTLED}>
      <StatEntryPopover
        index={index}
        value={value}
        onChange={(entry) => {
          onChange(entry)
          setValue(entry)
        }}
        defaultOpen={defaultOpen}
        readOnly={readOnly}
        availableVariables={NO_VARIABLES}
      />
    </FieldSuggestContext>
  )
}

function renderEntry(props: Partial<Omit<HarnessProps, 'onChange'>> = {}) {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} {...props} />)
  return { onChange }
}

function trigger(): HTMLElement {
  const found = screen
    .queryAllByRole('button', { hidden: true })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog')
  expect(found).toBeDefined()
  return found as HTMLElement
}

async function open(user: User, name = 'Stat 2'): Promise<HTMLElement> {
  await user.click(trigger())
  return screen.getByRole('dialog', { name })
}

function statSelect(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('combobox', { name: 'Stat' })
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

function lastEntry(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StatEntryPopover', () => {
  describe('the trigger in words (OS-7)', () => {
    it.each([
      [{ stat: 'count' }, 'Count'],
      [{ stat: 'sum', field: 'bytes' }, 'Sum of bytes'],
      [{ stat: 'average', field: 'latency_ms' }, 'Average of latency_ms'],
      [{ stat: 'min', field: 'x' }, 'Min of x'],
      [{ stat: 'max', field: 'x' }, 'Max of x'],
      [{ stat: 'percentile', field: 'latency_ms', percent: 95 }, '95th percentile of latency_ms'],
      [{ stat: 'percentile', field: 'x', percent: 99.9 }, '99.9th percentile of x'],
      [{ stat: 'percentile', field: 'x', percent: 21 }, '21st percentile of x'],
      [{ stat: 'percentile', field: 'x', percent: 12 }, '12th percentile of x'],
      [{ stat: 'unique_count', field: 'user.id' }, 'Unique count of user.id'],
      [{ stat: 'increase', field: 'requests_total' }, 'Increase of requests_total'],
      [{ stat: 'custom', json: SAMPLE_AGGREGATION_JSON, name: 'p99 via tdigest' }, 'Custom: p99 via tdigest'],
      [{ stat: 'sum', field: '' }, 'Sum (no field)'],
    ])('reads %j as "%s"', (initialValue, words) => {
      renderEntry({ initialValue })
      expect(trigger()).toHaveAccessibleName(`Stat 2: ${words}`)
      expect(trigger().textContent?.trim()).toBe(words)
    })

    it('names an unnamed Custom entry after its position', () => {
      renderEntry({ index: 2, initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      expect(trigger()).toHaveAccessibleName('Stat 3: Custom: custom 3')
    })

    it('announces a dialog and starts collapsed', () => {
      renderEntry({ initialValue: { stat: 'count' } })
      expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('the popover', () => {
    it('is a dialog named after the entry position', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })

      expect(await open(user)).toBeInTheDocument()
      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    })

    it('puts focus on Stat', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })
      const dialog = await open(user)

      expect(statSelect(dialog)).toHaveFocus()
    })

    it('offers the stats in order', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })
      const dialog = await open(user)

      expect(await optionLabels(user, statSelect(dialog))).toEqual(STAT_LABELS)
    })

    it('opens at once with focus on Stat when asked to', () => {
      renderEntry({ initialValue: { stat: 'sum', field: '' }, defaultOpen: true })

      const dialog = screen.getByRole('dialog', { name: 'Stat 2' })
      expect(statSelect(dialog)).toHaveFocus()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })
      await open(user)

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger()).toHaveFocus()
    })

    it('writes nothing when it opens and closes', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({ initialValue: { stat: 'sum', field: 'bytes' } })
      await open(user)

      await user.keyboard('{Escape}')

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('rows and column line per stat', () => {
    it('shows only Stat for Count, with the column count', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })
      const dialog = await open(user)

      expect(shownLabel(statSelect(dialog))).toBe('Count')
      expect(within(dialog).queryByRole('combobox', { name: 'Field' })).not.toBeInTheDocument()
      expect(within(dialog).queryByLabelText('Percent')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: 'Edit JSON' })).not.toBeInTheDocument()
      expect(within(dialog).getByText('count')).toBeInTheDocument()
    })

    it.each([
      [{ stat: 'sum', field: 'bytes' }, 'Sum', 'sum of bytes'],
      [{ stat: 'average', field: 'latency_ms' }, 'Average', 'average of latency_ms'],
      [{ stat: 'min', field: 'x' }, 'Min', 'min of x'],
      [{ stat: 'max', field: 'x' }, 'Max', 'max of x'],
      [{ stat: 'increase', field: 'requests_total' }, 'Increase', 'increase of requests_total'],
      [{ stat: 'unique_count', field: 'user.id' }, 'Unique count', 'unique count of user.id'],
    ])('shows Stat and Field for %j, with the column line', async (initialValue, label, column) => {
      const user = userEvent.setup()
      renderEntry({ initialValue })
      const dialog = await open(user)

      expect(shownLabel(statSelect(dialog))).toBe(label)
      expect(within(dialog).getByRole('combobox', { name: 'Field' })).toHaveValue(
        (initialValue as { field: string }).field,
      )
      expect(within(dialog).queryByLabelText('Percent')).not.toBeInTheDocument()
      expect(within(dialog).getByText(column)).toBeInTheDocument()
    })

    it('asks for a field when a stat that takes one has none', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'sum', field: '' } })
      const dialog = await open(user)

      expect(within(dialog).getByText('Pick a field')).toBeInTheDocument()
    })

    it('shows Percent and Field for Percentile, with the column line', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'percentile', field: 'latency_ms', percent: 95 } })
      const dialog = await open(user)

      expect((within(dialog).getByLabelText('Percent') as HTMLInputElement).value).toBe('95')
      expect(within(dialog).getByRole('combobox', { name: 'Field' })).toHaveValue('latency_ms')
      expect(within(dialog).getByText('percentile 95 of latency_ms')).toBeInTheDocument()
    })

    it('writes a decimal percent in its shortest form on the column line', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'percentile', field: 'x', percent: 99.9 } })
      const dialog = await open(user)

      expect(within(dialog).getByText('percentile 99.9 of x')).toBeInTheDocument()
    })

    it('shows Edit JSON and Column name for Custom (JSON), with no Field', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      const dialog = await open(user)

      expect(shownLabel(statSelect(dialog))).toBe('Custom (JSON)')
      expect(within(dialog).getByRole('button', { name: 'Edit JSON' })).toBeInTheDocument()
      expect(within(dialog).getByPlaceholderText('custom 2')).toBeInTheDocument()
      expect(within(dialog).queryByRole('combobox', { name: 'Field' })).not.toBeInTheDocument()
      expect(within(dialog).getByText('custom 2')).toBeInTheDocument()
    })

    it('keeps browser autocomplete and spellcheck off the Column name box', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      const dialog = await open(user)

      const box = within(dialog).getByPlaceholderText('custom 2')
      expect(box).toHaveAttribute('autocomplete', 'off')
      expect(box).toHaveAttribute('spellcheck', 'false')
    })

    it('shows the column name on the column line when one is set', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON, name: 'p99 via tdigest' } })
      const dialog = await open(user)

      expect((within(dialog).getByPlaceholderText('custom 2') as HTMLInputElement).value).toBe('p99 via tdigest')
      expect(within(dialog).getByText('p99 via tdigest')).toBeInTheDocument()
    })
  })

  describe('the fields offered', () => {
    it('offers numeric fields for Sum', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'sum', field: '' } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('combobox', { name: 'Field' }))

      expect(screen.getByRole('option', { name: /latency_ms/ })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /requests_total/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^message/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^log\.level/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^@timestamp/ })).not.toBeInTheDocument()
    })

    it('offers numeric fields for Percentile', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'percentile', field: '', percent: 95 } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('combobox', { name: 'Field' }))

      expect(screen.getByRole('option', { name: /latency_ms/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^user\.id/ })).not.toBeInTheDocument()
    })

    it('offers aggregatable fields for Unique count', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'unique_count', field: '' } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('combobox', { name: 'Field' }))

      expect(screen.getByRole('option', { name: /^user\.id/ })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /^log\.level/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^message/ })).not.toBeInTheDocument()
    })
  })

  describe('every change writes the entry at once', () => {
    it('writes a picked field', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({ initialValue: { stat: 'sum', field: '' } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('combobox', { name: 'Field' }))
      await user.click(screen.getByRole('option', { name: /latency_ms/ }))

      expect(lastEntry(onChange)).toEqual({ stat: 'sum', field: 'latency_ms' })
      expect(trigger()).toHaveAccessibleName('Stat 2: Sum of latency_ms')
    })

    it('writes a typed field name the list does not hold', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({ initialValue: { stat: 'sum', field: '' } })
      const dialog = await open(user)

      await user.type(within(dialog).getByRole('combobox', { name: 'Field' }), 'bytes')

      expect(lastEntry(onChange)).toEqual({ stat: 'sum', field: 'bytes' })
    })

    it('writes a new percent as a number', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({
        initialValue: { stat: 'percentile', field: 'latency_ms', percent: 95 },
      })
      const dialog = await open(user)

      fireEvent.change(within(dialog).getByLabelText('Percent'), { target: { value: '99.9' } })

      expect(lastEntry(onChange)).toEqual({ stat: 'percentile', field: 'latency_ms', percent: 99.9 })
    })

    it('writes a percent a JS number would change as its exact digits (REQ-3.1.3.14)', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({
        initialValue: { stat: 'percentile', field: 'latency_ms', percent: 95 },
      })
      const dialog = await open(user)

      fireEvent.change(within(dialog).getByLabelText('Percent'), { target: { value: '99.90' } })

      expect(lastEntry(onChange)).toEqual({ stat: 'percentile', field: 'latency_ms', percent: '99.90' })
    })

    it('clears the percent when its box is emptied', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({
        initialValue: { stat: 'percentile', field: 'latency_ms', percent: 95 },
      })
      const dialog = await open(user)

      fireEvent.change(within(dialog).getByLabelText('Percent'), { target: { value: '' } })

      expect(lastEntry(onChange)).toEqual({ stat: 'percentile', field: 'latency_ms', percent: undefined })
    })

    it('shows a stored small percent in plain digits', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'percentile', field: 'latency_ms', percent: 0.0000001 } })
      const dialog = await open(user)

      expect(within(dialog).getByLabelText('Percent')).toHaveValue('0.0000001')
    })

    it('writes a column name for Custom (JSON)', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      const dialog = await open(user)

      fireEvent.change(within(dialog).getByPlaceholderText('custom 2'), {
        target: { value: 'p99 via tdigest' },
      })

      expect(lastEntry(onChange)).toEqual({
        stat: 'custom',
        json: SAMPLE_AGGREGATION_JSON,
        name: 'p99 via tdigest',
      })
    })
  })

  describe('changing Stat', () => {
    it.each([
      [{ stat: 'sum', field: 'bytes' }, 'Average', { stat: 'average', field: 'bytes' }],
      [{ stat: 'sum', field: 'bytes' }, 'Unique count', { stat: 'unique_count', field: 'bytes' }],
      [{ stat: 'sum', field: 'bytes' }, 'Increase', { stat: 'increase', field: 'bytes' }],
      [{ stat: 'sum', field: 'bytes' }, 'Count', { stat: 'count' }],
      [{ stat: 'sum', field: 'bytes' }, 'Percentile', { stat: 'percentile', field: 'bytes', percent: 95 }],
      [{ stat: 'percentile', field: 'latency_ms', percent: 99 }, 'Max', { stat: 'max', field: 'latency_ms' }],
      [{ stat: 'sum', field: 'bytes' }, 'Custom (JSON)', { stat: 'custom' }],
      [{ stat: 'custom', json: SAMPLE_AGGREGATION_JSON, name: 'p99' }, 'Count', { stat: 'count' }],
    ])('turns %j into %s and writes %j', async (initialValue, label, written) => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({ initialValue })
      const dialog = await open(user)

      await choose(user, statSelect(dialog), label)

      expect(lastEntry(onChange)).toEqual(written)
    })

    it('drops the JSON and the column name when Custom becomes a stat that takes a field', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({
        initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON, name: 'p99' },
      })
      const dialog = await open(user)

      await choose(user, statSelect(dialog), 'Sum')

      const entry = lastEntry(onChange)
      expect(entry.stat).toBe('sum')
      expect(entry).not.toHaveProperty('json')
      expect(entry).not.toHaveProperty('name')
      expect(entry).not.toHaveProperty('percent')
    })

    it('shows the rows of the new stat', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' } })
      const dialog = await open(user)

      await choose(user, statSelect(dialog), 'Percentile')

      expect(within(dialog).getByLabelText('Percent')).toBeInTheDocument()
      expect(within(dialog).getByRole('combobox', { name: 'Field' })).toBeInTheDocument()
    })
  })

  describe('Custom (JSON) aggregation', () => {
    it('opens the value editor in aggregation JSON mode, literal only and with no Run', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('button', { name: 'Edit JSON' }))

      const sheet = screen.getByTestId('value-editor-sheet')
      expect(sheet).toHaveAttribute('data-label', 'Stat 2 aggregation')
      expect(sheet).toHaveAttribute('data-allowed-formats', 'aggregation-json')
      expect(sheet).toHaveAttribute('data-allow-template', 'false')
      expect(sheet).toHaveAttribute('data-has-on-run', 'false')
      expect(sheet).toHaveAttribute('data-value', JSON.stringify(SAMPLE_AGGREGATION_JSON))
    })

    it('writes the saved JSON and keeps the column name', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntry({
        initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON, name: 'p99 via tdigest' },
      })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('button', { name: 'Edit JSON' }))
      await user.click(screen.getByTestId('sheet-save'))

      expect(lastEntry(onChange)).toEqual({
        stat: 'custom',
        json: '{"sum":{"field":"x"}}',
        name: 'p99 via tdigest',
      })
    })

    it('closes the value editor on Close', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'custom', json: SAMPLE_AGGREGATION_JSON } })
      const dialog = await open(user)

      await user.click(within(dialog).getByRole('button', { name: 'Edit JSON' }))
      await user.click(screen.getByTestId('sheet-close'))

      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    })
  })

  describe('read-only', () => {
    it('disables the trigger', () => {
      renderEntry({ initialValue: { stat: 'count' }, readOnly: true })
      expect(trigger()).toBeDisabled()
    })

    it('opens nothing from a disabled trigger', async () => {
      const user = userEvent.setup()
      renderEntry({ initialValue: { stat: 'count' }, readOnly: true })

      await user.click(trigger())

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

// The popover's Field is a form box, as the approved stat popover wireframe draws it (OS-7).
describe('StatEntryPopover - the Field box look', () => {
  it('keeps the plain form box look, not the sheet row look', async () => {
    const user = userEvent.setup()
    renderEntry({ initialValue: { stat: 'sum', field: 'bytes' } })
    const dialog = await open(user)

    const field = within(dialog).getByRole('combobox', { name: 'Field' })
    expect(field).toHaveClass('font-mono')
    expect(field).not.toHaveClass('text-sky-300')
    expect(field).not.toHaveClass('h-8')
  })

  it('stays the plain suggestion box, not a Block row value field: no expand, reset or row test id', async () => {
    const user = userEvent.setup()
    renderEntry({ initialValue: { stat: 'sum', field: 'bytes' } })
    const dialog = await open(user)

    const field = within(dialog).getByRole('combobox', { name: 'Field' })
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.closest('[data-slot="input-group"]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /^Open editor/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId(/^param-input-/)).not.toBeInTheDocument()
  })
})

// On a Stats row the trigger is the control of the row's one 32px box, the ∅ inside the same box (FIELD-1, FIELD-13).
describe('StatEntryPopover - the trigger in the row box', () => {
  it('draws the trigger as a flat control that fills the row box', () => {
    renderEntry({ initialValue: { stat: 'count' } })
    expect(trigger()).toHaveClass('h-full', 'flex-1', 'border-0', 'bg-transparent', 'shadow-none')
    expect(trigger()).not.toHaveClass('h-8', 'border-input', 'bg-background')
  })

  it('sits in the row box with the ∅, and marks itself open while its popover is open', async () => {
    const user = userEvent.setup()
    render(
      <FieldSuggestContext value={SETTLED}>
        <EntryBox nullButton={{ label: 'Item 2', pressed: false, onClick: vi.fn(), testId: 'array-edit-input-1-null' }}>
          <StatEntryPopover index={1} value={{ stat: 'count' }} onChange={vi.fn()} availableVariables={NO_VARIABLES} />
        </EntryBox>
      </FieldSuggestContext>,
    )
    const box = trigger().closest('[data-slot="input-group"]') as HTMLElement
    expect(box).toHaveClass('h-8')
    expect(screen.getByTestId('array-edit-input-1-null').closest('[data-slot="input-group"]')).toBe(box)
    await user.click(trigger())
    expect(trigger()).toHaveAttribute('data-state', 'open')
    expect([...box.classList]).toEqual(expect.arrayContaining(['has-[[data-state=open]]:ring-1']))
  })
})
