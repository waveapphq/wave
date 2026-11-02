// The one value field of a Block row: every state of a free-entry field (FIELD-1..FIELD-6, REQ-3.1.1.5, REQ-3.1.3.20).

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const expression = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))

// The field never opens a sheet itself: its host opens the editor from onExpand.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => <div data-testid="value-editor-sheet" />,
}))

// The expression box is CodeMirror; a textarea keeps its text, its newlines and its gray hint testable.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => {
  function ExpressionFieldStub({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) {
    expression.props.push({ value, placeholder })
    return (
      <textarea
        data-testid="expression-field"
        aria-label="Expression"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  return { ExpressionField: ExpressionFieldStub }
})

// The same stand-in when the field draws the inline expression input directly.
vi.mock('@/features/workbench/common/element-config/expressions/expression-input', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/workbench/common/element-config/expressions/expression-input')
  >()
  const { ExpressionField } = await import(
    '@/features/workbench/common/element-config/expressions/expression-field'
  )
  return { ...actual, ExpressionInput: ExpressionField }
})

import { BlockValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import type {
  ComboboxVariable,
  SuggestionList,
} from '@/features/workbench/common/element-config/shared/variable-combobox-base'
import { FieldNoteContext } from '@/components/shared/fields/field-error-context'
import { SheetFrozenContext } from '@/components/shared/sheet-layer'
import { MASK_PLACEHOLDER, SECRET_ENVELOPE_PREFIX } from '@/lib/secret-envelope'
import { getValueColorClass } from '@/lib/variable-format'

type FieldProps = ComponentProps<typeof BlockValueField>

// Text Muted (--color-text-muted): the one gray of the default, null and <empty string>.
const TEXT_MUTED = 'text-[color:var(--color-text-muted)]'
const NAME = 'region'
const LABEL = 'Region'
const DEFAULT_TOOLTIP = /^Not set, so the default is used\. Type to use your own value\.$/
const ENTRIES_TOOLTIP = /^Has \{\{ \}\} entries\. Open the editor to change it\.$/
const EMPTY_MARKER = '<empty string>'
const ENTRY_LIST = ['web-1', 'backup_host', 'web-3']
const ENTRY_LINE = '["web-1", {{ backup_host }}, "web-3"]'

interface Spies {
  onChange: Mock
  onUnset: Mock
  onNull: Mock
  onExpand: Mock
}

// Holds the value and its set flag the way a Block row does, so the field sees its own changes come back.
function Harness({ spies, ...props }: Readonly<Partial<FieldProps> & { spies: Spies }>) {
  const [held, setHeld] = useState<{ value: unknown; isSet: boolean }>({
    value: props.value,
    isSet: props.isSet ?? false,
  })
  return (
    <div data-testid="host">
      <BlockValueField
        type="string"
        mode="literal"
        nullable={false}
        hasEditor
        testId={NAME}
        label={LABEL}
        {...props}
        value={held.value}
        isSet={held.isSet}
        onChange={(next: unknown, nextTypes?: unknown) => {
          setHeld({ value: next, isSet: true })
          spies.onChange(next, nextTypes)
        }}
        onUnset={() => {
          setHeld({ value: undefined, isSet: false })
          spies.onUnset()
        }}
        onNull={() => {
          setHeld({ value: null, isSet: true })
          spies.onNull()
        }}
        onExpand={spies.onExpand}
      />
    </div>
  )
}

function renderField(props: Partial<FieldProps> = {}): Spies {
  const spies = { onChange: vi.fn(), onUnset: vi.fn(), onNull: vi.fn(), onExpand: vi.fn() }
  render(<Harness spies={spies} {...props} />)
  return spies
}

const host = () => screen.getByTestId('host')
const textbox = () => within(host()).getByRole('textbox')
const numberBox = (name = 'timeout') => within(host()).getByTestId(`param-input-${name}`)
const expressionBox = () => within(host()).getByTestId('expression-field')
const expandButton = (name = NAME) => screen.queryByTestId(`param-expand-${name}`)
const resetButton = (name = NAME) => screen.queryByTestId(`param-reset-${name}`)
const nullButton = (name = NAME) => screen.queryByTestId(`param-null-${name}`)

// The element that shows a text: an input holding it as its value, or the innermost element drawing it
// (text only a screen reader hears is not shown).
function shownElement(text: string): HTMLElement | null {
  const byValue = within(host()).queryAllByDisplayValue(text)
  if (byValue.length > 0) return byValue[0]
  const drawn = within(host()).queryAllByText(
    (_content, element) =>
      element !== null &&
      element.closest('.sr-only') === null &&
      element.textContent === text &&
      !Array.from(element.children).some((child) => child.textContent === text),
  )
  return drawn[0] ?? null
}

function shown(text: string): HTMLElement {
  const element = shownElement(text)
  expect(element, `the field shows ${text}`).not.toBeNull()
  return element as HTMLElement
}

// The key-press tooltip carries param-tooltip-<name> on its content or on the text inside it.
async function keyTooltip(name = NAME): Promise<HTMLElement> {
  const tip = await screen.findByRole('tooltip')
  const tagged =
    tip.closest(`[data-testid="param-tooltip-${name}"]`) ?? tip.querySelector(`[data-testid="param-tooltip-${name}"]`)
  expect(tagged).not.toBeNull()
  return tip
}

// The {{ }} line takes focus itself, or through the field's own text box.
function focusLine(line: HTMLElement) {
  const target = line.closest<HTMLElement>('[tabindex]') ?? within(host()).queryByRole('textbox')
  expect(target).not.toBeNull()
  act(() => (target as HTMLElement).focus())
}

// The text the user has selected: inside a text box, or anywhere in the page.
function selectedText(): string {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
  }
  return window.getSelection()?.toString() ?? ''
}

// The element, or a wrapper of it inside the field, cannot be selected.
function unselectable(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node && node !== host(); node = node.parentElement) {
    if (node.classList.contains('select-none')) return true
  }
  return false
}

beforeEach(() => {
  expression.props = []
})

