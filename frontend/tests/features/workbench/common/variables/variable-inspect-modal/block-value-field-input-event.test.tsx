// The one value field of a Block row: an input event no key or paste started (a fill, autofill, a dropped text)
// over a gray default (FIELD-2, REQ-3.1.1.5).

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, type Mock } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

// The field never opens a sheet itself: its host opens the editor from onExpand.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => <div data-testid="value-editor-sheet" />,
}))

import { BlockValueField } from '@/features/workbench/common/variables/variable-inspect-modal/window-value-field'
import { getValueColorClass } from '@/lib/variable-format'

type FieldProps = ComponentProps<typeof BlockValueField>

// Text Muted (--color-text-muted): the gray of a default.
const TEXT_MUTED = 'text-[color:var(--color-text-muted)]'

interface Spies {
  onChange: Mock
  onUnset: Mock
}

// Holds the value and its set flag the way a Block row does, so the field sees its own changes come back.
function Harness({ spies, ...props }: Readonly<Partial<FieldProps> & { spies: Spies }>) {
  const [held, setHeld] = useState<{ value: unknown; isSet: boolean }>({ value: undefined, isSet: false })
  return (
    <div data-testid="host">
      <BlockValueField
        type="string"
        mode="literal"
        nullable={false}
        hasEditor
        testId="field"
        label="Field"
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
        onNull={() => undefined}
        onExpand={() => undefined}
      />
    </div>
  )
}

function renderField(props: Partial<FieldProps>): Spies {
  const spies = { onChange: vi.fn(), onUnset: vi.fn() }
  render(<Harness spies={spies} {...props} />)
  return spies
}

const host = () => screen.getByTestId('host')
const textbox = () => within(host()).getByRole('textbox')
const numberBox = () => within(host()).getByTestId('param-input-field')
const resetButton = () => screen.queryByTestId('param-reset-field')

/** One input event carrying `data`, leaving the box at `value`: what a fill, autofill or a drop dispatches. */
function inputEvent(box: HTMLElement, value: string, init: { data?: string | null; inputType?: string } = {}) {
  act(() => {
    fireEvent.input(box, { target: { value }, data: init.data ?? null, inputType: init.inputType ?? 'insertText' })
  })
}

/** Set the box's text the way the browser does before it fires the input event. */
function setBoxText(box: HTMLElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text)
}

function expectUserValue(box: HTMLElement, type: Parameters<typeof getValueColorClass>[0], shown: string) {
  expect(box).toHaveValue(shown)
  expect(box).toHaveClass(getValueColorClass(type))
  expect(box).not.toHaveClass(TEXT_MUTED)
  expect(resetButton()).toBeInTheDocument()
}

