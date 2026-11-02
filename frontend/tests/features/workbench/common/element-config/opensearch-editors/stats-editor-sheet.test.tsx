/**
 * The OpenSearch Stats editor: a thin host of the shared list editor inside the
 * Edit value sheet, each row edited through its stat trigger and popover. Move,
 * remove, Add, per-row {x} and the null button come from the shared editor; Save
 * hands back the stored record rows and the rows held as {x}.
 *
 * Design Reference:
 * FIELD-10 (list fields open their own editor), OS-7 (Stats entries)
 * REQ-3.3.3.2: OpenSearch statistics validation
 * REQ-3.1.3.20: Null is the only empty value
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/api/sql-tools', () => ({
  checkSql: vi.fn(() => Promise.resolve({ issues: [] })),
  startCatalog: vi.fn(() => new Promise(() => {})),
  getCatalog: vi.fn(() => new Promise(() => {})),
  cancelCatalog: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/api/python-tools', () => ({
  checkPython: vi.fn(() => Promise.resolve({ issues: [] })),
  completePython: vi.fn(() => Promise.resolve({ items: [] })),
  renamePython: vi.fn(() => Promise.resolve({ edits: [] })),
}))

import { StatsEditorSheet } from '@/features/workbench/common/element-config/opensearch-editors/stats-editor-sheet'
import type { FieldSuggestValue } from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import { SAMPLE_FIELDS, SAMPLE_INDEXES } from '../../../opensearch-fixtures'

type User = ReturnType<typeof userEvent.setup>

const SETTLED: FieldSuggestValue = { fields: SAMPLE_FIELDS, indexes: SAMPLE_INDEXES, state: 'settled', start: vi.fn() }

/** Stored rows in the saved shape. */
function rows(...values: unknown[]): { value: unknown }[] {
  return values.map((value) => ({ value }))
}

const TWO_STATS = rows({ stat: 'count' }, { stat: 'sum', field: 'bytes' })

interface RenderOptions {
  stored?: { value: unknown }[]
  expressionRows?: number[]
}

function renderEditor({ stored = TWO_STATS, expressionRows = [] }: RenderOptions = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <StatsEditorSheet
      rows={stored}
      expressionRows={new Set(expressionRows)}
      fields={SETTLED}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  return { onSave, onCancel }
}

function body(): HTMLElement {
  return within(screen.getByTestId('value-editor-sheet')).getByTestId('array-edit-body')
}

/** The control of a stat row that opens its popover, by its accessible name. */
function statTrigger(name: string): HTMLElement {
  const found = within(body())
    .queryAllByRole('button', { hidden: true })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog' && button.getAttribute('aria-label') === name)
  expect(found).toBeDefined()
  return found as HTMLElement
}

function hasStatTrigger(prefix: string): boolean {
  return within(body())
    .queryAllByRole('button', { hidden: true })
    .some((button) => (button.getAttribute('aria-label') ?? '').startsWith(prefix))
}

function saveButton(): HTMLElement {
  return screen.getByTestId('value-editor-save-button')
}

