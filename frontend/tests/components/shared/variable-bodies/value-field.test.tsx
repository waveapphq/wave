/**
 * ValueField (shared) tests
 *
 * The shared per-type value affordance behind the Variable Setter rows and the
 * Profile parameter rows: an inline ScalarEditBody for integer / float / boolean,
 * and a plain truncating Edit-preview button for string + array / map / table
 * that opens the host's "Edit value" sheet. The plain button (no shadcn inner
 * wrapper) is what lets a long preview truncate instead of overflowing.
 */

import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValueField, type ValueFieldProps } from '@/components/shared/variable-bodies/value-field'
// Looked up per case, so a missing export fails its own cases and not the file.
import * as valueFieldModule from '@/components/shared/variable-bodies/value-field'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'

// Tooltip (wrapping the masked-secret button) reads the viewport hook.
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({ isTouchDevice: false, width: 1024, height: 768, breakpoint: 'lg' }),
}))

// Inline scalar body stand-in: emits a typed value through onChange so the
// field's value pass-through wiring can be asserted without CodeMirror.
vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ({ value, type, onChange, onValidChange, onInvalidText, blank }: any) => (
    <div
      data-testid="scalar-edit-body"
      data-type={type}
      data-value={String(value)}
      data-blank={blank ?? ''}
    >
      <button
        data-testid="emit-int"
        onClick={() => {
          onChange(42)
          onValidChange(true)
        }}
      >
        int
      </button>
      <button data-testid="emit-unfinished" onClick={() => onInvalidText('-')}>
        unfinished
      </button>
    </div>
  ),
}))

function renderField(props: Partial<ValueFieldProps> = {}) {
  const onChange = vi.fn()
  const onEdit = vi.fn()
  const result = render(
    <ValueField
      type="string"
      value=""
      onChange={onChange}
      onEdit={onEdit}
      editTestId="edit-value"
      {...props}
    />,
  )
  return { ...result, onChange, onEdit }
}

