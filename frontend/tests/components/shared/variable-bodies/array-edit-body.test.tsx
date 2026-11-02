/**
 * Tests for ArrayEditBody - the controlled array edit body. Each item carries a
 * per-element type pill: the type is inferred from the text as you type and sticks
 * once chosen by hand; numbers are kept as exact text (precision); an invalid item
 * is flagged, not blocked. As the shared list editor it also takes a per-item {x}
 * slot, a per-item null button, an item-input slot, position labels, a text-item
 * editor slot behind expand, and its own reorder buttons (FIELD-10, FIELD-13).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.1.5: Block parameter configuration forms
 * REQ-3.1.3.19: Declared element types for array and map values
 * REQ-3.1.3.20: Null is the only empty value
 */

import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ArrayEditBody } from '@/components/shared/variable-bodies/array-edit-body'
import { ListItemNounContext } from '@/components/shared/variable-bodies/list-item-noun-context'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import {
  partsExprIndicesFor,
  withPartsExprIndices,
} from '@/features/workbench/lib/node-parameters/indexed-expression-fields'
import { inferRuntimeType, type ValueType } from '@/lib/variable-validation'
import { ChildEditorParent } from '../../../utils/child-editor-parent'

interface RenderOptions {
  value?: unknown[]
  types?: ValueType[]
  onChange?: (value: unknown[], types: ValueType[]) => void
  onValidChange?: (valid: boolean) => void
  stringValuesOnly?: boolean
}

// A real stateful parent so the controlled body re-renders on change (like the modal).
function renderBody({
  value = [1, 2],
  types,
  onChange = vi.fn(),
  onValidChange = vi.fn(),
  stringValuesOnly,
}: RenderOptions = {}) {
  const initialTypes = types ?? value.map(inferRuntimeType)
  function Harness() {
    const [v, setV] = useState<unknown[]>(value)
    const [t, setT] = useState<ValueType[]>(initialTypes)
    return (
      <ArrayEditBody
        value={v}
        types={t}
        onChange={(nextValue, nextTypes) => {
          setV(nextValue)
          setT(nextTypes)
          onChange(nextValue, nextTypes)
        }}
        onValidChange={onValidChange}
        stringValuesOnly={stringValuesOnly}
      />
    )
  }
  render(<Harness />)
  return { onChange, onValidChange }
}

function calls(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls
}
const lastValue = (fn: unknown) => calls(fn).at(-1)?.[0]
const lastTypes = (fn: unknown) => calls(fn).at(-1)?.[1]

// Flush ui/select.tsx SelectItem's deferred aria-selected MutationObserver update,
// scheduled as a microtask when an inferred type change flips a type pill's value.
const flushTypePill = () => act(async () => {})

describe('ArrayEditBody - outlined grid + header (VMGR-82)', () => {
  it('renders a quiet header row labeling #, Value and Type', () => {
    renderBody({ value: ['alpha'], types: ['string'] })
    expect(screen.getByText('#')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
  })

  it('places the value input before the type pill (value-first)', () => {
    renderBody({ value: ['alpha'], types: ['string'] })
    const input = screen.getByTestId('array-edit-input-0')
    const pill = screen.getByTestId('array-type-0')
    expect(input.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ArrayEditBody - rows + type pill', () => {
  it('renders a value input and a type pill per element', () => {
    renderBody({ value: ['alpha', 7], types: ['string', 'integer'] })
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('alpha')
    expect(screen.getByTestId('array-edit-input-1')).toHaveValue('7')
    expect(screen.getByTestId('array-type-0')).toHaveTextContent('string')
    expect(screen.getByTestId('array-type-1')).toHaveTextContent('integer')
  })

  it('labels each row with its 0-based index', () => {
    renderBody({ value: ['a', 'b', 'c'] })
    expect(screen.getAllByTestId('array-edit-index').map((el) => el.textContent)).toEqual([
      '0',
      '1',
      '2',
    ])
  })
})

describe('ArrayEditBody - inference + precision', () => {
  it('keeps typed digits as exact text and never picks a number type', async () => {
    const { onChange } = renderBody({ value: [], types: [] })
    fireEvent.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), {
      target: { value: '12345678901234567890' },
    })
    await flushTypePill()
    expect(lastValue(onChange)).toEqual(['12345678901234567890'])
    expect(lastTypes(onChange)).toEqual(['string'])
  })

  it('keeps a seeded item\'s type while it is typed into', async () => {
    const { onChange } = renderBody({ value: ['1'], types: ['integer'] })
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '-12' } })
    await flushTypePill()
    expect(lastValue(onChange)).toEqual(['-12'])
    expect(lastTypes(onChange)).toEqual(['integer'])
  })

  it('keeps a string element a string', () => {
    const { onChange } = renderBody({ value: ['a', 'b'], types: ['string', 'string'] })
    fireEvent.change(screen.getByTestId('array-edit-input-1'), { target: { value: 'beta' } })
    expect(lastValue(onChange)).toEqual(['a', 'beta'])
    expect(lastTypes(onChange)).toEqual(['string', 'string'])
  })

  it('infers array from a nested JSON value and keeps the verbatim text', async () => {
    const { onChange } = renderBody({ value: [], types: [] })
    fireEvent.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '[1, 2]' } })
    await flushTypePill()
    expect(lastValue(onChange)).toEqual(['[1, 2]'])
    expect(lastTypes(onChange)).toEqual(['array'])
  })

  it('does not normalize a nested number while typing (123.0 stays 123.0)', async () => {
    const { onChange } = renderBody({ value: [''], types: ['string'] })
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '{"hi":123.0}' } })
    await flushTypePill()
    expect(lastValue(onChange)).toEqual(['{"hi":123.0}'])
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('{"hi":123.0}')
  })

  it('commits to array on the bracket and flags invalid JSON', async () => {
    renderBody({ value: [], types: [] })
    fireEvent.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '[1, 2' } })
    await flushTypePill()
    expect(screen.getByTestId('array-type-0')).toHaveTextContent('array')
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('ArrayEditBody - manual override', () => {
  it('sticks a hand-picked type across later edits (no re-inference)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [1], types: ['integer'] })
    await user.click(screen.getByTestId('array-type-0'))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(lastTypes(onChange)).toEqual(['string'])
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '42' } })
    expect(lastValue(onChange)).toEqual(['42'])
    expect(lastTypes(onChange)).toEqual(['string'])
  })

  it('flags - not blocks - text typed that no longer fits a hand-picked type', async () => {
    const user = userEvent.setup()
    const { onValidChange } = renderBody({ value: [1], types: ['integer'] })
    await user.click(screen.getByTestId('array-type-0'))
    await user.click(await screen.findByRole('option', { name: 'boolean' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'maybe' } })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('ArrayEditBody - add / delete / reorder', () => {
  it('appends an empty string item, defaulting its type to string', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [1], types: ['integer'] })
    await user.click(screen.getByTestId('array-add-item'))
    expect(lastValue(onChange)).toEqual([1, ''])
    expect(lastTypes(onChange)).toEqual(['integer', 'string'])
  })

  it('removes the targeted element with its type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [1, 'a', 3], types: ['integer', 'string', 'integer'] })
    await user.click(screen.getByTestId('array-remove-1'))
    expect(lastValue(onChange)).toEqual([1, 3])
    expect(lastTypes(onChange)).toEqual(['integer', 'integer'])
  })

  it('moves an element with its type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [1, 'a'], types: ['integer', 'string'] })
    await user.click(screen.getByTestId('array-move-down-0'))
    expect(lastValue(onChange)).toEqual(['a', 1])
    expect(lastTypes(onChange)).toEqual(['string', 'integer'])
  })

  it('disables move-up on the first row and move-down on the last row', () => {
    renderBody({ value: [1, 2] })
    expect(screen.getByTestId('array-move-up-0')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('array-move-down-1')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('ArrayEditBody - validation forwarding + missing type default', () => {
  it('forwards messages to onValidation and defaults a missing element type to string', () => {
    const onValidation = vi.fn()
    render(
      <ArrayEditBody
        value={['a', 'b']}
        types={['string']} // shorter than value: item 1 has no type
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        onValidation={onValidation}
      />,
    )
    expect(screen.getByTestId('array-type-1')).toHaveTextContent('string') // types[1] ?? 'string'
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'x' } })
    expect(onValidation).toHaveBeenCalled()
  })
})