/** The rows and the {x} rows of the last Save. */
function lastSave(onSave: ReturnType<typeof vi.fn>): { saved: unknown; expression: number[] } {
  const call = onSave.mock.calls.at(-1) as [unknown, Iterable<number>]
  return { saved: call[0], expression: [...call[1]].sort((a, b) => a - b) }
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

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('StatsEditorSheet', () => {
  describe('the sheet and its rows', () => {
    it('opens the Edit value sheet with the shared list editor', () => {
      renderEditor()
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      expect(body()).toBeInTheDocument()
    })

    it('reads each stored stat in words on its row trigger', () => {
      renderEditor({ stored: rows({ stat: 'count' }, { stat: 'percentile', field: 'latency_ms', percent: 95 }) })
      expect(statTrigger('Stat 1: Count').textContent?.trim()).toBe('Count')
      expect(statTrigger('Stat 2: 95th percentile of latency_ms').textContent?.trim()).toBe(
        '95th percentile of latency_ms',
      )
    })

    it('numbers the rows from one', () => {
      renderEditor()
      expect(within(body()).getAllByTestId('array-edit-index').map((cell) => cell.textContent)).toEqual(['1', '2'])
    })

    it('names each row control by the number the row shows, the trigger by its stat', () => {
      renderEditor()
      expect(statTrigger('Stat 2: Sum of bytes')).toBeInTheDocument()
      expect(within(body()).getByTestId('array-expr-toggle-1')).toHaveAccessibleName('Item 2 expression mode')
      expect(within(body()).getByTestId('array-edit-input-1-null')).toHaveAccessibleName('Set Item 2 to null')
      expect(within(body()).getByTestId('array-move-up-1')).toHaveAccessibleName('Move item 2 up')
      expect(within(body()).getByTestId('array-move-down-1')).toHaveAccessibleName('Move item 2 down')
      expect(within(body()).getByTestId('array-remove-1')).toHaveAccessibleName('Remove item 2')
    })

    it('gives a stat row no expand: the popover is its editor', () => {
      renderEditor()
      expect(within(body()).queryAllByTestId(/^array-expand-/)).toHaveLength(0)
      expect(within(body()).queryByRole('button', { name: 'Open editor' })).not.toBeInTheDocument()
    })

    it('shows no Type column: a stat row takes no one fixed type', () => {
      renderEditor()
      expect(within(body()).queryByText('Type')).not.toBeInTheDocument()
      expect(within(body()).queryAllByTestId(/^array-type-/)).toHaveLength(0)
    })

    it('opens clean: Save stays off until something changes', () => {
      renderEditor({ stored: rows('stat_entry', { stat: 'count' }), expressionRows: [0] })
      expect(saveButton()).toBeDisabled()
    })
  })

  describe('the stat popover on a row', () => {
    it('opens from the row trigger', async () => {
      const user = userEvent.setup()
      renderEditor()
      await user.click(statTrigger('Stat 1: Count'))
      expect(screen.getByRole('dialog', { name: 'Stat 1' })).toBeInTheDocument()
    })

    it('offers the pulled numeric fields in its Field box', async () => {
      const user = userEvent.setup()
      renderEditor({ stored: rows({ stat: 'sum', field: '' }) })
      await user.click(statTrigger('Stat 1: Sum (no field)'))
      const dialog = screen.getByRole('dialog', { name: 'Stat 1' })
      await user.click(within(dialog).getByRole('combobox', { name: 'Field' }))
      expect(screen.getByRole('option', { name: /latency_ms/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^message/ })).not.toBeInTheDocument()
    })

    it('saves a popover change into its row', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(statTrigger('Stat 2: Sum of bytes'))
      const dialog = screen.getByRole('dialog', { name: 'Stat 2' })
      await choose(user, within(dialog).getByRole('combobox', { name: 'Stat' }), 'Average')
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({
        saved: rows({ stat: 'count' }, { stat: 'average', field: 'bytes' }),
        expression: [],
      })
    })
  })

  describe('move, remove and Add', () => {
    it('keeps each stat whole when it moves', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({
        stored: rows({ stat: 'count' }, { stat: 'percentile', field: 'latency_ms', percent: 95 }),
      })
      await user.click(within(body()).getByTestId('array-move-down-0'))
      expect(statTrigger('Stat 1: 95th percentile of latency_ms')).toBeInTheDocument()
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({
        saved: rows({ stat: 'percentile', field: 'latency_ms', percent: 95 }, { stat: 'count' }),
        expression: [],
      })
    })

    it('saves without a removed stat', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-remove-0'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows({ stat: 'sum', field: 'bytes' }), expression: [] })
    })

    it('appends a Sum with no field and opens its popover with focus on Stat', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows({ stat: 'count' }) })
      await user.click(within(body()).getByTestId('array-add-item'))
      const dialog = screen.getByRole('dialog', { name: 'Stat 2' })
      expect(within(dialog).getByRole('combobox', { name: 'Stat' })).toHaveFocus()
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({
        saved: rows({ stat: 'count' }, { stat: 'sum', field: '' }),
        expression: [],
      })
    })

    it('appends the first stat to an empty list and opens its popover', async () => {
      const user = userEvent.setup()
      renderEditor({ stored: [] })
      await user.click(within(body()).getByTestId('array-add-item'))
      expect(screen.getByRole('dialog', { name: 'Stat 1' })).toBeInTheDocument()
      expect(statTrigger('Stat 1: Sum (no field)')).toBeInTheDocument()
    })
  })

  describe('per-row {x}', () => {
    it('keeps the expression editor on a row held as {x}', () => {
      renderEditor({ stored: rows('stat_entry', { stat: 'count' }), expressionRows: [0] })
      expect(within(body()).getByTestId('array-expr-value-0')).toBeInTheDocument()
      expect(hasStatTrigger('Stat 1:')).toBe(false)
      expect(statTrigger('Stat 2: Count')).toBeInTheDocument()
    })

    it('saves a row turned into an expression among the {x} rows', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      await user.click(saveButton())
      expect(lastSave(onSave).expression).toEqual([0])
    })

    it('writes the Add default when a row comes back from an expression', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows('stat_entry', { stat: 'count' }), expressionRows: [0] })
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      expect(statTrigger('Stat 1: Sum (no field)')).toBeInTheDocument()
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({
        saved: rows({ stat: 'sum', field: '' }, { stat: 'count' }),
        expression: [],
      })
    })

    it('keeps a stat row as it is when the switch into {x} is canceled', async () => {
      const user = userEvent.setup()
      renderEditor({ stored: rows({ stat: 'sum', field: 'bytes' }) })
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(statTrigger('Stat 1: Sum of bytes')).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('brings a stat row through {x} and back as the Add default, asking once', async () => {
      const user = userEvent.setup()
      renderEditor({ stored: rows({ stat: 'sum', field: 'bytes' }) })
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(statTrigger('Stat 1: Sum (no field)')).toBeInTheDocument()
    })
  })

  describe('the null button', () => {
    it('saves a stat row set to null', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-edit-input-1-null'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows({ stat: 'count' }, null), expression: [] })
    })

    it('shows no null button on a row held as {x}', () => {
      renderEditor({ stored: rows('stat_entry', { stat: 'count' }), expressionRows: [0] })
      expect(within(body()).queryByTestId('array-edit-input-0-null')).not.toBeInTheDocument()
      expect(within(body()).getByTestId('array-edit-input-1-null')).toBeInTheDocument()
    })
  })

  describe('Close', () => {
    it('cancels and saves nothing when nothing changed', async () => {
      const user = userEvent.setup()
      const { onSave, onCancel } = renderEditor()
      await user.click(screen.getByTestId('value-editor-cancel-button'))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
    })
  })
})