describe('BlockValueField - not set, with a default (FIELD-2)', () => {
  it('shows the default as real text in the Text Muted gray, upright', () => {
    renderField({ defaultValue: 'eu-west-1' })
    const text = shown('eu-west-1')
    expect(text).toHaveClass(TEXT_MUTED)
    expect(text).not.toHaveClass('italic')
    expect((textbox() as HTMLInputElement).placeholder).toBe('')
  })

  it.each([
    ['list', 'array', ['smoke'], '["smoke"]'],
    ['map', 'map', { env: 'qa' }, '{"env": "qa"}'],
  ] as const)('shows a %s default as one JSON line in the Text Muted gray', (_label, type, defaultValue, line) => {
    renderField({ type, defaultValue })
    expect(shown(line)).toHaveClass(TEXT_MUTED)
  })

  it('lets Ctrl+A select the whole gray text and copy it', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}')
    const box = textbox() as HTMLInputElement
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 'eu-west-1'.length])
    const copied = await user.copy()
    expect(copied?.getData('text/plain')).toBe('eu-west-1')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('refuses a cut of the gray text (FIELD-2)', () => {
    renderField({ defaultValue: 'eu-west-1' })
    expect(fireEvent.cut(textbox())).toBe(false)
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
  })

  it.each([
    ['ArrowLeft', '{ArrowLeft}'],
    ['ArrowRight', '{ArrowRight}'],
    ['ArrowUp', '{ArrowUp}'],
    ['ArrowDown', '{ArrowDown}'],
  ])('%s changes nothing and shows no tooltip', async (_key, keys) => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard(keys)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl+C', '{Control>}c{/Control}'],
    ['Cmd+A', '{Meta>}a{/Meta}'],
    ['Cmd+C', '{Meta>}c{/Meta}'],
  ])('%s changes nothing and shows no tooltip', async (_keys, keys) => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard(keys)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('typing replaces the whole default and makes the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.type(textbox(), 'us')
    expect(onChange.mock.lastCall?.[0]).toBe('us')
    expect(textbox()).toHaveValue('us')
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
  })

  it('typing replaces the whole default whatever part of it is selected', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.type(textbox(), 'z', { initialSelectionStart: 0, initialSelectionEnd: 3 })
    expect(onChange.mock.lastCall?.[0]).toBe('z')
    expect(textbox()).toHaveValue('z')
  })

  it('a paste replaces the whole default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.paste('us-east-2')
    expect(onChange.mock.lastCall?.[0]).toBe('us-east-2')
    expect(textbox()).toHaveValue('us-east-2')
  })

  it('a paste replaces a gray list default with the pasted list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'array', defaultValue: ['smoke'] })
    await user.click(textbox())
    await user.paste('["nightly"]')
    expect(onChange.mock.lastCall?.[0]).toEqual(['nightly'])
  })

  it.each([
    ['Delete', '{Delete}'],
    ['Backspace', '{Backspace}'],
  ])('%s changes nothing and opens the tooltip', async (_key, keys) => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard(keys)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
    expect(await keyTooltip()).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('closes the tooltip when the field loses focus', async () => {
    const user = userEvent.setup()
    renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard('{Backspace}')
    await keyTooltip()
    act(() => textbox().blur())
    await vi.waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('shows no reset icon and no null button', () => {
    renderField({ defaultValue: 'eu-west-1', nullable: true })
    expect(resetButton()).not.toBeInTheDocument()
    expect(nullButton()).not.toBeInTheDocument()
  })

  it('expand asks the host for the editor and changes nothing', async () => {
    const user = userEvent.setup()
    const { onExpand, onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(expandButton() as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('BlockValueField - not set, with no default', () => {
  it('shows an empty field with no gray text and no placeholder', () => {
    renderField({})
    expect(textbox()).toHaveValue('')
    expect((textbox() as HTMLInputElement).placeholder).toBe('')
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('typing gives the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({})
    await user.type(textbox(), 'ab')
    expect(onChange.mock.lastCall?.[0]).toBe('ab')
    expect(textbox()).toHaveValue('ab')
  })

  it('Delete changes nothing and shows no tooltip', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({})
    await user.click(textbox())
    await user.keyboard('{Delete}')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('BlockValueField - user value, with a default (FIELD-3)', () => {
  it('shows the value in its type color with the reset icon inside the field', () => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    expect(textbox()).toHaveValue('qa-team')
    expect(textbox()).toHaveClass(getValueColorClass('string'))
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton()).toHaveAttribute('aria-label', 'Reset to default')
    expect(nullButton()).not.toBeInTheDocument()
  })

  it('lets the user value be cut', () => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    expect(fireEvent.cut(textbox())).toBe(true)
  })

  it('carries the tooltip "Reset to default" on the reset icon', async () => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    act(() => (resetButton() as HTMLElement).focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Reset to default$/)
  })

  it('a reset click brings the gray default back', async () => {
    const user = userEvent.setup()
    const { onUnset, onChange } = renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    await user.click(resetButton() as HTMLElement)
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
    expect(resetButton()).not.toBeInTheDocument()
  })

  it.each([
    ['Delete', '{Delete}'],
    ['Backspace', '{Backspace}'],
  ])('select all + %s takes the field back to not set', async (_key, keys) => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    await user.click(textbox())
    await user.keyboard(`{Control>}a{/Control}${keys}`)
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(shown('eu-west-1')).toHaveClass(TEXT_MUTED)
  })

  it('a partial delete is normal editing', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    await user.click(textbox())
    await user.keyboard('{Backspace}')
    expect(onChange.mock.lastCall?.[0]).toBe('qa-tea')
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('never shows the null button, even on a nullable field', () => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true, nullable: true })
    expect(resetButton()).toBeInTheDocument()
    expect(nullButton()).not.toBeInTheDocument()
  })
})

describe('BlockValueField - user value, with no default', () => {
  it('shows the null button, not pressed, on a nullable field', () => {
    renderField({ testId: 'note', label: 'Note', value: 'ship it', isSet: true, nullable: true })
    expect(nullButton('note')).toHaveAttribute('aria-label', 'Set Note to null')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'false')
    expect(resetButton('note')).not.toBeInTheDocument()
  })

  it('carries the tooltip "Set to null" on the null button', async () => {
    renderField({ testId: 'note', label: 'Note', value: 'ship it', isSet: true, nullable: true })
    act(() => (nullButton('note') as HTMLElement).focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Set to null$/)
  })

  it('shows neither the null button nor the reset icon on a field that refuses null', () => {
    renderField({ value: 'ship it', isSet: true })
    expect(nullButton()).not.toBeInTheDocument()
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('select all + Delete gives null on a nullable field', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ testId: 'note', label: 'Note', value: 'ship it', isSet: true, nullable: true })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalledTimes(1)
    act(() => textbox().blur())
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'true')
  })

  it('select all + Delete empties a field that refuses null', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ value: 'ship it', isSet: true })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(textbox()).toHaveValue('')
    expect(shownElement('null')).toBeNull()
  })

  it('clearing a nullable list gives null', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({
      testId: 'targets',
      label: 'Targets',
      type: 'array',
      value: ['web-1'],
      isSet: true,
      nullable: true,
    })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalledTimes(1)
    act(() => textbox().blur())
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('targets')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('BlockValueField - empty text (FIELD-4)', () => {
  it('shows <empty string> in the Text Muted gray, italic', () => {
    renderField({ value: '', isSet: true })
    expect(shown(EMPTY_MARKER)).toHaveClass(TEXT_MUTED, 'italic')
  })

  it('hides <empty string> while focused and brings it back on leaving without typing', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ value: '', isSet: true })
    await user.click(textbox())
    expect(shownElement(EMPTY_MARKER)).toBeNull()
    expect(textbox()).toHaveValue('')
    act(() => textbox().blur())
    expect(shown(EMPTY_MARKER)).toHaveClass(TEXT_MUTED, 'italic')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('typing deleted back to nothing leaves empty text', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ value: '', isSet: true })
    await user.type(textbox(), 'a{Backspace}')
    expect(onChange.mock.lastCall?.[0]).toBe('')
    expect(onUnset).not.toHaveBeenCalled()
    act(() => textbox().blur())
    expect(shown(EMPTY_MARKER)).toBeInTheDocument()
  })

  it('shows the reset icon when the field has a default', () => {
    renderField({ value: '', isSet: true, defaultValue: 'eu-west-1' })
    expect(resetButton()).toBeInTheDocument()
    expect(nullButton()).not.toBeInTheDocument()
  })

  it('shows the null button, not pressed, on a nullable field with no default', () => {
    renderField({ testId: 'note', label: 'Note', value: '', isSet: true, nullable: true })
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'false')
    expect(resetButton('note')).not.toBeInTheDocument()
  })

  it('keeps <empty string> out of the text box value and out of a selection', () => {
    renderField({ value: '', isSet: true })
    expect(textbox()).toHaveValue('')
    const marker = shown(EMPTY_MARKER)
    expect(marker).not.toBe(textbox())
    expect(unselectable(marker)).toBe(true)
  })

  it('expand asks the host for the string editor and leaves the empty text as it is', async () => {
    const user = userEvent.setup()
    const { onExpand, onChange, onUnset } = renderField({ value: '', isSet: true })
    await user.click(expandButton() as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown(EMPTY_MARKER)).toHaveClass(TEXT_MUTED, 'italic')
  })
})

