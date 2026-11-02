/**
 * Tests for MapEditBody - the controlled map edit body. Each entry is key + a
 * per-value type pill + value: the value's type is inferred from its text and
 * sticks once picked by hand; numbers are kept as exact text (precision);
 * duplicate keys / an invalid value flag (not block). Every value takes the null
 * button, hidden while the entry is {x}, and a text value opens the host's
 * string editor from expand (FIELD-10, FIELD-13).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.19: Declared element types for array and map values
 * REQ-3.1.3.20: Null is the only empty value
 */

import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MapEditBody, type MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import { inferRuntimeType, type ValueType } from '@/lib/variable-validation'

interface RenderOptions {
  value?: Record<string, unknown>
  types?: Record<string, ValueType>
  onChange?: (value: Record<string, unknown>, types: Record<string, ValueType>) => void
  onValidChange?: (valid: boolean) => void
  stringValuesOnly?: boolean
}

function inferTypes(value: Record<string, unknown>): Record<string, ValueType> {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferRuntimeType(v)]))
}

function renderBody({
  value = { a: 1 },
  types,
  onChange = vi.fn(),
  onValidChange = vi.fn(),
  stringValuesOnly,
}: RenderOptions = {}) {
  render(
    <MapEditBody
      value={value}
      types={types ?? inferTypes(value)}
      onChange={onChange}
      onValidChange={onValidChange}
      stringValuesOnly={stringValuesOnly}
    />,
  )
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

describe('MapEditBody - outlined grid + header (VMGR-82)', () => {
  it('renders a quiet header row labeling Key, Value and Type', () => {
    renderBody({ value: { a: 1 } })
    expect(screen.getByText('Key')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
  })

  it('places the value input before the type pill (value-first)', () => {
    renderBody({ value: { a: 1 } })
    const value = screen.getByTestId('map-edit-value-0')
    const pill = screen.getByTestId('map-type-0')
    expect(value.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('MapEditBody - rows + type pill', () => {
  it('renders key / type pill / value per entry', () => {
    renderBody({ value: { host: 'localhost', port: 8000 } })
    expect(screen.getByTestId('map-edit-key-0')).toHaveValue('host')
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('localhost')
    expect(screen.getByTestId('map-type-0')).toHaveTextContent('string')
    expect(screen.getByTestId('map-edit-key-1')).toHaveValue('port')
    expect(screen.getByTestId('map-type-1')).toHaveTextContent('integer')
  })
})

describe('MapEditBody - seed + validation forwarding', () => {
  it('infers a value type from its runtime shape when none is supplied', () => {
    // types omits 'a', so the seed falls back to inferRuntimeType(1) = integer.
    renderBody({ value: { a: 1 }, types: {} })
    expect(screen.getByTestId('map-type-0')).toHaveTextContent('integer')
  })

  it('forwards the per-entry validation messages to onValidation', () => {
    const onValidation = vi.fn()
    render(
      <MapEditBody
        value={{ a: 1 }}
        types={{ a: 'integer' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        onValidation={onValidation}
      />,
    )
    // Emptying the key while a value is present emits a key-error message.
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: '' } })
    expect(onValidation).toHaveBeenCalledWith([expect.any(String)])
  })

  it('changes one entry type and leaves the other entries untouched', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { a: 1, b: 'x' } })
    await user.click(screen.getByTestId('map-type-0'))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(lastValue(onChange)).toEqual({ a: '', b: 'x' })
    expect(lastTypes(onChange)).toEqual({ a: 'string', b: 'string' })
  })
})

describe('MapEditBody - inference + precision', () => {
  it('re-emits the value as exact text + the inferred type', () => {
    const { onChange } = renderBody({ value: { a: 1 } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), {
      target: { value: '1234567890123456789' },
    })
    expect(lastValue(onChange)).toEqual({ a: '1234567890123456789' })
    expect(lastTypes(onChange)).toEqual({ a: 'integer' })
  })

  it('drops a key that takes an integer value past 19 digits or out of the number rule (REQ-3.1.3.14)', () => {
    const { onChange } = renderBody({ value: { a: 1 } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: '12345678901234567890' } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: '1e5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('1')
    expect(screen.getByTestId('map-edit-value-0')).toHaveAttribute('inputmode', 'numeric')
  })

  it('leaves a text value free of the number rule', () => {
    const { onChange } = renderBody({ value: { a: 'x' } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: '1e5' } })
    expect(lastValue(onChange)).toEqual({ a: '1e5' })
    expect(screen.getByTestId('map-edit-value-0')).not.toHaveAttribute('inputmode')
  })

  it('re-keys the entry on a key change', () => {
    const { onChange } = renderBody({ value: { a: 'x' } })
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'b' } })
    expect(lastValue(onChange)).toEqual({ b: 'x' })
  })
})

describe('MapEditBody - manual override', () => {
  it('sticks a hand-picked value type across later edits', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { a: 1 } })
    await user.click(screen.getByTestId('map-type-0'))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    await user.click(screen.getByRole('button', { name: 'Change type' }))
    expect(lastTypes(onChange)).toEqual({ a: 'string' })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: '42' } })
    expect(lastValue(onChange)).toEqual({ a: '42' })
    expect(lastTypes(onChange)).toEqual({ a: 'string' })
  })
})