describe('ArrayEditBody - manual-override reindexing on delete / move', () => {
  it('rebases hand-picked types around a removed item (dropIndex both sides)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: ['a', 'b', 'c'], types: ['string', 'string', 'string'] })
    // Pin items 0 and 2 by hand (override set = {0, 2}); each type change clears its text.
    await user.click(screen.getByTestId('array-type-0'))
    await user.click(await screen.findByRole('option', { name: 'integer' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    await user.click(screen.getByTestId('array-type-2'))
    await user.click(await screen.findByRole('option', { name: 'integer' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    // Remove item 1: the override at 0 (< 1) stays, the one at 2 (> 1) shifts to 1.
    await user.click(screen.getByTestId('array-remove-1'))
    // The shifted override still sticks: a non-integer edit does NOT re-infer to string.
    fireEvent.change(screen.getByTestId('array-edit-input-1'), { target: { value: 'xyz' } })
    expect(lastTypes(onChange)).toEqual(['integer', 'integer'])
  })

  it('swaps hand-picked types with their items on move (swapIndex both endpoints)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: ['a', 'b'], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-type-0'))
    await user.click(await screen.findByRole('option', { name: 'integer' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    await user.click(screen.getByTestId('array-type-1'))
    await user.click(await screen.findByRole('option', { name: 'float' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    // Move item 1 up: the overrides at 0 and 1 swap with the items (move-up handler).
    await user.click(screen.getByTestId('array-move-up-1'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'p' } })
    fireEvent.change(screen.getByTestId('array-edit-input-1'), { target: { value: 'q' } })
    expect(lastTypes(onChange)).toEqual(['float', 'integer'])
  })
})

describe('ArrayEditBody - revealing an appended row', () => {
  function getGrid(): HTMLElement {
    return screen.getByTestId('array-edit-body').firstElementChild as HTMLElement
  }

  it('scrolls the grid down to the row just added', async () => {
    const user = userEvent.setup()
    renderBody({ value: [1, 2] })
    const grid = getGrid()
    // jsdom lays nothing out, so the overflow is described explicitly.
    Object.defineProperty(grid, 'scrollHeight', { value: 400, configurable: true })

    await user.click(screen.getByTestId('array-add-item'))

    expect(grid.scrollTop).toBe(400)
  })

  it('leaves a list that does not overflow where it is', async () => {
    const user = userEvent.setup()
    renderBody({ value: [1, 2] })
    const grid = getGrid()

    await user.click(screen.getByTestId('array-add-item'))

    expect(grid.scrollTop).toBe(0)
  })

  it('does not scroll when a row is merely edited', async () => {
    const user = userEvent.setup()
    renderBody({ value: [1, 2] })
    const grid = getGrid()
    Object.defineProperty(grid, 'scrollHeight', { value: 400, configurable: true })

    await user.type(screen.getByTestId('array-edit-input-0'), '9')

    expect(grid.scrollTop).toBe(0)
  })
})

// A stored null item stays null until the user enters a value (REQ-3.1.3.19, VMGR-93).
describe('ArrayEditBody - a null item', () => {
  const nullChip = (index: number) => screen.getByRole('button', { name: `Item ${index} (null)` })

  it('shows a stored null item as the null chip named for its item', () => {
    renderBody({ value: ['a', null], types: ['string', 'integer'] })
    expect(nullChip(1)).toHaveTextContent(/^null$/)
    expect(screen.queryByRole('textbox', { name: 'Item 1 value' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Item 0 value' })).toHaveValue('a')
    expect(screen.getByTestId('array-type-1')).toHaveTextContent('integer')
  })

  it('explains the chip on keyboard focus', async () => {
    renderBody({ value: [null], types: ['string'] })
    act(() => nullChip(0).focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it('keeps an untouched null item null when another item is edited', () => {
    const { onChange } = renderBody({ value: ['a', null], types: ['string', 'integer'] })
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'b' } })
    expect(lastValue(onChange)).toEqual(['b', null])
    expect(lastTypes(onChange)).toEqual(['string', 'integer'])
  })

  it.each(['string', 'integer', 'float', 'boolean', 'array', 'map'] as const)(
    'counts a null %s item valid when another item is edited',
    (type) => {
      const { onValidChange } = renderBody({ value: ['a', null], types: ['string', type] })
      fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'b' } })
      expect(onValidChange).toHaveBeenLastCalledWith(true)
    },
  )

  it('moves a null item with its chip', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [null, 'a'], types: ['integer', 'string'] })
    await user.click(screen.getByTestId('array-move-down-0'))
    expect(lastValue(onChange)).toEqual(['a', null])
    expect(lastTypes(onChange)).toEqual(['string', 'integer'])
    expect(nullChip(1)).toBeInTheDocument()
  })

  it.each([
    ['string', '', ''],
    ['integer', '0', '0'],
    ['float', '0', '0'],
    ['boolean', false, 'false'],
    ['array', '[]', '[]'],
    ['map', '{}', '{}'],
  ] as const)('gives a null %s item its type default when the chip is clicked', async (type, item, text) => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [null], types: [type] })
    await user.click(nullChip(0))
    expect(lastValue(onChange)).toEqual([item])
    expect(lastTypes(onChange)).toEqual([type])
    expect(screen.queryByRole('button', { name: 'Item 0 (null)' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Item 0 value' })).toHaveValue(text)
  })

  it('gives the type default when Enter is pressed on the focused chip', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [null], types: ['integer'] })
    act(() => nullChip(0).focus())
    await user.keyboard('{Enter}')
    expect(lastValue(onChange)).toEqual(['0'])
  })

  it('replaces the default with what the user types after the chip is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [null], types: ['integer'] })
    await user.click(nullChip(0))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 0 value' }), {
      target: { value: '42' },
    })
    expect(lastValue(onChange)).toEqual(['42'])
    expect(lastTypes(onChange)).toEqual(['integer'])
  })

  it('shows an item holding the text "null" as ordinary text, not the chip', () => {
    renderBody({ value: ['null'], types: ['string'] })
    expect(screen.getByRole('textbox', { name: 'Item 0 value' })).toHaveValue('null')
    expect(screen.queryByRole('button', { name: 'Item 0 (null)' })).not.toBeInTheDocument()
  })

  it('never throws when given a whole null value', () => {
    render(
      <ArrayEditBody
        value={null as unknown as unknown[]}
        types={[]}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('array-edit-body')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^array-edit-input-/)).toHaveLength(0)
  })
})

describe('ArrayEditBody - text-only list', () => {
  it('shows the Type column with a read-only string pill on every item', () => {
    renderBody({ value: ['502', '503'], types: ['string', 'string'], stringValuesOnly: true })
    expect(screen.getByText('Type')).toBeInTheDocument()
    for (const index of [0, 1]) {
      const pill = screen.getByTestId(`array-type-${index}`)
      expect(pill).toHaveTextContent(/^string$/)
      expect(pill.tagName).toBe('SPAN')
    }
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getAllByTestId(/^array-edit-input-\d+$/)).toHaveLength(2)
  })

  it('keeps every typed item text, true and brackets included', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: ['', ''], types: ['string', 'string'], stringValuesOnly: true })
    await user.type(screen.getByTestId('array-edit-input-0'), 'true')
    await user.type(screen.getByTestId('array-edit-input-1'), '[[5')
    expect(lastValue(onChange)).toEqual(['true', '[5'])
    expect(lastTypes(onChange)).toEqual(['string', 'string'])
  })
})