describe('BlockValueField - null (FIELD-5, REQ-3.1.3.20)', () => {
  it('shows a stored null as italic null in the Text Muted gray with the null button pressed', () => {
    renderField({ testId: 'note', label: 'Note', value: null, isSet: true, nullable: true })
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows null with the button pressed on a nullable field not set and with no default', () => {
    renderField({ testId: 'note', label: 'Note', nullable: true })
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'true')
  })

  it('a click on the null button sets the field to null', async () => {
    const user = userEvent.setup()
    const { onNull } = renderField({ testId: 'note', label: 'Note', value: 'ship it', isSet: true, nullable: true })
    await user.click(nullButton('note') as HTMLElement)
    expect(onNull).toHaveBeenCalledTimes(1)
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides null on focus and keeps null when left without typing', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ testId: 'note', label: 'Note', value: null, isSet: true, nullable: true })
    await user.click(textbox())
    expect(shownElement('null')).toBeNull()
    act(() => textbox().blur())
    expect(shown('null')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('typing into a null text field gives text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'note', label: 'Note', value: null, isSet: true, nullable: true })
    await user.type(textbox(), 'x')
    expect(onChange.mock.lastCall?.[0]).toBe('x')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no null button while the field is an expression', () => {
    renderField({ testId: 'note', label: 'Note', mode: 'expression', value: 'None', isSet: true, nullable: true })
    expect(nullButton('note')).not.toBeInTheDocument()
  })

  it('expand asks the host for the editor and keeps null', async () => {
    const user = userEvent.setup()
    const { onExpand, onChange, onUnset, onNull } = renderField({
      testId: 'note',
      label: 'Note',
      value: null,
      isSet: true,
      nullable: true,
    })
    await user.click(expandButton('note') as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(onNull).not.toHaveBeenCalled()
    expect(shown('null')).toHaveClass(TEXT_MUTED, 'italic')
    expect(nullButton('note')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the expand of a null list field on: it opens the editor on an empty list', () => {
    renderField({ testId: 'items', label: 'Items', type: 'array', value: null, isSet: true, nullable: true })
    const expand = expandButton('items') as HTMLElement
    expect(expand).toHaveAccessibleName('Open editor for Items')
    expect(expand).toBeEnabled()
  })
})

describe('BlockValueField - {x} mode', () => {
  it('hands a multi-line expression to the expression box with its newlines', () => {
    renderField({ mode: 'expression', value: 'first_line\n+ second_line', isSet: true })
    expect(expressionBox()).toHaveValue('first_line\n+ second_line')
    expect(within(host()).queryByTestId('scalar-edit-input')).not.toBeInTheDocument()
  })

  it.each([
    ['text', 'string', 'eu-west-1', "'eu-west-1'"],
    ['list', 'array', ['smoke', 'nightly'], "['smoke', 'nightly']"],
    ['map', 'map', { env: 'qa' }, "{'env': 'qa'}"],
  ] as const)(
    'not set, shows an empty box with the %s default as the gray hint in Python literal form',
    (_label, type, defaultValue, hint) => {
      renderField({ type, mode: 'expression', defaultValue })
      expect(expressionBox()).toHaveValue('')
      expect(expressionBox()).toHaveAttribute('placeholder', hint)
    },
  )

  it('not set with no default, shows an empty box with no hint', () => {
    renderField({ mode: 'expression' })
    expect(expressionBox()).toHaveValue('')
    expect(expressionBox().getAttribute('placeholder') ?? '').toBe('')
  })

  it('typing an expression makes the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ mode: 'expression', defaultValue: 'eu-west-1' })
    await user.type(expressionBox(), 'x')
    expect(onChange.mock.lastCall?.[0]).toBe('x')
  })

  it('shows the reset icon on a field with a default holding an expression', () => {
    renderField({ mode: 'expression', defaultValue: 'eu-west-1', value: 'region_var', isSet: true })
    expect(resetButton()).toBeInTheDocument()
  })

  it('a reset click empties the box and brings the gray hint back', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ mode: 'expression', defaultValue: 'eu-west-1', value: 'region_var', isSet: true })
    await user.click(resetButton() as HTMLElement)
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(expressionBox()).toHaveValue('')
    expect(expressionBox()).toHaveAttribute('placeholder', "'eu-west-1'")
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('shows no reset icon while the expression is not set', () => {
    renderField({ mode: 'expression', defaultValue: 'eu-west-1' })
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('expand asks the host for the expression editor', async () => {
    const user = userEvent.setup()
    const { onExpand } = renderField({ mode: 'expression', value: 'region_var', isSet: true })
    await user.click(expandButton() as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})

describe('BlockValueField - a line with {x} entries (FIELD-6)', () => {
  const entryProps = {
    testId: 'targets',
    label: 'Targets',
    type: 'array',
    value: ENTRY_LIST,
    isSet: true,
    expressionEntries: ['1'],
  } as const

  it('draws an {x} item as {{ expr }} without quotes and the text items with theirs', () => {
    renderField({ ...entryProps })
    expect(shown(ENTRY_LINE)).toBeInTheDocument()
  })

  it('draws an {x} map value as {{ expr }} without quotes', () => {
    renderField({
      ...entryProps,
      type: 'map',
      value: { tier: 'web', host: 'backup_host' },
      expressionEntries: ['host'],
    })
    expect(shown('{"tier": "web", "host": {{ backup_host }}}')).toBeInTheDocument()
  })

  it.each([
    ['a printable key', 'x'],
    ['Delete', '{Delete}'],
    ['Backspace', '{Backspace}'],
  ])('%s changes nothing and opens the tooltip', async (_key, keys) => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ ...entryProps })
    focusLine(shown(ENTRY_LINE))
    await user.keyboard(keys)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown(ENTRY_LINE)).toBeInTheDocument()
    expect(await keyTooltip('targets')).toHaveTextContent(ENTRIES_TOOLTIP)
  })

  it('a paste changes nothing and opens the tooltip', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ ...entryProps })
    focusLine(shown(ENTRY_LINE))
    await user.paste('["db-1"]')
    expect(onChange).not.toHaveBeenCalled()
    expect(shown(ENTRY_LINE)).toBeInTheDocument()
    expect(await keyTooltip('targets')).toHaveTextContent(ENTRIES_TOOLTIP)
  })

  it('Ctrl+A selects the whole line, which copies as it is drawn, with no tooltip', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ ...entryProps })
    focusLine(shown(ENTRY_LINE))
    await user.keyboard('{Control>}a{/Control}')
    expect(selectedText()).toBe(ENTRY_LINE)
    const copied = await user.copy()
    expect(copied?.getData('text/plain')).toBe(ENTRY_LINE)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl+C', '{Control>}c{/Control}'],
    ['Cmd+A', '{Meta>}a{/Meta}'],
    ['Cmd+C', '{Meta>}c{/Meta}'],
  ])('%s changes nothing and shows no tooltip', async (_keys, keys) => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ ...entryProps })
    focusLine(shown(ENTRY_LINE))
    await user.keyboard(keys)
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(shown(ENTRY_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('a click never opens the editor', async () => {
    const user = userEvent.setup()
    const { onExpand } = renderField({ ...entryProps })
    await user.click(shown(ENTRY_LINE))
    expect(onExpand).not.toHaveBeenCalled()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('expand is the way to edit it', async () => {
    const user = userEvent.setup()
    const { onExpand } = renderField({ ...entryProps })
    await user.click(expandButton('targets') as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('shows the reset icon when the field has a default', () => {
    renderField({ ...entryProps, defaultValue: ['web-1'] })
    expect(resetButton('targets')).toBeInTheDocument()
  })
})

describe('BlockValueField - masked secret (REQ-3.1.3.18)', () => {
  it.each([
    ['a sealed value', `${SECRET_ENVELOPE_PREFIX}c2VhbGVk`],
    ['the mask', MASK_PLACEHOLDER],
  ])('masks %s behind the pencil control with the lock icon and no expand', (_label, stored) => {
    renderField({ testId: 'token', label: 'Token', leftIcon: 'lock', value: stored, isSet: true })
    expect(screen.getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
    expect(host().querySelector('svg.lucide-lock')).not.toBeNull()
    expect(within(host()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(stored)).not.toBeInTheDocument()
    expect(expandButton('token')).not.toBeInTheDocument()
    expect(resetButton('token')).not.toBeInTheDocument()
    expect(nullButton('token')).not.toBeInTheDocument()
  })

  it('after Delete & Edit, is a normal field with the lock icon and expand', () => {
    renderField({ testId: 'token', label: 'Token', leftIcon: 'lock', value: 'typed-now', isSet: true })
    expect(textbox()).toHaveValue('typed-now')
    expect(host().querySelector('svg.lucide-lock')).not.toBeNull()
    expect(expandButton('token')).toBeInTheDocument()
  })
})

describe('BlockValueField - time value (FIELD-9)', () => {
  it('shows the clock icon inside the field and the gray default', () => {
    renderField({ testId: 'to', label: 'To', leftIcon: 'clock', defaultValue: 'now' })
    expect(host().querySelector('svg.lucide-clock')).not.toBeNull()
    expect(shown('now')).toHaveClass(TEXT_MUTED)
    expect(expandButton('to')).toBeInTheDocument()
  })
})

describe('BlockValueField - numbers (REQ-3.1.3.14)', () => {
  it('shows the default as real gray text in the number box, not a placeholder, and no expand', () => {
    renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    expect(numberBox()).toHaveValue('30')
    expect(numberBox().getAttribute('placeholder') ?? '').toBe('')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
    expect(expandButton('timeout')).not.toBeInTheDocument()
  })

  it('typing replaces the whole gray default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    await user.type(numberBox(), '5')
    expect(onChange.mock.lastCall?.[0]).toBe('5')
    expect(numberBox()).toHaveValue('5')
  })

  it('Backspace on the gray default changes nothing and opens the tooltip', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    await user.click(numberBox())
    await user.keyboard('{Backspace}')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(numberBox()).toHaveValue('30')
    expect(await keyTooltip('timeout')).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('a user number shows its type color and the reset icon', () => {
    renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30, value: '7', isSet: true })
    expect(numberBox()).toHaveValue('7')
    expect(numberBox()).toHaveClass(getValueColorClass('integer'))
    expect(numberBox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton('timeout')).toBeInTheDocument()
  })

  it('select all + Delete takes a number back to its gray default', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({
      testId: 'timeout',
      label: 'Timeout',
      type: 'integer',
      defaultValue: 30,
      value: '7',
      isSet: true,
    })
    await user.click(numberBox())
    await user.keyboard('{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
  })
})

describe('BlockValueField - expand (FIELD-1)', () => {
  it('is the "Open editor for <label>" button with the param-expand test id', () => {
    renderField({ value: 'qa-team', isSet: true })
    const expand = expandButton() as HTMLElement
    expect(expand).toHaveAttribute('aria-label', `Open editor for ${LABEL}`)
    expect(expand.tagName).toBe('BUTTON')
  })

  it('is plain "Open editor" on a field with no label', () => {
    renderField({ value: 'qa-team', isSet: true, label: undefined })
    expect(expandButton()).toHaveAccessibleName('Open editor')
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the editor from the keyboard with %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onExpand } = renderField({ value: 'qa-team', isSet: true })
    act(() => (expandButton() as HTMLElement).focus())
    await user.keyboard(keys)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('is absent on a field with no full editor', () => {
    renderField({ value: 'qa-team', isSet: true, hasEditor: false })
    expect(expandButton()).not.toBeInTheDocument()
  })
})

describe('BlockValueField - reset icon and null button from the keyboard', () => {
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('the reset icon takes the field back to not set with %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    act(() => (resetButton() as HTMLElement).focus())
    await user.keyboard(keys)
    expect(onUnset).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('the null button sets null with %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onNull } = renderField({ testId: 'note', label: 'Note', value: 'ship it', isSet: true, nullable: true })
    act(() => (nullButton('note') as HTMLElement).focus())
    await user.keyboard(keys)
    expect(onNull).toHaveBeenCalledTimes(1)
  })
})

describe('BlockValueField - a read-only field', () => {
  it('is shown, never changed, with no reset icon or null button, and keeps expand', async () => {
    const user = userEvent.setup()
    const { onChange, onExpand } = renderField({
      defaultValue: 'eu-west-1',
      value: 'qa-team',
      isSet: true,
      nullable: true,
      readOnly: true,
    })
    expect(textbox()).toHaveAttribute('readonly')
    await user.type(textbox(), 'x')
    expect(onChange).not.toHaveBeenCalled()
    expect(resetButton()).not.toBeInTheDocument()
    expect(nullButton()).not.toBeInTheDocument()
    await user.click(expandButton() as HTMLElement)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})

// A text box that suggests names keeps every rule of the one value field and offers its list under the box (OS-13).
describe('BlockValueField - a suggestion list under the text box', () => {
  const NAMES: ComboboxVariable[] = [
    { name: '@timestamp', type: 'date' },
    { name: 'event.created', type: 'date_nanos' },
    { name: 'service.name', type: 'keyword' },
    { name: 'service.version', type: 'keyword' },
  ]
  const LIST: SuggestionList = { items: NAMES, emptyText: 'No matching fields' }
  const TIME_DEFAULT = { suggestions: LIST, defaultValue: '@timestamp' }

  const combobox = () => within(host()).getByRole('combobox', { name: LABEL })
  const optionNames = () => screen.queryAllByRole('option').map((option) => option.getAttribute('data-value'))
  function option(name: string): HTMLElement {
    const found = screen.getAllByRole('option').find((candidate) => candidate.getAttribute('data-value') === name)
    expect(found, `the list offers ${name}`).toBeDefined()
    return found as HTMLElement
  }

  it('is a combobox carrying the param-input test id, closed at first', () => {
    renderField(TIME_DEFAULT)
    expect(combobox()).toHaveAttribute('data-testid', `param-input-${NAME}`)
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('keeps the gray default and lists every name under it: the default never narrows the list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    expect(optionNames()).toEqual(NAMES.map((item) => item.name))
    expect(shown('@timestamp')).toHaveClass(TEXT_MUTED)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a picked name becomes the user value, shuts the list and gives the box its focus back', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    await user.click(option('event.created'))
    expect(onChange.mock.lastCall?.[0]).toBe('event.created')
    expect(combobox()).toHaveValue('event.created')
    expect(combobox()).toHaveClass(getValueColorClass('string'))
    expect(combobox()).not.toHaveClass(TEXT_MUTED)
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    expect(combobox()).toHaveFocus()
    expect(resetButton()).toBeInTheDocument()
  })

  it('picking the name the default shows still makes it the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    await user.click(option('@timestamp'))
    expect(onChange.mock.lastCall?.[0]).toBe('@timestamp')
    expect(combobox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton()).toBeInTheDocument()
  })

  it('the reset icon brings the gray default back after a pick', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    await user.click(option('event.created'))
    await user.click(resetButton() as HTMLElement)
    expect(onUnset).toHaveBeenCalledTimes(1)
    expect(shown('@timestamp')).toHaveClass(TEXT_MUTED)
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('the first key replaces the gray default, and the list narrows to names holding the typed text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.type(combobox(), 'SERV')
    expect(onChange.mock.lastCall?.[0]).toBe('SERV')
    expect(combobox()).toHaveValue('SERV')
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    expect(optionNames()).toEqual(['service.name', 'service.version'])
  })

  it('Delete on the gray default only explains', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    await user.keyboard('{Delete}')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(await keyTooltip()).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('accepts a name the list does not hold and says no name matches', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.type(combobox(), 'no.such.field')
    expect(onChange.mock.lastCall?.[0]).toBe('no.such.field')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching fields')).toBeInTheDocument()
  })

  it('shows no empty line when the list gives none', async () => {
    const user = userEvent.setup()
    renderField({ suggestions: { items: [], emptyText: null } })
    await user.click(combobox())
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('No matching fields')).not.toBeInTheDocument()
  })

  it('an unfiltered list keeps every name whatever is typed', async () => {
    const user = userEvent.setup()
    renderField({ suggestions: { ...LIST, unfiltered: true }, value: 'app-*', isSet: true })
    await user.click(combobox())
    expect(optionNames()).toEqual(NAMES.map((item) => item.name))
  })

  it('shows the footer under the rows', async () => {
    const user = userEvent.setup()
    const start = vi.fn()
    renderField({
      suggestions: {
        ...LIST,
        footer: (
          <button type="button" onClick={start}>
            Get fields
          </button>
        ),
      },
    })
    await user.click(combobox())
    await user.click(screen.getByRole('button', { name: 'Get fields' }))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('Escape shuts the list and Ctrl+Space opens it again, changing nothing', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField(TIME_DEFAULT)
    await user.click(combobox())
    await user.keyboard('{Escape}')
    expect(combobox()).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Control>} {/Control}')
    expect(combobox()).toHaveAttribute('aria-expanded', 'true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a read-only field offers no list but keeps the test id', async () => {
    const user = userEvent.setup()
    renderField({ ...TIME_DEFAULT, value: 'event.created', isSet: true, readOnly: true })
    expect(within(host()).queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(textbox())
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(textbox()).toHaveAttribute('data-testid', `param-input-${NAME}`)
  })

  it('{x} mode offers no list: the field is the expression box', () => {
    renderField({ ...TIME_DEFAULT, mode: 'expression' })
    expect(expressionBox()).toBeInTheDocument()
    expect(within(host()).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('a field without suggestions is a plain text box with no row test id', () => {
    renderField({ defaultValue: '@timestamp' })
    expect(within(host()).queryByRole('combobox')).not.toBeInTheDocument()
    expect(textbox()).not.toHaveAttribute('data-testid')
  })
})

// The hint an empty box shows: italic in the Text Muted gray, never over a null or <empty string> marker.
describe('BlockValueField - the hint of an empty box', () => {
  const HINT_LOOK = ['placeholder:italic', 'placeholder:text-[color:var(--color-text-muted)]']

  it('shows the hint on an empty field with no default', () => {
    renderField({ placeholder: 'logs-*' })
    expect(textbox()).toHaveValue('')
    expect(textbox()).toHaveAttribute('placeholder', 'logs-*')
    expect(textbox()).toHaveClass(...HINT_LOOK)
  })

  it('shows a declared hint over an empty gray default, in place of <empty string>', () => {
    renderField({ defaultValue: '', placeholder: 'No field' })
    expect(textbox()).toHaveValue('')
    expect(textbox()).toHaveAttribute('placeholder', 'No field')
    expect(shownElement(EMPTY_MARKER)).toBeNull()
    expect(textbox()).toHaveAccessibleDescription('not set, the default is used')
  })

  it('shows no hint over <empty string>', () => {
    renderField({ value: '', isSet: true, placeholder: 'No field' })
    expect(shown(EMPTY_MARKER)).toBeInTheDocument()
    expect(textbox()).not.toHaveAttribute('placeholder')
  })

  it('shows no hint over null', () => {
    renderField({ testId: 'note', label: 'Note', nullable: true, placeholder: 'No field' })
    expect(shown('null')).toBeInTheDocument()
    expect(textbox()).not.toHaveAttribute('placeholder')
  })
})

// The line's own colors draw it once: the box under them paints no text (FIELD-6).
describe('BlockValueField - a {x} entries line is drawn once', () => {
  it('keeps the box under the colored line clear of text', () => {
    renderField({ testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] })
    const box = textbox()
    expect(box).toHaveValue(ENTRY_LINE)
    expect(box).toHaveClass('text-transparent', 'caret-transparent')
    expect(box).not.toHaveClass(getValueColorClass('array'))
  })

  it('writes nested items with ", " between items and ": " after keys', () => {
    renderField({
      testId: 'stats',
      label: 'Stats',
      type: 'array',
      value: [{ stat: 'count' }, { stat: 'sum', field: 'bytes' }],
      isSet: true,
    })
    expect(textbox()).toHaveValue('[{"stat": "count"}, {"stat": "sum", "field": "bytes"}]')
  })
})

// The reset icon is small and Text Muted, like the null button's glyph, and darkens on hover (FIELD-3).
describe('BlockValueField - the reset icon look', () => {
  it.each([
    ['literal', 'literal'],
    ['{x}', 'expression'],
  ] as const)('is a small Text Muted icon in %s mode', (_mode, mode) => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true, mode })
    const reset = resetButton() as HTMLElement
    expect(reset).toHaveAccessibleName('Reset to default')
    expect(reset).toHaveClass(TEXT_MUTED, 'hover:text-foreground')
    expect(reset.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5')
  })
})

// A screen reader hears the key hint and the state the eye sees.
describe('BlockValueField - what a screen reader hears', () => {
  const keyHint = (name = NAME) => screen.getByTestId(`param-key-hint-${name}`)

  it('announces the key hint politely, and drops it when the field loses focus', async () => {
    const user = userEvent.setup()
    renderField({ defaultValue: 'eu-west-1' })
    expect(keyHint()).toHaveAttribute('aria-live', 'polite')
    expect(keyHint()).toHaveTextContent(/^$/)
    await user.click(textbox())
    await user.keyboard('{Backspace}')
    expect(keyHint()).toHaveTextContent(DEFAULT_TOOLTIP)
    act(() => textbox().blur())
    expect(keyHint()).toHaveTextContent(/^$/)
  })

  it('announces the {{ }} entries hint on a key in the line', async () => {
    const user = userEvent.setup()
    renderField({ testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] })
    await user.click(textbox())
    await user.keyboard('x')
    expect(keyHint('targets')).toHaveTextContent(ENTRIES_TOOLTIP)
  })

  it('describes a gray default as not set', () => {
    renderField({ defaultValue: 'eu-west-1' })
    expect(textbox()).toHaveValue('eu-west-1')
    expect(textbox()).toHaveAccessibleDescription('not set, the default is used')
  })

  it('describes a gray number default as not set', () => {
    renderField({ type: 'integer', testId: 'timeout', label: 'Timeout', defaultValue: 30 })
    expect(numberBox()).toHaveAccessibleDescription('not set, the default is used')
  })

  it('describes null as null, focused or not', async () => {
    const user = userEvent.setup()
    renderField({ testId: 'note', label: 'Note', nullable: true })
    expect(textbox()).toHaveAccessibleDescription('null')
    await user.click(textbox())
    expect(textbox()).toHaveAccessibleDescription('null')
  })

  it('describes a null number as null', () => {
    renderField({ type: 'integer', testId: 'timeout', label: 'Timeout', value: null, isSet: true, nullable: true })
    expect(numberBox()).toHaveAccessibleDescription('null')
  })

  it('describes empty text as empty string', () => {
    renderField({ value: '', isSet: true })
    expect(textbox()).toHaveAccessibleDescription('empty string')
  })

  it('adds nothing for a value the user set', () => {
    renderField({ defaultValue: 'eu-west-1', value: 'qa-team', isSet: true })
    expect(textbox()).not.toHaveAccessibleDescription()
    expect(textbox()).not.toHaveAttribute('aria-describedby')
  })

  it('adds nothing in {x} mode', () => {
    renderField({ defaultValue: 'eu-west-1', mode: 'expression' })
    expect(screen.queryByText('not set, the default is used')).not.toBeInTheDocument()
  })

  it.each([
    ['a text box', {}, () => textbox()],
    ['a number box', { type: 'integer' as const, testId: 'timeout', label: 'Timeout' }, () => numberBox()],
  ])('is described by the note under the field in %s', (_label, props, control) => {
    const spies = { onChange: vi.fn(), onUnset: vi.fn(), onNull: vi.fn(), onExpand: vi.fn() }
    render(
      <FieldNoteContext value="row-note">
        <Harness spies={spies} {...props} />
        <p id="row-note">Heads up</p>
      </FieldNoteContext>,
    )
    expect(control()).toHaveAccessibleDescription('Heads up')
  })
})

// A table default reads as its rows, as a held table does, never as the stored {columns, rows} (REQ-3.5.5.1, FIELD-2).
describe('BlockValueField - a table default', () => {
  const STORED_TABLE = {
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'string' },
    ],
    rows: [
      [1, 'a'],
      [2, 'b'],
    ],
  }
  const ROW_LINE = '[{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]'
  const tableField = { type: 'table', testId: 'rows', label: 'Rows' } as const

  it('shows a held table as its rows on one line', () => {
    renderField({ ...tableField, value: STORED_TABLE, isSet: true })
    expect(textbox()).toHaveValue(ROW_LINE)
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
  })

  it('shows a not-set table default as the same rows, in the Text Muted gray', () => {
    renderField({ ...tableField, defaultValue: STORED_TABLE })
    expect(textbox()).toHaveValue(ROW_LINE)
    expect(textbox()).toHaveClass(TEXT_MUTED)
    expect(textbox()).not.toHaveValue(expect.stringContaining('columns'))
  })

  it('hints a table default in {x} mode as the Python literal of its rows', () => {
    renderField({ ...tableField, defaultValue: STORED_TABLE, mode: 'expression' })
    expect(expressionBox()).toHaveAttribute('placeholder', "[{'id': 1, 'name': 'a'}, {'id': 2, 'name': 'b'}]")
  })
})

// A not-set field whose default is empty text draws it as held empty text: gray italic <empty string> (FIELD-4).
describe('BlockValueField - an empty gray default', () => {
  it('draws <empty string> in the Text Muted gray, italic, with no reset icon and no null button', () => {
    renderField({ defaultValue: '', nullable: true })
    expect(textbox()).toHaveValue('')
    expect(shown(EMPTY_MARKER)).toHaveClass(TEXT_MUTED, 'italic')
    expect(resetButton()).not.toBeInTheDocument()
    expect(nullButton()).not.toBeInTheDocument()
  })

  it('hides <empty string> while focused and brings it back on leaving, still not set', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: '' })
    await user.click(textbox())
    expect(shownElement(EMPTY_MARKER)).toBeNull()
    act(() => textbox().blur())
    expect(shown(EMPTY_MARKER)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('is told to a screen reader as a default that is not set', () => {
    renderField({ defaultValue: '' })
    expect(textbox()).toHaveAccessibleDescription('not set, the default is used')
  })

  it('takes typed text as the user value, which then shows no marker', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: '' })
    await user.type(textbox(), 'ab')
    expect(onChange.mock.lastCall?.[0]).toBe('ab')
    act(() => textbox().blur())
    expect(shownElement(EMPTY_MARKER)).toBeNull()
    expect(resetButton()).toBeInTheDocument()
  })
})

// A drawn line is one inline run that the field cuts with "…"; a flex row of segments would trim
// the space beside a {{ }} entry and cut with no mark.
describe('BlockValueField - the drawn line run', () => {
  // The drawn copy, not the clear box under it that holds the same text as its value.
  function drawnRun(text: string): HTMLElement {
    const runs = Array.from(host().querySelectorAll<HTMLElement>('span')).filter(
      (span) => span.textContent === text && !Array.from(span.children).some((child) => child.textContent === text),
    )
    expect(runs, `the field draws ${text}`).toHaveLength(1)
    return runs[0]
  }

  it('keeps every segment of a {{ }} line inline in one run that ends in "…" when cut', () => {
    renderField({ testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] })
    const run = drawnRun(ENTRY_LINE)
    expect(run.textContent).toBe('["web-1", {{ backup_host }}, "web-3"]')
    expect(run).toHaveClass('truncate', 'min-w-0')
    expect(run.parentElement).toHaveClass('flex')
    expect(run.parentElement).not.toHaveClass('truncate')
    const segments = Array.from(run.children)
    expect(segments.map((segment) => segment.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN'])
    expect(segments.map((segment) => segment.textContent)).toEqual(['["web-1", ', '{{ backup_host }}', ', "web-3"]'])
  })

  it('keeps an entry at the start spaced from the next item', () => {
    renderField({ testId: 'arguments', label: 'Arguments', type: 'array', value: ['run_id', 'alpha'], isSet: true, expressionEntries: ['0'] })
    const run = drawnRun('[{{ run_id }}, "alpha"]')
    expect(run).toHaveClass('truncate')
    expect(Array.from(run.children).map((segment) => segment.textContent)).toEqual(['[', '{{ run_id }}', ', "alpha"]'])
  })

  it('ends the text clear of a status mark at the right end of the field', () => {
    renderField({
      testId: 'headers',
      label: 'Headers',
      type: 'map',
      value: { Authorization: 'Bearer abc' },
      isSet: true,
      adornment: <span data-testid="row-advisory" />,
    })
    expect(textbox()).toHaveClass('pr-8')
  })

  it('ends a drawn {{ }} line clear of a status mark too', () => {
    renderField({
      testId: 'targets',
      label: 'Targets',
      type: 'array',
      value: ENTRY_LIST,
      isSet: true,
      expressionEntries: ['1'],
      adornment: <span data-testid="row-advisory" />,
    })
    expect(drawnRun(ENTRY_LINE).parentElement).toHaveClass('pr-8')
  })

  it('keeps the normal end padding with no status mark', () => {
    renderField({ testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] })
    expect(drawnRun(ENTRY_LINE).parentElement).not.toHaveClass('pr-8')
    expect(textbox()).not.toHaveClass('pr-8')
  })
})

// The clock and the lock share the left slot (FIELD-1): the same 16 px box and Text Muted, with or without a hint.
describe('BlockValueField - the left icon look', () => {
  const ICON_LOOK = ['size-4', TEXT_MUTED]

  it('draws the clock at the slot size in Text Muted', () => {
    renderField({ testId: 'to', label: 'To', leftIcon: 'clock', defaultValue: 'now' })
    expect(host().querySelector('svg.lucide-clock')).toHaveClass(...ICON_LOOK)
  })

  it.each([
    ['an empty credential', { value: undefined, isSet: false }],
    ['a typed credential', { value: 'typed-now', isSet: true }],
    ['a stored secret', { value: `${SECRET_ENVELOPE_PREFIX}c2VhbGVk`, isSet: true }],
  ])('draws the lock of %s like the clock, keeping its name and hint', async (_state, held) => {
    const user = userEvent.setup()
    renderField({ testId: 'token', label: 'Token', leftIcon: 'lock', leftIconLabel: 'Stored protected', ...held })
    expect(host().querySelector('svg.lucide-lock')).toHaveClass(...ICON_LOOK)
    const named = within(host()).getByLabelText('Stored protected')
    expect(named.querySelector('svg.lucide-lock')).not.toBeNull()
    await user.hover(named)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Stored protected')
  })
})

// Unfinished number text is named on the row, the way the variable window names it (REQ-3.1.3.14).
describe('BlockValueField - unfinished number text', () => {
  it('reports unfinished text as the row problem and clears it once the text is a number', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange } = renderField({ testId: 'ratio', label: 'Ratio', type: 'float', value: '2', isSet: true, onValidation })
    await user.type(numberBox('ratio'), '.')
    expect(onValidation).toHaveBeenLastCalledWith(['Enter a valid float value'])
    expect(onChange).not.toHaveBeenCalled()
    await user.type(numberBox('ratio'), '5')
    expect(onValidation).toHaveBeenLastCalledWith([])
    expect(onChange.mock.lastCall?.[0]).toBe('2.5')
  })

  it('shows a stored JS number in plain digits', () => {
    renderField({ testId: 'ratio', label: 'Ratio', type: 'float', value: 0.0000001, isSet: true })
    expect(numberBox('ratio')).toHaveValue('0.0000001')
  })
})

// Any change makes the user's value, even one equal to the default (FIELD-2).
describe('BlockValueField - text equal to the gray default', () => {
  it('pasting the copied gray default back makes it the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}')
    await user.copy()
    await user.paste()
    expect(onChange.mock.calls).toEqual([['eu-west-1', undefined]])
    expect(textbox()).toHaveValue('eu-west-1')
    expect(textbox()).toHaveClass(getValueColorClass('string'))
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton()).toBeInTheDocument()
  })

  it('typing a one-character default makes it the user value, then Backspace edits it', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'a' })
    await user.click(textbox())
    await user.keyboard('a')
    expect(onChange.mock.calls).toEqual([['a', undefined]])
    expect(resetButton()).toBeInTheDocument()
    await user.keyboard('b{Backspace}')
    expect(onChange.mock.lastCall?.[0]).toBe('a')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('pasting the copied gray list default back makes the same list the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ type: 'array', defaultValue: ['502', '503'] })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}')
    await user.copy()
    await user.paste()
    expect(onChange.mock.lastCall?.[0]).toEqual(['502', '503'])
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton()).toBeInTheDocument()
  })

  it('pasting the gray number default back stores the text a typed number stores', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    await user.click(numberBox())
    await user.paste('30')
    expect(onChange.mock.calls).toEqual([['30', undefined]])
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).not.toHaveClass(TEXT_MUTED)
    expect(resetButton('timeout')).toBeInTheDocument()
  })

  it('typing a one-digit number default stores the text a typed number stores', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 3 })
    await user.click(numberBox())
    await user.keyboard('3')
    expect(onChange.mock.calls).toEqual([['3', undefined]])
    expect(numberBox()).not.toHaveClass(TEXT_MUTED)
  })

  it.each([
    ['a float 2.5 over a selected 2', 'float', 2, '2.5'],
    ['an integer 30 over a selected 3', 'integer', 3, '30'],
  ] as const)('keeps every key of %s', async (_case, type, defaultValue, typed) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type, defaultValue })
    await user.click(numberBox())
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard(typed)
    expect(numberBox()).toHaveValue(typed)
    expect(onChange.mock.lastCall?.[0]).toBe(typed)
  })

  it('keeps the keys typed after a selected one-character text default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'a' })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}ab')
    expect(textbox()).toHaveValue('ab')
    expect(onChange.mock.lastCall?.[0]).toBe('ab')
  })

  it('adds the keys typed after the gray number default pasted back over its selection', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    await user.click(numberBox())
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('30')
    await user.keyboard('5')
    expect(numberBox()).toHaveValue('305')
    expect(onChange.mock.lastCall?.[0]).toBe('305')
  })
})

