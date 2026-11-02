/**
 * The Edit value sheet's nested levels: a List or Map entry opens the same sheet
 * one level deeper, its items typed by their own JSON. A nested Save writes into
 * the entry of the level below; Close discards; a read-only sheet opens its
 * levels read-only; the tenth level opens no deeper List or Map.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.1.3.19: Declared element types for array and map values
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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

import {
  ValueEditorSheet,
  type ListEditorOptions,
} from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import type { ElementTypes } from '@/lib/variable-validation'
import type { VariableType } from '@/lib/variable-types'

interface RenderOptions {
  type?: VariableType
  value: unknown
  elementTypes?: ElementTypes
  level?: number
  frozen?: boolean
  listEditor?: ListEditorOptions
}

function renderSheet({ type = 'array', value, elementTypes, level, frozen = false, listEditor }: RenderOptions) {
  const onSave = vi.fn()
  const sheet = (
    <ValueEditorSheet
      label="Values"
      name="values"
      type={type}
      value={value}
      elementTypes={elementTypes}
      isTemplate={false}
      availableVariables={[]}
      level={level}
      listEditor={listEditor}
      onSave={onSave}
      onClose={vi.fn()}
    />
  )
  render(frozen ? <FreezableFieldset disabled>{sheet}</FreezableFieldset> : sheet)
  return { onSave }
}

const sheets = () => screen.getAllByTestId('value-editor-sheet')
const sheet = (level: number) => within(sheets()[level - 1])
const typeOf = (level: number, index: number) => sheet(level).getByTestId(`array-type-${index}`).textContent

function ExpressionSlot({ value, testId, ariaLabel }: MapExpressionEditorProps) {
  return <input data-testid={testId} aria-label={ariaLabel} value={value} readOnly />
}

describe('ValueEditorSheet - a List entry opens one level deeper', () => {
  it('opens the same Edit value sheet on the entry, each item typed by its own JSON', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['["5", 5, 2.0, true, [1], {"a": 1}]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheets()).toHaveLength(2)
    expect(sheet(2).getByTestId('value-editor-type-badge')).toHaveTextContent(/^array$/)
    expect(sheet(2).getByTestId('array-edit-input-0')).toHaveValue('5')
    expect(sheet(2).getByTestId('array-edit-input-2')).toHaveValue('2.0')
    expect(sheet(2).getByTestId('array-edit-input-5')).toHaveValue('{"a": 1}')
    expect([0, 1, 2, 3, 4, 5].map((index) => typeOf(2, index))).toEqual([
      'string',
      'integer',
      'float',
      'boolean',
      'array',
      'map',
    ])
    expect(within(sheet(2).getByTestId('array-edit-body')).getAllByRole('combobox', { name: /^Item \d type$/ })).toHaveLength(6)
  })

  it('writes the nested Save into the entry below and leaves the field to that level Save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ value: ['[1, 2.0, "x"]', 'b'], elementTypes: ['array', 'string'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    fireEvent.change(sheet(2).getByTestId('array-edit-input-2'), { target: { value: 'y' } })
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue('[1, 2.0, "y"]')
    expect(sheets()).toHaveLength(2)
    expect(onSave).not.toHaveBeenCalled()
    await user.click(sheet(1).getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(['[1, 2.0, "y"]', 'b'], false, [], ['array', 'string'])
  })

  it('keeps a whole float and a 19-digit integer exact through a nested edit', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[2.0, 1234567890123456789, "a"]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    fireEvent.change(sheet(2).getByTestId('array-edit-input-2'), { target: { value: 'b' } })
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue('[2.0, 1234567890123456789, "b"]')
  })

  it('keeps a float a float when its text becomes a whole number', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[2.5]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    fireEvent.change(sheet(2).getByTestId('array-edit-input-0'), { target: { value: '3' } })
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue('[3.0]')
  })

  it('discards the nested draft on Close', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ value: ['[1]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    fireEvent.change(sheet(2).getByTestId('array-edit-input-0'), { target: { value: '2' } })
    await user.click(sheet(2).getByTestId('value-editor-cancel-button'))
    await user.click(screen.getByTestId('value-editor-unsaved-discard-button'))
    expect(sheets()).toHaveLength(1)
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue('[1]')
    expect(sheet(1).getByTestId('value-editor-save-button')).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the text entry expand: a text item opens the string editor', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['abc'], elementTypes: ['string'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheet(2).getByTestId('value-editor-type-badge')).toHaveTextContent(/^string$/)
  })

  it('takes no {x} at a nested level', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[1]'], elementTypes: ['array'], listEditor: { expressionEditor: ExpressionSlot } })
    expect(sheet(1).getByTestId('array-expr-toggle-0')).toBeInTheDocument()
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheet(2).getByTestId('array-edit-input-0')).toHaveValue('1')
    expect(sheet(2).queryAllByTestId(/^array-expr-toggle-/)).toHaveLength(0)
  })
})

describe('ValueEditorSheet - a Map entry and the levels inside it', () => {
  it('opens a Map entry, then a List inside it, and saves each level into the one below', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'map', value: { m: '{"b": 2.0, "l": [1]}' }, elementTypes: { m: 'map' } })
    await user.click(sheet(1).getByTestId('map-expand-0'))
    expect(sheet(2).getByTestId('map-edit-key-0')).toHaveValue('b')
    expect(sheet(2).getByTestId('map-edit-value-0')).toHaveValue('2.0')
    expect(sheet(2).getByTestId('map-type-0')).toHaveTextContent(/^float$/)
    expect(sheet(2).getByTestId('map-type-1')).toHaveTextContent(/^array$/)
    await user.click(sheet(2).getByTestId('map-expand-1'))
    expect(sheets()).toHaveLength(3)
    expect(typeOf(3, 0)).toBe('integer')
    fireEvent.change(sheet(3).getByTestId('array-edit-input-0'), { target: { value: '9' } })
    await user.click(sheet(3).getByTestId('value-editor-save-button'))
    expect(sheet(2).getByTestId('map-edit-value-1')).toHaveValue('[9]')
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('map-edit-value-0')).toHaveValue('{"b": 2.0, "l": [9]}')
  })
})

describe('ValueEditorSheet - at most 10 nested levels', () => {
  it('opens the tenth level from the ninth, whose List expand is off with the reason', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[[1]]'], elementTypes: ['array'], level: 9 })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheet(2).getByTestId('array-edit-input-0')).toHaveValue('[1]')
    expect(typeOf(2, 0)).toBe('array')
    const expand = sheet(2).getByTestId('array-expand-0')
    expect(expand).toBeDisabled()
    expect(expand).toHaveClass('opacity-50', 'cursor-not-allowed')
    await user.hover(expand.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Up to 10 nested levels$/)
  })
})

describe('ValueEditorSheet - a read-only sheet', () => {
  it('opens a nested level read-only', () => {
    renderSheet({ value: ['[1]'], elementTypes: ['array'], frozen: true })
    expect(sheet(1).getByTestId('array-edit-input-0')).toBeDisabled()
    // user-event treats a disabled fieldset's links as disabled; a browser does not.
    fireEvent.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheets()).toHaveLength(2)
    expect(sheet(2).getByTestId('array-edit-input-0')).toBeDisabled()
    expect(sheet(2).getByTestId('value-editor-save-button')).toBeDisabled()
  })
})

const pickType = async (user: ReturnType<typeof userEvent.setup>, level: number, testId: string, type: string) => {
  await user.click(sheet(level).getByTestId(testId))
  await user.click(await screen.findByRole('option', { name: type }))
}

const optionNames = async () => (await screen.findAllByRole('option')).map((option) => option.textContent)

const SIX_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map']

// A nested level is as editable as level 1 (FIELD-13).
describe('ValueEditorSheet - nested levels take the editable type picker', () => {
  it('offers all six types at level 2 and level 3', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[[1]]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    await user.click(sheet(2).getByTestId('array-type-0'))
    expect(await optionNames()).toEqual(SIX_TYPES)
    await user.keyboard('{Escape}')
    await user.click(sheet(2).getByTestId('array-expand-0'))
    await user.click(sheet(3).getByTestId('array-type-0'))
    expect(await optionNames()).toEqual(SIX_TYPES)
  })

  it('opens an editable level 3 from a Map picked at level 2', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'map', value: { m: '{"k": ""}' }, elementTypes: { m: 'map' } })
    await user.click(sheet(1).getByTestId('map-expand-0'))
    await pickType(user, 2, 'map-type-0', 'map')
    expect(sheet(2).getByTestId('map-edit-value-0')).toHaveValue('{}')
    await user.click(sheet(2).getByTestId('map-expand-0'))
    expect(sheets()).toHaveLength(3)
    await user.click(sheet(3).getByTestId('map-add-entry'))
    fireEvent.change(sheet(3).getByTestId('map-edit-key-0'), { target: { value: 'n' } })
    await pickType(user, 3, 'map-type-0', 'integer')
    expect(sheet(3).getByTestId('map-edit-value-0')).toHaveValue('0')
    await user.click(sheet(3).getByTestId('value-editor-save-button'))
    expect(sheet(2).getByTestId('map-edit-value-0')).toHaveValue('{"n": 0}')
  })

  it.each([
    ['Float', 'float', '[3.0]', '3.0'],
    ['Integer', 'integer', '[3]', '3'],
  ] as const)('round-trips a whole %s through a nested Save and reopen', async (_name, type, saved, shown) => {
    const user = userEvent.setup()
    renderSheet({ value: ['["a"]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    await pickType(user, 2, 'array-type-0', type)
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    fireEvent.change(sheet(2).getByTestId('array-edit-input-0'), { target: { value: '3' } })
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue(saved)
    await user.click(sheet(2).getByTestId('value-editor-cancel-button'))
    expect(sheets()).toHaveLength(1)
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(sheet(2).getByTestId('array-edit-input-0')).toHaveValue(shown)
    expect(typeOf(2, 0)).toBe(type)
  })

  it('keeps the picked type of a null item for this session and reads it as String once reopened (known limit)', async () => {
    const user = userEvent.setup()
    renderSheet({ value: ['[5, "b"]'], elementTypes: ['array'] })
    await user.click(sheet(1).getByTestId('array-expand-0'))
    await user.click(sheet(2).getByTestId('array-edit-input-0-null'))
    expect(typeOf(2, 0)).toBe('integer')
    await user.click(sheet(2).getByTestId('value-editor-save-button'))
    expect(sheet(1).getByTestId('array-edit-input-0')).toHaveValue('[null, "b"]')
    await user.click(sheet(2).getByTestId('value-editor-cancel-button'))
    await user.click(sheet(1).getByTestId('array-expand-0'))
    expect(typeOf(2, 0)).toBe('string')
  })
})