// The enum allowed values: one Value Type for every item, shown as a read-only pill (VMGR-100, VMGR-104, REQ-3.1.2.11).
describe('ArrayEditBody - a list typed by one Value Type', () => {
  function renderTyped(itemType: 'string' | 'integer' | 'float', value: unknown[] = []) {
    const onChange = vi.fn()
    const onValidChange = vi.fn()
    function Harness() {
      const [v, setV] = useState<unknown[]>(value)
      const [t, setT] = useState<ValueType[]>(value.map(() => itemType))
      return (
        <ArrayEditBody
          value={v}
          types={t}
          onChange={(nextValue, nextTypes) => {
            setV(nextValue)
            setT(nextTypes)
            onChange(nextValue, nextTypes)
          }}
          onValidChange={onValidChange}
          itemType={itemType}
        />
      )
    }
    render(<Harness />)
    return { onChange, onValidChange }
  }

  // A fixed item type shows as a read-only pill, never a picker.
  function expectReadOnlyTypeColumn(itemType: string) {
    expect(screen.getByText('Type')).toBeInTheDocument()
    const pills = screen.getAllByTestId(/^array-type-/)
    expect(pills.length).toBeGreaterThan(0)
    for (const pill of pills) {
      expect(pill).toHaveTextContent(new RegExp(`^${itemType}$`))
      expect(pill).not.toHaveRole('button')
      expect(pill).not.toHaveRole('combobox')
    }
  }

  it('stores 1 typed into an Integer list as the number 1 and shows a read-only integer pill', async () => {
    const user = userEvent.setup()
    const { onChange, onValidChange } = renderTyped('integer')
    await user.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '1' } })
    expect(lastValue(onChange)).toEqual([1])
    expect(lastTypes(onChange)).toEqual(['integer'])
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    expectReadOnlyTypeColumn('integer')
  })

  it('stores 2.5 typed into a Float list as the number 2.5 and shows a read-only float pill', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTyped('float')
    await user.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '2.5' } })
    expect(lastValue(onChange)).toEqual([2.5])
    expect(lastTypes(onChange)).toEqual(['float'])
    expectReadOnlyTypeColumn('float')
  })

  it('keeps 1 typed into a String list as the text 1 and shows a read-only string pill', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTyped('string')
    await user.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '1' } })
    expect(lastValue(onChange)).toEqual(['1'])
    expect(lastTypes(onChange)).toEqual(['string'])
    expectReadOnlyTypeColumn('string')
  })

  it.each(['string', 'integer', 'float'] as const)('gives a new item the %s Value Type', async (itemType) => {
    const user = userEvent.setup()
    const { onChange } = renderTyped(itemType, [])
    await user.click(screen.getByTestId('array-add-item'))
    expect(lastTypes(onChange)).toEqual([itemType])
  })

  it('shows numbers written in the Code view as items of the list and keeps edits numbers', () => {
    const { onChange } = renderTyped('integer', [1, 2])
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('1')
    expect(screen.getByTestId('array-edit-input-1')).toHaveValue('2')
    expectReadOnlyTypeColumn('integer')
    fireEvent.change(screen.getByTestId('array-edit-input-1'), { target: { value: '3' } })
    expect(lastValue(onChange)).toEqual([1, 3])
    expect(lastTypes(onChange)).toEqual(['integer', 'integer'])
  })

  it('drops a key the number rule refuses in an Integer list (REQ-3.1.3.14)', () => {
    const { onChange } = renderTyped('integer', [1])
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '1a' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('1')
  })

  it('flags text an Integer list holds and keeps it as text', () => {
    const { onChange, onValidChange } = renderTyped('integer', ['a'])
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '-' } })
    expect(lastValue(onChange)).toEqual(['-'])
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('aria-invalid', 'true')
  })

  it('keeps an item an Integer list cannot hold as one JS number as its exact text', () => {
    const { onChange } = renderTyped('integer', [1])
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '9007199254740993' } })
    expect(lastValue(onChange)).toEqual(['9007199254740993'])
  })

  it('stores a Float list item that prints back the same way as a number, and trailing zeros as text', () => {
    const { onChange } = renderTyped('float', [1])
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '2.5' } })
    expect(lastValue(onChange)).toEqual([2.5])
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '2.50' } })
    expect(lastValue(onChange)).toEqual(['2.50'])
  })

  it('gives an integer item the number keyboard and a length stop', () => {
    renderTyped('integer', [1])
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('maxlength', '20')
  })
})

// ============================================================================
// The shared list editor (FIELD-10, FIELD-13): slots a host injects, the null
// button on every item, position labels, focus after Add / Remove / Move.
// ============================================================================

/** What the item-input slot receives for one literal item. */
interface ItemInputSlotProps {
  value: unknown
  index: number
  onChange: (value: unknown) => void
  ariaLabel: string
  testId: string
}

/** What the entry editor slot receives while a text, List or Map item is expanded. */
interface TextEditorSlotProps {
  label: string
  type?: string
  value: string
  onSave: (text: string) => void
  onClose: () => void
}

// Stands in for the host's expression editor; the editable surface carries the CodeMirror class.
function ExpressionSlot({ value, onChange, ariaLabel, testId }: MapExpressionEditorProps) {
  return (
    <div data-testid={testId}>
      <input
        className="cm-content"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

// Stands in for a host row input such as the stat trigger: it writes a whole entry at once.
function StatSlot({ value, index, onChange, ariaLabel, testId }: Readonly<ItemInputSlotProps>) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      data-index={String(index)}
      onClick={() => onChange({ stat: 'sum', field: 'bytes' })}
    >
      {JSON.stringify(value)}
    </button>
  )
}

