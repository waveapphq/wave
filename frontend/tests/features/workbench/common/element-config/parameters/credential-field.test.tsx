/**
 * Declared credential input field - status indicator + write-only masking (REQ-3.1.3.18).
 *
 * A plugin-declared credential input field (parameter.secret === true) is
 * protected by default wherever a value is entered directly:
 *   - STORED literal (a sealed `wave:enc:v1:` envelope from the saved config)
 *     -> the field is masked write-only (the shared ValueField.secret
 *     affordance, aria-label "Edit protected value") and a gray Lock status
 *     indicator carries the protected tooltip.
 *   - Literal typed THIS session (plaintext, pre-save) -> stays visible and
 *     inline-editable (the normal string edit affordance) with the Lock
 *     indicator; it seals when the config is saved.
 *   - Expression referencing a SECRET variable -> a gray Lock status indicator.
 *   - Expression referencing a NON-secret variable -> an amber alert status
 *     indicator whose copy names the variable and never blocks save/run.
 *   - A non-credential param is visually unchanged (no status indicator).
 *
 * Contract this test pins:
 *   - `parameter.secret` marks a credential field (added to the element-config
 *     Parameter type).
 *   - `AvailableVariable` gains `isSecret?`; in expression mode the field
 *     resolves the referenced variable by matching the expression value against
 *     an available-variable name and reads that variable's `isSecret`.
 *   - The status indicator exposes its tooltip copy as an accessible label
 *     (aria-label), so it is assertable without hovering the tooltip.
 *
 * Design Reference: REQ-3.1.3.18; SECFLD-1..4.
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The inline expression editor is heavy (CodeMirror); the status-indicator
// assertions only need the row's value cell, so stub it out.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: (props: { name: string; value: string }) => (
    <div data-testid="mock-expression-field" data-name={props.name} data-value={props.value} />
  ),
}))

const sheetValues = vi.hoisted(() => [] as unknown[])

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: ({ value }: { value: unknown }) => {
    sheetValues.push(value)
    return null
  },
}))

// The masked ValueField affordance and the status indicator both wrap a Tooltip,
// which reads the viewport.
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({ isTouchDevice: false, width: 1024, height: 768, breakpoint: 'lg' }),
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import { resolveCredentialStatus } from '@/features/workbench/common/element-config/parameters/parameter-value-inputs'
import { CredentialRevealContext } from '@/features/workbench/common/element-config/use-credential-reveal'
import { functionBlockInputs } from '@/features/functions/lib/function-block-fields'
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'

// `secret?` on the element-config Parameter and `isSecret?` on AvailableVariable, spelled out for this test.
type CredParam = Parameter & { secret?: boolean }
type SecretAwareVar = AvailableVariable & { isSecret?: boolean }

const LITERAL_TOOLTIP =
  'This value is stored protected - after saving, it can be replaced, and viewed only ' +
  'while secret unmasking is enabled in Settings.'
const SECRET_EXPR_TOOLTIP = 'Value protected - references a secret variable.'
const nonSecretExprTooltip = (name: string) =>
  `Variable ${name} is not a secret - its value is stored and displayed unprotected. ` +
  `Mark it secret in the Variable Manager to protect it.`

const credentialParam: CredParam = {
  name: 'password',
  label: 'Password',
  type: 'string',
  required: false,
  secret: true,
}

const plainParam: Parameter = {
  name: 'host',
  label: 'Host',
  type: 'string',
  required: false,
}

const availableVariables: SecretAwareVar[] = [
  { name: 'secret_ref', type: 'string', isSecret: true },
  { name: 'plain_ref', type: 'string', isSecret: false },
]

/** The row shows this exact text: as a field's value, or as the text of its innermost element. */
function showsText(text: string): boolean {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  if (fields.some((field) => field.value === text)) return true
  return (
    screen.queryAllByText(
      (_content, element) =>
        element !== null &&
        element.textContent === text &&
        !Array.from(element.children).some((child) => child.textContent === text),
    ).length > 0
  )
}

const baseProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: availableVariables as AvailableVariable[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

function renderRow(
  props: React.ComponentProps<typeof ParameterRow>,
  revealed: Record<string, string> = {},
) {
  return render(
    <CredentialRevealContext value={revealed}>
      <table>
        <tbody>
          <ParameterRow {...props} />
        </tbody>
      </table>
    </CredentialRevealContext>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// A stored credential value arrives from the saved config as a sealed envelope.
const SEALED_VALUE = 'wave:enc:v1:c2VhbGVkLXNlY3JldA=='

describe('Credential field - literal value (REQ-3.1.3.18)', () => {
  it('renders the write-only masked affordance for a STORED (sealed) credential literal', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: SEALED_VALUE,
    })

    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(screen.queryByText(/wave:enc:v1:/)).not.toBeInTheDocument()
  })

  it('shows the gray lock status indicator carrying the protected tooltip copy', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: SEALED_VALUE,
    })

    expect(screen.getByLabelText(LITERAL_TOOLTIP)).toBeInTheDocument()
  })

  it('keeps a literal typed this session visible and inline-editable until save', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: 'pw-typed-this-session',
    })

    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Password' })).toHaveValue('pw-typed-this-session')
    expect(screen.getByLabelText(LITERAL_TOOLTIP)).toBeInTheDocument()
  })

  it('shows the empty edit affordance for an unset credential field (no "undefined")', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: undefined,
    })

    expect(screen.getByRole('textbox', { name: 'Password' })).toHaveValue('')
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it('reveals a stored (sealed) credential in the clear when the credential-inputs unmask is on', () => {
    renderRow(
      {
        ...baseProps,
        parameter: credentialParam as Parameter,
        value: SEALED_VALUE,
      },
      { password: 'revealed-plaintext-pw' },
    )

    expect(screen.getByText(/revealed-plaintext-pw/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    // The lock indicator stays: the value is still a protected credential.
    expect(screen.getByLabelText(LITERAL_TOOLTIP)).toBeInTheDocument()
  })
})