// The first key or paste replaces the whole gray default, then typing goes on as normal (FIELD-2).
describe('BlockValueField - typing over a gray default', () => {
  it.each([
    ['a float 1.5 over 1', 'float', 1, '1.5'],
    ['a float 10 over 1', 'float', 1, '10'],
    ['an integer 10 over 1', 'integer', 1, '10'],
    ['an integer -5 over 30', 'integer', 30, '-5'],
    ['a float -0.5 over 1.5', 'float', 1.5, '-0.5'],
    ['an integer 300 over 3', 'integer', 3, '300'],
    ['a float 0.5 over 2', 'float', 2, '0.5'],
  ] as const)('keeps every key of %s', async (_case, type, defaultValue, typed) => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type, defaultValue, onValidation })
    await user.click(numberBox())
    await user.keyboard(typed)
    expect(numberBox()).toHaveValue(typed)
    expect(onChange.mock.lastCall?.[0]).toBe(typed)
    expect(onValidation).toHaveBeenLastCalledWith([])
    expect(numberBox()).toHaveClass(getValueColorClass(type))
    expect(resetButton('timeout')).toBeInTheDocument()
  })

  it('draws unfinished number text in the value color, names its problem and lets Backspace edit it', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange, onUnset } = renderField({ testId: 'ratio', label: 'Ratio', type: 'float', defaultValue: 30, onValidation })
    await user.click(numberBox('ratio'))
    await user.keyboard('-')
    expect(numberBox('ratio')).toHaveValue('-')
    expect(numberBox('ratio')).toHaveClass(getValueColorClass('float'))
    expect(numberBox('ratio')).not.toHaveClass(TEXT_MUTED)
    expect(onValidation).toHaveBeenLastCalledWith(['Enter a valid float value'])
    await user.keyboard('.')
    expect(numberBox('ratio')).toHaveValue('-.')
    await user.keyboard('{Backspace}')
    expect(numberBox('ratio')).toHaveValue('-')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('brings the gray number default back once unfinished text is deleted to nothing', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange, onUnset } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30, onValidation })
    await user.click(numberBox())
    await user.keyboard('-{Backspace}')
    expect(onUnset).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(onValidation).toHaveBeenLastCalledWith([])
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
    await user.keyboard('{Backspace}')
    expect(await keyTooltip('timeout')).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('select all + Delete on unfinished number text brings the gray default back', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    await user.click(numberBox())
    await user.keyboard('-{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalled()
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
  })

  it('a change event with no input event before it leaves unfinished number text out of the gray default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    fireEvent.change(numberBox(), { target: { value: '-' } })
    act(() => numberBox().focus())
    await user.keyboard('{Backspace}')
    expect(onChange).not.toHaveBeenCalled()
    expect(await keyTooltip('timeout')).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('a change event with no input event before it leaves the gray default number as it is', () => {
    const { onChange } = renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    fireEvent.change(numberBox(), { target: { value: '45' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('pastes into a user value as typed, at the caret', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1', value: 'qa', isSet: true })
    await user.click(textbox())
    await user.paste('-team')
    expect(onChange.mock.calls).toEqual([['qa-team', undefined]])
  })

  it.each([
    ['a list over its default', 'array', ['502', '503', '504'], '[["429"]', '["429"]', ['429']],
    ['a list over an empty list', 'array', [], '[["-v"]', '["-v"]', ['-v']],
    ['a map over an empty map', 'map', {}, '{{"A": "1"}', '{"A": "1"}', { A: '1' }],
  ] as const)('keeps every key of %s and stores it once it reads as a value', async (_case, type, defaultValue, keys, line, stored) => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange } = renderField({ testId: 'codes', label: 'Codes', type, defaultValue, onValidation })
    await user.click(textbox())
    await user.keyboard(keys)
    expect(textbox()).toHaveValue(line)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.lastCall?.[0]).toEqual(stored)
    expect(onValidation).toHaveBeenLastCalledWith([])
    expect(textbox()).toHaveClass(getValueColorClass(type))
    expect(resetButton('codes')).toBeInTheDocument()
  })

  it('keeps every key of table rows over a table default and stores them', async () => {
    const user = userEvent.setup()
    const defaultValue = {
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
      rows: [[1, 'a']],
    }
    const { onChange } = renderField({ testId: 'rows', label: 'Rows', type: 'table', defaultValue })
    await user.click(textbox())
    await user.keyboard('[[{{"id": 3, "name": "c"}]')
    expect(textbox()).toHaveValue('[{"id": 3, "name": "c"}]')
    expect(onChange).toHaveBeenCalledTimes(1)
    // A typed number cell keeps its exact digits (REQ-3.1.3.14).
    expect(onChange.mock.lastCall?.[0]).toEqual({ columns: defaultValue.columns, rows: [['3', 'c']] })
  })

  it('draws list text typed so far in the value color, names its problem and lets Backspace edit it', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange, onUnset } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'], onValidation })
    await user.click(textbox())
    await user.keyboard('[[')
    expect(textbox()).toHaveValue('[')
    expect(textbox()).toHaveClass(getValueColorClass('array'))
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
    expect(onValidation).toHaveBeenLastCalledWith(['Unexpected end of JSON input'])
    await user.keyboard('"a{Backspace}')
    expect(textbox()).toHaveValue('["')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
  })

  it('brings the gray list default back once typed text is deleted to nothing', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange, onUnset } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'], onValidation })
    await user.click(textbox())
    await user.keyboard('[["{Backspace}{Backspace}')
    expect(onUnset).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(onValidation).toHaveBeenLastCalledWith([])
    expect(textbox()).toHaveValue('["502"]')
    expect(textbox()).toHaveClass(TEXT_MUTED)
    expect(textbox()).toHaveAccessibleDescription('not set, the default is used')
    await user.keyboard('{Backspace}')
    expect(await keyTooltip('codes')).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('select all + Delete on typed list text brings the gray default back', async () => {
    const user = userEvent.setup()
    const { onUnset } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'] })
    await user.click(textbox())
    await user.keyboard('[["a{Control>}a{/Control}{Delete}')
    expect(onUnset).toHaveBeenCalled()
    expect(textbox()).toHaveValue('["502"]')
    expect(textbox()).toHaveClass(TEXT_MUTED)
  })

  it('a paste of part of a list, then typing the rest, gives the whole list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'] })
    await user.click(textbox())
    await user.paste('["a", ')
    expect(textbox()).toHaveValue('["a", ')
    await user.keyboard('"b"]')
    expect(textbox()).toHaveValue('["a", "b"]')
    expect(onChange.mock.lastCall?.[0]).toEqual(['a', 'b'])
  })

  it('a list cleared back to its gray default takes a newly typed list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'], value: ['a'], isSet: true })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    expect(textbox()).toHaveClass(TEXT_MUTED)
    await user.keyboard('[["b"]')
    expect(textbox()).toHaveValue('["b"]')
    expect(onChange.mock.lastCall?.[0]).toEqual(['b'])
  })

  it('keeps typed text over the gray default of a field that takes a null, never showing null', async () => {
    const user = userEvent.setup()
    renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'], nullable: true })
    await user.click(textbox())
    await user.keyboard('[[')
    act(() => textbox().blur())
    expect(textbox()).toHaveValue('[')
    expect(shownElement('null')).toBeNull()
  })

  it('shows a new gray default that comes while typed text is held', async () => {
    const user = userEvent.setup()
    const spies = { onChange: vi.fn(), onUnset: vi.fn(), onNull: vi.fn(), onExpand: vi.fn() }
    const field = { testId: 'codes', label: 'Codes', type: 'array' } as const
    const { rerender } = render(<Harness spies={spies} {...field} defaultValue={['502']} />)
    await user.click(textbox())
    await user.keyboard('[[')
    rerender(<Harness spies={spies} {...field} defaultValue={['503']} />)
    expect(textbox()).toHaveValue('["503"]')
    expect(textbox()).toHaveClass(TEXT_MUTED)
  })

  it('a set list edited into unfinished text keeps its value until the line reads as a list again', async () => {
    const user = userEvent.setup()
    const onValidation = vi.fn()
    const { onChange, onUnset } = renderField({
      testId: 'codes',
      label: 'Codes',
      type: 'array',
      defaultValue: ['502'],
      value: ['a'],
      isSet: true,
      onValidation,
    })
    await user.click(textbox())
    await user.keyboard('{End}{Backspace}')
    expect(textbox()).toHaveValue('["a"')
    expect(textbox()).toHaveClass(getValueColorClass('array'))
    expect(onValidation).toHaveBeenLastCalledWith(["Line 1: Expected ',' or ']' after array element"])
    expect(onChange).not.toHaveBeenCalled()
    expect(resetButton('codes')).toBeInTheDocument()
    await user.keyboard(', "b"]')
    expect(onChange.mock.lastCall?.[0]).toEqual(['a', 'b'])
    expect(onUnset).not.toHaveBeenCalled()
  })
})