// Stands in for the host's string editor; it reports to the parent like every child editor.
function TextEditorStub({ label, type, value, onSave, onClose }: Readonly<TextEditorSlotProps>) {
  const [draft, setDraft] = useState(value)
  useChildEditor({ label, hasChanges: draft !== value, cannotBeSaved: false, apply: () => onSave(draft) })
  return (
    <div data-testid="text-editor" data-value={value} data-type={type}>
      <button type="button" data-testid="text-editor-type" onClick={() => setDraft(`${draft}!`)}>
        type
      </button>
      <button type="button" data-testid="text-editor-save" onClick={() => onSave('SAVED')}>
        Save
      </button>
      <button type="button" data-testid="text-editor-close" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

const renderTextEditor = (props: TextEditorSlotProps) => <TextEditorStub {...props} />
const renderStatSlot = (props: ItemInputSlotProps) => <StatSlot {...props} />
const dollarLabel = (index: number) => `$${index + 1}`

interface EditorOptions {
  value?: unknown[]
  types?: ValueType[]
  stringValuesOnly?: boolean
  /** Inject the expression slot (the {x} column). */
  expression?: boolean
  expressionIndices?: number[]
  renderItemInput?: (props: ItemInputSlotProps) => ReactNode
  positionLabel?: (index: number) => string
  textEditor?: (props: TextEditorSlotProps) => ReactNode
  /** Render inside a parent that collects its child editors (the removal guard). */
  inParent?: boolean
  /** What the host calls its rows. */
  noun?: string
  /** The nested level the list sits at. */
  level?: number
  /** Render inside a read-only (frozen) sheet. */
  frozen?: boolean
  /** The value Add appends and an item leaving {x} takes. */
  newItem?: () => unknown
}

// A stateful host: it keeps the value, the types and the {x} item set the body reports.
function renderEditor({
  value = ['a', 'b'],
  types,
  stringValuesOnly,
  expression = false,
  expressionIndices = [],
  renderItemInput,
  positionLabel,
  textEditor,
  inParent = false,
  noun,
  level,
  frozen = false,
  newItem,
}: EditorOptions = {}) {
  const onChange = vi.fn()
  const onValidChange = vi.fn()
  const onExpressionIndicesChange = vi.fn()
  const initialTypes = types ?? value.map(inferRuntimeType)
  function Harness() {
    const [v, setV] = useState<unknown[]>(value)
    const [t, setT] = useState<ValueType[]>(initialTypes)
    const [expr, setExpr] = useState<ReadonlySet<number>>(() => new Set(expressionIndices))
    return (
      <ArrayEditBody
        value={v}
        types={t}
        onChange={(nextValue, nextTypes) => {
          setV(nextValue)
          setT(nextTypes)
          onChange(nextValue, nextTypes)
        }}
        onValidChange={onValidChange}
        stringValuesOnly={stringValuesOnly}
        expressionEditor={expression ? ExpressionSlot : undefined}
        expressionIndices={expr}
        onExpressionIndicesChange={(next: Iterable<number>) => {
          const indices = new Set(next)
          setExpr(indices)
          onExpressionIndicesChange([...indices].sort((a, b) => a - b))
        }}
        renderItemInput={renderItemInput}
        positionLabel={positionLabel}
        textEditor={textEditor}
        level={level}
        newItem={newItem}
      />
    )
  }
  const named = noun === undefined ? <Harness /> : <ListItemNounContext value={noun}><Harness /></ListItemNounContext>
  const body = frozen ? <FrozenSheetBody>{named}</FrozenSheetBody> : named
  render(inParent ? <ChildEditorParent>{body}</ChildEditorParent> : body)
  return { onChange, onValidChange, onExpressionIndicesChange }
}

function FrozenSheetBody({ children }: Readonly<{ children: ReactNode }>) {
  return <FreezableFieldset disabled>{children}</FreezableFieldset>
}

const indexLabels = () => screen.getAllByTestId('array-edit-index').map((cell) => cell.textContent)

describe('ArrayEditBody - per-item {x} through the injected slot', () => {
  it('shows a {x} toggle on every item with an expression editor and none without one', () => {
    renderEditor({ value: ['a', 'b'], expression: true })
    expect(screen.getByTestId('array-expr-toggle-0')).toBeInTheDocument()
    expect(screen.getByTestId('array-expr-toggle-1')).toBeInTheDocument()
    cleanup()
    renderEditor({ value: ['a', 'b'] })
    expect(screen.queryAllByTestId(/^array-expr-toggle-/)).toHaveLength(0)
  })

  it('names the toggle by its item and presses it only on an item held as {x}', () => {
    renderEditor({ value: ['a', 'n + 1'], expression: true, expressionIndices: [1] })
    expect(screen.getByTestId('array-expr-toggle-0')).toHaveAttribute('aria-label', 'Item 0 expression mode')
    expect(screen.getByTestId('array-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('array-expr-toggle-1')).toHaveAttribute('aria-pressed', 'true')
  })

  it('draws the shared {x} toggle, which shows pressed once clicked', async () => {
    const user = userEvent.setup()
    renderEditor({ value: [''], expression: true })
    const toggle = screen.getByTestId('array-expr-toggle-0')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAttribute('data-state', 'off')
    await user.click(toggle)
    expect(screen.getByTestId('array-expr-toggle-0')).toHaveAttribute('data-state', 'on')
  })

  it('draws an {x} item through the slot with its text and hides its text box, type pill and null button', () => {
    renderEditor({ value: ['a', 'n + 1'], types: ['string', 'string'], expression: true, expressionIndices: [1] })
    const slot = screen.getByTestId('array-expr-value-1')
    expect(within(slot).getByRole('textbox', { name: 'Item 1 value' })).toHaveValue('n + 1')
    expect(screen.queryByTestId('array-edit-input-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('array-type-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('array-edit-input-1-null')).not.toBeInTheDocument()
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('a')
    expect(screen.getByTestId('array-type-0')).toBeInTheDocument()
  })

  it('reports the item as {x} once its switch is answered, and starts the slot empty', async () => {
    const user = userEvent.setup()
    const { onExpressionIndicesChange } = renderEditor({ value: ['a', 'abc'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-1'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onExpressionIndicesChange).toHaveBeenLastCalledWith([1])
    expect(within(screen.getByTestId('array-expr-value-1')).getByRole('textbox')).toHaveValue('')
  })

  it('brings the text box back holding the type default once the toggle goes off', async () => {
    const user = userEvent.setup()
    const { onExpressionIndicesChange } = renderEditor({
      value: ['abc'],
      expression: true,
      expressionIndices: [0],
    })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onExpressionIndicesChange).toHaveBeenLastCalledWith([])
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('')
    expect(screen.queryByTestId('array-expr-value-0')).not.toBeInTheDocument()
  })

  it('writes what is typed in the slot as the item text', () => {
    const { onChange } = renderEditor({ value: ['a', ''], expression: true, expressionIndices: [1] })
    fireEvent.change(within(screen.getByTestId('array-expr-value-1')).getByRole('textbox'), {
      target: { value: 'run_id' },
    })
    expect(lastValue(onChange)).toEqual(['a', 'run_id'])
  })

  it('never checks an {x} item against its type', async () => {
    const user = userEvent.setup()
    const { onValidChange } = renderEditor({ value: [7], types: ['integer'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.change(within(screen.getByTestId('array-expr-value-0')).getByRole('textbox'), {
      target: { value: 'count + 1' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps the item type through {x} on and off, back at its default', async () => {
    const user = userEvent.setup()
    renderEditor({ value: [7], types: ['integer'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByTestId('array-type-0')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await flushTypePill()
    expect(screen.getByTestId('array-type-0')).toHaveTextContent('integer')
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('0')
  })
})

// Each row's {x} flag is stored under the dotted key <param>.<i>.value (Arguments, Out arguments).
describe('ArrayEditBody - dotted per-row {x} flags', () => {
  function renderArguments(initialFields: string[], value: unknown[] = ['a', 'b']) {
    const onFieldsChange = vi.fn()
    const onChange = vi.fn()
    function Host() {
      const [items, setItems] = useState<unknown[]>(value)
      const [types, setTypes] = useState<ValueType[]>(value.map(() => 'string'))
      const [fields, setFields] = useState<string[]>(initialFields)
      return (
        <ArrayEditBody
          value={items}
          types={types}
          onChange={(nextValue, nextTypes) => {
            setItems(nextValue)
            setTypes(nextTypes)
            onChange(nextValue, nextTypes)
          }}
          onValidChange={vi.fn()}
          stringValuesOnly
          positionLabel={dollarLabel}
          expressionEditor={ExpressionSlot}
          expressionIndices={partsExprIndicesFor('arguments', fields)}
          onExpressionIndicesChange={(next: Iterable<number>) => {
            const indices = [...new Set(next)].sort((a, b) => a - b)
            const nextFields = withPartsExprIndices('arguments', fields, indices)
            setFields(nextFields)
            onFieldsChange(nextFields)
          }}
        />
      )
    }
    render(<Host />)
    return { onFieldsChange, onChange }
  }

  it('adds the row entry when its toggle goes on and leaves other entries in place', async () => {
    const user = userEvent.setup()
    const { onFieldsChange } = renderArguments(['script'])
    await user.click(screen.getByTestId('array-expr-toggle-1'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onFieldsChange).toHaveBeenLastCalledWith(['script', 'arguments.1.value'])
  })

  it('drops the row entry when its toggle goes off', async () => {
    const user = userEvent.setup()
    const { onFieldsChange } = renderArguments(['arguments.0.value'])
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onFieldsChange).toHaveBeenLastCalledWith([])
  })

  it('rebuilds the entries from the remaining rows when a row goes', async () => {
    const user = userEvent.setup()
    const { onFieldsChange, onChange } = renderArguments(['script', 'arguments.1.value'])
    await user.click(screen.getByTestId('array-remove-0'))
    expect(lastValue(onChange)).toEqual(['b'])
    expect(onFieldsChange).toHaveBeenLastCalledWith(['script', 'arguments.0.value'])
  })

  it('moves the entry with its row', async () => {
    const user = userEvent.setup()
    const { onFieldsChange, onChange } = renderArguments(['arguments.0.value'])
    await user.click(screen.getByTestId('array-move-down-0'))
    expect(lastValue(onChange)).toEqual(['b', 'a'])
    expect(onFieldsChange).toHaveBeenLastCalledWith(['arguments.1.value'])
  })
})

// Null is allowed in every list item, with no locks (FIELD-13).
describe('ArrayEditBody - the null button on every item', () => {
  it('gives every literal item a null button named by its item, not pressed', () => {
    renderEditor({ value: ['a', 7], types: ['string', 'integer'] })
    const button = screen.getByTestId('array-edit-input-1-null')
    expect(button).toHaveAttribute('aria-label', 'Set Item 1 to null')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('array-edit-input-0-null')).toBeInTheDocument()
  })

  it('gives a text-only list item a null button too', () => {
    renderEditor({ value: ['502'], types: ['string'], stringValuesOnly: true })
    expect(screen.getByTestId('array-edit-input-0-null')).toBeInTheDocument()
  })

  it('sets the item to null and keeps its type', async () => {
    const user = userEvent.setup()
    const { onChange, onValidChange } = renderEditor({ value: ['a', 7], types: ['string', 'integer'] })
    await user.click(screen.getByTestId('array-edit-input-1-null'))
    expect(lastValue(onChange)).toEqual(['a', null])
    expect(lastTypes(onChange)).toEqual(['string', 'integer'])
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Item 1 (null)' })).toBeInTheDocument()
    expect(screen.getByTestId('array-type-1')).toHaveTextContent('integer')
  })

  it('explains the button on keyboard focus', async () => {
    renderEditor({ value: ['a'], types: ['string'] })
    act(() => screen.getByTestId('array-edit-input-0-null').focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Set to null$/)
  })

  it('hides the null button while the item is {x}', () => {
    renderEditor({ value: ['a', 'n'], expression: true, expressionIndices: [1] })
    expect(screen.getByTestId('array-edit-input-0-null')).toBeInTheDocument()
    expect(screen.queryByTestId('array-edit-input-1-null')).not.toBeInTheDocument()
  })
})

// Arguments number their rows $1, $2, ... from one (SHRUN-4).
// A Block list names its rows by its own noun; a list whose host names none says "item" (SHRUN-4).
describe('ArrayEditBody - the row noun', () => {
  it('names Add, every row control and the item editor by the host noun', async () => {
    const user = userEvent.setup()
    const textEditor = vi.fn((_props: TextEditorSlotProps) => <div data-testid="text-editor" />)
    renderEditor({
      value: ['a', 'b'],
      types: ['string', 'string'],
      positionLabel: dollarLabel,
      expression: true,
      textEditor,
      noun: 'argument',
    })
    expect(screen.getByTestId('array-add-item')).toHaveTextContent(/^Add argument$/)
    expect(screen.getByTestId('array-edit-input-1')).toHaveAccessibleName('Argument $2 value')
    expect(screen.getByTestId('array-expr-toggle-1')).toHaveAccessibleName('Argument $2 expression mode')
    expect(screen.getByTestId('array-move-up-1')).toHaveAccessibleName('Move argument $2 up')
    expect(screen.getByTestId('array-move-down-0')).toHaveAccessibleName('Move argument $1 down')
    expect(screen.getByTestId('array-remove-1')).toHaveAccessibleName('Remove argument $2')
    await user.click(screen.getByTestId('array-expand-1'))
    expect(textEditor.mock.lastCall?.[0].label).toBe('Argument $2')
  })

  it('says item where the host names no noun', () => {
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], positionLabel: dollarLabel })
    expect(screen.getByTestId('array-add-item')).toHaveTextContent(/^Add item$/)
    expect(screen.getByTestId('array-edit-input-1')).toHaveAccessibleName('Item $2 value')
    expect(screen.getByTestId('array-move-up-1')).toHaveAccessibleName('Move item $2 up')
    expect(screen.getByTestId('array-remove-1')).toHaveAccessibleName('Remove item $2')
  })
})

describe('ArrayEditBody - position labels', () => {
  it('labels each row with the host label instead of the 0-based index', () => {
    renderEditor({ value: ['a', 'b', 'c'], positionLabel: dollarLabel })
    expect(indexLabels()).toEqual(['$1', '$2', '$3'])
  })

  it('renumbers the rows after one goes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b', 'c'], positionLabel: dollarLabel })
    await user.click(screen.getByTestId('array-remove-0'))
    expect(indexLabels()).toEqual(['$1', '$2'])
  })

  it('hides a host position label from assistive technology', () => {
    renderEditor({ value: ['a'], positionLabel: dollarLabel })
    expect(screen.getByTestId('array-edit-index')).toHaveTextContent(/^\$1$/)
    expect(screen.getByTestId('array-edit-index')).toHaveAttribute('aria-hidden', 'true')
  })

  it('names every control of a row by the label the row shows', () => {
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], positionLabel: dollarLabel, expression: true })
    expect(screen.getByTestId('array-edit-input-1')).toHaveAccessibleName('Item $2 value')
    expect(screen.getByTestId('array-type-1')).toHaveAccessibleName('Item $2 type')
    expect(screen.getByTestId('array-expr-toggle-1')).toHaveAccessibleName('Item $2 expression mode')
    expect(screen.getByTestId('array-edit-input-1-null')).toHaveAccessibleName('Set Item $2 to null')
    expect(screen.getByTestId('array-move-up-1')).toHaveAccessibleName('Move item $2 up')
    expect(screen.getByTestId('array-move-down-1')).toHaveAccessibleName('Move item $2 down')
    expect(screen.getByTestId('array-remove-1')).toHaveAccessibleName('Remove item $2')
  })

  it('names the first row from its label, never from zero', () => {
    renderEditor({ value: ['a'], types: ['string'], positionLabel: dollarLabel })
    expect(screen.getByRole('textbox', { name: 'Item $1 value' })).toHaveValue('a')
    expect(screen.getByRole('button', { name: 'Remove item $1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove item 0' })).not.toBeInTheDocument()
  })

  it('renames the controls of the rows that move up after one goes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b', 'c'], positionLabel: dollarLabel })
    await user.click(screen.getByRole('button', { name: 'Remove item $1' }))
    expect(screen.getByRole('textbox', { name: 'Item $1 value' })).toHaveValue('b')
    expect(screen.getByRole('textbox', { name: 'Item $2 value' })).toHaveValue('c')
    expect(screen.queryByRole('textbox', { name: 'Item $3 value' })).not.toBeInTheDocument()
  })

  it('names a null item and its {x} slot by the label the row shows', () => {
    renderEditor({
      value: ['run_id', null],
      types: ['string', 'string'],
      positionLabel: dollarLabel,
      expression: true,
      expressionIndices: [0],
    })
    expect(screen.getByRole('textbox', { name: 'Item $1 value' })).toHaveValue('run_id')
    expect(screen.getByRole('button', { name: 'Item $2 (null)' })).toBeInTheDocument()
  })

  it('hands the item-input slot the name of the label the row shows', () => {
    renderEditor({
      value: [{ stat: 'count' }],
      types: ['map'],
      renderItemInput: renderStatSlot,
      positionLabel: (index) => String(index + 1),
    })
    expect(screen.getByTestId('array-edit-input-0')).toHaveAttribute('aria-label', 'Item 1 value')
  })

  it('keeps naming the rows by their 0-based index when the host gives no position label', () => {
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    expect(screen.getByTestId('array-remove-1')).toHaveAccessibleName('Remove item 1')
    expect(screen.getByTestId('array-edit-input-1')).toHaveAccessibleName('Item 1 value')
  })
})

// A host row input (the field box, the stat trigger) in place of the text box (FIELD-10).
describe('ArrayEditBody - the item-input slot', () => {
  const STATS = [{ stat: 'count' }, { stat: 'sum', field: 'x' }]

  it('draws each literal item through the slot, handing it the item value and position', () => {
    renderEditor({ value: STATS, types: ['map', 'map'], renderItemInput: renderStatSlot })
    const first = screen.getByTestId('array-edit-input-0')
    expect(first.tagName).toBe('BUTTON')
    expect(first).toHaveTextContent('{"stat":"count"}')
    expect(first).toHaveAttribute('data-index', '0')
    expect(first).toHaveAttribute('aria-label', 'Item 0 value')
    expect(screen.getByTestId('array-edit-input-1')).toHaveAttribute('data-index', '1')
    expect(within(screen.getByTestId('array-edit-body')).queryAllByRole('textbox')).toHaveLength(0)
  })

  it('writes what the slot gives into the item as it is and keeps the item type', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: STATS, types: ['map', 'map'], renderItemInput: renderStatSlot })
    await user.click(screen.getByTestId('array-edit-input-0'))
    expect(lastValue(onChange)).toEqual([{ stat: 'sum', field: 'bytes' }, { stat: 'sum', field: 'x' }])
    expect(lastTypes(onChange)).toEqual(['map', 'map'])
  })

  it('draws an {x} item through the expression slot and a null item as the chip, not the item input', () => {
    renderEditor({
      value: ['stat_entry', null, { stat: 'count' }],
      types: ['string', 'map', 'map'],
      renderItemInput: renderStatSlot,
      expression: true,
      expressionIndices: [0],
    })
    expect(screen.getByTestId('array-expr-value-0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Item 1 (null)' })).toBeInTheDocument()
    expect(screen.getByTestId('array-edit-input-2')).toHaveAttribute('data-index', '2')
    expect(screen.queryByTestId('array-edit-input-0')).not.toBeInTheDocument()
  })
})