describe('MapEditBody - add / delete / duplicate', () => {
  it('includes a newly typed entry; its digits stay a string', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { a: 1 } })
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), { target: { value: 'c' } })
    fireEvent.change(screen.getByTestId('map-edit-value-1'), { target: { value: '3' } })
    await flushTypePill()
    expect(lastValue(onChange)).toEqual({ a: '1', c: '3' })
    expect(lastTypes(onChange)).toEqual({ a: 'integer', c: 'string' })
  })

  it('removes the targeted entry', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { a: 1, b: 2 } })
    await user.click(screen.getByTestId('map-remove-0'))
    expect(lastValue(onChange)).toEqual({ b: '2' })
  })

  it('outlines the key cell when the key is missing but a value is present', async () => {
    const user = userEvent.setup()
    renderBody({ value: { a: 1 } })
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-value-1'), { target: { value: '5' } })
    await flushTypePill()
    expect(screen.getByTestId('map-edit-key-1')).toHaveAttribute('aria-invalid', 'true')
  })

  it('outlines both key cells when keys duplicate', async () => {
    const user = userEvent.setup()
    renderBody({ value: { a: 1 } })
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), { target: { value: 'a' } })
    expect(screen.getByTestId('map-edit-key-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('map-edit-key-1')).toHaveAttribute('aria-invalid', 'true')
  })

  it('flags duplicate keys with onValidChange(false), back to true once unique', async () => {
    const user = userEvent.setup()
    const { onValidChange } = renderBody({ value: { a: 1 } })
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), { target: { value: 'a' } })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByTestId('map-edit-key-1'), { target: { value: 'b' } })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })
})

describe('MapEditBody - seeds a stored nested value by its structure', () => {
  it('types a value held as verbatim JSON text as a map when the type is unseeded', () => {
    // types prop has no entry for the key, so seedEntries recovers the type from
    // the stored value: a JSON-object text string is a map, not a string.
    render(
      <MapEditBody
        value={{ cfg: '{"a":1}' }}
        types={{}}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('map-type-0')).toHaveTextContent('map')
  })
})

// ============================================================================
// stringValuesOnly (HTTP header / query-param maps stay string->string)
//
// A parameter map (e.g. HTTP headers) must keep every value a string: a header
// value of 8080 has to reach the request as the string "8080", never the number
// 8080. With stringValuesOnly every entry shows a read-only string pill and is
// forced to the string type so serialization never coerces a
// numeric-/boolean-looking value to a number / boolean.
// ============================================================================

describe('MapEditBody - stringValuesOnly', () => {
  it('shows the Type column with a read-only string pill on every entry', () => {
    renderBody({ value: { host: 'localhost', port: '8080' }, stringValuesOnly: true })
    expect(screen.getByText('Type')).toBeInTheDocument()
    for (const index of [0, 1]) {
      const pill = screen.getByTestId(`map-type-${index}`)
      expect(pill).toHaveTextContent(/^string$/)
      expect(pill).not.toHaveRole('button')
      expect(pill).not.toHaveRole('combobox')
    }
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('keeps a numeric-looking entered value as the string type (not integer)', () => {
    const { onChange } = renderBody({ value: {}, stringValuesOnly: true })
    fireEvent.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'port' } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: '8080' } })
    expect(lastValue(onChange)).toEqual({ port: '8080' })
    expect(lastTypes(onChange)).toEqual({ port: 'string' })
  })

  it('keeps a boolean-looking entered value as the string "true" (not the boolean)', () => {
    const { onChange } = renderBody({ value: {}, stringValuesOnly: true })
    fireEvent.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'flag' } })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: 'true' } })
    expect(lastValue(onChange)).toEqual({ flag: 'true' })
    expect(lastTypes(onChange)).toEqual({ flag: 'string' })
  })

  it('seeds a numeric-looking stored value as a string (a read-only string pill)', () => {
    renderBody({ value: { port: '8080' }, types: { port: 'integer' }, stringValuesOnly: true })
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('8080')
    expect(screen.getByTestId('map-type-0')).toHaveTextContent(/^string$/)
  })

  it('still keeps the Type pill when stringValuesOnly is off (default)', () => {
    renderBody({ value: { port: 8080 } })
    expect(screen.getByTestId('map-type-0')).toBeInTheDocument()
  })
})

describe('MapEditBody - revealing an appended row', () => {
  function getGrid(): HTMLElement {
    const body = screen.getByTestId('map-edit-body')
    return body.querySelector('.overflow-auto') as HTMLElement
  }

  it('scrolls the grid down to the entry just added', async () => {
    const user = userEvent.setup()
    renderBody({ value: { a: 1 } })
    const grid = getGrid()
    // jsdom lays nothing out, so the overflow is described explicitly.
    Object.defineProperty(grid, 'scrollHeight', { value: 400, configurable: true })

    await user.click(screen.getByTestId('map-add-entry'))

    expect(grid.scrollTop).toBe(400)
  })

  it('leaves a list that does not overflow where it is', async () => {
    const user = userEvent.setup()
    renderBody({ value: { a: 1 } })
    const grid = getGrid()

    await user.click(screen.getByTestId('map-add-entry'))

    expect(grid.scrollTop).toBe(0)
  })

  it('does not scroll when an entry is merely edited', async () => {
    const user = userEvent.setup()
    renderBody({ value: { a: 1 } })
    const grid = getGrid()
    Object.defineProperty(grid, 'scrollHeight', { value: 400, configurable: true })

    await user.type(screen.getByTestId('map-edit-key-0'), 'b')

    expect(grid.scrollTop).toBe(0)
  })
})