// A gray default with line breaks is cut with "…" on one line, yet typing or pasting replaces it (FIELD-2, VMGR-110).
describe('BlockValueField - a multi-line gray default', () => {
  const SCRIPT = 'print(1)\nprint(2)'

  it('shows the first line cut with "…" in the Text Muted gray', () => {
    renderField({ defaultValue: SCRIPT })
    expect(textbox()).toHaveValue('print(1)…')
    expect(textbox()).toHaveClass(TEXT_MUTED)
  })

  it('a key replaces the whole default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: SCRIPT })
    await user.click(textbox())
    await user.keyboard('x')
    expect(onChange.mock.calls).toEqual([['x', undefined]])
    expect(textbox()).toHaveValue('x')
  })

  it('a paste replaces the whole default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: SCRIPT })
    await user.click(textbox())
    await user.paste('y')
    expect(onChange.mock.calls).toEqual([['y', undefined]])
    expect(textbox()).toHaveValue('y')
  })

  it('copying the whole cut line copies the full default text', async () => {
    const user = userEvent.setup()
    renderField({ defaultValue: SCRIPT })
    await user.click(textbox())
    await user.keyboard('{Control>}a{/Control}')
    const copied = await user.copy()
    expect(copied?.getData('text/plain')).toBe(SCRIPT)
  })

  it('copying part of the cut line copies that part', async () => {
    const user = userEvent.setup()
    renderField({ defaultValue: SCRIPT })
    const box = textbox() as HTMLInputElement
    await user.click(box)
    act(() => box.setSelectionRange(0, 5))
    const copied = await user.copy()
    expect(copied?.getData('text/plain')).toBe('print')
  })

  it('pasting the full default back keeps its line breaks and makes it the user value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: SCRIPT })
    await user.click(textbox())
    await user.paste(SCRIPT)
    expect(onChange.mock.calls).toEqual([[SCRIPT, undefined]])
    expect(resetButton()).toBeInTheDocument()
  })

  it('Backspace only explains', async () => {
    const user = userEvent.setup()
    const { onChange, onUnset } = renderField({ defaultValue: SCRIPT })
    await user.click(textbox())
    await user.keyboard('{Backspace}')
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(await keyTooltip()).toHaveTextContent(DEFAULT_TOOLTIP)
  })

  it('a user text with line breaks stays cut and is not typed into, and copies whole', async () => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'pass', value: SCRIPT, isSet: true })
    const box = textbox() as HTMLInputElement
    expect(box).toHaveValue('print(1)…')
    expect(box.readOnly).toBe(true)
    await user.click(box)
    await user.keyboard('x')
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard('{Control>}a{/Control}')
    const copied = await user.copy()
    expect(copied?.getData('text/plain')).toBe(SCRIPT)
  })
})