// A text item's expand opens the string editor, a List or Map item's its own list or map editor, an {x} item's its expression editor (FIELD-10, FIELD-1).
describe('ArrayEditBody - expand on a text item', () => {
  it('offers expand on a text, List, Map and {x} item, drawn off on a null one, and none on a number or boolean', () => {
    renderEditor({
      value: ['a', 7, true, [1], { k: 1 }, null, 'n'],
      types: ['string', 'integer', 'boolean', 'array', 'map', 'string', 'string'],
      textEditor: renderTextEditor,
      expression: true,
      expressionIndices: [6],
    })
    for (const index of [0, 3, 4, 6]) {
      expect(screen.getByTestId(`array-expand-${index}`)).toHaveAccessibleName(`Open editor for Item ${index}`)
      expect(screen.getByTestId(`array-expand-${index}`)).toBeEnabled()
    }
    expect(screen.getByTestId('array-expand-5')).toBeDisabled()
    for (const index of [1, 2]) {
      expect(screen.queryByTestId(`array-expand-${index}`)).not.toBeInTheDocument()
    }
  })

  it('offers expand only when the host gives a text editor', () => {
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    expect(screen.getByTestId('array-expand-1')).toBeInTheDocument()
    cleanup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    expect(screen.queryAllByTestId(/^array-expand-/)).toHaveLength(0)
  })

  it("opens the editor on the item's own text", async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'b')
  })

  it('writes the saved text into the item as text and keeps the editor open until Close', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual(['SAVED', 'b'])
    expect(lastTypes(onChange)).toEqual(['string', 'string'])
    expect(screen.getByTestId('text-editor')).toBeInTheDocument()
    await user.click(screen.getByTestId('text-editor-close'))
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })

  it('closes the editor of an item that goes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })

  it('keeps the editor of an item that stays when an earlier item goes, and saves into that item', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-1'))
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'b')
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual(['SAVED'])
  })

  it('keeps the editor of an item that stays when a later item goes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('array-remove-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'a')
  })
})