describe('Credential field - expression value (REQ-3.1.3.18)', () => {
  it('shows the protected lock when the referenced variable is secret', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: 'secret_ref',
      expressionFields: ['password'],
    })

    expect(screen.getByLabelText(SECRET_EXPR_TOOLTIP)).toBeInTheDocument()
  })

  it('shows the amber alert with the exact copy when the referenced variable is not secret', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: 'plain_ref',
      expressionFields: ['password'],
    })

    expect(screen.getByLabelText(nonSecretExprTooltip('plain_ref'))).toBeInTheDocument()
  })

  it('shows no status indicator when the expression does not resolve to a known variable', () => {
    renderRow({
      ...baseProps,
      parameter: credentialParam as Parameter,
      value: 'concat(a, b)',
      expressionFields: ['password'],
    })

    // Indeterminate secrecy -> no lock and no amber alert (resolveCredentialStatus -> null).
    expect(screen.queryByLabelText(SECRET_EXPR_TOOLTIP)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(nonSecretExprTooltip('concat(a, b)'))).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('Non-credential field is unchanged (REQ-3.1.3.18)', () => {
  it('renders no status indicator and the normal value affordance', () => {
    renderRow({ ...baseProps, parameter: plainParam, value: 'db.example.com' })

    expect(screen.queryByLabelText(LITERAL_TOOLTIP)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveValue('db.example.com')
  })
})

// Switching a credential literal to an expression must NOT carry the stored
// value into the expression editor (it is a sealed envelope) and must warn that
// the stored value is discarded (REQ-3.1.3.18).
describe('Credential field - literal -> expression toggle discards the stored value', () => {
  it('confirms before dropping a stored credential literal and never leaks the envelope', () => {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onChange,
      onExpressionFieldsChange,
      parameter: credentialParam as Parameter,
      value: SEALED_VALUE,
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))

    // Warned, and nothing switched yet - the sealed value is NOT carried over.
    expect(screen.getByText('Discard protected value?')).toBeInTheDocument()
    expect(onExpressionFieldsChange).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to expression' }))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['password'])
    expect(onChange).toHaveBeenCalledWith('')
    expect(onChange).not.toHaveBeenCalledWith(SEALED_VALUE)
  })

  it('keeps literal mode when the discard is canceled', () => {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onChange,
      onExpressionFieldsChange,
      parameter: credentialParam as Parameter,
      value: SEALED_VALUE,
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onExpressionFieldsChange).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('switches an empty credential field to expression directly and carries nothing in', () => {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onChange,
      onExpressionFieldsChange,
      parameter: credentialParam as Parameter,
      value: undefined,
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))

    expect(screen.queryByText('Discard protected value?')).not.toBeInTheDocument()
    expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['password'])
    for (const [written] of onChange.mock.calls) expect([undefined, '']).toContainEqual(written)
  })

  it.each([
    ['empty text', ''],
    ['null', null],
    ['only whitespace', '   '],
  ])('asks the switch warning, not the discard confirm, for a credential holding %s', (_label, value) => {
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onExpressionFieldsChange,
      parameter: credentialParam as Parameter,
      value,
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))

    expect(screen.queryByText('Discard protected value?')).not.toBeInTheDocument()
    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(onExpressionFieldsChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('switch-mode-clear-default'))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['password'])
  })

  it('a non-credential field asks the switch warning and carries nothing into the expression', () => {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onChange,
      onExpressionFieldsChange,
      parameter: plainParam,
      value: 'db.example.com',
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))

    expect(screen.queryByText('Discard protected value?')).not.toBeInTheDocument()
    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(onExpressionFieldsChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('switch-mode-clear-default'))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['host'])
    expect(onChange).not.toHaveBeenCalledWith('db.example.com')
  })

  it('names the field by its param name in the discard prompt when it has no label', () => {
    const noLabelCred: CredParam = { name: 'api_key', type: 'string', required: false, secret: true }
    renderRow({ ...baseProps, parameter: noLabelCred as Parameter, value: SEALED_VALUE })

    fireEvent.click(screen.getByTestId('expression-toggle'))

    expect(screen.getByText(/The protected value stored in api_key/)).toBeInTheDocument()
  })
})

