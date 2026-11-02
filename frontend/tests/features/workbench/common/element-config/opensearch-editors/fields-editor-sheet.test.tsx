/**
 * The OpenSearch Fields editor: a thin host of the shared list editor inside the
 * Edit value sheet, each row edited in the field box that suggests the pulled
 * fields. Move, remove, Add, per-row {x} and the null button come from the shared
 * editor; Save hands back the stored record rows and the rows held as {x}.
 *
 * Design Reference:
 * FIELD-10 (list fields open their own editor), OS-6 (Fields), OS-13 (field suggestions)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries
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

import { FieldsEditorSheet } from '@/features/workbench/common/element-config/opensearch-editors/fields-editor-sheet'
import type { FieldSuggestValue } from '@/features/workbench/common/element-config/parameters/field-suggest-context'
import { SAMPLE_FIELDS, SAMPLE_INDEXES } from '../../../opensearch-fixtures'

type User = ReturnType<typeof userEvent.setup>

function settled(overrides: Partial<FieldSuggestValue> = {}): FieldSuggestValue {
  return { fields: SAMPLE_FIELDS, indexes: SAMPLE_INDEXES, state: 'settled', start: vi.fn(), ...overrides }
}

/** Stored rows in the saved shape. */
function rows(...values: unknown[]): { value: unknown }[] {
  return values.map((value) => ({ value }))
}

interface RenderOptions {
  stored?: { value: unknown }[]
  expressionRows?: number[]
  suggestions?: FieldSuggestValue
}

function renderEditor({ stored = rows('@timestamp', 'message'), expressionRows = [], suggestions = settled() }: RenderOptions = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <FieldsEditorSheet
      rows={stored}
      expressionRows={new Set(expressionRows)}
      suggestions={suggestions}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  return { onSave, onCancel }
}

function body(): HTMLElement {
  return within(screen.getByTestId('value-editor-sheet')).getByTestId('array-edit-body')
}

function rowBox(index: number): HTMLElement {
  return within(body()).getByTestId(`array-edit-input-${index}`)
}

function saveButton(): HTMLElement {
  return screen.getByTestId('value-editor-save-button')
}

/** The rows and the {x} rows of the last Save. */
function lastSave(onSave: ReturnType<typeof vi.fn>): { saved: unknown; expression: number[] } {
  const call = onSave.mock.calls.at(-1) as [unknown, Iterable<number>]
  return { saved: call[0], expression: [...call[1]].sort((a, b) => a - b) }
}