// An item whose open editor holds unsaved changes asks before it goes.
describe('ArrayEditBody - the removal guard', () => {
  async function openDirtyEditor(user: ReturnType<typeof userEvent.setup>, index: number) {
    await user.click(screen.getByTestId(`array-expand-${index}`))
    await user.click(screen.getByTestId('text-editor-type'))
  }

  it('asks before an item with unsaved editor changes goes, and Keep Editing keeps it', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      value: ['a', 'b'],
      types: ['string', 'string'],
      textEditor: renderTextEditor,
      inParent: true,
    })
    await openDirtyEditor(user, 0)
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('unsaved-keep-editing'))
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('a')
    expect(screen.getByTestId('text-editor')).toBeInTheDocument()
  })

  it('lets the item go on Close', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      value: ['a', 'b'],
      types: ['string', 'string'],
      textEditor: renderTextEditor,
      inParent: true,
    })
    await openDirtyEditor(user, 0)
    await user.click(screen.getByTestId('array-remove-0'))
    await user.click(screen.getByTestId('unsaved-close'))
    expect(lastValue(onChange)).toEqual(['b'])
  })

  it('lets an item go at once while its open editor is clean', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      value: ['a', 'b'],
      types: ['string', 'string'],
      textEditor: renderTextEditor,
      inParent: true,
    })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual(['b'])
  })

  it('lets another item go at once while one item editor holds changes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      value: ['a', 'b'],
      types: ['string', 'string'],
      textEditor: renderTextEditor,
      inParent: true,
    })
    await openDirtyEditor(user, 0)
    await user.click(screen.getByTestId('array-remove-1'))
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual(['a'])
  })
})

// Focus lands where the next keystroke belongs after Add, Remove and Move.
describe('ArrayEditBody - focus after Add, Remove and Move', () => {
  it('moves focus to the item Add appended', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-add-item'))
    expect(screen.getByTestId('array-edit-input-2')).toHaveFocus()
  })

  it('moves focus to the value of the item that took the place of a removed one', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('b')
    expect(screen.getByTestId('array-edit-input-0')).toHaveFocus()
  })

  it('moves focus into the expression editor when the item that took the place is {x}', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], expression: true, expressionIndices: [1] })
    await user.click(screen.getByTestId('array-remove-0'))
    const surface = screen.getByTestId('array-expr-value-0').querySelector<HTMLElement>('.cm-content')
    expect(surface).not.toBeNull()
    expect(surface).toHaveFocus()
  })

  it('moves focus to Add when the last item goes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a'], types: ['string'] })
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.getByTestId('array-add-item')).toHaveFocus()
  })

  it("keeps focus on the same arrow at the item's new position", async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b', 'c'], types: ['string', 'string', 'string'] })
    await user.click(screen.getByTestId('array-move-down-0'))
    expect(screen.getByTestId('array-move-down-1')).toHaveFocus()
  })

  it('moves focus to the other arrow when the clicked one turns disabled', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-move-down-0'))
    expect(screen.getByTestId('array-move-down-1')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('array-move-up-1')).toHaveFocus()
  })

  it('reorders nothing from an arrow that is turned off', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['a', 'b'], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-move-up-0'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

// Stands in for the host's {x} editor: shows the open state it gets and reports Ctrl+E and Close.
function OpenableExpressionSlot({ value, testId, ariaLabel, editorOpen, onEditorOpenChange }: MapExpressionEditorProps) {
  return (
    <div data-testid={testId} data-editor-open={String(editorOpen)}>
      <input aria-label={ariaLabel} value={value} readOnly />
      <button type="button" data-testid={`${testId}-ctrl-e`} onClick={() => onEditorOpenChange?.(true)}>
        open
      </button>
      <button type="button" data-testid={`${testId}-close`} onClick={() => onEditorOpenChange?.(false)}>
        close
      </button>
    </div>
  )
}

function renderOpenable({
  textEditor,
  renderItemInput,
}: { textEditor?: EditorOptions['textEditor']; renderItemInput?: EditorOptions['renderItemInput'] } = {}) {
  render(
    <ArrayEditBody
      value={['a', 'base_host', 'other_host']}
      types={['string', 'string', 'string']}
      onChange={vi.fn()}
      onValidChange={vi.fn()}
      expressionEditor={OpenableExpressionSlot}
      expressionIndices={new Set([1, 2])}
      textEditor={textEditor}
      renderItemInput={renderItemInput}
    />,
  )
}

describe('ArrayEditBody - expand on an {x} item (FIELD-1)', () => {
  it("opens that item's expression editor, not the text editor", async () => {
    const user = userEvent.setup()
    renderOpenable({ textEditor: renderTextEditor })
    expect(screen.getByTestId('array-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByTestId('array-expr-value-1')).toHaveAttribute('data-editor-open', 'true')
    expect(screen.getByTestId('array-expr-value-2')).toHaveAttribute('data-editor-open', 'false')
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })

  it('follows the editor when it closes, and when it opens itself (Ctrl+E)', async () => {
    const user = userEvent.setup()
    renderOpenable({ textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-1'))
    await user.click(screen.getByTestId('array-expr-value-1-close'))
    expect(screen.getByTestId('array-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
    await user.click(screen.getByTestId('array-expr-value-2-ctrl-e'))
    expect(screen.getByTestId('array-expr-value-2')).toHaveAttribute('data-editor-open', 'true')
    expect(screen.getByTestId('array-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
  })

  it('offers expand on an {x} item of a list with a host row input, and none on its literal items', () => {
    renderOpenable({ renderItemInput: renderStatSlot })
    expect(screen.getByTestId('array-expand-1')).toHaveAttribute('aria-label', 'Open editor for Item 1')
    expect(screen.queryByTestId('array-expand-0')).not.toBeInTheDocument()
  })
})

// One row box for every item, the ∅ inside it at its right end (FIELD-1, FIELD-13).
describe('ArrayEditBody - one row box', () => {
  const boxOf = (element: HTMLElement) => element.closest('[data-slot="input-group"]') as HTMLElement

  it('draws a literal item and a null item in the one 32px box, the ∅ inside at the right end', () => {
    renderEditor({ value: ['a', null], types: ['string', 'integer'] })
    const literal = screen.getByTestId('array-edit-input-0')
    const nullButton = screen.getByTestId('array-edit-input-0-null')
    expect(boxOf(literal)).toHaveClass('h-8')
    expect(boxOf(nullButton)).toBe(boxOf(literal))
    expect(nullButton.closest('[data-slot="input-group-addon"]')).toHaveAttribute('data-align', 'inline-end')
    expect(boxOf(screen.getByTestId('array-edit-null-1'))).toHaveClass('h-8')
  })

  it('shows a null item as gray italic null with the ∅ pressed inside its box (VMGR-93)', () => {
    renderEditor({ value: [null], types: ['integer'] })
    const chip = screen.getByRole('button', { name: 'Item 0 (null)' })
    expect(chip).toHaveClass('italic')
    const nullButton = screen.getByTestId('array-edit-input-0-null')
    expect(nullButton).toHaveAttribute('aria-pressed', 'true')
    expect(nullButton).toHaveAccessibleName('Set Item 0 to null')
    expect(boxOf(nullButton)).toBe(boxOf(chip))
  })

  it('leaves null with the type default from the pressed ∅ and keeps the focus there', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [null], types: ['integer'] })
    await user.click(screen.getByTestId('array-edit-input-0-null'))
    expect(lastValue(onChange)).toEqual(['0'])
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('0')
    expect(screen.getByTestId('array-edit-input-0-null')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('array-edit-input-0-null')).toHaveFocus()
  })

  it('puts a host row input in the box with the ∅ beside it inside', () => {
    renderEditor({ value: [{ stat: 'count' }], types: ['map'], renderItemInput: renderStatSlot })
    const input = screen.getByTestId('array-edit-input-0')
    expect(boxOf(input)).toHaveClass('h-8')
    expect(boxOf(screen.getByTestId('array-edit-input-0-null'))).toBe(boxOf(input))
  })

  it('gives expand its own track after Value', () => {
    renderEditor({ value: ['a'], types: ['string'], expression: true, textEditor: renderTextEditor })
    const row = screen.getByTestId('array-edit-input-0').closest('.grid') as HTMLElement
    expect(row.style.gridTemplateColumns).toBe('1.5rem minmax(0,1fr) 1.75rem 5rem 2rem 3rem 1.75rem')
    const header = screen.getByText('Value').closest('.grid') as HTMLElement
    expect(header.style.gridTemplateColumns).toBe(row.style.gridTemplateColumns)
    expect(screen.getByTestId('array-expand-0').closest('[data-slot="input-group"]')).toBeNull()
  })

  it('drops the tracks a list has no use for and keeps Type for a fixed item type', () => {
    renderEditor({ value: ['a'], types: ['string'], stringValuesOnly: true })
    const row = screen.getByTestId('array-edit-input-0').closest('.grid') as HTMLElement
    expect(row.style.gridTemplateColumns).toBe('1.5rem minmax(0,1fr) max-content 3rem 1.75rem')
    cleanup()
    renderEditor({ value: [{ stat: 'count' }], types: ['map'], renderItemInput: renderStatSlot })
    const statRow = screen.getByTestId('array-edit-input-0').closest('.grid') as HTMLElement
    expect(statRow.style.gridTemplateColumns).toBe('1.5rem minmax(0,1fr) 3rem 1.75rem')
  })
})

describe('ArrayEditBody - the open text editor follows its item', () => {
  it('keeps one editor when the open item asks again, and moves to another item on its expand', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('array-expand-0'))
    expect(screen.getAllByTestId('text-editor')).toHaveLength(1)
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'b')
  })

  it('moves the open editor with its item, and with the item that takes its place', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['a', 'b'], types: ['string', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('array-move-down-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual(['b', 'SAVED'])
    await user.click(screen.getByTestId('array-move-down-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual(['SAVED', 'b'])
  })
})

describe('ArrayEditBody - edges of the {x} and null items', () => {
  it('shows a null {x} item as an empty expression', () => {
    renderEditor({ value: [null], types: ['string'], expression: true, expressionIndices: [0] })
    expect(within(screen.getByTestId('array-expr-value-0')).getByRole('textbox')).toHaveValue('')
  })

  it('holds no {x} item when the host gives the slot but no item set', () => {
    render(
      <ArrayEditBody
        value={['a']}
        types={['string']}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        expressionEditor={ExpressionSlot}
      />,
    )
    expect(screen.getByTestId('array-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('a')
  })

  it("gives a null item the host's new item from its chip", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArrayEditBody
        value={[null]}
        types={['map']}
        onChange={onChange}
        onValidChange={vi.fn()}
        renderItemInput={renderStatSlot}
        newItem={() => ({ stat: 'count' })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Item 0 (null)' }))
    expect(lastValue(onChange)).toEqual([{ stat: 'count' }])
  })

  it('moves focus to the null chip of the item that took the place of a removed one', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', null], types: ['string', 'string'] })
    await user.click(screen.getByTestId('array-remove-0'))
    expect(screen.getByRole('button', { name: 'Item 0 (null)' })).toHaveFocus()
  })
})

// A List or Map item opens its own list or map editor from expand (REQ-3.1.3.19).
// A List or Map item reads as one spaced JSON line, the form a nested Save writes (FIELD-6).
describe('ArrayEditBody - a stored List or Map item', () => {
  it('shows a List or Map held as a structure as one spaced JSON line', () => {
    renderBody({ value: [{ a: 'x', n: [1, 2] }, [true, { k: 1 }]], types: ['map', 'array'] })
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('{"a": "x", "n": [1, 2]}')
    expect(screen.getByTestId('array-edit-input-1')).toHaveValue('[true, {"k": 1}]')
  })
})

describe('ArrayEditBody - expand on a List or Map item', () => {
  it("opens the entry editor on the List item's JSON text, typed as a list", async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', '[1, 2.0]'], types: ['string', 'array'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', '[1, 2.0]')
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'array')
  })

  it('opens a Map item typed as a map, and a text item typed as text', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['a', { k: 1 }], types: ['string', 'map'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', '{"k": 1}')
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'map')
    await user.click(screen.getByTestId('text-editor-close'))
    await user.click(screen.getByTestId('array-expand-0'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'string')
  })

  it('writes what the editor saves into that List item and keeps it a list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['[1]', 'b'], types: ['array', 'string'], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-expand-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual(['SAVED', 'b'])
    expect(lastTypes(onChange)).toEqual(['array', 'string'])
  })

  it('keeps the type the editor opened with when the item type changes under it', async () => {
    const user = userEvent.setup()
    renderEditor({ value: [], types: [], textEditor: renderTextEditor })
    await user.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '[1]' } })
    await flushTypePill()
    await user.click(screen.getByTestId('array-expand-0'))
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: 'x' } })
    await flushTypePill()
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'array')
  })

  it('draws the expand off for a List item whose text is not a list', () => {
    renderEditor({ value: ['[1,', '{"a": 1}'], types: ['array', 'array'], textEditor: renderTextEditor })
    expect(screen.getByTestId('array-expand-0')).toBeDisabled()
    expect(screen.getByTestId('array-expand-1')).toBeDisabled()
  })

  it('offers no expand on a List item of a list with a host row input', () => {
    renderEditor({ value: [[1]], types: ['array'], textEditor: renderTextEditor, renderItemInput: renderStatSlot })
    expect(screen.queryByTestId('array-expand-0')).not.toBeInTheDocument()
  })
})

