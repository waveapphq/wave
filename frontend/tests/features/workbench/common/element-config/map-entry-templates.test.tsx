/**
 * Literal-vs-expression values in parameter maps.
 *
 * Each map value is a plain LITERAL or a whole-value EXPRESSION. The per-row
 * {x} toggle switches between them: pressed swaps the row's value input to the
 * host-injected expression editor and marks the key an expression; unpressed
 * keeps the plain input (a literal, verbatim - a literal containing {{ }} is
 * NOT auto-detected as an expression). Expression-ness is a sidecar key set
 * (onExpressionKeysChange), never {{ }}-in-the-string. Hosts without an injected
 * editor (Variable Manager) render plain inputs and no toggle.
 */
import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MapEditBody,
  type MapEditBodyProps,
  type MapExpressionEditorProps,
} from '@/components/shared/variable-bodies/map-edit-body'
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { ValueType } from '@/lib/variable-validation'

const STRING_TYPES = (value: Record<string, unknown>): Record<string, ValueType> =>
  Object.fromEntries(Object.keys(value).map((k) => [k, 'string' as ValueType]))

function fakeExpressionEditor(props: MapExpressionEditorProps) {
  return (
    <input
      data-testid={props.testId}
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

type RowProps = ComponentProps<typeof ParameterRow>

/** A map row of a Block window; its expand opens the map editor. */
function renderMapRow(parameter: Parameter, value: Record<string, unknown>, extra: Partial<RowProps> = {}) {
  return render(
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={vi.fn()}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          allValues={{}}
          {...extra}
        />
      </tbody>
    </table>,
  )
}

function renderBody(
  value: Record<string, unknown>,
  overrides: Partial<MapEditBodyProps> = {},
) {
  const onChange = vi.fn()
  const onValidChange = vi.fn()
  const onExpressionKeysChange = vi.fn()
  render(
    <MapEditBody
      value={value}
      types={STRING_TYPES(value)}
      onChange={onChange}
      onValidChange={onValidChange}
      onExpressionKeysChange={onExpressionKeysChange}
      stringValuesOnly
      expressionEditor={fakeExpressionEditor}
      {...overrides}
    />,
  )
  return { onChange, onValidChange, onExpressionKeysChange }
}

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)

describe('MapEditBody - expression toggle rendering', () => {
  it('renders no toggle without an injected expression editor (Variable Manager stays plain)', () => {
    render(
      <MapEditBody
        value={{ a: '1' }}
        types={{ a: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
      />,
    )
    expect(screen.queryByTestId('map-expr-toggle-0')).not.toBeInTheDocument()
  })

  it('renders a per-row toggle, unpressed for a literal value', () => {
    renderBody({ 'X-Trace-Id': 'wave-1' })
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
  })

  it('seeds pressed state from the expressionKeys prop, not from {{ }} content', () => {
    renderBody(
      { Authorization: "'Bearer ' + api_token", 'X-Trace-Id': 'wave-1' },
      { expressionKeys: new Set(['Authorization']) },
    )
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map-expr-toggle-1')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a literal value containing {{ }} stays a plain input and is not auto-detected as expression', () => {
    // Guard: no hybrid, no {{ }} auto-detect.
    renderBody({ 'X-Note': '{{ not an expr }}' })
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('{{ not an expr }}')
    expect(screen.queryByTestId('map-expr-value-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-edit-value-0').className).not.toContain('text-cyan-400')
  })

  it('names the toggle for assistive tech', () => {
    renderBody({ 'X-Trace-Id': 'wave-1' })
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute(
      'aria-label',
      'Entry 0 expression mode',
    )
  })
})

describe('MapEditBody - expression toggle behavior', () => {
  it('pressing the toggle asks first, then swaps the plain input for the empty injected editor and reports the key', async () => {
    const user = userEvent.setup()
    const { onChange, onExpressionKeysChange } = renderBody({ 'X-Trace-Id': 'wave-1' })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByTestId('map-edit-value-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue('')
    // Switching never carries the value across (FIELD-7).
    expect(lastCall(onChange)?.[0]).toEqual({ 'X-Trace-Id': '' })
    expect(lastCall(onExpressionKeysChange)?.[0]).toEqual(new Set(['X-Trace-Id']))
  })

  it('an expression row (seeded) opens through the injected editor', () => {
    renderBody(
      { Authorization: "'Bearer ' + api_token" },
      { expressionKeys: new Set(['Authorization']) },
    )
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue("'Bearer ' + api_token")
    expect(screen.queryByTestId('map-edit-value-0')).not.toBeInTheDocument()
  })

  it('edits through the injected editor flow into the map value verbatim', () => {
    const { onChange } = renderBody(
      { Authorization: 'api_token' },
      { expressionKeys: new Set(['Authorization']) },
    )
    fireEvent.change(screen.getByTestId('map-expr-value-0'), {
      target: { value: "'Bearer ' + api_token" },
    })
    expect(lastCall(onChange)?.[0]).toEqual({ Authorization: "'Bearer ' + api_token" })
  })

  it('unpressing asks first, then returns to the plain input holding empty text and drops the key', async () => {
    const user = userEvent.setup()
    const { onExpressionKeysChange } = renderBody(
      { Authorization: 'api_token' },
      { expressionKeys: new Set(['Authorization']) },
    )
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('map-edit-value-0')).toHaveValue('')
    expect(lastCall(onExpressionKeysChange)?.[0]).toEqual(new Set())
  })

  it('renaming an expression key carries the expression flag to the new key', () => {
    const { onExpressionKeysChange } = renderBody(
      { OldKey: 'api_token' },
      { expressionKeys: new Set(['OldKey']) },
    )
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'NewKey' } })
    expect(lastCall(onExpressionKeysChange)?.[0]).toEqual(new Set(['NewKey']))
  })

  it('toggling one row leaves the sibling rows on their own affordance', async () => {
    const user = userEvent.setup()
    renderBody({ 'X-Trace-Id': 'wave-1', Accept: 'application/json' })
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('map-expr-value-0')).toHaveValue('')
    expect(screen.getByTestId('map-edit-value-1')).toHaveValue('application/json')
    expect(screen.queryByTestId('map-expr-value-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-expr-toggle-1')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('MapEditBody - credential advisory', () => {
  it('hands the callback the key, value, and expression flag of each row', () => {
    const credentialAdvisory = vi.fn().mockReturnValue(false)
    renderBody({ 'X-Auth-Token': 'abc123' }, { credentialAdvisory })
    expect(credentialAdvisory).toHaveBeenCalledWith('X-Auth-Token', 'abc123', false)
  })

  it('renders the amber advisory only on rows the host flags, non-blocking', () => {
    const { onValidChange } = renderBody(
      { 'X-Api-Key': 'sk_live_9f2d41c8a7', Accept: 'application/json' },
      { credentialAdvisory: (key) => key === 'X-Api-Key' },
    )
    expect(screen.getAllByLabelText('Unsecured credential')).toHaveLength(1)
    expect(onValidChange).not.toHaveBeenCalledWith(false)
  })
})

describe('A map row - literal/expression map saves via dotted expressionFields', () => {
  const headersParam: Parameter = {
    name: 'headers',
    label: 'Headers',
    type: 'map',
    required: false,
  }

  it('saves the map value and preserves seeded expression fields on save', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    renderMapRow(
      headersParam,
      { Authorization: "'Bearer ' + api_token" },
      { onChange, expressionFields: ['headers.Authorization'], onExpressionFieldsChange },
    )
    await user.click(screen.getByTestId('param-expand-headers'))
    // Save only wakes on a moved draft (PYRUN-20); the seeded row must survive it.
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), { target: { value: 'Accept' } })
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(lastCall(onChange)?.[0]).toEqual({
      Authorization: "'Bearer ' + api_token",
      Accept: '',
    })
    expect(lastCall(onExpressionFieldsChange)?.[0]).toEqual(['headers.Authorization'])
  })

  it('seeds the expression editor for a dotted expressionFields row inside the sheet', async () => {
    const user = userEvent.setup()
    renderMapRow(headersParam, { Authorization: "'Bearer ' + api_token" }, { expressionFields: ['headers.Authorization'] })
    await user.click(screen.getByTestId('param-expand-headers'))
    expect(screen.getByTestId('map-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map-expr-value-0')).toBeInTheDocument()
  })

  it('toggling a literal row to an expression writes its dotted field on save', async () => {
    const user = userEvent.setup()
    const onExpressionFieldsChange = vi.fn()
    renderMapRow(headersParam, { Accept: 'application/json' }, { onExpressionFieldsChange })
    await user.click(screen.getByTestId('param-expand-headers'))
    await user.click(screen.getByTestId('map-expr-toggle-0'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(lastCall(onExpressionFieldsChange)?.[0]).toEqual(['headers.Accept'])
  })
})

describe('A map row - credential advisory threading', () => {
  const credentialParam: Parameter = {
    name: 'headers',
    label: 'Headers',
    type: 'map',
    required: false,
    credentialCatalog: true,
  }

  function renderInput(value: Record<string, string>, expressionFields: string[] = []) {
    return renderMapRow(credentialParam, value, {
      availableVariables: [{ name: 'api_token', type: 'string', isSecret: true }],
      credentialCatalogKeys: ['authorization', 'x-api-key'],
      expressionFields,
    })
  }

  it('flags a plaintext literal under a credential-catalog key inside the sheet', async () => {
    const user = userEvent.setup()
    renderInput({ Authorization: 'Bearer abc123' })
    await user.click(screen.getByTestId('param-expand-headers'))
    expect(within(screen.getByTestId('map-edit-body')).getByLabelText('Unsecured credential')).toBeInTheDocument()
  })

  it('flags a plaintext literal under a credential-catalog key on the field line, with the map editor copy', async () => {
    const user = userEvent.setup()
    renderInput({ Accept: 'application/json', Authorization: 'Bearer abc123' })
    const advisory = within(screen.getByTestId('param-row-headers')).getByLabelText('Unsecured credential')
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    await user.hover(advisory)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^This credential is not protected - it is stored and displayed in plain text\. Switch this value to an expression that references a secret variable instead\.$/,
    )
  })

  it('keeps the line calm for an {x} entry reading a secret variable', () => {
    renderInput({ Authorization: 'api_token' }, ['headers.Authorization'])
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('keeps the line calm for entries outside the credential catalog and for an empty or null value', () => {
    renderMapRow(credentialParam, { Accept: 'application/json', Authorization: '', Cookie: null }, {
      credentialCatalogKeys: ['authorization', 'cookie'],
    })
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('keeps the line calm while the field holds no map', () => {
    renderMapRow(credentialParam, undefined as unknown as Record<string, unknown>, {
      credentialCatalogKeys: ['authorization'],
    })
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('keeps the line calm where the Block declares no credential keys', () => {
    renderMapRow(credentialParam, { Authorization: 'Bearer abc123' })
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('keeps the line calm on a map setting without a credential catalog', () => {
    renderMapRow({ ...credentialParam, credentialCatalog: undefined }, { Authorization: 'Bearer abc123' }, {
      credentialCatalogKeys: ['authorization'],
    })
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('draws the line advisory beside the expected-headers advisory, not on top of it', () => {
    renderMapRow(credentialParam, { Authorization: 'Bearer abc123' }, {
      credentialCatalogKeys: ['authorization'],
      mapExtras: { generatedRows: [], missingHeaderAdvisories: [{ key: 'Content-Type', message: 'No Content-Type header is sent' }] },
    })
    const row = screen.getByTestId('param-row-headers')
    expect(within(row).getByLabelText('Expected headers missing')).toHaveClass('right-2')
    expect(within(row).getByLabelText('Unsecured credential')).toHaveClass('right-7')
  })

  it('stays calm for an expression referencing a secret variable', async () => {
    const user = userEvent.setup()
    renderInput({ Authorization: 'api_token' }, ['headers.Authorization'])
    await user.click(screen.getByTestId('param-expand-headers'))
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })

  it('stays calm for a row outside the credential catalog', async () => {
    const user = userEvent.setup()
    renderInput({ Accept: 'application/json' })
    await user.click(screen.getByTestId('param-expand-headers'))
    expect(screen.queryByLabelText('Unsecured credential')).not.toBeInTheDocument()
  })
})