async function pick(user: User, index: number, name: string) {
  await user.click(rowBox(index))
  const found = screen.getAllByRole('option').find((option) => option.getAttribute('data-value') === name)
  expect(found).toBeDefined()
  await user.click(found as HTMLElement)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('FieldsEditorSheet', () => {
  describe('the sheet and its rows', () => {
    it('opens the Edit value sheet with the shared list editor', () => {
      renderEditor()
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      expect(body()).toBeInTheDocument()
    })

    it('edits each stored field in the field box', () => {
      renderEditor()
      expect(rowBox(0)).toHaveRole('combobox')
      expect(rowBox(0)).toHaveValue('@timestamp')
      expect(rowBox(1)).toHaveValue('message')
    })

    it('numbers the rows from one', () => {
      renderEditor()
      expect(within(body()).getAllByTestId('array-edit-index').map((cell) => cell.textContent)).toEqual(['1', '2'])
    })

    it('names each row control by the number the row shows', () => {
      renderEditor()
      expect(rowBox(1)).toHaveAccessibleName('Item 2 value')
      expect(within(body()).getByTestId('array-expr-toggle-1')).toHaveAccessibleName('Item 2 expression mode')
      expect(within(body()).getByTestId('array-edit-input-1-null')).toHaveAccessibleName('Set Item 2 to null')
      expect(within(body()).getByTestId('array-move-up-1')).toHaveAccessibleName('Move item 2 up')
      expect(within(body()).getByTestId('array-move-down-1')).toHaveAccessibleName('Move item 2 down')
      expect(within(body()).getByTestId('array-remove-1')).toHaveAccessibleName('Remove item 2')
    })

    it('gives a field row no expand: the field box is its editor', () => {
      renderEditor()
      expect(within(body()).queryAllByTestId(/^array-expand-/)).toHaveLength(0)
      expect(within(body()).queryByRole('button', { name: 'Open editor' })).not.toBeInTheDocument()
    })

    it('shows the fixed string type of every field row as a read-only Type pill', () => {
      renderEditor()
      expect(within(body()).getByText('Type')).toBeInTheDocument()
      for (const index of [0, 1]) {
        const pill = within(body()).getByTestId(`array-type-${index}`)
        expect(pill).toHaveTextContent(/^string$/)
        expect(pill).not.toHaveRole('combobox')
        expect(pill).not.toHaveRole('button')
      }
    })

    it('opens clean: Save stays off until something changes', () => {
      renderEditor({ expressionRows: [1] })
      expect(saveButton()).toBeDisabled()
    })
  })

  describe('suggestions from the pulled fields', () => {
    it('offers every pulled field on a row', async () => {
      const user = userEvent.setup()
      renderEditor()
      await user.click(rowBox(1))
      expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-value'))).toEqual(
        SAMPLE_FIELDS.map((field) => field.name),
      )
    })

    it('starts the pull from a row before any pull ran', async () => {
      const user = userEvent.setup()
      const suggestions = settled({ fields: null, indexes: null, state: 'idle' })
      renderEditor({ suggestions })
      await user.click(rowBox(0))
      await user.click(screen.getByRole('button', { name: 'Get fields' }))
      expect(suggestions.start).toHaveBeenCalledTimes(1)
    })

    it('saves a picked field into its row', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows('@timestamp', '') })
      await pick(user, 1, 'log.level')
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('@timestamp', 'log.level'), expression: [] })
    })

    it('saves a typed field name the list does not hold', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows('') })
      await user.type(rowBox(0), 'geo.city')
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('geo.city'), expression: [] })
    })
  })

  describe('move, remove and Add', () => {
    it('saves the new order after a move', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-move-down-0'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('message', '@timestamp'), expression: [] })
    })

    it('saves without a removed row', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-remove-0'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('message'), expression: [] })
    })

    it('appends an empty field and moves focus to its box', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-add-item'))
      expect(rowBox(2)).toHaveFocus()
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('@timestamp', 'message', ''), expression: [] })
    })
  })

  describe('per-row {x}', () => {
    it('keeps the expression editor on a row held as {x}', () => {
      renderEditor({ stored: rows('time_field', 'message'), expressionRows: [0] })
      expect(within(body()).getByTestId('array-expr-value-0')).toBeInTheDocument()
      expect(within(body()).queryByTestId('array-edit-input-0')).not.toBeInTheDocument()
      expect(within(body()).getByTestId('array-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
      expect(rowBox(1)).toHaveValue('message')
    })

    it('saves a row turned into an expression among the {x} rows, its field cleared by the switch', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-expr-toggle-1'))
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('@timestamp', ''), expression: [1] })
    })

    it('saves a row back to plain when its toggle goes off, its expression cleared to empty text', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows('time_field', 'message'), expressionRows: [0] })
      await user.click(within(body()).getByTestId('array-expr-toggle-0'))
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      expect(rowBox(0)).toHaveValue('')
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('', 'message'), expression: [] })
    })

    it('moves the {x} mark with its row', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor({ stored: rows('time_field', 'message'), expressionRows: [0] })
      await user.click(within(body()).getByTestId('array-move-down-0'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows('message', 'time_field'), expression: [1] })
    })
  })

  describe('the null button', () => {
    it('saves a row set to null', async () => {
      const user = userEvent.setup()
      const { onSave } = renderEditor()
      await user.click(within(body()).getByTestId('array-edit-input-0-null'))
      await user.click(saveButton())
      expect(lastSave(onSave)).toEqual({ saved: rows(null, 'message'), expression: [] })
    })

    it('shows no null button on a row held as {x}', () => {
      renderEditor({ stored: rows('time_field', 'message'), expressionRows: [0] })
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