// A null entry keeps its expand, drawn off, so the column never gaps.
describe('ArrayEditBody - expand on a null item', () => {
  it.each([
    ['text', 'string'],
    ['List', 'array'],
    ['Map', 'map'],
  ] as const)('keeps a null %s item expand, named, disabled and drawn off', async (_name, type) => {
    const user = userEvent.setup()
    renderEditor({ value: [null], types: [type], textEditor: renderTextEditor })
    const expand = screen.getByTestId('array-expand-0')
    expect(expand).toHaveAccessibleName('Open editor for Item 0')
    expect(expand).toBeDisabled()
    expect(expand).toHaveClass('opacity-50', 'cursor-not-allowed')
    await user.click(expand)
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })

  it('turns the expand on once the null item takes a value', async () => {
    const user = userEvent.setup()
    renderEditor({ value: [null], types: ['string'], textEditor: renderTextEditor })
    await user.click(screen.getByRole('button', { name: 'Item 0 (null)' }))
    expect(screen.getByTestId('array-expand-0')).toBeEnabled()
  })
})

// At most 10 nested levels, the one opened from the field counted as 1.
describe('ArrayEditBody - the nested level limit', () => {
  it('draws the List and Map expand off at level 10 with the reason, and keeps the text expand', async () => {
    const user = userEvent.setup()
    renderEditor({
      value: ['[1]', '{"a": 1}', 'text'],
      types: ['array', 'map', 'string'],
      textEditor: renderTextEditor,
      level: 10,
    })
    for (const index of [0, 1]) {
      const expand = screen.getByTestId(`array-expand-${index}`)
      expect(expand).toBeDisabled()
      expect(expand).toHaveClass('opacity-50', 'cursor-not-allowed')
    }
    await user.hover(screen.getByTestId('array-expand-0').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Up to 10 nested levels$/)
    expect(screen.getByTestId('array-expand-2')).toBeEnabled()
  })

  it('keeps the List expand on at level 9', () => {
    renderEditor({ value: ['[1]'], types: ['array'], textEditor: renderTextEditor, level: 9 })
    expect(screen.getByTestId('array-expand-0')).toBeEnabled()
  })
})

// A nested level is as editable as level 1; only a fixed item type shows read-only (REQ-3.1.3.19).
describe('ArrayEditBody - a nested level', () => {
  it('shows each item type in the editable picker, as level 1 does', () => {
    renderEditor({ value: ['5', '2.0', true], types: ['string', 'float', 'boolean'], level: 2 })
    expect(screen.getByRole('combobox', { name: 'Item 0 type' })).toHaveTextContent(/^string$/)
    expect(screen.getByRole('combobox', { name: 'Item 1 type' })).toHaveTextContent(/^float$/)
    expect(screen.getByRole('combobox', { name: 'Item 2 type' })).toHaveTextContent(/^boolean$/)
  })

  it('offers all six types at a nested level, and a pick there leaves the new default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [''], types: ['string'], level: 3 })
    await user.click(screen.getByRole('combobox', { name: 'Item 0 type' }))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'string',
      'integer',
      'float',
      'boolean',
      'array',
      'map',
    ])
    await user.click(screen.getByRole('option', { name: 'map' }))
    expect(lastValue(onChange)).toEqual(['{}'])
    expect(lastTypes(onChange)).toEqual(['map'])
  })

  it.each([
    ['a text-only list', { stringValuesOnly: true }, 'string'],
    ['an Integer list', {}, 'integer'],
  ] as const)('keeps the read-only pill of %s at every level', (_name, options, type) => {
    for (const level of [1, 2, 10]) {
      cleanup()
      render(
        <ArrayEditBody
          value={['1']}
          types={[type]}
          onChange={vi.fn()}
          onValidChange={vi.fn()}
          itemType={type === 'integer' ? 'integer' : undefined}
          level={level}
          {...options}
        />,
      )
      expect(screen.getByTestId('array-type-0')).toHaveTextContent(new RegExp(`^${type}$`))
      expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    }
  })

  it('keeps an item type while its text changes, and types a new item by what is typed', async () => {
    const { onChange } = renderEditor({ value: ['2.5'], types: ['float'], level: 2 })
    fireEvent.change(screen.getByTestId('array-edit-input-0'), { target: { value: '3' } })
    expect(lastTypes(onChange)).toEqual(['float'])
    fireEvent.click(screen.getByTestId('array-add-item'))
    fireEvent.change(screen.getByTestId('array-edit-input-1'), { target: { value: '[1]' } })
    await flushTypePill()
    expect(lastTypes(onChange)).toEqual(['float', 'array'])
    expect(screen.getByTestId('array-type-1')).toHaveTextContent(/^array$/)
  })
})