// A stored null map value stays null until the user enters a value (REQ-3.1.3.19, VMGR-93).
describe('MapEditBody - a null map value', () => {
  const nullChip = (key: string) => screen.getByRole('button', { name: `${key} (null)` })

  it('shows a stored null value as the null chip named for its key', () => {
    renderBody({ value: { host: 'db', port: null }, types: { host: 'string', port: 'integer' } })
    expect(nullChip('port')).toHaveTextContent(/^null$/)
    expect(screen.queryByRole('textbox', { name: 'Entry 1 value' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Entry 1 key' })).toHaveValue('port')
    expect(screen.getByTestId('map-type-1')).toHaveTextContent('integer')
  })

  it('explains the chip on keyboard focus', async () => {
    renderBody({ value: { port: null }, types: { port: 'integer' } })
    act(() => nullChip('port').focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it('reports no problem on mount for a null value of any type', () => {
    const { onValidChange } = renderBody({
      value: { s: null, i: null, f: null, b: null, a: null, m: null },
      types: { s: 'string', i: 'integer', f: 'float', b: 'boolean', a: 'array', m: 'map' },
    })
    expect(onValidChange).not.toHaveBeenCalledWith(false)
  })

  it('keeps an untouched null value null, and valid, when another entry is edited', () => {
    const { onChange, onValidChange } = renderBody({
      value: { host: 'db', port: null },
      types: { host: 'string', port: 'integer' },
    })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), { target: { value: 'db2' } })
    expect(lastValue(onChange)).toEqual({ host: 'db2', port: null })
    expect(lastTypes(onChange)).toEqual({ host: 'string', port: 'integer' })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps the value null when its key is renamed, and the chip follows the key', () => {
    const { onChange } = renderBody({ value: { port: null }, types: { port: 'integer' } })
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'db_port' } })
    expect(lastValue(onChange)).toEqual({ db_port: null })
    expect(nullChip('db_port')).toBeInTheDocument()
  })

  it.each([
    ['string', '', ''],
    ['integer', '0', '0'],
    ['float', '0', '0'],
    ['boolean', false, 'false'],
    ['array', '[]', '[]'],
    ['map', '{}', '{}'],
  ] as const)('gives a null %s value its type default when the chip is clicked', async (type, stored, text) => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { v: null }, types: { v: type } })
    await user.click(nullChip('v'))
    expect(lastValue(onChange)).toEqual({ v: stored })
    expect(lastTypes(onChange)).toEqual({ v: type })
    expect(screen.queryByRole('button', { name: 'v (null)' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Entry 0 value' })).toHaveValue(text)
  })

  it('gives the type default when Enter is pressed on the focused chip', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { port: null }, types: { port: 'integer' } })
    act(() => nullChip('port').focus())
    await user.keyboard('{Enter}')
    expect(lastValue(onChange)).toEqual({ port: '0' })
  })

  it('replaces the default with what the user types after the chip is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: { port: null }, types: { port: 'integer' } })
    await user.click(nullChip('port'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Entry 0 value' }), {
      target: { value: '5432' },
    })
    expect(lastValue(onChange)).toEqual({ port: '5432' })
    expect(lastTypes(onChange)).toEqual({ port: 'integer' })
  })

  it('shows a value holding the text "null" as ordinary text, not the chip', () => {
    renderBody({ value: { note: 'null' }, types: { note: 'string' } })
    expect(screen.getByRole('textbox', { name: 'Entry 0 value' })).toHaveValue('null')
    expect(screen.queryByRole('button', { name: 'note (null)' })).not.toBeInTheDocument()
  })

  it('never throws when given a whole null value', () => {
    render(
      <MapEditBody
        value={null as unknown as Record<string, unknown>}
        types={{}}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('map-edit-body')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^map-edit-key-/)).toHaveLength(0)
  })
})