// Windows AltGr sends Ctrl+Alt and Mac Option sends Alt with the character the layout writes.
describe('BlockValueField - AltGr and Option keys over a gray default', () => {
  const LAYOUT_KEYS = [
    ['AltGr (Ctrl+Alt)', '{Control>}{Alt>}', '{/Alt}{/Control}'],
    ['Option (Alt)', '{Alt>}', '{/Alt}'],
  ] as const

  it.each(LAYOUT_KEYS)('takes [ typed with %s as the first key over a gray list default', async (_how, hold, release) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ testId: 'codes', label: 'Codes', type: 'array', defaultValue: ['502'] })
    await user.click(textbox())
    await user.keyboard(`${hold}[[`)
    // The browser writes the layout's character over the selected default.
    fireEvent.change(textbox(), { target: { value: '[' } })
    await user.keyboard(release)
    expect(textbox()).toHaveValue('[')
    expect(textbox()).not.toHaveClass(TEXT_MUTED)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(textbox(), { target: { value: '["429"]' } })
    expect(onChange.mock.lastCall?.[0]).toEqual(['429'])
  })

  it.each(LAYOUT_KEYS)('takes @ typed with %s as the first key over a gray text default', async (_how, hold, release) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard(`${hold}@`)
    fireEvent.change(textbox(), { target: { value: '@' } })
    await user.keyboard(release)
    expect(onChange.mock.calls).toEqual([['@', undefined]])
    expect(textbox()).toHaveValue('@')
  })

  it.each(LAYOUT_KEYS)('takes a one-character default typed with %s as the user value', async (_how, hold, release) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: '@' })
    await user.click(textbox())
    await user.keyboard(`${hold}@${release}`)
    expect(onChange.mock.calls).toEqual([['@', undefined]])
    expect(resetButton()).toBeInTheDocument()
  })

  it.each([
    ['Ctrl', '{Control>}', '{/Control}'],
    ['Meta', '{Meta>}', '{/Meta}'],
    ['Meta+Alt', '{Meta>}{Alt>}', '{/Alt}{/Meta}'],
    ['Ctrl+Meta+Alt', '{Control>}{Meta>}{Alt>}', '{/Alt}{/Meta}{/Control}'],
  ] as const)('never takes a key sent with %s as typing', async (_how, hold, release) => {
    const user = userEvent.setup()
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    await user.click(textbox())
    await user.keyboard(`${hold}x`)
    fireEvent.change(textbox(), { target: { value: 'x' } })
    await user.keyboard(release)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('names the {{ }} entries rule on an AltGr key in the line', async () => {
    const user = userEvent.setup()
    renderField({ testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] })
    await user.click(textbox())
    await user.keyboard('{Control>}{Alt>}[[{/Alt}{/Control}')
    expect(screen.getByTestId('param-key-hint-targets')).toHaveTextContent(ENTRIES_TOOLTIP)
  })
})