// A read-only sheet opens an entry's editor read-only: the expand stays a link in its frozen form.
describe('ArrayEditBody - in a read-only sheet', () => {
  it('opens a List item editor from the expand, every other control frozen', () => {
    renderEditor({ value: ['a', '[1]'], types: ['string', 'array'], textEditor: renderTextEditor, frozen: true })
    expect(screen.getByTestId('array-edit-input-0')).toBeDisabled()
    const expand = screen.getByTestId('array-expand-1')
    expect(expand).toHaveAccessibleName('Open editor for Item 1')
    expect(expand.tagName).toBe('A')
    // user-event treats a disabled fieldset's links as disabled; a browser does not.
    fireEvent.click(expand)
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'array')
  })

  it('keeps a null item expand off in a read-only sheet', () => {
    renderEditor({ value: [null], types: ['array'], textEditor: renderTextEditor, frozen: true })
    expect(screen.getByTestId('array-expand-0')).toBeDisabled()
  })
})

const dialogButtons = () =>
  within(screen.getByRole('alertdialog')).getAllByRole('button').map((button) => button.textContent)

async function pickItemType(user: ReturnType<typeof userEvent.setup>, index: number, type: string) {
  await user.click(screen.getByTestId(`array-type-${index}`))
  await user.click(await screen.findByRole('option', { name: type }))
}

// A type change leaves the new type's default, asking first when that clears a value (FIELD-7).
describe('ArrayEditBody - a type change', () => {
  it.each([
    ['integer', '0'],
    ['float', '0'],
    ['boolean', false],
    ['array', '[]'],
    ['map', '{}'],
  ] as const)("gives an item holding its type's default the %s default at once", async (type, empty) => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [''], types: ['string'] })
    await pickItemType(user, 0, type)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual([empty])
    expect(lastTypes(onChange)).toEqual([type])
  })

  it('opens a List item from expand right after its type changes', async () => {
    const user = userEvent.setup()
    renderEditor({ value: [''], types: ['string'], textEditor: renderTextEditor })
    await pickItemType(user, 0, 'array')
    expect(screen.getByTestId('array-expand-0')).toBeEnabled()
  })

  it("gives a null item the new type's default at once", async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [null], types: ['string'] })
    await pickItemType(user, 0, 'integer')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual(['0'])
  })

  it('asks before a type change clears a value, and Change type leaves the new default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['abc', 'b'], types: ['string', 'string'] })
    await pickItemType(user, 0, 'integer')
    const dialog = screen.getByRole('alertdialog', { name: 'Change item type?' })
    expect(dialog).toHaveTextContent('Changing type to integer will clear 1 existing string value. This cannot be undone.')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Change type' }))
    expect(lastValue(onChange)).toEqual(['0', 'b'])
    expect(lastTypes(onChange)).toEqual(['integer', 'string'])
  })

  it('counts the entries a List item clears', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['[1, 2]'], types: ['array'] })
    await pickItemType(user, 0, 'string')
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Changing type to string will clear 2 existing array entries. This cannot be undone.',
    )
  })

  it('keeps the type and the value on Cancel', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: ['abc'], types: ['string'] })
    await pickItemType(user, 0, 'integer')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('array-type-0')).toHaveTextContent('string')
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('abc')
  })
})

// {x} on an item asks the Block field's switch warning before a value is lost (FIELD-7).
describe('ArrayEditBody - switching an item into and out of {x}', () => {
  const slotText = (index: number) => within(screen.getByTestId(`array-expr-value-${index}`)).getByRole('textbox')

  it('switches an item with no value into an empty {x} at once', async () => {
    const user = userEvent.setup()
    const { onExpressionIndicesChange } = renderEditor({ value: ['', null], types: ['string', 'integer'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(screen.getByTestId('array-expr-toggle-1'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onExpressionIndicesChange).toHaveBeenLastCalledWith([0, 1])
    expect(slotText(0)).toHaveValue('')
    expect(slotText(1)).toHaveValue('')
  })

  it('asks before a text item holding a value goes into {x}, with Cancel, Clear and Clear & Empty', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['abc'], types: ['string'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to an expression?' })).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
  })

  it('keeps the value and the plain mode on Cancel', async () => {
    const user = userEvent.setup()
    const { onChange, onExpressionIndicesChange } = renderEditor({ value: ['abc'], types: ['string'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(onExpressionIndicesChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('abc')
  })

  it('leaves an empty {x} on Clear', async () => {
    const user = userEvent.setup()
    const { onChange, onExpressionIndicesChange } = renderEditor({ value: ['abc'], types: ['string'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear' }))
    expect(lastValue(onChange)).toEqual([''])
    expect(onExpressionIndicesChange).toHaveBeenLastCalledWith([0])
    expect(slotText(0)).toHaveValue('')
  })

  it.each([
    ['text', 'string', 'abc', "''"],
    ['List', 'array', '[1]', '[]'],
    ['Map', 'map', '{"a": 1}', '{}'],
  ] as const)('puts the empty %s in as an expression on Clear & Empty', async (_name, type, held, empty) => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [held], types: [type], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear & Empty' }))
    expect(lastValue(onChange)).toEqual([empty])
    expect(slotText(0)).toHaveValue(empty)
  })

  it('offers Clear only for a number item', async () => {
    const user = userEvent.setup()
    renderEditor({ value: ['5'], types: ['integer'], expression: true })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
  })

  it('asks before a written expression goes back to a plain value, and Clear leaves the type default', async () => {
    const user = userEvent.setup()
    const { onChange, onExpressionIndicesChange } = renderEditor({
      value: ['n + 1'],
      types: ['integer'],
      expression: true,
      expressionIndices: [0],
    })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to a plain value?' })).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear' }))
    expect(lastValue(onChange)).toEqual(['0'])
    expect(onExpressionIndicesChange).toHaveBeenLastCalledWith([])
    expect(screen.getByTestId('array-edit-input-0')).toHaveValue('0')
  })

  it('switches an empty expression back to the type default at once', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ value: [''], types: ['boolean'], expression: true, expressionIndices: [0] })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual([false])
  })

  it("gives an item leaving {x} the host's new item", async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      value: [''],
      types: ['map'],
      expression: true,
      expressionIndices: [0],
      renderItemInput: renderStatSlot,
      newItem: () => ({ stat: 'count' }),
    })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(lastValue(onChange)).toEqual([{ stat: 'count' }])
  })

  it("switches an item holding the host's new item into {x} at once", async () => {
    const user = userEvent.setup()
    renderEditor({
      value: [{ stat: 'count' }],
      types: ['map'],
      expression: true,
      renderItemInput: renderStatSlot,
      newItem: () => ({ stat: 'count' }),
    })
    await user.click(screen.getByTestId('array-expr-toggle-0'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(slotText(0)).toHaveValue('')
  })
})

// A fixed type's column is as wide as its read-only pill, so {x} sits one gap after it.
describe('ArrayEditBody - the Type track of a fixed item type', () => {
  const rowOf = (element: HTMLElement) => element.closest('.grid') as HTMLElement

  it('sizes the Type track to the pill in the header and every row', () => {
    renderEditor({
      value: ['a', 'n'],
      types: ['string', 'string'],
      stringValuesOnly: true,
      expression: true,
      expressionIndices: [1],
      textEditor: renderTextEditor,
    })
    const tracks = '1.5rem minmax(0,1fr) 1.75rem max-content 2rem 3rem 1.75rem'
    expect(rowOf(screen.getByTestId('array-edit-input-0')).style.gridTemplateColumns).toBe(tracks)
    expect(rowOf(screen.getByText('Value')).style.gridTemplateColumns).toBe(tracks)
  })

  it('keeps an unseen pill in the header and in an {x} row, so every Type cell is one width', () => {
    renderEditor({ value: ['a', 'n'], types: ['string', 'string'], stringValuesOnly: true, expression: true, expressionIndices: [1] })
    const header = rowOf(screen.getByText('Value'))
    const sizer = within(header).getByText('string').closest('[aria-hidden="true"]')
    expect(sizer).toHaveClass('invisible')
    const exprRow = rowOf(screen.getByTestId('array-expr-value-1'))
    expect(within(exprRow).getByText('string').closest('[aria-hidden="true"]')).toHaveClass('invisible')
    expect(screen.getByTestId('array-type-0')).toHaveTextContent(/^string$/)
  })

  it('keeps the picker track for a list whose items each pick a type', () => {
    renderEditor({ value: ['a'], types: ['string'] })
    expect(rowOf(screen.getByTestId('array-edit-input-0')).style.gridTemplateColumns).toBe(
      '1.5rem minmax(0,1fr) 5rem 3rem 1.75rem',
    )
  })
})