describe('ValueField (shared)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Inline scalar bodies (integer / float / boolean)
  // --------------------------------------------------------------------------
  describe('inline scalar bodies', () => {
    it.each(['integer', 'float', 'boolean'] as const)(
      'renders the shared ScalarEditBody inline for %s',
      (type) => {
        renderField({ type, value: type === 'boolean' ? true : '7' })
        expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-type', type)
      },
    )

    it('passes the value through to the scalar body', () => {
      renderField({ type: 'integer', value: '7' })
      expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', '7')
    })

    it('forwards a scalar edit through onChange', () => {
      const { onChange } = renderField({ type: 'integer', value: '7' })
      fireEvent.click(screen.getByTestId('emit-int'))
      expect(onChange).toHaveBeenCalledWith(42)
    })

    it('hands unfinished number text to the host as typed, so the host can name it (REQ-3.1.3.14)', () => {
      const { onChange } = renderField({ type: 'integer', value: '7' })
      fireEvent.click(screen.getByTestId('emit-unfinished'))
      expect(onChange).toHaveBeenCalledWith('-')
    })

    it('hands the scalar body what a cleared number box stands for', () => {
      renderField({ type: 'integer', value: '', blank: 'unset' })
      expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-blank', 'unset')
    })

    it('leaves a cleared number box to the scalar body default when not told', () => {
      renderField({ type: 'integer', value: '7' })
      expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-blank', '')
    })

    it('renders no Edit button for a scalar type', () => {
      renderField({ type: 'integer', value: '7', editTestId: 'edit-value' })
      expect(screen.queryByTestId('edit-value')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edit-preview button (string + array / map / table)
  // --------------------------------------------------------------------------
  describe('edit-preview button', () => {
    it('renders a plain <button> under the given editTestId', () => {
      renderField({ type: 'string', value: 'db.local', editTestId: 'edit-value' })
      expect(screen.getByTestId('edit-value').tagName).toBe('BUTTON')
    })

    it('outlines the button in red and points at the message while its row shows an error', () => {
      render(
        <FieldErrorContext value="row-error">
          <ValueField type="map" value={{ a: '1' }} onChange={vi.fn()} onEdit={vi.fn()} editTestId="edit-value" />
        </FieldErrorContext>,
      )
      expect(screen.getByTestId('edit-value')).toHaveClass('border-destructive')
      expect(screen.getByTestId('edit-value')).toHaveAttribute('aria-describedby', 'row-error')
    })

    it('keeps the normal border with no error', () => {
      renderField({ type: 'map', value: { a: '1' }, editTestId: 'edit-value' })
      expect(screen.getByTestId('edit-value')).toHaveClass('border-input')
    })

    it('quotes a non-empty string preview', () => {
      renderField({ type: 'string', value: 'db.local' })
      expect(screen.getByTestId('edit-value')).toHaveTextContent('"db.local"')
    })

    it('shows the empty-string placeholder preview', () => {
      renderField({ type: 'string', value: '' })
      expect(screen.getByTestId('edit-value')).toHaveTextContent('Edit…')
    })

    it('names the button with the host-supplied ariaLabel', () => {
      renderField({ type: 'string', value: '', ariaLabel: 'Edit API URL' })
      expect(screen.getByRole('button', { name: 'Edit API URL' })).toBeInTheDocument()
    })

    it('leaves the button unnamed when the host supplies no ariaLabel', () => {
      renderField({ type: 'string', value: '' })
      expect(screen.getByTestId('edit-value')).not.toHaveAttribute('aria-label')
    })

    it('calls onEdit when clicked', () => {
      const { onEdit } = renderField({ type: 'string', value: 'x' })
      fireEvent.click(screen.getByTestId('edit-value'))
      expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('disables the button when disabled', () => {
      renderField({ type: 'string', value: 'x', disabled: true })
      expect(screen.getByTestId('edit-value')).toBeDisabled()
    })

    it('is enabled by default (no disabled prop)', () => {
      renderField({ type: 'string', value: 'x' })
      expect(screen.getByTestId('edit-value')).toBeEnabled()
    })

    it('truncates the preview (truncate + min-w-0) so a long value cannot overflow', () => {
      renderField({ type: 'string', value: 'x'.repeat(120) })
      const preview = screen.getByTestId('edit-value').querySelector('span.truncate')
      expect(preview).not.toBeNull()
      expect(preview).toHaveClass('min-w-0')
    })

    it('tints a string preview with the string value color', () => {
      const { container } = renderField({ type: 'string', value: 'x' })
      expect(container.querySelector('.text-sky-300')).toBeInTheDocument()
    })

    it('renders an array preview muted (not the string color)', () => {
      const { container } = renderField({ type: 'array', value: ['a', 'b'] })
      expect(container.querySelector('.text-sky-300')).not.toBeInTheDocument()
      expect(screen.getByTestId('edit-value')).toHaveTextContent('2 items')
    })

    it('summarizes a map preview', () => {
      renderField({ type: 'map', value: { a: 1, b: 2 } })
      expect(screen.getByTestId('edit-value')).toHaveTextContent('2 pairs')
    })

    it('summarizes a table preview', () => {
      renderField({
        type: 'table',
        value: [
          { a: '1', b: '2', c: '3' },
          { a: '4', b: '5', c: '6' },
        ],
      })
      expect(screen.getByTestId('edit-value')).toHaveTextContent('2 rows x 3 col')
    })

    it('renders the italic placeholder for an empty string value when given', () => {
      renderField({ type: 'string', value: '', placeholder: '(auto from file extension)' })
      const placeholder = screen.getByText('(auto from file extension)')
      expect(placeholder).toHaveClass('italic')
      expect(placeholder).toHaveClass('truncate')
    })

    it('prefers the real value preview over the placeholder once a value exists', () => {
      renderField({ type: 'string', value: 'report.json', placeholder: '(auto from file extension)' })
      expect(screen.queryByText('(auto from file extension)')).not.toBeInTheDocument()
      expect(screen.getByTestId('edit-value')).toHaveTextContent('"report.json"')
    })

    it('shows no placeholder for a non-string type (strings only)', () => {
      renderField({ type: 'map', value: {}, placeholder: '(auto from file extension)' })
      expect(screen.queryByText('(auto from file extension)')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // PYRUN-21: the row a paused debug run lets the author edit keeps its Edit
  // affordance live inside the read-only form region around it. A <button>
  // there is disabled by the ancestor <fieldset disabled>, so the live
  // affordance is not a form control.
  // --------------------------------------------------------------------------
  describe('edit-preview affordance inside a frozen form region', () => {
    function renderFrozen(props: Partial<ValueFieldProps> = {}) {
      const onEdit = vi.fn()
      render(
        <fieldset disabled>
          <ValueField
            type="string"
            value="print(1)"
            onChange={vi.fn()}
            onEdit={onEdit}
            editTestId="edit-value"
            {...props}
          />
        </fieldset>,
      )
      return { onEdit, trigger: screen.getByTestId('edit-value') }
    }

    it('freezes the ordinary affordance with the form region around it', () => {
      const { trigger } = renderFrozen()
      expect(trigger.tagName).toBe('BUTTON')
      expect(trigger).toBeDisabled()
    })
  })
})

// blank='variable': a stored null shows the null chip (REQ-3.1.3.20, VMGR-93, VMGR-95).
const ALL_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

describe('ValueField (shared) - a stored null in a variable value cell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const nullChip = () => screen.getByRole('button', { name: 'retries (null)' })

  it.each(ALL_TYPES)('shows a stored null %s as the null chip named for the variable', (type) => {
    renderField({ type, value: null, blank: 'variable', fieldName: 'retries' })
    expect(nullChip()).toHaveTextContent(/^null$/)
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
    expect(screen.queryByTestId('edit-value')).not.toBeInTheDocument()
  })

  it('treats an absent value as null', () => {
    renderField({ type: 'integer', value: undefined, blank: 'variable', fieldName: 'retries' })
    expect(nullChip()).toBeInTheDocument()
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
  })

  it.each([
    ['string', ''],
    ['integer', 0],
    ['float', 0],
    ['boolean', false],
    ['array', []],
    ['map', {}],
    ['table', []],
  ] as const)('gives the %s type default when the chip is clicked', async (type, typeDefault) => {
    const user = userEvent.setup()
    const { onChange, onEdit } = renderField({
      type,
      value: null,
      blank: 'variable',
      fieldName: 'retries',
    })
    await user.click(nullChip())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(typeDefault)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('gives the type default when %s is pressed on the focused chip', async (_key, keys) => {
    const user = userEvent.setup()
    const { onChange } = renderField({
      type: 'integer',
      value: null,
      blank: 'variable',
      fieldName: 'retries',
    })
    await user.tab()
    expect(nullChip()).toHaveFocus()
    await user.keyboard(keys)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('explains the chip on keyboard focus', async () => {
    const user = userEvent.setup()
    renderField({ type: 'integer', value: null, blank: 'variable', fieldName: 'retries' })
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })

  it.each(['integer', 'float'] as const)('refuses an emptied %s box', (type) => {
    renderField({ type, value: '7', blank: 'variable', fieldName: 'retries' })
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-blank', 'refuse')
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })

  it('keeps an empty string an ordinary value, not null', () => {
    renderField({ type: 'string', value: '', blank: 'variable', fieldName: 'retries' })
    expect(screen.getByTestId('edit-value')).toHaveTextContent('Edit…')
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })

  it('keeps a string holding the text "null" an ordinary string', () => {
    renderField({ type: 'string', value: 'null', blank: 'variable', fieldName: 'retries' })
    expect(screen.getByTestId('edit-value')).toHaveTextContent('"null"')
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })

  it.each([
    ['an empty list', 'array', []],
    ['an empty map', 'map', {}],
    ['zero', 'integer', 0],
    ['false', 'boolean', false],
  ] as const)('keeps %s an ordinary value, not null', (_label, type, value) => {
    renderField({ type, value, blank: 'variable', fieldName: 'retries' })
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })
})

describe('ValueField (shared) - block parameter and profile fields keep their look for a stored null', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['a block parameter', 'refuse', 'refuse'],
    ['a profile parameter', 'unset', 'unset'],
    ['a field with no mode', undefined, ''],
  ] as const)('keeps the inline number box for %s', (_label, blank, received) => {
    renderField({ type: 'integer', value: null, blank, fieldName: 'retries' })
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-blank', received)
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })

  it.each(['refuse', 'unset'] as const)('keeps the Edit-preview button for a %s string field', (blank) => {
    renderField({ type: 'string', value: null, blank, fieldName: 'retries' })
    expect(screen.getByTestId('edit-value')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'retries (null)' })).not.toBeInTheDocument()
  })
})

describe('ValueField (shared) - the Edit-preview of a null value (VMGR-93)', () => {
  function nullLookClasses(): string[] {
    expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
    return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
  }

  it.each([
    ['string', 'a block parameter', 'refuse', null],
    ['string', 'a profile parameter', 'unset', undefined],
    ['array', 'a block parameter', 'refuse', null],
    ['map', 'a profile parameter', 'unset', null],
    ['table', 'a field with no mode', undefined, null],
  ] as const)('previews a null %s in %s as null with the one null look', (type, _label, blank, value) => {
    renderField({ type, value, blank })
    const preview = within(screen.getByTestId('edit-value')).getByText('null')
    expect(preview).toHaveTextContent(/^null$/)
    expect(preview).toHaveClass(...nullLookClasses())
  })

  it('previews a null in the Text Muted gray of the default, not the muted foreground', () => {
    renderField({ type: 'string', value: null, blank: 'refuse' })
    const preview = within(screen.getByTestId('edit-value')).getByText('null')
    expect(preview).toHaveClass('text-[color:var(--color-text-muted)]', 'italic')
    expect(preview).not.toHaveClass('text-muted-foreground')
  })

  it('previews a string holding the text "null" quoted, without the null look', () => {
    renderField({ type: 'string', value: 'null', blank: 'unset' })
    const preview = within(screen.getByTestId('edit-value')).getByText('"null"')
    expect(nullLookClasses().every((name) => preview.classList.contains(name))).toBe(false)
  })
})

// ============================================================================
// Masked secret render (promoted from the profile renderMaskedSecret).
//
// When a secret row HOLDS a value (and is not mid-inline-edit), ValueField
// renders one uniform masked clear-and-edit affordance for every type instead
// of the inline scalar / Edit-preview. Clicking it asks the host to start the
// clear-and-edit confirm (onEditSecret). With no `secret` prop the field is
// unchanged (the Variable Setter never passes it).
// ============================================================================

describe('ValueField (shared) - masked secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the uniform masked affordance for a secret string with a value', () => {
    renderField({ type: 'string', value: 'super-secret', secret: true, onEditSecret: vi.fn() })
    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    // The masked button replaces the Edit-preview, so the raw value never renders.
    expect(screen.queryByTestId('edit-value')).not.toBeInTheDocument()
    expect(screen.queryByText('"super-secret"')).not.toBeInTheDocument()
  })

  it('keeps the protected-value name when the host supplies an ariaLabel', () => {
    renderField({
      type: 'string',
      value: 'super-secret',
      secret: true,
      ariaLabel: 'Edit Token',
      onEditSecret: vi.fn(),
    })
    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit Token')).not.toBeInTheDocument()
  })

  it('masks a secret integer that holds a value (no inline scalar body)', () => {
    renderField({ type: 'integer', value: '42', secret: true, onEditSecret: vi.fn() })
    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
  })

  it.each(['array', 'map', 'table'] as const)(
    'renders one uniform masked affordance for a secret %s with a value',
    (type) => {
      const value =
        type === 'map' ? { k: 'v' } : type === 'table' ? [{ a: '1' }] : ['a']
      renderField({ type, value, secret: true, onEditSecret: vi.fn() })
      expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
      expect(screen.queryByLabelText(`Edit protected ${type}`)).not.toBeInTheDocument()
    },
  )

  it('fires onEditSecret (not onEdit) when the masked affordance is clicked', () => {
    const onEditSecret = vi.fn()
    const onEdit = vi.fn()
    renderField({ type: 'string', value: 'super-secret', secret: true, onEditSecret, onEdit })
    fireEvent.click(screen.getByLabelText('Edit protected value'))
    expect(onEditSecret).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('takes the keyboard focus when it is clicked, before the host is asked', () => {
    const focusedWhenAsked: (Element | null)[] = []
    const onEditSecret = vi.fn(() => focusedWhenAsked.push(document.activeElement))
    renderField({ type: 'string', value: 'super-secret', secret: true, onEditSecret })
    const masked = screen.getByLabelText('Edit protected value')
    expect(masked).not.toHaveFocus()

    // A click that moves no focus, as in a browser that does not focus a clicked button.
    fireEvent.click(masked)

    expect(masked).toHaveFocus()
    expect(focusedWhenAsked).toEqual([masked])
  })

  it('takes the focus and asks nothing when the host gives it no confirm to start', () => {
    const { onEdit, onChange } = renderField({ type: 'string', value: 'super-secret', secret: true })
    const masked = screen.getByLabelText('Edit protected value')

    fireEvent.click(masked)

    expect(masked).toHaveFocus()
    expect(onEdit).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables the masked affordance when disabled', () => {
    renderField({
      type: 'string',
      value: 'super-secret',
      secret: true,
      disabled: true,
      onEditSecret: vi.fn(),
    })
    expect(screen.getByLabelText('Edit protected value')).toBeDisabled()
  })

  it('shows the Edit-preview (not masked) for a secret string with no value', () => {
    renderField({ type: 'string', value: '', secret: true, onEditSecret: vi.fn() })
    expect(screen.getByTestId('edit-value')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it.each([null, undefined])('shows the Edit-preview (not masked) for a secret string value of %s', (value) => {
    renderField({ type: 'string', value, secret: true, onEditSecret: vi.fn() })
    expect(screen.getByTestId('edit-value')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it.each([
    ['whitespace', '   '],
    ['a sealed envelope', 'wave:enc:v1:abc'],
    ['the mask', '********'],
  ])('masks a secret string holding %s', (_label, value) => {
    renderField({ type: 'string', value, secret: true, onEditSecret: vi.fn() })
    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-value')).not.toBeInTheDocument()
  })

  it('shows the inline scalar (not masked) while isEditingSecret is true', () => {
    renderField({
      type: 'integer',
      value: '42',
      secret: true,
      isEditingSecret: true,
      onEditSecret: vi.fn(),
    })
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it('never masks a boolean (boolean is never secret)', () => {
    renderField({ type: 'boolean', value: true, secret: true, onEditSecret: vi.fn() })
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it('is unaffected when no secret prop is given (Variable Setter path)', () => {
    renderField({ type: 'string', value: 'plain' })
    expect(screen.getByTestId('edit-value')).toHaveTextContent('"plain"')
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })
})

// ============================================================================
// The masked control as its own export, for hosts that own the stored value.
// ============================================================================

type MaskedSecretControlProps = ComponentProps<typeof valueFieldModule.MaskedSecretControl>

const MASKED_CONTROL_FORMS = ['pill', 'field'] as const
const MASKED_CONTROL_NAME = { name: 'Edit protected value' } as const
const MASKED_CONTROL_HINT = 'Edit will clear the existing value'

function renderMaskedControl(props: MaskedSecretControlProps = {}) {
  const Control = valueFieldModule.MaskedSecretControl
  expect(Control, 'value-field exports MaskedSecretControl').toBeDefined()
  return render(<Control {...props} />)
}

function maskedControl(): HTMLElement {
  return screen.getByRole('button', MASKED_CONTROL_NAME)
}

function describedByIds(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}

describe('MaskedSecretControl (the masked control on its own)', () => {
  it('renders the masked control under the name it has inside ValueField', () => {
    renderMaskedControl()
    expect(maskedControl()).toBeInTheDocument()
  })

  it.each([
    ['by default', {}],
    ['when asked for the pill form', { secretAffordance: 'pill' }],
  ] as const)('keeps the lock inside the control %s', (_label, props) => {
    renderMaskedControl(props)
    expect(maskedControl().querySelector('svg.lucide-lock')).not.toBeNull()
  })

  it('leaves the lock to the host in the field form (SECFLD-2)', () => {
    renderMaskedControl({ secretAffordance: 'field' })
    expect(maskedControl().querySelector('svg.lucide-lock')).toBeNull()
  })

  describe.each(MASKED_CONTROL_FORMS)('in the %s form', (secretAffordance) => {
    it('puts the given id on the control', () => {
      renderMaskedControl({ secretAffordance, id: 'proxy-password' })
      expect(maskedControl()).toHaveAttribute('id', 'proxy-password')
    })

    it('points the control at the given description', () => {
      renderMaskedControl({ secretAffordance, 'aria-describedby': 'proxy-password-help' })
      expect(describedByIds(maskedControl())).toContain('proxy-password-help')
    })

    it('puts the given test id on the control', () => {
      renderMaskedControl({ secretAffordance, 'data-testid': 'proxy-password-masked' })
      expect(screen.getByTestId('proxy-password-masked')).toBe(maskedControl())
    })

    it('adds the given class to the control', () => {
      renderMaskedControl({ secretAffordance, className: 'settings-control-slot' })
      expect(maskedControl()).toHaveClass('settings-control-slot')
    })

    it('draws its pencil, lock and dots muted, over the outline button text color', () => {
      renderMaskedControl({ secretAffordance })
      const control = maskedControl()
      expect(control).toHaveClass('btn-secondary')
      expect(control).toHaveClass('!text-muted-foreground')
      expect(control).not.toHaveClass('text-muted-foreground')
      // The icons and the dots inherit the control's color: none sets its own.
      for (const part of control.querySelectorAll('svg, span')) {
        expect(part.getAttribute('class') ?? '').not.toMatch(/(^|\s)!?text-(?!sm\b|xs\b)/)
      }
    })

    it('carries no id, description or test id when none is given', () => {
      renderMaskedControl({ secretAffordance })
      const control = maskedControl()
      expect(control).not.toHaveAttribute('id')
      expect(control).not.toHaveAttribute('aria-describedby')
      expect(control).not.toHaveAttribute('data-testid')
    })

    it('calls onClick once per click', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      renderMaskedControl({ secretAffordance, onClick })

      await user.click(maskedControl())

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('is disabled when told, and a click then calls nothing', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      renderMaskedControl({ secretAffordance, onClick, disabled: true })

      expect(maskedControl()).toBeDisabled()
      await user.click(maskedControl())

      expect(onClick).not.toHaveBeenCalled()
    })

    it('is the control ValueField shows for a secret holding a value', () => {
      const onItsOwn = renderMaskedControl({ secretAffordance })
      const inValueField = renderField({
        type: 'string',
        value: 'super-secret',
        secret: true,
        secretAffordance,
      })

      expect(within(onItsOwn.container).getByRole('button', MASKED_CONTROL_NAME).outerHTML).toBe(
        within(inValueField.container).getByRole('button', MASKED_CONTROL_NAME).outerHTML,
      )
    })
  })

  describe('keyboard', () => {
    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('answers %s on the focused control like a click', async (_key, keys) => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      renderMaskedControl({ onClick })

      await user.tab()
      expect(maskedControl()).toHaveFocus()
      await user.keyboard(keys)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('shows its hint on keyboard focus', async () => {
      const user = userEvent.setup()
      renderMaskedControl()

      await user.tab()

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        new RegExp(`^${MASKED_CONTROL_HINT}$`),
      )
    })

    it('is described by its hint while the hint shows', async () => {
      const user = userEvent.setup()
      renderMaskedControl()

      await user.tab()
      await screen.findByRole('tooltip')

      expect(maskedControl()).toHaveAccessibleDescription(MASKED_CONTROL_HINT)
    })
  })
})