// A map credential (K8s Apply's Secret Data) keeps the map editor: its keys are
// readable and the backend seals it value by value, so the stored shape is a map
// of envelopes, not one envelope. The row must not fall through to the
// single-line credential control (REQ-3.1.3.18).
describe('Credential field - map credential keeps the map editor', () => {
  const SEALED_KEY = 'wave:enc:v1:c2VhbGVkLWtleQ=='
  const mapCred: CredParam = {
    name: 'secret_data',
    label: 'Data',
    type: 'map',
    required: false,
    secret: true,
  }
  const storedMap = { 'tls.crt': SEALED_VALUE, 'tls.key': SEALED_KEY }

  it('renders the map editor for a map typed this session, with no entry masking', () => {
    renderRow({
      ...baseProps,
      parameter: mapCred as Parameter,
      value: { username: 'admin', password: 'hunter2' },
    })

    expect(showsText('{"username": "admin", "password": "hunter2"}')).toBe(true)
    expect(screen.getByTestId('param-expand-secret_data')).toHaveAccessibleName('Open editor for Data')
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })

  it('masks a STORED map without its entry count, its keys, or its envelopes', () => {
    renderRow({ ...baseProps, parameter: mapCred as Parameter, value: storedMap })

    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-secret_data')).not.toBeInTheDocument()
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument()
    expect(screen.queryByText(/tls\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/wave:enc:v1:/)).not.toBeInTheDocument()
  })

  it('clears the stored map on the shared confirm and leaves it alone on cancel', () => {
    const onChange = vi.fn()
    renderRow({ ...baseProps, onChange, parameter: mapCred as Parameter, value: storedMap })

    fireEvent.click(screen.getByLabelText('Edit protected value'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Edit protected value'))
    expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('shows no literal lock, whose reveal copy does not apply to a map', () => {
    renderRow({ ...baseProps, parameter: mapCred as Parameter, value: storedMap })

    expect(screen.queryByLabelText(LITERAL_TOOLTIP)).not.toBeInTheDocument()
  })

  it('still classifies the expression a map credential is switched to', () => {
    renderRow({
      ...baseProps,
      parameter: mapCred as Parameter,
      value: 'plain_ref',
      expressionFields: ['secret_data'],
    })

    expect(screen.getByLabelText(nonSecretExprTooltip('plain_ref'))).toBeInTheDocument()
  })

  it('confirms before carrying a stored map into an expression, and drops it', () => {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderRow({
      ...baseProps,
      onChange,
      onExpressionFieldsChange,
      parameter: mapCred as Parameter,
      value: storedMap,
    })

    fireEvent.click(screen.getByTestId('expression-toggle'))
    expect(screen.getByText('Discard protected value?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to expression' }))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['secret_data'])
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('leaves a non-credential map row untouched', () => {
    const plainMap: Parameter = { name: 'data', label: 'Data', type: 'map', required: false }
    renderRow({ ...baseProps, parameter: plainMap, value: { a: '1' } })

    expect(showsText('{"a": "1"}')).toBe(true)
    expect(screen.getByTestId('param-expand-data')).toHaveAccessibleName('Open editor for Data')
    expect(screen.queryByLabelText(LITERAL_TOOLTIP)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
  })
})

// A block dialog row that holds a stored credential and drops it when asked.
function StoredCredentialRow({ parameter }: Readonly<{ parameter: Parameter }>) {
  const [value, setValue] = useState<unknown>(SEALED_VALUE)
  return (
    <CredentialRevealContext value={{}}>
      <input aria-label="Block name" />
      <table>
        <tbody>
          <ParameterRow {...baseProps} parameter={parameter} value={value} onChange={setValue} />
        </tbody>
      </table>
    </CredentialRevealContext>
  )
}

describe('Credential field - keyboard focus after "Edit Protected Value?"', () => {
  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })],
  ])('puts focus back on the masked credential after %s', async (_label, dismiss) => {
    render(<StoredCredentialRow parameter={credentialParam as Parameter} />)
    fireEvent.click(screen.getByLabelText('Edit protected value'))
    expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()

    dismiss()

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Edit protected value')).toHaveFocus())
  })

  it('puts focus on the empty credential\'s own control after "Delete & Edit"', async () => {
    render(<StoredCredentialRow parameter={credentialParam as Parameter} />)
    screen.getByRole('textbox', { name: 'Block name' }).focus()
    fireEvent.click(screen.getByLabelText('Edit protected value'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Password' })).toHaveFocus())
    expect(screen.getByRole('textbox', { name: 'Block name' })).not.toHaveFocus()
  })
})

describe('Credential field - non-string declared credential (REQ-3.1.3.18)', () => {
  it('renders the masked affordance for a non-string credential without stringifying', () => {
    const intCred: CredParam = {
      name: 'pin',
      label: 'PIN',
      type: 'integer',
      required: false,
      secret: true,
    }
    renderRow({ ...baseProps, parameter: intCred as Parameter, value: SEALED_VALUE })

    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
  })
})

// A Block window row holding what the user types, as the window's draft does.
function TypedCredentialRow({ parameter }: Readonly<{ parameter: Parameter }>) {
  const [value, setValue] = useState<unknown>(undefined)
  return (
    <CredentialRevealContext value={{}}>
      <table>
        <tbody>
          <ParameterRow {...baseProps} parameter={parameter} value={value} onChange={setValue} />
        </tbody>
      </table>
    </CredentialRevealContext>
  )
}

function rowTree(props: React.ComponentProps<typeof ParameterRow>, revealed: Record<string, string> = {}) {
  return (
    <CredentialRevealContext value={revealed}>
      <table>
        <tbody>
          <ParameterRow {...props} />
        </tbody>
      </table>
    </CredentialRevealContext>
  )
}

/** The ids the control's aria-describedby lists. */
function describedIds(control: HTMLElement): string[] {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}

describe('Credential field - the unsaved-secret line (REQ-3.1.3.18)', () => {
  const TEST_LINE = /^Secret value stays visible until you save the test\.$/
  const FUNCTION_LINE = /^Secret value stays visible until you save the Function\.$/
  const NOTICE_TEXT = /stays visible until you save/
  const line = (name = 'password') => screen.queryByTestId(`param-warning-${name}`)
  const passwordBox = () => screen.getByRole('textbox', { name: 'Password' })

  it('shows the amber line under the field as soon as a value is typed', () => {
    render(<TypedCredentialRow parameter={credentialParam as Parameter} />)
    expect(line()).not.toBeInTheDocument()

    fireEvent.change(passwordBox(), { target: { value: 'hunter2' } })

    expect(passwordBox()).toHaveValue('hunter2')
    expect(line()).toHaveTextContent(TEST_LINE)
    expect(line()).toHaveClass('text-warning')
  })

  it('drops the line when the typed value is cleared', () => {
    render(<TypedCredentialRow parameter={credentialParam as Parameter} />)
    fireEvent.change(passwordBox(), { target: { value: 'hunter2' } })
    expect(line()).toBeInTheDocument()

    fireEvent.change(passwordBox(), { target: { value: '' } })

    expect(line()).not.toBeInTheDocument()
  })

  it('links the line to the field it sits under', () => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value: 'hunter2' })

    const note = screen.getByTestId('param-warning-password')
    expect(note.id).not.toBe('')
    expect(describedIds(passwordBox())).toContain(note.id)
  })

  it('goes away once the save has sealed the value and the field shows it masked', () => {
    const props = { ...baseProps, parameter: credentialParam as Parameter }
    const { rerender } = render(rowTree({ ...props, value: 'hunter2' }))
    expect(line()).toHaveTextContent(TEST_LINE)

    rerender(rowTree({ ...props, value: SEALED_VALUE }))

    expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
  })

  it.each([
    ['a sealed stored value', SEALED_VALUE],
    ['a masked stored value', MASK_PLACEHOLDER],
    ['no value', undefined],
    ['empty text', ''],
  ])('shows no line for %s', (_label, value) => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value })

    expect(line()).not.toBeInTheDocument()
  })

  it('shows no line for a stored value revealed in the clear', () => {
    render(rowTree({ ...baseProps, parameter: credentialParam as Parameter, value: SEALED_VALUE }, { password: 'revealed-pw' }))

    expect(screen.getByText(/revealed-pw/)).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
  })

  it.each([
    ['a secret variable', 'secret_ref', SECRET_EXPR_TOOLTIP],
    ['a non-secret variable', 'plain_ref', nonSecretExprTooltip('plain_ref')],
  ])('keeps only the status icon in {x} mode reading %s', (_label, value, iconLabel) => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value, expressionFields: ['password'] })

    expect(screen.getByLabelText(iconLabel)).toBeInTheDocument()
    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument()
  })

  it('shows no line on a field that is not secret', () => {
    renderRow({ ...baseProps, parameter: plainParam, value: 'db.example.com' })

    expect(line('host')).not.toBeInTheDocument()
    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument()
  })

  it('names the Function as the save inside a library Function view', () => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value: 'hunter2', secretSaveTarget: 'Function' })

    expect(line()).toHaveTextContent(FUNCTION_LINE)
  })

  it('shows the line on a Function Block input marked secret', () => {
    const [apiKey] = functionBlockInputs({ inputs: [{ name: 'api_key', type: 'string', secret: true }] as never })
    render(<TypedCredentialRow parameter={apiKey as Parameter} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'api_key' }), { target: { value: 'sk-123' } })

    expect(line('api_key')).toHaveTextContent(TEST_LINE)
  })

  it('links the line to the number box of a secret number input', () => {
    const [pin] = functionBlockInputs({ inputs: [{ name: 'pin', type: 'integer', secret: true }] as never })
    renderRow({ ...baseProps, parameter: pin as Parameter, value: 1234 })

    const note = screen.getByTestId('param-warning-pin')
    expect(note).toHaveTextContent(TEST_LINE)
    expect(describedIds(screen.getByTestId('param-input-pin'))).toContain(note.id)
  })

  describe('a map credential', () => {
    const mapCred: CredParam = { name: 'secret_data', label: 'Data', type: 'map', required: false, secret: true }
    const mapLine = () => line('secret_data')

    it('shows the line, linked to the map line, for a map typed this session', () => {
      renderRow({ ...baseProps, parameter: mapCred as Parameter, value: { username: 'admin', password: 'hunter2' } })

      const note = mapLine() as HTMLElement
      expect(note).toHaveTextContent(TEST_LINE)
      expect(describedIds(screen.getByRole('textbox', { name: 'Data' }))).toContain(note.id)
    })

    it.each([
      ['a stored map', { 'tls.crt': SEALED_VALUE }],
      ['an emptied map', {}],
      ['a map of empty values', { 'tls.crt': '' }],
    ])('shows no line for %s', (_label, value) => {
      renderRow({ ...baseProps, parameter: mapCred as Parameter, value })

      expect(mapLine()).not.toBeInTheDocument()
    })
  })
})

