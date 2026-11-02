/**
 * Tests for ScalarEditBody - the controlled scalar/string edit body used by
 * the inspect modal's edit state (REQ-3.1.3.11). Sibling to the dumb read-only
 * scalar-body.
 *
 * Contract under test:
 *   - controlled: renders the current draft value as an editable field,
 *     emits onChange(parsedValue) + onValidChange(isValid); never saves
 *   - string -> plain textarea;
 *     integer/float -> numeric input; boolean -> true/false button pair
 *   - the editable field keeps the type value color
 *   - numeric parse errors emit onValidChange(false) (host gates Save)
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/shared/variable-bodies/string-edit-body', () => ({
  StringEditBody: ({
    value,
    format,
    extraExtensions,
  }: {
    value: unknown
    format?: string
    extraExtensions?: unknown[]
  }) => (
    <div
      data-testid="string-edit-stub"
      data-format={format ?? ''}
      data-extra={JSON.stringify(extraExtensions ?? [])}
    >
      {String(value)}
    </div>
  ),
}))

import { ScalarEditBody } from '@/components/shared/variable-bodies/scalar-edit-body'
import type { VariableType } from '@/lib/variable-types'
import { HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'

interface RenderOptions {
  value?: unknown
  type?: VariableType
  onChange?: (value: unknown) => void
  onValidChange?: (valid: boolean) => void
  format?: 'json' | 'yaml' | 'xml' | 'plain'
  extraExtensions?: unknown[]
}

function renderBody({
  value = 'bob',
  type = 'string',
  onChange = vi.fn(),
  onValidChange = vi.fn(),
  format,
  extraExtensions,
}: RenderOptions = {}) {
  render(
    <ScalarEditBody
      value={value}
      type={type}
      onChange={onChange}
      onValidChange={onValidChange}
      format={format}
      extraExtensions={extraExtensions as never}
    />,
  )
  return { onChange, onValidChange }
}

function getInput(): HTMLTextAreaElement | HTMLInputElement {
  return screen.getByTestId('scalar-edit-input') as
    | HTMLTextAreaElement
    | HTMLInputElement
}

describe('ScalarEditBody - field shape by type', () => {
  it('delegates string values to the StringEditBody editor', () => {
    renderBody({ value: 'hello', type: 'string' })
    expect(screen.getByTestId('string-edit-stub')).toHaveTextContent('hello')
    expect(screen.queryByTestId('scalar-edit-input')).not.toBeInTheDocument()
  })

  it('renders a numeric input for integer values seeded from the draft', () => {
    renderBody({ value: 42, type: 'integer' })
    const input = getInput()
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveValue('42')
  })

  it('renders a numeric input for float values seeded from the draft', () => {
    renderBody({ value: 3.14, type: 'float' })
    expect(getInput()).toHaveValue('3.14')
  })

  it('renders the true/false segmented control for boolean values', () => {
    renderBody({ value: true, type: 'boolean' })
    expect(screen.getByTestId('scalar-edit-bool-true')).toBeInTheDocument()
    expect(screen.getByTestId('scalar-edit-bool-false')).toBeInTheDocument()
    expect(screen.queryByTestId('scalar-edit-input')).not.toBeInTheDocument()
  })

  it('gives the number box the form name its host passes', () => {
    render(<ScalarEditBody value={7} type="integer" name="variable-value" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(getInput()).toHaveAttribute('name', 'variable-value')
  })

  it('leaves the number box without a form name when its host passes none', () => {
    renderBody({ value: 7, type: 'integer' })
    expect(getInput()).not.toHaveAttribute('name')
  })

  it('puts the number box under the test id its host passes', () => {
    render(
      <ScalarEditBody value={7} type="integer" inputTestId="param-input-timeout" onChange={vi.fn()} onValidChange={vi.fn()} />,
    )
    expect(screen.getByTestId('param-input-timeout').tagName).toBe('INPUT')
    expect(screen.getByTestId('param-input-timeout')).toHaveValue('7')
    expect(screen.queryByTestId('scalar-edit-input')).not.toBeInTheDocument()
  })

  it('shows the hint its host passes on an empty number box', () => {
    render(<ScalarEditBody value="" type="integer" placeholder="5432" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(getInput()).toHaveValue('')
    expect(getInput()).toHaveAttribute('placeholder', '5432')
  })

  it('leaves the number box without a hint when its host passes none', () => {
    renderBody({ value: '', type: 'integer' })
    expect(getInput()).not.toHaveAttribute('placeholder')
  })
})

describe('ScalarEditBody - the true / false group name', () => {
  it('names the group by the caption whose id it is given', () => {
    render(
      <>
        <span id="bool-caption">Value</span>
        <ScalarEditBody value={false} type="boolean" onChange={vi.fn()} onValidChange={vi.fn()} labeledBy="bool-caption" />
      </>,
    )
    expect(screen.getByRole('group', { name: 'Value' })).toBeInTheDocument()
  })

  it('keeps the Edit value name with no caption', () => {
    renderBody({ value: true, type: 'boolean' })
    expect(screen.getByRole('group', { name: 'Edit value' })).toBeInTheDocument()
  })
})

describe('ScalarEditBody - type color', () => {
  it.each([
    ['integer', 7, /violet/],
    ['float', 1.5, /pink/],
  ] as const)('keeps the %s value color on the editable field', (type, value, color) => {
    renderBody({ value, type })
    expect(getInput().className).toMatch(color)
  })

  it('paints a held default in Text Muted', () => {
    render(<ScalarEditBody value={30} type="integer" muted onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(getInput()).toHaveClass(HELD_DEFAULT_LOOK_CLASS)
  })

  it('drops the held-default look once the box holds text that is not the default', () => {
    render(<ScalarEditBody value={30} type="integer" muted onChange={vi.fn()} onValidChange={vi.fn()} />)
    fireEvent.change(getInput(), { target: { value: '-' } })
    expect(getInput()).not.toHaveClass(HELD_DEFAULT_LOOK_CLASS)
    expect(getInput().className).toMatch(/violet/)
  })
})

describe('ScalarEditBody - numeric editing', () => {
  it('emits the integer as its exact string and onValidChange(true)', () => {
    const { onChange, onValidChange } = renderBody({ value: 1, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '99' } })
    expect(onChange).toHaveBeenLastCalledWith('99')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps a large integer exact (no JS-number rounding on save)', () => {
    const { onChange } = renderBody({ value: 1, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '1111111111111199999' } })
    expect(onChange).toHaveBeenLastCalledWith('1111111111111199999')
  })

  it('emits the float as its exact string and onValidChange(true) for a valid value', () => {
    const { onChange, onValidChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '2.5' } })
    expect(onChange).toHaveBeenLastCalledWith('2.5')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps a high-precision float exact (no JS-number rounding on save)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '-2123.123213123123699999' } })
    expect(onChange).toHaveBeenLastCalledWith('-2123.123213123123699999')
  })

  it('emits a dot-less float as its exact string', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '123' } })
    expect(onChange).toHaveBeenLastCalledWith('123')
  })

  it('rejects a decimal point in an integer field (the char never enters)', () => {
    const { onChange, onValidChange } = renderBody({ value: 1, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '3.14' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
    expect(onValidChange).not.toHaveBeenCalled()
  })

  it('rejects non-numeric input in a float field (the chars never enter)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: 'abc' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects valid-prefix garbage rather than silently truncating (0.1234x5678)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '0.1234x5678' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks the exponent char e (plain decimal only)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '1e' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks the exponent char E (plain decimal only)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '1E' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks a leading plus sign (only a leading minus is plain decimal)', () => {
    const { onChange } = renderBody({ value: 1, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '+1' } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts a 28-significant-digit float within the raised input cap', () => {
    const { onChange } = renderBody({ value: 0, type: 'float' })
    const value = '1.' + '9'.repeat(27) // 1 + 27 = 28 significant digits, 29 chars
    fireEvent.change(getInput(), { target: { value } })
    expect(getInput().value).toBe(value)
    expect(onChange).toHaveBeenLastCalledWith(value)
  })

  it('ignores input longer than the per-type cap', () => {
    const { onChange } = renderBody({ value: 1, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '1'.repeat(20) } })
    expect(getInput().value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks a 29th significant digit so the precision cap is never an error', () => {
    // A dot-less 29-digit value is under the char cap but over the 28-sig cap;
    // the keystroke must be blocked at the input (like the char cap), not
    // accepted then rejected. Leading zeros do not count toward the 28.
    const { onChange } = renderBody({ value: 0, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '1' + '9'.repeat(28) } }) // 29 sig
    expect(getInput().value).toBe('0')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts 28 significant digits even with a leading zero (zeros are not significant)', () => {
    const { onChange } = renderBody({ value: 0, type: 'float' })
    const value = '0' + '1' + '9'.repeat(27) // leading 0 stripped -> 28 significant digits
    fireEvent.change(getInput(), { target: { value } })
    expect(getInput().value).toBe(value)
    expect(onChange).toHaveBeenLastCalledWith(value)
  })

  it('accepts a 0.<28-digit> value (no longer char-capped: zeros + dot are free)', () => {
    // Significant digits (not chars) are the limit, so the dot can form -0.<28 sig>.
    const { onChange } = renderBody({ value: 0, type: 'float' })
    const value = '-0.' + '9'.repeat(28) // 28 significant digits, 31 chars
    fireEvent.change(getInput(), { target: { value } })
    expect(getInput().value).toBe(value)
    expect(onChange).toHaveBeenLastCalledWith(value)
  })

  it('keeps a generous float maxLength so a 0.<28-digit> value is never char-trapped', () => {
    // The precision limit is significant digits, not chars; the DOM maxLength is
    // a generous runaway backstop (>= 30 covers sign + 28 digits + dot + zeros).
    renderBody({ value: 1, type: 'float' })
    expect(getInput().maxLength).toBeGreaterThanOrEqual(30)
  })

  it('caps the integer input length with maxLength (+1 for the optional sign)', () => {
    renderBody({ value: 1, type: 'integer' })
    expect(getInput().maxLength).toBe(20)
  })

  it('does not let the minus sign eat into the digit cap', () => {
    const { onChange } = renderBody({ value: 1, type: 'integer' })
    // sign + 19 digits = 20 chars: the 19-digit budget is unchanged by the sign.
    const negNineteen = `-${'1'.repeat(19)}`
    fireEvent.change(getInput(), { target: { value: negNineteen } })
    expect(getInput().value).toBe(negNineteen)
    expect(onChange).toHaveBeenLastCalledWith(negNineteen)
  })
})

describe('ScalarEditBody - a cleared number box (K8SPROF-6)', () => {
  function renderNumber(type: VariableType, blank?: 'refuse' | 'unset') {
    const onChange = vi.fn()
    const onValidChange = vi.fn()
    render(
      <ScalarEditBody value="5432" type={type} onChange={onChange} onValidChange={onValidChange} blank={blank} />,
    )
    return { onChange, onValidChange }
  }

  it.each(['integer', 'float'] as const)('refuses a cleared %s box by default, never meaning zero (VMGR-95)', (type) => {
    const { onChange, onValidChange } = renderNumber(type)
    fireEvent.change(getInput(), { target: { value: '' } })
    expect(getInput().value).toBe('')
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalledWith('0')
    expect(onChange).not.toHaveBeenCalledWith(0)
  })

  it.each(['integer', 'float'] as const)('refuses a cleared %s box when told to refuse (VMGR-95)', (type) => {
    const { onChange, onValidChange } = renderNumber(type, 'refuse')
    fireEvent.change(getInput(), { target: { value: '' } })
    expect(getInput().value).toBe('')
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalledWith('0')
    expect(onChange).not.toHaveBeenCalledWith(0)
  })

  it('accepts a number typed into the box after it was cleared', () => {
    const { onChange, onValidChange } = renderNumber('integer', 'refuse')
    fireEvent.change(getInput(), { target: { value: '' } })
    fireEvent.change(getInput(), { target: { value: '7' } })
    expect(onChange).toHaveBeenLastCalledWith('7')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it.each(['integer', 'float'] as const)('stays empty for a %s field that may be left unset', (type) => {
    const { onChange, onValidChange } = renderNumber(type, 'unset')
    fireEvent.change(getInput(), { target: { value: '' } })
    expect(getInput().value).toBe('')
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('still parses a typed number in a field that may be left unset', () => {
    const { onChange } = renderNumber('integer', 'unset')
    fireEvent.change(getInput(), { target: { value: '9473' } })
    expect(onChange).toHaveBeenLastCalledWith('9473')
  })
})

describe('ScalarEditBody - numeric edit counter', () => {
  it('hides the counter for a low-precision float', () => {
    renderBody({ value: 0, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '3.14' } }) // 3 significant digits
    expect(screen.queryByTestId('scalar-edit-counter')).not.toBeInTheDocument()
  })

  it('shows a muted float counter from 80% of the 28-significant-digit cap', () => {
    renderBody({ value: 0, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '1.' + '9'.repeat(22) } }) // 23 sig
    const counter = screen.getByTestId('scalar-edit-counter')
    expect(counter).toHaveTextContent('23/28')
    expect(counter.className).toContain('text-muted-foreground')
  })

  it('shows a destructive float counter at the 28-significant-digit cap', () => {
    renderBody({ value: 0, type: 'float' })
    fireEvent.change(getInput(), { target: { value: '1.' + '9'.repeat(27) } }) // 28 sig
    const counter = screen.getByTestId('scalar-edit-counter')
    expect(counter).toHaveTextContent('28/28')
    expect(counter.className).toContain('text-destructive')
  })

  it('hides the counter for a short integer', () => {
    renderBody({ value: 0, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '42' } }) // 2 digits
    expect(screen.queryByTestId('scalar-edit-counter')).not.toBeInTheDocument()
  })

  it('shows a muted integer counter from 80% of the 19-digit cap', () => {
    renderBody({ value: 0, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '1'.repeat(16) } }) // 16 digits
    const counter = screen.getByTestId('scalar-edit-counter')
    expect(counter).toHaveTextContent('16/19')
    expect(counter.className).toContain('text-muted-foreground')
  })

  it('shows a destructive integer counter at the 19-digit cap', () => {
    renderBody({ value: 0, type: 'integer' })
    fireEvent.change(getInput(), { target: { value: '1'.repeat(19) } }) // 19 digits
    const counter = screen.getByTestId('scalar-edit-counter')
    expect(counter).toHaveTextContent('19/19')
    expect(counter.className).toContain('text-destructive')
  })
})

describe('ScalarEditBody - boolean editing', () => {
  it('emits onChange(true) and onValidChange(true) when true is picked', async () => {
    const user = userEvent.setup()
    const { onChange, onValidChange } = renderBody({ value: false, type: 'boolean' })
    await user.click(screen.getByTestId('scalar-edit-bool-true'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('emits onChange(false) when false is picked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: true, type: 'boolean' })
    await user.click(screen.getByTestId('scalar-edit-bool-false'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('marks the segment matching the current value as pressed', () => {
    renderBody({ value: true, type: 'boolean' })
    expect(screen.getByTestId('scalar-edit-bool-true')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('scalar-edit-bool-false')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('shows false as the chosen option on an untouched false draft', () => {
    renderBody({ value: false, type: 'boolean' })
    expect(screen.getByTestId('scalar-edit-bool-false')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('scalar-edit-bool-true')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

// ===========================================================================
// The string edit body threads the per-watcher Format + host-injected template
// extensions through to StringEditBody. Numeric / boolean branches ignore them.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

describe('ScalarEditBody - format threading (string branch)', () => {
  it('threads format + extra extensions to StringEditBody for strings', () => {
    renderBody({
      value: 'x',
      type: 'string',
      format: 'json',
      extraExtensions: ['EXTRA_A'],
    })
    const stub = screen.getByTestId('string-edit-stub')
    expect(stub).toHaveAttribute('data-format', 'json')
    expect(JSON.parse(stub.getAttribute('data-extra') ?? '[]')).toContain('EXTRA_A')
  })

  it('ignores format on numeric scalars (no string editor rendered)', () => {
    renderBody({ value: 1, type: 'integer', format: 'json' })
    expect(screen.queryByTestId('string-edit-stub')).not.toBeInTheDocument()
    expect(getInput()).toBeInTheDocument()
  })
})

describe('ScalarEditBody - numeric field height (FIELDERR-2)', () => {
  it.each(['integer', 'float'] as const)(
    'gives the %s input a table row height with size row',
    (type) => {
      render(
        <ScalarEditBody value={5} type={type} onChange={vi.fn()} onValidChange={vi.fn()} size="row" />,
      )
      expect(getInput()).toHaveClass('h-8', 'py-1')
      expect(getInput()).not.toHaveClass('py-2')
    },
  )

  it('keeps the body padding and no fixed height by default', () => {
    renderBody({ value: 5, type: 'integer' })
    expect(getInput()).toHaveClass('py-2')
    expect(getInput()).not.toHaveClass('h-8')
  })
})

// An emptied number box reports itself when it loses focus; the creation window ticks Set to null on it (VMGR-97).
describe('ScalarEditBody - an emptied number box losing focus (VMGR-97)', () => {
  it.each(['integer', 'float'] as const)('reports an emptied %s box when it loses focus, never before', (type) => {
    const onEmptyBlur = vi.fn()
    const onValidChange = vi.fn()
    render(
      <ScalarEditBody
        value={5}
        type={type}
        onChange={vi.fn()}
        onValidChange={onValidChange}
        onEmptyBlur={onEmptyBlur}
      />,
    )
    fireEvent.blur(getInput())
    expect(onEmptyBlur).not.toHaveBeenCalled()
    fireEvent.change(getInput(), { target: { value: '' } })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(onEmptyBlur).not.toHaveBeenCalled()
    fireEvent.blur(getInput())
    expect(onEmptyBlur).toHaveBeenCalledTimes(1)
    fireEvent.change(getInput(), { target: { value: '7' } })
    fireEvent.blur(getInput())
    expect(onEmptyBlur).toHaveBeenCalledTimes(1)
  })
})

describe('ScalarEditBody - an emptied number box in a host with no blur handler', () => {
  it('stays invalid and quiet when an emptied box loses focus', () => {
    const onValidChange = vi.fn()
    render(<ScalarEditBody value={5} type="integer" onChange={vi.fn()} onValidChange={onValidChange} />)

    fireEvent.change(getInput(), { target: { value: '' } })
    fireEvent.blur(getInput())

    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(getInput()).toHaveValue('')
  })
})

// A number shows and is compared in plain, exact digits (REQ-3.1.3.14).
describe('ScalarEditBody - plain exact numbers', () => {
  const numberBox = () => screen.getByTestId('scalar-edit-input')

  it('shows a JS number in plain digits and keeps it editable', async () => {
    const onChange = vi.fn()
    render(<ScalarEditBody value={0.0000001} type="float" onChange={onChange} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('0.0000001')
    await userEvent.type(numberBox(), '5')
    expect(onChange).toHaveBeenLastCalledWith('0.00000015')
  })

  it('shows a large JS integer in plain digits', () => {
    render(<ScalarEditBody value={1e18} type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('1000000000000000000')
  })

  it('empties the box when a value from outside goes back to none', async () => {
    const { rerender } = render(
      <ScalarEditBody value="" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />,
    )
    await userEvent.type(numberBox(), '5')
    rerender(<ScalarEditBody value="5" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    rerender(<ScalarEditBody value="" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('')
  })

  it('replaces unfinished text with a number from outside', async () => {
    const { rerender } = render(
      <ScalarEditBody value="" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />,
    )
    await userEvent.type(numberBox(), '-')
    rerender(<ScalarEditBody value={7} type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('7')
  })

  it('shows an absent value as an empty box', () => {
    render(<ScalarEditBody value={null} type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('')
  })

  it('takes a new outside number one JS double cannot tell from the shown one', () => {
    const { rerender } = render(
      <ScalarEditBody value="9007199254740992" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />,
    )
    rerender(<ScalarEditBody value="9007199254740993" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('9007199254740993')
  })

  it('keeps the text it shows for the same exact number written another way', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ScalarEditBody value="" type="float" onChange={onChange} onValidChange={vi.fn()} />,
    )
    await userEvent.type(numberBox(), '1.50')
    rerender(<ScalarEditBody value={1.5} type="float" onChange={onChange} onValidChange={vi.fn()} />)
    expect(numberBox()).toHaveValue('1.50')
  })

  it('counts integer digits without the sign', () => {
    render(
      <ScalarEditBody value="-1234567890123456" type="integer" onChange={vi.fn()} onValidChange={vi.fn()} />,
    )
    expect(screen.getByTestId('scalar-edit-counter')).toHaveTextContent('16/19')
  })

  it('hands unfinished text to a host that asks for it, and never as a value', async () => {
    const onChange = vi.fn()
    const onInvalidText = vi.fn()
    const onValidChange = vi.fn()
    render(
      <ScalarEditBody
        value=""
        type="float"
        onChange={onChange}
        onValidChange={onValidChange}
        onInvalidText={onInvalidText}
      />,
    )
    await userEvent.type(numberBox(), '-')
    expect(onInvalidText).toHaveBeenLastCalledWith('-')
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.type(numberBox(), '2')
    expect(onChange).toHaveBeenLastCalledWith('-2')
    expect(onInvalidText).toHaveBeenCalledTimes(1)
  })
})