describe('MapEditBody - typed rows beside expression rows (REQ-3.1.3.19)', () => {
  const expressionEditor = (props: { testId: string; value: string }) => (
    <div data-testid={props.testId}>{props.value}</div>
  )

  it('shows a type pill on a literal row and none on an expression row, generated rows included', () => {
    render(
      <MapEditBody
        value={{ n: '16', app: "'a'" }}
        types={{ n: 'integer', app: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        expressionEditor={expressionEditor}
        expressionKeys={new Set(['app'])}
        generatedRows={[{ key: 'Generated', value: 'x' }]}
      />,
    )
    expect(screen.getByTestId('map-type-0')).toHaveTextContent('integer')
    expect(screen.queryByTestId('map-type-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-expr-toggle-1')).toBeInTheDocument()
    expect(screen.getByTestId('map-generated-key-0')).toHaveValue('Generated')
  })

  it('draws the shared {x} toggle, which shows pressed once clicked', async () => {
    const user = userEvent.setup()
    render(
      <MapEditBody
        value={{ app: '' }}
        types={{ app: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        expressionEditor={expressionEditor}
      />,
    )
    const toggle = screen.getByTestId('map-expr-toggle-0')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^Entry 0 expression mode$/)
    expect(toggle).toHaveAttribute('data-state', 'off')
    await user.click(toggle)
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('data-state', 'on')
    expect(screen.getByTestId('map-expr-value-0')).toBeInTheDocument()
  })
})

/** What the entry editor slot receives while a text, List or Map value is expanded. */
interface TextEditorSlotProps {
  label: string
  type?: string
  value: string
  onSave: (text: string) => void
  onClose: () => void
}

function ExpressionSlot({ value, onChange, ariaLabel, testId }: MapExpressionEditorProps) {
  return (
    <input data-testid={testId} aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}

function TextEditorStub({ type, value, onSave, onClose }: Readonly<TextEditorSlotProps>) {
  const [saved, setSaved] = useState(false)
  return (
    <div data-testid="text-editor" data-value={value} data-type={type} data-saved={String(saved)}>
      <button
        type="button"
        data-testid="text-editor-save"
        onClick={() => {
          setSaved(true)
          onSave('SAVED')
        }}
      >
        Save
      </button>
      <button type="button" data-testid="text-editor-close" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

const renderTextEditor = (props: TextEditorSlotProps) => <TextEditorStub {...props} />

interface SlotOptions {
  value: Record<string, unknown>
  types: Record<string, ValueType>
  expressionKeys?: string[]
  textEditor?: (props: TextEditorSlotProps) => ReactNode
  /** The nested level the map sits at. */
  level?: number
  /** Render inside a read-only (frozen) sheet. */
  frozen?: boolean
}

function renderWithSlots({ value, types, expressionKeys, textEditor, level, frozen = false }: SlotOptions) {
  const onChange = vi.fn()
  const onValidChange = vi.fn()
  const body = (
    <MapEditBody
      value={value}
      types={types}
      onChange={onChange}
      onValidChange={onValidChange}
      expressionEditor={expressionKeys ? ExpressionSlot : undefined}
      expressionKeys={expressionKeys ? new Set(expressionKeys) : undefined}
      textEditor={textEditor}
      level={level}
    />
  )
  render(frozen ? <FreezableFieldset disabled>{body}</FreezableFieldset> : body)
  return { onChange, onValidChange }
}

// Null is allowed in every map value, with no locks (FIELD-13).
describe('MapEditBody - the null button on every value', () => {
  it('gives every literal value a null button named by its key, not pressed', () => {
    renderWithSlots({ value: { host: 'db', port: 5432 }, types: { host: 'string', port: 'integer' } })
    const button = screen.getByTestId('map-edit-value-1-null')
    expect(button).toHaveAttribute('aria-label', 'Set port to null')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('map-edit-value-0-null')).toBeInTheDocument()
  })

  it('gives a string-only map value a null button too', () => {
    render(
      <MapEditBody
        value={{ 'X-Trace': 'a' }}
        types={{ 'X-Trace': 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
      />,
    )
    expect(screen.getByTestId('map-edit-value-0-null')).toHaveAttribute('aria-label', 'Set X-Trace to null')
  })

  it('names the null button of an entry with no key yet by its row', () => {
    renderWithSlots({ value: { '': 'a' }, types: { '': 'string' } })
    expect(screen.getByTestId('map-edit-value-0-null')).toHaveAttribute('aria-label', 'Set Entry 0 to null')
  })

  it('sets the value to null and keeps its type', async () => {
    const user = userEvent.setup()
    const { onChange, onValidChange } = renderWithSlots({
      value: { host: 'db', port: 5432 },
      types: { host: 'string', port: 'integer' },
    })
    await user.click(screen.getByTestId('map-edit-value-1-null'))
    expect(lastValue(onChange)).toEqual({ host: 'db', port: null })
    expect(lastTypes(onChange)).toEqual({ host: 'string', port: 'integer' })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'port (null)' })).toBeInTheDocument()
    expect(screen.getByTestId('map-type-1')).toHaveTextContent('integer')
  })

  it('explains the button on keyboard focus', async () => {
    renderWithSlots({ value: { host: 'db' }, types: { host: 'string' } })
    act(() => screen.getByTestId('map-edit-value-0-null').focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Set to null$/)
  })

  it('hides the null button while the entry is {x}', () => {
    renderWithSlots({
      value: { host: 'db', app: 'app_name' },
      types: { host: 'string', app: 'string' },
      expressionKeys: ['app'],
    })
    expect(screen.getByTestId('map-edit-value-0-null')).toBeInTheDocument()
    expect(screen.queryByTestId('map-edit-value-1-null')).not.toBeInTheDocument()
  })

  it('brings the null button back when the entry leaves {x}', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { app: 'app_name' }, types: { app: 'string' }, expressionKeys: ['app'] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('map-edit-value-0-null')).toBeInTheDocument()
  })
})

// A text entry's expand opens the string editor, an {x} entry's its expression editor (FIELD-10, FIELD-1, FIELD-6).
describe('MapEditBody - expand on a text value', () => {
  it('offers expand on a text, List, Map and {x} value, drawn off on a null one, and none on a number or boolean', () => {
    renderWithSlots({
      value: { s: 'a', i: 1, b: true, l: [1], m: { k: 1 }, n: null, e: 'x' },
      types: { s: 'string', i: 'integer', b: 'boolean', l: 'array', m: 'map', n: 'string', e: 'string' },
      expressionKeys: ['e'],
      textEditor: renderTextEditor,
    })
    for (const index of [0, 3, 4, 6]) {
      expect(screen.getByTestId(`map-expand-${index}`)).toHaveAccessibleName(`Open editor for Entry ${index}`)
      expect(screen.getByTestId(`map-expand-${index}`)).toBeEnabled()
    }
    expect(screen.getByTestId('map-expand-5')).toBeDisabled()
    for (const index of [1, 2]) {
      expect(screen.queryByTestId(`map-expand-${index}`)).not.toBeInTheDocument()
    }
  })

  it('offers expand only when the host gives a text editor', () => {
    const { unmount } = render(
      <MapEditBody
        value={{ s: 'a' }}
        types={{ s: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        textEditor={renderTextEditor}
      />,
    )
    expect(screen.getByTestId('map-expand-0')).toBeInTheDocument()
    unmount()
    render(<MapEditBody value={{ s: 'a' }} types={{ s: 'string' }} onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(screen.queryAllByTestId(/^map-expand-/)).toHaveLength(0)
  })

  it("opens the editor on the entry's own text", async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { a: 'one', b: 'two' }, types: { a: 'string', b: 'string' }, textEditor: renderTextEditor })
    await user.click(screen.getByTestId('map-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'two')
  })

  it('writes the saved text into the entry and keeps the editor open until Close', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({
      value: { a: 'one', b: 'two' },
      types: { a: 'string', b: 'string' },
      textEditor: renderTextEditor,
    })
    await user.click(screen.getByTestId('map-expand-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual({ a: 'SAVED', b: 'two' })
    expect(lastTypes(onChange)).toEqual({ a: 'string', b: 'string' })
    expect(within(screen.getByTestId('map-edit-body')).getByTestId('map-edit-value-0')).toHaveValue('SAVED')
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-saved', 'true')
    await user.click(screen.getByTestId('text-editor-close'))
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
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

function renderOpenable(textEditor?: (props: TextEditorSlotProps) => ReactNode) {
  render(
    <MapEditBody
      value={{ host: 'db', base: 'base_host', other: 'other_host' }}
      types={{ host: 'string', base: 'string', other: 'string' }}
      onChange={vi.fn()}
      onValidChange={vi.fn()}
      expressionEditor={OpenableExpressionSlot}
      expressionKeys={new Set(['base', 'other'])}
      textEditor={textEditor}
    />,
  )
}

describe('MapEditBody - expand on an {x} value (FIELD-1)', () => {
  it("opens that entry's expression editor, not the text editor", async () => {
    const user = userEvent.setup()
    renderOpenable(renderTextEditor)
    expect(screen.getByTestId('map-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
    await user.click(screen.getByTestId('map-expand-1'))
    expect(screen.getByTestId('map-expr-value-1')).toHaveAttribute('data-editor-open', 'true')
    expect(screen.getByTestId('map-expr-value-2')).toHaveAttribute('data-editor-open', 'false')
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })

  it('follows the editor when it closes, and when it opens itself (Ctrl+E)', async () => {
    const user = userEvent.setup()
    renderOpenable(renderTextEditor)
    await user.click(screen.getByTestId('map-expand-1'))
    await user.click(screen.getByTestId('map-expr-value-1-close'))
    expect(screen.getByTestId('map-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
    await user.click(screen.getByTestId('map-expr-value-2-ctrl-e'))
    expect(screen.getByTestId('map-expr-value-2')).toHaveAttribute('data-editor-open', 'true')
    expect(screen.getByTestId('map-expr-value-1')).toHaveAttribute('data-editor-open', 'false')
  })

  it('offers expand on an {x} value when the host gives no text editor, and none on a literal', () => {
    renderOpenable()
    expect(screen.getByTestId('map-expand-1')).toHaveAttribute('aria-label', 'Open editor for Entry 1')
    expect(screen.getByTestId('map-expand-2')).toBeInTheDocument()
    expect(screen.queryByTestId('map-expand-0')).not.toBeInTheDocument()
  })
})

// One row box for every part of a row, the ∅ inside the value box at its right end (FIELD-1, FIELD-13).
describe('MapEditBody - one row box', () => {
  const boxOf = (element: HTMLElement) => element.closest('[data-slot="input-group"]') as HTMLElement

  it('draws the Key, a literal value and a null value in the one 32px box', () => {
    renderWithSlots({ value: { host: 'db', port: null }, types: { host: 'string', port: 'integer' } })
    expect(boxOf(screen.getByTestId('map-edit-key-0'))).toHaveClass('h-8')
    expect(boxOf(screen.getByTestId('map-edit-key-1'))).toHaveClass('h-8')
    expect(boxOf(screen.getByTestId('map-edit-value-0'))).toHaveClass('h-8')
    expect(boxOf(screen.getByTestId('map-edit-null-1'))).toHaveClass('h-8')
  })

  it('puts the ∅ inside the value box at its right end', () => {
    renderWithSlots({ value: { Accept: 'text/plain' }, types: { Accept: 'string' } })
    const nullButton = screen.getByTestId('map-edit-value-0-null')
    expect(boxOf(nullButton)).toBe(boxOf(screen.getByTestId('map-edit-value-0')))
    expect(nullButton.closest('[data-slot="input-group-addon"]')).toHaveAttribute('data-align', 'inline-end')
  })

  it('shows a null value as gray italic null with the ∅ pressed inside its box (VMGR-93)', async () => {
    renderWithSlots({ value: { 'X-Trace': null }, types: { 'X-Trace': 'string' } })
    const chip = screen.getByRole('button', { name: 'X-Trace (null)' })
    expect(chip).toHaveClass('italic')
    const nullButton = screen.getByTestId('map-edit-value-0-null')
    expect(nullButton).toHaveAttribute('aria-pressed', 'true')
    expect(nullButton).toHaveAccessibleName('Set X-Trace to null')
    expect(boxOf(nullButton)).toBe(boxOf(chip))
    act(() => chip.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it('leaves null with the type default from the pressed ∅', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { port: null }, types: { port: 'integer' } })
    await user.click(screen.getByTestId('map-edit-value-0-null'))
    expect(lastValue(onChange)).toEqual({ port: '0' })
    expect(screen.getByRole('textbox', { name: 'Entry 0 value' })).toHaveValue('0')
    expect(screen.getByTestId('map-edit-value-0-null')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the focus on the ∅ that set the value to null', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { host: 'db' }, types: { host: 'string' } })
    await user.click(screen.getByTestId('map-edit-value-0-null'))
    expect(screen.getByTestId('map-edit-value-0-null')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map-edit-value-0-null')).toHaveFocus()
  })

  it('puts the credential advisory before the ∅ in the same end slot', () => {
    render(
      <MapEditBody
        value={{ Authorization: 'Bearer abc' }}
        types={{ Authorization: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
        credentialAdvisory={() => true}
      />,
    )
    const advisory = screen.getByLabelText('Unsecured credential')
    const nullButton = screen.getByTestId('map-edit-value-0-null')
    expect(advisory.closest('[data-slot="input-group-addon"]')).toBe(nullButton.closest('[data-slot="input-group-addon"]'))
    expect(advisory.compareDocumentPosition(nullButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the credential advisory on an {x} value, which takes no ∅', () => {
    render(
      <MapEditBody
        value={{ Authorization: 'token' }}
        types={{ Authorization: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
        expressionEditor={ExpressionSlot}
        expressionKeys={new Set(['Authorization'])}
        credentialAdvisory={(_key, _value, isExpr) => isExpr}
      />,
    )
    expect(screen.getByLabelText('Unsecured credential')).toBeInTheDocument()
    expect(screen.queryByTestId('map-edit-value-0-null')).not.toBeInTheDocument()
  })

  it('splits Key and Value 1 : 1.4 and gives expand its own track after Value', () => {
    renderWithSlots({ value: { s: 'a' }, types: { s: 'string' }, expressionKeys: [], textEditor: renderTextEditor })
    const row = screen.getByTestId('map-edit-key-0').closest('.grid') as HTMLElement
    expect(row.style.gridTemplateColumns).toBe('minmax(0,1fr) minmax(0,1.4fr) 1.75rem 5rem 2rem 1.75rem')
    const header = screen.getByText('Key').closest('.grid') as HTMLElement
    expect(header.style.gridTemplateColumns).toBe(row.style.gridTemplateColumns)
    expect(screen.getByTestId('map-expand-0').closest('[data-slot="input-group"]')).toBeNull()
  })

  it('flags the whole box of an invalid value and of a missing key', () => {
    renderWithSlots({ value: { port: 'abc', '': 'x' }, types: { port: 'integer', '': 'string' } })
    const value = screen.getByTestId('map-edit-value-0')
    expect(value).toHaveAttribute('aria-invalid', 'true')
    expect(value).toHaveClass('text-destructive')
    expect([...boxOf(value).classList]).toContain('has-[[aria-invalid=true]]:border-destructive')
    expect(screen.getByTestId('map-edit-key-1')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('map-edit-key-1')).toHaveClass('text-destructive')
  })

  it('draws an {x} entry holding null in its expression editor, empty, as a list item does', () => {
    renderWithSlots({ value: { v: null }, types: { v: 'string' }, expressionKeys: ['v'] })
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'v (null)' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-edit-value-0-null')).not.toBeInTheDocument()
  })

  it('drops the tracks a map has no use for and keeps Type for a string-only map', () => {
    render(
      <MapEditBody value={{ a: 'x' }} types={{ a: 'string' }} onChange={vi.fn()} onValidChange={vi.fn()} stringValuesOnly />,
    )
    const row = screen.getByTestId('map-edit-key-0').closest('.grid') as HTMLElement
    expect(row.style.gridTemplateColumns).toBe('minmax(0,1fr) minmax(0,1.4fr) max-content 1.75rem')
  })
})

describe('MapEditBody - the open text editor follows its entry', () => {
  it('keeps one editor when the open entry asks again, and moves to another entry on its expand', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { a: 'one', b: 'two' }, types: { a: 'string', b: 'string' }, textEditor: renderTextEditor })
    await user.click(screen.getByTestId('map-expand-0'))
    await user.click(screen.getByTestId('map-expand-0'))
    expect(screen.getAllByTestId('text-editor')).toHaveLength(1)
    await user.click(screen.getByTestId('map-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', 'two')
  })

  it('hands the open editor empty text once its entry is set to null', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { a: 'one' }, types: { a: 'string' }, textEditor: renderTextEditor })
    await user.click(screen.getByTestId('map-expand-0'))
    await user.click(screen.getByTestId('map-edit-value-0-null'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', '')
  })
})

// A List or Map value reads as one spaced JSON line, the form a nested Save writes (FIELD-6).
describe('MapEditBody - a stored List or Map value', () => {
  it('shows a List or Map held as a structure as one spaced JSON line', () => {
    renderBody({ value: { m: { a: 'x', n: [1, 2] }, l: [true, { k: 1 }] }, types: { m: 'map', l: 'array' } })
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('{"a": "x", "n": [1, 2]}')
    expect(screen.getByTestId('map-edit-value-1')).toHaveValue('[true, {"k": 1}]')
  })
})

// A List or Map value opens its own list or map editor from expand (REQ-3.1.3.19).
describe('MapEditBody - expand on a List or Map value', () => {
  it("opens the entry editor on the List value's JSON text, typed as a list", async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { s: 'a', l: '[1, 2.0]' }, types: { s: 'string', l: 'array' }, textEditor: renderTextEditor })
    await user.click(screen.getByTestId('map-expand-1'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', '[1, 2.0]')
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'array')
  })

  it('opens a Map value typed as a map', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { m: { k: 1 } }, types: { m: 'map' }, textEditor: renderTextEditor })
    await user.click(screen.getByTestId('map-expand-0'))
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-value', '{"k": 1}')
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'map')
  })

  it('writes what the editor saves into that Map value and keeps it a map', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({
      value: { m: '{"k": 1}', s: 'b' },
      types: { m: 'map', s: 'string' },
      textEditor: renderTextEditor,
    })
    await user.click(screen.getByTestId('map-expand-0'))
    await user.click(screen.getByTestId('text-editor-save'))
    expect(lastValue(onChange)).toEqual({ m: 'SAVED', s: 'b' })
    expect(lastTypes(onChange)).toEqual({ m: 'map', s: 'string' })
  })

  it('draws the expand off for a Map value whose text is not a map', () => {
    renderWithSlots({ value: { m: '[1]' }, types: { m: 'map' }, textEditor: renderTextEditor })
    expect(screen.getByTestId('map-expand-0')).toBeDisabled()
  })
})

// A null value keeps its expand, drawn off, so the column never gaps.
describe('MapEditBody - expand on a null value', () => {
  it.each([
    ['text', 'string'],
    ['List', 'array'],
    ['Map', 'map'],
  ] as const)('keeps a null %s value expand, named, disabled and drawn off', async (_name, type) => {
    const user = userEvent.setup()
    renderWithSlots({ value: { v: null }, types: { v: type }, textEditor: renderTextEditor })
    const expand = screen.getByTestId('map-expand-0')
    expect(expand).toHaveAccessibleName('Open editor for Entry 0')
    expect(expand).toBeDisabled()
    expect(expand).toHaveClass('opacity-50', 'cursor-not-allowed')
    await user.click(expand)
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
  })
})

// At most 10 nested levels, the one opened from the field counted as 1.
describe('MapEditBody - the nested level limit', () => {
  it('draws the List and Map expand off at level 10 with the reason, and keeps the text expand', async () => {
    const user = userEvent.setup()
    renderWithSlots({
      value: { l: '[1]', m: '{"a": 1}', s: 'text' },
      types: { l: 'array', m: 'map', s: 'string' },
      textEditor: renderTextEditor,
      level: 10,
    })
    for (const index of [0, 1]) {
      const expand = screen.getByTestId(`map-expand-${index}`)
      expect(expand).toBeDisabled()
      expect(expand).toHaveClass('opacity-50', 'cursor-not-allowed')
    }
    await user.hover(screen.getByTestId('map-expand-1').parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Up to 10 nested levels$/)
    expect(screen.getByTestId('map-expand-2')).toBeEnabled()
  })
})

// A nested level is as editable as level 1; only a string-only map shows read-only (REQ-3.1.3.19).
describe('MapEditBody - a nested level', () => {
  it('shows each value type in the editable picker, as level 1 does', () => {
    renderWithSlots({ value: { s: '5', f: '2.0' }, types: { s: 'string', f: 'float' }, level: 2 })
    expect(screen.getByRole('combobox', { name: 'Entry 0 value type' })).toHaveTextContent(/^string$/)
    expect(screen.getByRole('combobox', { name: 'Entry 1 value type' })).toHaveTextContent(/^float$/)
  })

  it('keeps the read-only string pill of a string-only map at every level', () => {
    for (const level of [1, 3, 10]) {
      const { unmount } = render(
        <MapEditBody
          value={{ a: 'x' }}
          types={{ a: 'string' }}
          onChange={vi.fn()}
          onValidChange={vi.fn()}
          stringValuesOnly
          level={level}
        />,
      )
      expect(screen.getByTestId('map-type-0')).toHaveTextContent(/^string$/)
      expect(screen.queryAllByRole('combobox')).toHaveLength(0)
      unmount()
    }
  })
})

// A read-only sheet opens an entry's editor read-only: the expand stays a link in its frozen form.
describe('MapEditBody - in a read-only sheet', () => {
  it('opens a Map value editor from the expand, every other control frozen', () => {
    renderWithSlots({ value: { m: '{"a": 1}' }, types: { m: 'map' }, textEditor: renderTextEditor, frozen: true })
    expect(screen.getByTestId('map-edit-key-0')).toBeDisabled()
    const expand = screen.getByTestId('map-expand-0')
    expect(expand.tagName).toBe('A')
    expect(expand).toHaveAccessibleName('Open editor for Entry 0')
    // user-event treats a disabled fieldset's links as disabled; a browser does not.
    fireEvent.click(expand)
    expect(screen.getByTestId('text-editor')).toHaveAttribute('data-type', 'map')
  })
})

const dialogButtons = () =>
  within(screen.getByRole('alertdialog')).getAllByRole('button').map((button) => button.textContent)

async function pickEntryType(user: ReturnType<typeof userEvent.setup>, index: number, type: string) {
  await user.click(screen.getByTestId(`map-type-${index}`))
  await user.click(await screen.findByRole('option', { name: type }))
}

// A type change leaves the new type's default, asking first when that clears a value (FIELD-7).
describe('MapEditBody - a type change', () => {
  it("gives an entry holding its type's default the new type's default at once, so its expand works", async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: '' }, types: { k: 'string' }, textEditor: renderTextEditor })
    await pickEntryType(user, 0, 'map')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual({ k: '{}' })
    expect(lastTypes(onChange)).toEqual({ k: 'map' })
    expect(screen.getByTestId('map-expand-0')).toBeEnabled()
  })

  it("gives a null entry the new type's default at once", async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: null }, types: { k: 'string' } })
    await pickEntryType(user, 0, 'boolean')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastValue(onChange)).toEqual({ k: false })
  })

  it('asks before a type change clears a value, and Change type leaves the new default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: 'abc' }, types: { k: 'string' } })
    await pickEntryType(user, 0, 'integer')
    const dialog = screen.getByRole('alertdialog', { name: 'Change entry type?' })
    expect(dialog).toHaveTextContent('Changing type to integer will clear 1 existing string value. This cannot be undone.')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Change type' }))
    expect(lastValue(onChange)).toEqual({ k: '0' })
    expect(lastTypes(onChange)).toEqual({ k: 'integer' })
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('0')
  })

  it('counts the entries a Map value clears', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { k: '{"a": 1, "b": 2, "c": 3}' }, types: { k: 'map' } })
    await pickEntryType(user, 0, 'string')
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Changing type to string will clear 3 existing map entries. This cannot be undone.',
    )
  })

  it('keeps the type and the value on Cancel', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: 'abc' }, types: { k: 'string' } })
    await pickEntryType(user, 0, 'integer')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('map-type-0')).toHaveTextContent('string')
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('abc')
  })
})