describe('BlockValueField - edges of the key, paste and line rules', () => {
  it('ignores a paste into a read-only field', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1', readOnly: true })
    fireEvent.paste(textbox(), { clipboardData: { getData: () => 'us-east-1' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(textbox()).toHaveValue('eu-west-1')
  })

  it('leaves a paste into the {x} box to the expression editor', () => {
    const { onChange } = renderField({ mode: 'expression', value: 'region_var', isSet: true })
    fireEvent.paste(expressionBox(), { clipboardData: { getData: () => 'other_var' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('draws a revealed stored secret as one line of its text', () => {
    renderField({
      testId: 'token',
      label: 'Token',
      leftIcon: 'lock',
      value: `${SECRET_ENVELOPE_PREFIX}c2VhbGVk`,
      isSet: true,
      revealedText: 'hunter2',
    })
    expect(textbox()).toHaveValue('hunter2')
    expect(screen.queryByRole('button', { name: /Edit protected value$/ })).not.toBeInTheDocument()
  })

  it('draws a map held as text as text, even with {x} entries named', () => {
    renderField({ testId: 'headers', label: 'Headers', type: 'map', value: 'not a map', isSet: true, expressionEntries: ['a'] })
    expect(textbox()).toHaveValue('not a map')
  })

  it('keeps expand in {x} mode inside a frozen window', () => {
    render(
      <SheetFrozenContext value>
        <div data-testid="host">
          <BlockValueField
            type="string"
            mode="expression"
            nullable={false}
            hasEditor
            testId={NAME}
            label={LABEL}
            value="region_var"
            isSet
            onChange={vi.fn()}
            onUnset={vi.fn()}
            onNull={vi.fn()}
            onExpand={vi.fn()}
          />
        </div>
      </SheetFrozenContext>,
    )
    expect(expandButton()).toBeInTheDocument()
  })
})

describe('BlockValueField - a path shows its end (TDATA-8)', () => {
  const PATH = 'testdata://scripts/a/long/folder/name/deploy.sh'

  // jsdom lays nothing out: the box reports a wide text and records where it is scrolled to.
  function watchScroll(box: HTMLElement): Mock {
    const scrolledTo = vi.fn()
    Object.defineProperty(box, 'scrollWidth', { configurable: true, get: () => 400 })
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => 0, set: scrolledTo })
    return scrolledTo
  }

  it('scrolls a long path to its end, the file name, with no ellipsis', async () => {
    renderField({ value: PATH, isSet: true, showsEnd: true })
    const scrolledTo = watchScroll(textbox())
    await vi.waitFor(() => expect(scrolledTo).toHaveBeenCalledWith(400))
    expect(textbox()).toHaveClass('text-clip')
  })

  it('leaves the text where the user puts it while the box has focus, and shows the end again on blur', async () => {
    renderField({ value: PATH, isSet: true, showsEnd: true })
    const scrolledTo = watchScroll(textbox())
    await vi.waitFor(() => expect(scrolledTo).toHaveBeenCalled())
    scrolledTo.mockClear()
    act(() => textbox().focus())
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(scrolledTo).not.toHaveBeenCalled()
    act(() => textbox().blur())
    await vi.waitFor(() => expect(scrolledTo).toHaveBeenCalledWith(400))
  })

  it('keeps the start of a field that is not a path', async () => {
    renderField({ value: PATH, isSet: true })
    const scrolledTo = watchScroll(textbox())
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(scrolledTo).not.toHaveBeenCalled()
    expect(textbox()).not.toHaveClass('text-clip')
  })
})

describe('BlockValueField - text drawn over the box is kept from browser translation', () => {
  it.each([
    ['null', { testId: 'note', label: 'Note', value: null, isSet: true, nullable: true }, 'null'],
    ['<empty string>', { value: '', isSet: true }, EMPTY_MARKER],
    [
      'a line with {x} entries',
      { testId: 'targets', label: 'Targets', type: 'array', value: ENTRY_LIST, isSet: true, expressionEntries: ['1'] },
      ENTRY_LINE,
    ],
  ] as const)('marks %s translate="no"', (_name, props, text) => {
    renderField(props as Partial<FieldProps>)
    expect(shown(text).closest('[translate="no"]')).not.toBeNull()
  })
})

describe('BlockValueField - form names', () => {
  it('names the text box after the field', () => {
    renderField({ value: 'qa-team', isSet: true })
    expect(textbox()).toHaveAttribute('name', NAME)
  })

  it('names the number box after the field', () => {
    renderField({ testId: 'timeout', label: 'Timeout', type: 'integer', defaultValue: 30 })
    expect(numberBox()).toHaveAttribute('name', 'timeout')
  })
})