// Static import: the global afterEach resets modules, so a per-test dynamic
// import would get a fresh, uninitialized tree-sitter instance.
describe('resolveCredentialStatus - protected / alert classification', () => {
  const VARS = [
    { name: 'secret_ref', type: 'string', isSecret: true },
    { name: 'plain_ref', type: 'string', isSecret: false },
  ] as AvailableVariable[]

  it('returns null for a non-credential field', () => {
    expect(resolveCredentialStatus(false, false, 'anything', VARS)).toBeNull()
  })

  it('classifies a literal as protected with the stored-protected tooltip', () => {
    expect(resolveCredentialStatus(true, false, 'hunter2', VARS)).toEqual({
      kind: 'protected',
      label: LITERAL_TOOLTIP,
    })
  })

  it('classifies a pure secret-variable expression as protected', () => {
    expect(resolveCredentialStatus(true, true, 'secret_ref', VARS)).toEqual({
      kind: 'protected',
      label: SECRET_EXPR_TOOLTIP,
    })
  })

  it('flags a non-secret variable reference with the naming tooltip', () => {
    expect(resolveCredentialStatus(true, true, 'plain_ref', VARS)).toEqual({
      kind: 'alert',
      label: nonSecretExprTooltip('plain_ref'),
    })
  })

  it('flags literal text inside an expression as unprotected material', () => {
    const status = resolveCredentialStatus(true, true, "'sk_live_' + secret_ref", VARS)
    expect(status?.kind).toBe('alert')
  })

  it('returns null when the expression resolves to nothing known', () => {
    expect(resolveCredentialStatus(true, true, 'mystery_ref', VARS)).toBeNull()
  })
})

describe('the credential text editor behind expand', () => {
  it('opens a revealed stored value on its revealed text', () => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value: SEALED_VALUE }, { password: 'revealed-pw' })
    fireEvent.click(screen.getByTestId('param-expand-password'))
    expect(sheetValues.at(-1)).toBe('revealed-pw')
  })

  it('opens a typed value on that value', () => {
    renderRow({ ...baseProps, parameter: credentialParam as Parameter, value: 'typed-now' })
    fireEvent.click(screen.getByTestId('param-expand-password'))
    expect(sheetValues.at(-1)).toBe('typed-now')
  })
})