// {x} on an entry asks the Block field's switch warning before a value is lost (FIELD-7).
describe('MapEditBody - switching an entry into and out of {x}', () => {
  it('switches an entry with no value into an empty {x} at once', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { a: '', b: null }, types: { a: 'string', b: 'integer' }, expressionKeys: [] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(screen.getByTestId('map-expr-toggle-1'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue('')
    expect(screen.getByTestId('map-expr-value-1')).toHaveValue('')
  })

  it('asks before a text entry holding a value goes into {x}, and Cancel keeps it', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: 'abc' }, types: { k: 'string' }, expressionKeys: [] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to an expression?' })).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear', 'Clear & Empty'])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('abc')
  })

  it('leaves an empty {x} on Clear, and the empty value as an expression on Clear & Empty', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({
      value: { a: 'abc', l: '[1]' },
      types: { a: 'string', l: 'array' },
      expressionKeys: [],
    })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue('')
    await user.click(screen.getByTestId('map-expr-toggle-1'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear & Empty' }))
    expect(screen.getByTestId('map-expr-value-1')).toHaveValue('[]')
    expect(lastValue(onChange)).toEqual({ a: '', l: '[]' })
  })

  it('offers Clear only for a number entry', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { n: '5' }, types: { n: 'integer' }, expressionKeys: [] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
  })

  it('asks before a written expression goes back to a plain value, and Clear leaves the type default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWithSlots({ value: { k: 'x + 1' }, types: { k: 'float' }, expressionKeys: ['k'] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to a plain value?' })).toBeInTheDocument()
    expect(dialogButtons()).toEqual(['Cancel', 'Clear'])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('0')
    expect(lastValue(onChange)).toEqual({ k: '0' })
  })

  it('switches an empty expression back to the type default at once', async () => {
    const user = userEvent.setup()
    renderWithSlots({ value: { k: '' }, types: { k: 'map' }, expressionKeys: ['k'] })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('{}')
  })
})