describe('BlockValueField - an input event with no key over a gray default', () => {
  it('a text fill replaces the whole default and is the user value', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    inputEvent(textbox(), 'us-east-2', { data: 'us-east-2' })
    expect(onChange.mock.calls).toEqual([['us-east-2', undefined]])
    expectUserValue(textbox(), 'string', 'us-east-2')
  })

  it('a text dropped inside the default replaces the whole default, never edits it in part', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    inputEvent(textbox(), 'eu-wXest-1', { data: 'X', inputType: 'insertFromDrop' })
    expect(onChange.mock.calls).toEqual([['X', undefined]])
    expectUserValue(textbox(), 'string', 'X')
  })

  it('an autofill with no data takes the whole new text', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    inputEvent(textbox(), 'ap-south-1', { inputType: 'insertReplacementText' })
    expect(onChange.mock.calls).toEqual([['ap-south-1', undefined]])
    expectUserValue(textbox(), 'string', 'ap-south-1')
  })

  it('a number fill shows and stores the same number', () => {
    const { onChange } = renderField({ type: 'integer', defaultValue: 30, hasEditor: false })
    inputEvent(numberBox(), '45', { data: '45' })
    expect(onChange.mock.lastCall?.[0]).toBe('45')
    expectUserValue(numberBox(), 'integer', '45')
  })

  it('a number dropped inside the default replaces the whole default', () => {
    const { onChange } = renderField({ type: 'integer', defaultValue: 30, hasEditor: false })
    inputEvent(numberBox(), '370', { data: '7', inputType: 'insertFromDrop' })
    expect(onChange.mock.lastCall?.[0]).toBe('7')
    expectUserValue(numberBox(), 'integer', '7')
  })

  it('a dropped text that is not a number leaves the gray number default as it was', () => {
    const { onChange } = renderField({ type: 'integer', defaultValue: 30, hasEditor: false })
    inputEvent(numberBox(), '3x0', { data: 'x', inputType: 'insertFromDrop' })
    expect(onChange).not.toHaveBeenCalled()
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
    expect(resetButton()).not.toBeInTheDocument()
  })

  it('a fill equal to the gray default is the user value (FIELD-2)', () => {
    const { onChange } = renderField({ type: 'float', defaultValue: 2.5, hasEditor: false })
    inputEvent(numberBox(), '2.5', { data: '2.5' })
    expect(onChange.mock.calls).toEqual([['2.5', undefined]])
    expectUserValue(numberBox(), 'float', '2.5')
  })

  it('a deletion with no key leaves the gray default whole, in the box too', () => {
    const { onChange, onUnset } = renderField({ type: 'integer', defaultValue: 30, hasEditor: false })
    inputEvent(numberBox(), '3', { inputType: 'deleteContentBackward' })
    expect(onChange).not.toHaveBeenCalled()
    expect(onUnset).not.toHaveBeenCalled()
    expect(numberBox()).toHaveValue('30')
    expect(numberBox()).toHaveClass(TEXT_MUTED)
  })

  it('a deletion with no key leaves a gray text default whole', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    inputEvent(textbox(), 'eu-west-', { inputType: 'deleteContentBackward' })
    expect(onChange).not.toHaveBeenCalled()
    expect(textbox()).toHaveValue('eu-west-1')
    expect(textbox()).toHaveClass(TEXT_MUTED)
  })

  it('text a composition is still building is left to the composition', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    act(() => {
      fireEvent.input(textbox(), { target: { value: 'eu-west-1k' }, data: 'k', isComposing: true })
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(textbox()).toHaveValue('eu-west-1')
  })

  it.each([
    ['a list', 'array', ['502', '503'], '["429"]', ['429']],
    ['a map', 'map', { k: 1 }, '{"k": "v"}', { k: 'v' }],
    [
      'a table',
      'table',
      { columns: [{ name: 'name', type: 'string' }], rows: [['alpha']] },
      '[{"name": "gamma"}]',
      [{ name: 'gamma' }],
    ],
  ] as const)('%s fill replaces the whole default and is the user value', (_case, type, defaultValue, filled, stored) => {
    const { onChange } = renderField({ type, defaultValue })
    inputEvent(textbox(), filled, { data: filled })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.lastCall?.[0]
    if (type === 'table') {
      expect(next).toMatchObject({ rows: [['gamma']] })
    } else {
      expect(next).toEqual(stored)
    }
    expectUserValue(textbox(), type, filled)
  })

  it('a dropped text read from the drop carries no data of its own and still replaces the whole default', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    const drop = new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'dropped' } })
    act(() => {
      setBoxText(textbox(), 'eu-dropped-west-1')
      fireEvent(textbox(), drop)
    })
    expect(onChange.mock.calls).toEqual([['dropped', undefined]])
    expectUserValue(textbox(), 'string', 'dropped')
  })

  it('an input event that is no InputEvent (some autofill) takes the whole new text', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    act(() => {
      setBoxText(textbox(), 'sa-east-1')
      fireEvent(textbox(), new Event('input', { bubbles: true }))
    })
    expect(onChange.mock.calls).toEqual([['sa-east-1', undefined]])
    expectUserValue(textbox(), 'string', 'sa-east-1')
  })

  it('a fill equal to a many-line gray default makes the whole default the user value', () => {
    const { onChange } = renderField({ defaultValue: 'first line\nsecond line' })
    expect(textbox()).toHaveValue('first line…')
    inputEvent(textbox(), 'first line\nsecond line', { data: 'first line\nsecond line' })
    expect(onChange.mock.calls).toEqual([['first line\nsecond line', undefined]])
    expect(resetButton()).toBeInTheDocument()
  })

  it('a read-only field takes no input event', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1', readOnly: true })
    inputEvent(textbox(), 'us-east-2', { data: 'us-east-2' })
    expect(onChange).not.toHaveBeenCalled()
    expect(textbox()).toHaveValue('eu-west-1')
  })

  it('after the input event replaced the default, the next input edits the user value as usual', () => {
    const { onChange } = renderField({ defaultValue: 'eu-west-1' })
    inputEvent(textbox(), 'us', { data: 'us' })
    inputEvent(textbox(), 'us-2', { data: '-2' })
    expect(onChange.mock.calls).toEqual([
      ['us', undefined],
      ['us-2', undefined],
    ])
  })
})