// A string-only map's Type column is as wide as its read-only pill, so {x} sits one gap after it.
describe('MapEditBody - the Type track of a string-only map', () => {
  const rowOf = (element: HTMLElement) => element.closest('.grid') as HTMLElement

  function renderHeaders() {
    render(
      <MapEditBody
        value={{ Accept: 'text/plain', Trace: 'run_id' }}
        types={{ Accept: 'string', Trace: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
        expressionEditor={ExpressionSlot}
        expressionKeys={new Set(['Trace'])}
        generatedRows={[{ key: 'Content-Type', value: 'application/json' }]}
        textEditor={renderTextEditor}
      />,
    )
  }

  it('sizes the Type track to the pill in the header, every row and the generated rows', () => {
    renderHeaders()
    const tracks = 'minmax(0,1fr) minmax(0,1.4fr) 1.75rem max-content 2rem 1.75rem'
    expect(rowOf(screen.getByTestId('map-edit-key-0')).style.gridTemplateColumns).toBe(tracks)
    expect(rowOf(screen.getByText('Key')).style.gridTemplateColumns).toBe(tracks)
    expect(rowOf(screen.getByTestId('map-generated-key-0')).style.gridTemplateColumns).toBe(tracks)
  })

  it('keeps an unseen pill in the header, an {x} row and a generated row, so every Type cell is one width', () => {
    renderHeaders()
    for (const row of [
      rowOf(screen.getByText('Key')),
      rowOf(screen.getByTestId('map-expr-value-1')),
      rowOf(screen.getByTestId('map-generated-key-0')),
    ]) {
      expect(within(row).getByText('string').closest('[aria-hidden="true"]')).toHaveClass('invisible')
    }
    expect(screen.getByTestId('map-type-0')).toHaveTextContent(/^string$/)
  })

  it('keeps the picker track for a map whose values each pick a type', () => {
    renderWithSlots({ value: { a: 'x' }, types: { a: 'string' } })
    expect(rowOf(screen.getByTestId('map-edit-key-0')).style.gridTemplateColumns).toBe(
      'minmax(0,1fr) minmax(0,1.4fr) 5rem 1.75rem',
    )
  })
})
