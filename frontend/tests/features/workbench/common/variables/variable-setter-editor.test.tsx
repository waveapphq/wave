/**
 * Unit tests for VariableSetterEditor component.
 *
 * Each row's value is the one value field of a Block (FIELD-1, VARSET-7): text inline,
 * numbers in the number box, true / false as a checkbox, lists and maps as one line, a
 * Template face, a masked face, the null button, expand and {x}. The editor reads and
 * writes the Block's shared slots through `slots` / `onSlotsChange`: `variables.<row>`
 * flags in expressionFields / templateFields, entry flags `variables.<row>.<key>`, entry
 * types at elementTypes['variables.<row>'], the secret mark in secretFields, and no row
 * type on the Block (a row's type is its declared variable's).
 *
 * The value-editor sheet is mocked to a stand-in exposing onSave, and the inline
 * expression editor to an input unless a case switches the real one on.
 *
 * Design decisions: VARSET-1..11, FIELD-1, FIELD-5, FIELD-7, FNCFG-9
 * REQ: REQ-3.4.1.14, REQ-3.4.3.8, REQ-3.1.3.19, REQ-3.1.3.21, REQ-4.5.20
 */
import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElementTypes } from '@/lib/variable-validation'

// The inline expression editor (CodeMirror) is a plain input unless a case needs the real one.
const expressionField = vi.hoisted(() => ({ real: false }))

interface ExpressionStubProps {
  name: string
  displayName?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  isInvalid?: boolean
  template?: boolean
}

vi.mock('@/features/workbench/common/element-config/expressions/expression-field', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/workbench/common/element-config/expressions/expression-field')
  >()
  return {
    ...actual,
    ExpressionField: (props: ExpressionStubProps) => {
      if (expressionField.real) {
        return React.createElement(
          actual.ExpressionField,
          props as unknown as React.ComponentProps<typeof actual.ExpressionField>,
        )
      }
      return React.createElement('input', {
        'data-testid': `param-input-${props.name}`,
        'data-template': props.template ? 'true' : undefined,
        'aria-label': props.displayName ?? props.name,
        value: props.value ?? '',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value),
        placeholder: props.placeholder,
        'aria-invalid': props.isInvalid ? 'true' : undefined,
      })
    },
  }
})

// The real expression editor reads the flow scope from the workflow store: these rows sit in the root flow.
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({
    insideFunction: false,
    scopeId: '',
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set<string>(),
  }),
}))

type SheetSave = [value: unknown, isTemplate: boolean, exprKeys?: string[], elementTypes?: unknown]

interface SheetStubProps {
  label: string
  type: string
  value: unknown
  isTemplate: boolean
  allowTemplate?: boolean
  elementTypes?: unknown
  listEditor?: { expressionIndices?: Iterable<number> }
  onSave: (...save: SheetSave) => void
  onClose: () => void
}

// The stand-in sheet's save buttons: the test id and what the sheet hands to onSave.
const sheetSaves = vi.hoisted((): Array<[string, SheetSave]> => [
  ['ves-save-typed-map', [{ n: '16', zip: '02134' }, false, [], { n: 'integer', zip: 'string' }]],
  ['ves-save-literal', ['edited-value', false]],
  ['ves-save-template', ['Hi {{ api_url }}', true]],
  ['ves-save-array', [[1, 2, 3], false]],
  ['ves-save-list-expr-entry', [['web-1', 'backup_host'], false, ['1'], ['string', 'string']]],
])

// ValueEditorSheet: the shared "Edit value" sheet a row's field opens. The stub echoes its props.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: (props: SheetStubProps) => {
    const indices = props.listEditor?.expressionIndices
    const echoes: Record<string, string> = {
      'ves-label': props.label,
      'ves-type': props.type,
      'ves-istemplate': String(props.isTemplate),
      'ves-allow-template': String(props.allowTemplate),
      'ves-value': JSON.stringify(props.value ?? null),
      'ves-element-types': JSON.stringify(props.elementTypes ?? null),
      'ves-expr-indices': JSON.stringify(indices ? [...indices] : null),
    }
    return React.createElement(
      'div',
      { 'data-testid': 'value-editor-sheet' },
      ...Object.entries(echoes).map(([id, text]) => React.createElement('span', { 'data-testid': id }, text)),
      ...sheetSaves.map(([id, save]) =>
        React.createElement('button', { 'data-testid': id, onClick: () => props.onSave(...save) }, id),
      ),
      React.createElement('button', { 'data-testid': 'ves-close', onClick: props.onClose }, 'close'),
    )
  },
}))

import { VariableSetterEditor } from '@/features/workbench/common/variables/variable-setter-editor/editor'

/** The Setter's shared slots as the window holds them. */
interface Slots {
  variables: Record<string, unknown>
  expressionFields: string[]
  templateFields: string[]
  elementTypes: Record<string, ElementTypes>
  secretFields: string[]
  rowTypes: Record<string, string>
}

interface AvailableVariableStub {
  name: string
  type: string
  source?: string
}

interface EditorTestProps {
  slots: Slots
  availableVariables: AvailableVariableStub[]
  onSlotsChange: (next: Slots) => void
  onValidChange: (valid: boolean) => void
  /** Whose save seals a typed secret: the test, or the Function in a library Function view. */
  secretSaveTarget?: 'test' | 'Function'
}

const Editor = VariableSetterEditor as unknown as React.FC<EditorTestProps>

const SLOT_NAMES = ['elementTypes', 'expressionFields', 'rowTypes', 'secretFields', 'templateFields', 'variables']

const EMPTY_SLOTS: Slots = {
  variables: {},
  expressionFields: [],
  templateFields: [],
  elementTypes: {},
  secretFields: [],
  rowTypes: {},
}

/** A stored secret as it reads back from the canvas: a sealed envelope. */
const SEALED = 'wave:enc:v1:c2stbGl2ZS1jbGFzc2lmaWVk'

// Available variables for autocomplete testing
const mockAvailableVariables: AvailableVariableStub[] = [
  { name: 'api_url', type: 'string' },
  { name: 'timeout', type: 'integer' },
  { name: 'retry_count', type: 'integer' },
  { name: 'enabled', type: 'boolean' },
]

/** The window around the editor: it keeps what the editor writes and hands it back. */
function SetterHarness({ initial, ...props }: Readonly<Omit<EditorTestProps, 'slots'> & { initial: Slots }>) {
  const [slots, setSlots] = useState(initial)
  return (
    <Editor
      {...props}
      slots={slots}
      onSlotsChange={(next) => {
        props.onSlotsChange(next)
        setSlots(next)
      }}
    />
  )
}

function renderEditor(
  options: {
    slots?: Partial<Slots>
    availableVariables?: AvailableVariableStub[]
    secretSaveTarget?: EditorTestProps['secretSaveTarget']
  } = {},
) {
  const props = {
    onSlotsChange: vi.fn<(next: Slots) => void>(),
    onValidChange: vi.fn<(valid: boolean) => void>(),
  }
  const initial: Slots = { ...EMPTY_SLOTS, ...options.slots }
  const view = render(
    <SetterHarness
      initial={initial}
      availableVariables={options.availableVariables ?? mockAvailableVariables}
      onSlotsChange={props.onSlotsChange}
      onValidChange={props.onValidChange}
      {...(options.secretSaveTarget ? { secretSaveTarget: options.secretSaveTarget } : {})}
    />,
  )
  /** What the editor last wrote. */
  const lastSlots = (): Slots => {
    const call = props.onSlotsChange.mock.lastCall
    if (!call) throw new Error('onSlotsChange was never called')
    return call[0]
  }
  return { ...view, props, lastSlots }
}

/** A row's text, list or map line, or {x} box, named by the row. */
const valueBox = (rowName: string) => screen.getByRole('textbox', { name: rowName })

const sorted = (list: readonly string[]) => [...list].sort((a, b) => a.localeCompare(b))

async function pickType(user: ReturnType<typeof userEvent.setup>, index: number, label: string) {
  await user.click(screen.getByTestId(`varset-type-select-${index}`))
  await user.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  expressionField.real = false
})

// =============================================================================
// VARSET-10: Empty State
// =============================================================================

describe('Empty State (VARSET-10)', () => {
  it('renders one empty row when no variables', () => {
    renderEditor()
    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
  })

  it('auto-focuses name field in empty row', () => {
    renderEditor()
    const nameInput = screen.getByTestId('varset-name-input-0')
    expect(nameInput).toHaveFocus()
  })

  it('shows default type as string for empty row', () => {
    renderEditor()
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })

  it('shows the expand of the empty (string) row', () => {
    renderEditor()
    expect(screen.getByTestId('param-expand-varset-value-0')).toBeInTheDocument()
  })

  it('shows Name is required under the one empty row at once and holds Save', () => {
    const { props } = renderEditor()

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Name is required$/)
    expect(screen.getByTestId('varset-name-input-0')).toHaveAttribute('aria-invalid', 'true')
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps Delete disabled on the only row while it is empty', () => {
    renderEditor()
    expect(screen.getByTestId('varset-delete-0')).toBeDisabled()
  })
})

// =============================================================================
// Column headers - the Secret checkbox column is labeled, matching the
// profile / entity variable tables.
// =============================================================================

describe('Column headers', () => {
  it('renders Name / Type / Secret / Value column headers', () => {
    renderEditor()
    for (const label of ['Name', 'Type', 'Secret', 'Value']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})

// =============================================================================
// VARSET-7: a row's value is the one value field
// =============================================================================

describe('Rows on the one value field (VARSET-7)', () => {
  it('draws a text value inline with its expand and an unpressed null button', () => {
    renderEditor({ slots: { variables: { greeting: 'hello world' }, rowTypes: { greeting: 'string' } } })

    expect(valueBox('greeting')).toHaveValue('hello world')
    expect(screen.getByTestId('param-expand-varset-value-0')).toBeInTheDocument()
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows empty text as <empty string> and lets it save', () => {
    const { props } = renderEditor({ slots: { variables: { note: '' }, rowTypes: { note: 'string' } } })

    expect(screen.getByText('<empty string>')).toBeInTheDocument()
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('draws an integer in the number box with an empty expand slot', () => {
    renderEditor({ slots: { variables: { count: '5' }, rowTypes: { count: 'integer' } } })

    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('5')
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
  })

  it('draws a true / false value as a checkbox with no null button and no expand', () => {
    renderEditor({ slots: { variables: { flag: true }, rowTypes: { flag: 'boolean' } } })

    expect(screen.getByRole('checkbox', { name: 'flag' })).toBeChecked()
    expect(screen.queryByTestId('param-null-varset-value-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
  })

  it('draws a list and a map as one line with their expand', () => {
    renderEditor({
      slots: {
        variables: { hosts: ['web-1', 'web-2'], limits: { cpu: 2, mem: '4Gi' } },
        rowTypes: { hosts: 'array', limits: 'map' },
      },
    })

    expect(valueBox('hosts')).toHaveValue('["web-1", "web-2"]')
    expect(valueBox('limits')).toHaveValue('{"cpu": 2, "mem": "4Gi"}')
    expect(screen.getByTestId('param-expand-varset-value-0')).toBeInTheDocument()
    expect(screen.getByTestId('param-expand-varset-value-1')).toBeInTheDocument()
  })

  it('draws a list entry held as {x} as {{ expr }} in the line', () => {
    renderEditor({
      slots: {
        variables: { hosts: ['web-1', 'web-2', 'backup_host'] },
        expressionFields: ['variables.hosts.2'],
        rowTypes: { hosts: 'array' },
      },
    })

    expect(valueBox('hosts')).toHaveValue('["web-1", "web-2", {{ backup_host }}]')
  })

  it('holds Save on a map line that does not read and shows the line problem under it', () => {
    const { props } = renderEditor({ slots: { variables: { limits: { cpu: 2 } }, rowTypes: { limits: 'map' } } })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    fireEvent.change(valueBox('limits'), { target: { value: '{"a": 1, "a": 2}' } })

    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Duplicate key "a"$/)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('draws a Template row in the Template face with no null button and opens its sheet on Template', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: {
        variables: { summary: 'Run {{ run_id }} done' },
        templateFields: ['variables.summary'],
        rowTypes: { summary: 'string' },
      },
    })

    const face = screen.getByTestId('param-input-varset-value-0')
    expect(face).toHaveAttribute('data-template', 'true')
    expect(face).toHaveValue('Run {{ run_id }} done')
    expect(screen.queryByTestId('param-null-varset-value-0')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    expect(screen.getByTestId('ves-istemplate')).toHaveTextContent(/^true$/)
  })

  it('draws a stored secret as the masked face named by the row, with no expand and no null button', () => {
    renderEditor({
      slots: { variables: { api_token: SEALED }, secretFields: ['variables.api_token'], rowTypes: { api_token: 'string' } },
    })

    expect(screen.getByRole('button', { name: 'api_token: Edit protected value' })).toBeInTheDocument()
    expect(screen.queryByText(/wave:enc/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-null-varset-value-0')).not.toBeInTheDocument()
  })

  it('starts a new row on null with its null button pressed', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { existing: 'val' }, rowTypes: { existing: 'string' } } })

    await user.click(screen.getByTestId('varset-add-button'))

    expect(screen.getByTestId('param-null-varset-value-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('param-error-varset-value-1')).not.toBeInTheDocument()
  })

  it('writes null for a new row once it is named, and Save is allowed', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor()

    await user.type(screen.getByTestId('varset-name-input-0'), 'note')

    expect(lastSlots().variables).toEqual({ note: null })
    expect(lastSlots().rowTypes.note).toBe('string')
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('writes null when the null button is pressed on a text row', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-null-varset-value-0'))

    expect(lastSlots().variables).toEqual({ greeting: null })
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
  })
})

// =============================================================================
// Secret Column (SECUI-2, VARSET-11)
// =============================================================================

describe('Secret Column (SECUI-2)', () => {
  it('renders a Secret checkbox for each row', () => {
    renderEditor({ slots: { variables: { token: 'x' }, rowTypes: { token: 'string' } } })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeInTheDocument()
  })

  it('checks the Secret checkbox when the row carries the secret mark', () => {
    renderEditor({
      slots: { variables: { token: 'x' }, rowTypes: { token: 'string' }, secretFields: ['variables.token'] },
    })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeChecked()
  })

  it('leaves the Secret checkbox unchecked for a non-secret row', () => {
    renderEditor({ slots: { variables: { token: 'x' }, rowTypes: { token: 'string' } } })

    expect(screen.getByTestId('varset-secret-checkbox-0')).not.toBeChecked()
  })

  it('writes the row secret mark when the Secret checkbox is checked', () => {
    const { lastSlots } = renderEditor({ slots: { variables: { token: 'x' }, rowTypes: { token: 'string' } } })

    fireEvent.click(screen.getByTestId('varset-secret-checkbox-0'))

    expect(lastSlots().secretFields).toEqual(['variables.token'])
  })

  it('removes the row secret mark when the Secret checkbox is unchecked', () => {
    const { lastSlots } = renderEditor({
      slots: { variables: { token: 'x' }, rowTypes: { token: 'string' }, secretFields: ['variables.token'] },
    })

    fireEvent.click(screen.getByTestId('varset-secret-checkbox-0'))

    expect(lastSlots().secretFields).toEqual([])
  })

  it('writes only the secret-flagged rows into the secret marks', () => {
    const { lastSlots } = renderEditor({
      slots: {
        variables: { token: 'x', region: 'us' },
        rowTypes: { token: 'string', region: 'string' },
        secretFields: ['variables.token'],
      },
    })

    // Mark the second (non-secret) row secret too.
    fireEvent.click(screen.getByTestId('varset-secret-checkbox-1'))

    expect(sorted(lastSlots().secretFields)).toEqual(['variables.region', 'variables.token'])
  })

  it('disables the Secret checkbox for a boolean row', () => {
    renderEditor({ slots: { variables: { flag: false }, rowTypes: { flag: 'boolean' } } })

    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeDisabled()
  })

  it('clears a ticked Secret when the row Type changes to Boolean and disables the box', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { flag: null }, rowTypes: { flag: 'string' }, secretFields: ['variables.flag'] },
    })

    await pickType(user, 0, 'Boolean')

    expect(lastSlots().secretFields).toEqual([])
    expect(lastSlots().variables).toEqual({ flag: false })
    expect(screen.getByTestId('varset-secret-checkbox-0')).not.toBeChecked()
    expect(screen.getByTestId('varset-secret-checkbox-0')).toBeDisabled()
  })

  it('masks a saved secret value write-only and clears it on the edit confirm', async () => {
    const user = userEvent.setup({ delay: null })
    // A SAVED setter secret round-trips to the canvas as a sealed envelope; only a
    // stored (sealed) value masks write-only.
    const { lastSlots } = renderEditor({
      slots: { variables: { token: SEALED }, rowTypes: { token: 'string' }, secretFields: ['variables.token'] },
    })

    // A secret row holding a stored value shows the masked write-only affordance,
    // not the raw envelope.
    expect(screen.queryByText(/wave:enc/)).not.toBeInTheDocument()
    const masked = screen.getByRole('button', { name: 'token: Edit protected value' })

    // Clicking it opens the clear-and-edit confirm; confirming drops the value and, as on
    // every Block text field, leaves the row's own empty text box with the focus and no sheet.
    await user.click(masked)
    const dialog = screen.getByRole('dialog', { name: 'Edit Protected Value?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete & Edit' }))

    expect(lastSlots().variables).toEqual({ token: '' })
    expect(screen.queryByRole('button', { name: 'token: Edit protected value' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(valueBox('token')).toHaveValue('')
    await waitFor(() => expect(valueBox('token')).toHaveFocus())
  })

  it("opens the row's own sheet on the emptied map after Delete & Edit on a stored map secret", async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { creds: SEALED }, rowTypes: { creds: 'map' }, secretFields: ['variables.creds'] },
    })

    await user.click(screen.getByRole('button', { name: 'creds: Edit protected value' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Protected Value?' })).getByRole('button', { name: 'Delete & Edit' }))

    expect(lastSlots().variables).toEqual({ creds: {} })
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('ves-label')).toHaveTextContent(/^creds$/)
    expect(screen.getByTestId('ves-type')).toHaveTextContent(/^map$/)
    expect(screen.getByTestId('ves-value')).toHaveTextContent(/^\{\}$/)
  })

  it.each([
    ['integer', 0],
    ['float', 0],
  ] as const)('starts a stored %s secret on its type default after Delete & Edit, its box focused', async (type, start) => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { port: SEALED }, rowTypes: { port: type }, secretFields: ['variables.port'] },
      availableVariables: [{ name: 'port', type }],
    })

    await user.click(screen.getByRole('button', { name: 'port: Edit protected value' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Protected Value?' })).getByRole('button', { name: 'Delete & Edit' }))

    expect(lastSlots().variables).toEqual({ port: start })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    const box = screen.getByTestId('param-input-varset-value-0')
    expect(box).toHaveValue(String(start))
    await waitFor(() => expect(box).toHaveFocus())
  })

  it.each([
    ['Cancel', async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(within(screen.getByRole('dialog', { name: 'Edit Protected Value?' })).getByRole('button', { name: 'Cancel' }))],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ] as const)('puts the keyboard focus back on the masked value after %s', async (_label, dismiss) => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { token: SEALED }, rowTypes: { token: 'string' }, secretFields: ['variables.token'] },
    })
    await user.click(screen.getByRole('button', { name: 'token: Edit protected value' }))

    await dismiss(user)

    expect(screen.queryByRole('dialog', { name: 'Edit Protected Value?' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'token: Edit protected value' })).toHaveFocus(),
    )
  })

  it('does NOT mask a freshly typed (non-stored) secret value', () => {
    // A value typed this session is plaintext, not a sealed envelope, so the row
    // stays visible and editable instead of dropping into write-only dots.
    renderEditor({
      slots: {
        variables: { token: 'just-typed-plaintext' },
        rowTypes: { token: 'string' },
        secretFields: ['variables.token'],
      },
    })

    expect(screen.queryByRole('button', { name: /edit protected value/i })).not.toBeInTheDocument()
    expect(valueBox('token')).toHaveValue('just-typed-plaintext')
  })

  it('says under a typed secret value that it stays visible until the test is saved', () => {
    renderEditor({
      slots: {
        variables: { token: 'just-typed-plaintext' },
        rowTypes: { token: 'string' },
        secretFields: ['variables.token'],
      },
    })

    expect(screen.getByText('Secret value stays visible until you save the test.')).toBeInTheDocument()
  })

  it('names the Function as the save in a library Function view', () => {
    renderEditor({
      slots: {
        variables: { token: 'just-typed-plaintext' },
        rowTypes: { token: 'string' },
        secretFields: ['variables.token'],
      },
      secretSaveTarget: 'Function',
    })

    expect(screen.getByText('Secret value stays visible until you save the Function.')).toBeInTheDocument()
    expect(screen.queryByText('Secret value stays visible until you save the test.')).not.toBeInTheDocument()
  })

  it('asks Discard protected value? before {x} on a stored secret, then holds the row as {x}', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { token: SEALED }, rowTypes: { token: 'string' }, secretFields: ['variables.token'] },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Discard protected value?' })).toBeInTheDocument()
    expect(props.onSlotsChange).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Switch to expression' }))

    expect(lastSlots().expressionFields).toEqual(['variables.token'])
    expect(screen.queryByRole('button', { name: 'token: Edit protected value' })).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-varset-value-0')).toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-1: Inline Variable Rows
// =============================================================================

describe('Inline Variable Rows (VARSET-1)', () => {
  it('renders existing variables as rows', () => {
    renderEditor({
      slots: { variables: { api_url: 'https://example.com', count: 5 }, rowTypes: { count: 'integer' } },
    })

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-name-input-1')).toBeInTheDocument()
  })

  it('each string row has name, type, expand, expression toggle, and delete', () => {
    renderEditor({ slots: { variables: { myvar: 'value' }, rowTypes: { myvar: 'string' } } })

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-type-select-0')).toBeInTheDocument()
    expect(screen.getByTestId('param-expand-varset-value-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-expression-toggle-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-delete-0')).toBeInTheDocument()
  })

  it('draws the shared {x} toggle on each row, named by the row', () => {
    renderEditor({ slots: { variables: { myvar: 'value' }, rowTypes: { myvar: 'string' } } })
    const toggle = screen.getByTestId('varset-expression-toggle-0')
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle).toHaveAccessibleName(/^myvar expression mode$/)
  })

  it('shows add button', () => {
    renderEditor()
    expect(screen.getByTestId('varset-add-button')).toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-2: Inline Empty Row for Adding
// =============================================================================

describe('Adding Variables (VARSET-2)', () => {
  it('add button inserts new empty row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { existing: 'val' }, rowTypes: { existing: 'string' } } })

    await user.click(screen.getByTestId('varset-add-button'))

    expect(screen.getByTestId('varset-name-input-1')).toBeInTheDocument()
  })
})

// =============================================================================
// VARSET-3: Name Field with Autocomplete
// =============================================================================

describe('Name Field Autocomplete (VARSET-3)', () => {
  it('typing in name field filters available variables', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'api')

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })
  })

  it('shows variables in autocomplete with type label', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'a')

    await waitFor(() => {
      const apiItem = screen.getByText('api_url').closest('[cmdk-item]')!
      expect(apiItem).toHaveTextContent('string')
    })
  })

  it('hides variables already present in other setter rows', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { api_url: 'https://example.com' } } })

    await user.click(screen.getByTestId('varset-add-button'))
    const nameInput = screen.getByTestId('varset-name-input-1')
    await user.type(nameInput, 'a')

    await waitFor(() => {
      const apiInItems = screen
        .queryAllByText('api_url')
        .filter((el) => el.closest('[cmdk-item]'))
      expect(apiInItems).toHaveLength(0)
    })
  })

  it('deduplicates variables by name', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      availableVariables: [
        { name: 'shared_var', type: 'string' },
        { name: 'shared_var', type: 'string' },
        { name: 'only_other', type: 'integer' },
      ],
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'shared')

    await waitFor(() => {
      const items = screen.getAllByText('shared_var')
      expect(items).toHaveLength(1)
    })
  })

  it('allows typing new variable names not in autocomplete', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'brand_new_var')
    fireEvent.blur(nameInput)

    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument()
  })

  it('hides profile aliases and dotted namespace entries from name field suggestions', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      availableVariables: [
        { name: 'cpr_var', type: 'string' },
        { name: 'cpr', type: 'map', source: 'Profile: staging' },
        { name: 'cpr.host', type: 'string', source: 'Profile: staging' },
        { name: 'system.cpr', type: 'string', source: 'System' },
      ],
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'cpr')

    await waitFor(() => {
      const items = screen
        .queryAllByText('cpr_var')
        .filter((el) => el.closest('[cmdk-item]'))
      expect(items).toHaveLength(1)
    })

    const cprItems = screen
      .queryAllByText('cpr')
      .filter((el) => el.closest('[cmdk-item]'))
    expect(cprItems).toHaveLength(0)

    const dottedItems = screen
      .queryAllByText(/cpr\.host|system\.cpr/)
      .filter((el) => el.closest('[cmdk-item]'))
    expect(dottedItems).toHaveLength(0)
  })
})

// =============================================================================
// REQ-3.4.3.8: inside a Function the Setter writes that Function's own scope
// =============================================================================

const FUNCTION_SCOPE: AvailableVariableStub[] = [
  { name: 'x', type: 'string', source: 'Function input' },
  { name: 'result', type: 'string', source: 'Function output' },
  { name: 'count', type: 'integer' },
]

/** The names a name box's open suggestion list shows. */
function suggestedNames(): string[] {
  return [...document.querySelectorAll('[cmdk-item]')].map((item) => item.getAttribute('data-value') ?? '')
}

describe('Inside a Function (REQ-3.4.3.8)', () => {
  it('shows the save check text under the name of a row naming a Function input as soon as the window opens and holds Save', () => {
    const { props } = renderEditor({
      slots: { variables: { x: 'hello' } },
      availableVariables: FUNCTION_SCOPE,
    })

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(
      /^Writes to declared input 'x'; inputs are read-only$/,
    )
    expect(screen.getByTestId('varset-name-input-0')).toHaveAttribute('aria-invalid', 'true')
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('leaves the Function inputs out of the name suggestions inside a Function and keeps its outputs and locals', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ availableVariables: FUNCTION_SCOPE })
    const nameInput = screen.getByTestId('varset-name-input-0')

    await user.click(document.body)
    fireEvent.keyDown(nameInput, { key: ' ', ctrlKey: true })

    await waitFor(() => expect(sorted(suggestedNames())).toEqual(['count', 'result']))

    await user.type(nameInput, 'x')

    await waitFor(() => expect(suggestedNames()).toEqual([]))
  })
})

// =============================================================================
// VARSET-4: No Shadowing
// =============================================================================

describe('No Shadowing (VARSET-4)', () => {
  it('does not show shadow warning (all variables are test-local)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'timeout')
    fireEvent.blur(nameInput)

    await waitFor(() => {
      expect(screen.queryByText(/will shadow/i)).not.toBeInTheDocument()
    })
  })

  it('rejects bare namespace keyword targets', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'system')

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Cannot modify namespace variable 'system'$/)
  })
})

// =============================================================================
// VARSET-5: Type Behavior
// =============================================================================

describe('Type Behavior (VARSET-5)', () => {
  it('type dropdown defaults to string for new variable', () => {
    renderEditor()
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })

  it('type dropdown is active for new variable name', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'brand_new')
    fireEvent.blur(nameInput)

    const typeSelect = screen.getByTestId('varset-type-select-0')
    expect(typeSelect).not.toBeDisabled()
  })

  it('type dropdown is disabled for existing variable from autocomplete', () => {
    renderEditor({
      slots: { variables: { api_url: '' } },
      availableVariables: [{ name: 'api_url', type: 'string' }],
    })

    const typeSelect = screen.getByTestId('varset-type-select-0')
    expect(typeSelect).toHaveAttribute('aria-disabled', 'true')
  })

  it('reads the type of an existing row from its declared variable', () => {
    renderEditor({
      slots: { variables: { timeout: '30' } },
      availableVariables: [{ name: 'timeout', type: 'integer' }],
    })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
    expect(screen.getByTestId('varset-type-select-0')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('30')
  })

  it('shows the new declared type of a variable retyped since the Setter was saved and keeps a literal that still fits', () => {
    const { props } = renderEditor({
      // `limit` was text when the Setter was saved; it is declared integer now.
      slots: { variables: { limit: '30' } },
      availableVariables: [{ name: 'limit', type: 'integer' }],
    })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('30')
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('drops a literal that no longer fits its retyped variable when the window opens and shows Value is required', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: {
        variables: { ready: 'yes', retries: 'abc', flagged: 'retries > 3' },
        expressionFields: ['variables.flagged'],
      },
      availableVariables: [
        { name: 'ready', type: 'boolean' },
        { name: 'retries', type: 'integer' },
        { name: 'flagged', type: 'boolean' },
      ],
    })

    // `yes` on a now true / false variable: the box opens empty, never switched to another value.
    expect(screen.getByRole('checkbox', { name: 'ready' })).not.toBeChecked()
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
    // `abc` on a now integer variable.
    expect(screen.getByTestId('param-input-varset-value-1')).toHaveValue('')
    expect(screen.getByTestId('param-error-varset-value-1')).toHaveTextContent(/^Value is required$/)
    // An {x} row on a retyped variable is kept as written.
    expect(screen.getByTestId('param-input-varset-value-2')).toHaveValue('retries > 3')
    expect(screen.queryByTestId('param-error-varset-value-2')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    // A value given again is the user's and releases Save once every row has one.
    await user.click(screen.getByRole('checkbox', { name: 'ready' }))
    await user.type(screen.getByTestId('param-input-varset-value-1'), '3')

    expect(lastSlots().variables).toEqual({ ready: true, retries: '3', flagged: 'retries > 3' })
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-error-varset-value-1')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps a Template row on a variable retyped to a non-text type as written, in the Template face', () => {
    const { props, lastSlots } = renderEditor({
      // `summary` was text when the Setter was saved; it is declared integer now.
      slots: {
        variables: { summary: 'Run {{ run_id }} done', other: 'x' },
        templateFields: ['variables.summary'],
        rowTypes: { other: 'string' },
      },
      availableVariables: [{ name: 'summary', type: 'integer' }],
    })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
    const face = screen.getByTestId('param-input-varset-value-0')
    expect(face).toHaveAttribute('data-template', 'true')
    expect(face).toHaveValue('Run {{ run_id }} done')
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()

    // An edit on another row writes the Template row back unchanged.
    fireEvent.change(valueBox('other'), { target: { value: 'y' } })
    expect(lastSlots().variables).toEqual({ summary: 'Run {{ run_id }} done', other: 'y' })
    expect(lastSlots().templateFields).toEqual(['variables.summary'])
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  /** The open window, with its variables declared as `declared`; rerender hands it the next declarations. */
  function renderFollowing(slots: Partial<Slots>, declared: AvailableVariableStub[]) {
    const view = renderEditor({ slots, availableVariables: declared })
    const initial: Slots = { ...EMPTY_SLOTS, ...slots }
    const redeclare = (next: AvailableVariableStub[]) =>
      view.rerender(
        <SetterHarness
          initial={initial}
          availableVariables={next}
          onSlotsChange={view.props.onSlotsChange}
          onValidChange={view.props.onValidChange}
        />,
      )
    return { ...view, redeclare }
  }

  it('shows the type the Variable Manager gives a variable while the window is open, keeping an {x} and a literal that still fits', async () => {
    const { props, lastSlots, redeclare } = renderFollowing(
      { variables: { next_attempt: 'attempt + 1', retries: 3 }, expressionFields: ['variables.next_attempt'] },
      [
        { name: 'next_attempt', type: 'integer' },
        { name: 'retries', type: 'integer' },
      ],
    )
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/^Integer$/)

    redeclare([
      { name: 'next_attempt', type: 'float' },
      { name: 'retries', type: 'float' },
    ])

    // The select redraws its chosen item after the commit; waitFor lets it settle inside act.
    await waitFor(() => expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/^Float$/))
    expect(screen.getByTestId('varset-type-select-0')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('attempt + 1')
    expect(screen.getByTestId('varset-type-select-1')).toHaveTextContent(/^Float$/)
    expect(screen.getByTestId('param-input-varset-value-1')).toHaveValue('3')
    expect(screen.queryByTestId('param-error-varset-value-1')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    // The next change writes the rows on the types they show.
    fireEvent.change(screen.getByTestId('param-input-varset-value-1'), { target: { value: '3.5' } })
    expect(lastSlots().variables).toEqual({ next_attempt: 'attempt + 1', retries: '3.5' })
    expect(lastSlots().rowTypes).toEqual({ next_attempt: 'float', retries: 'float' })
  })

  it('drops a literal that no longer fits a variable retyped while the window is open, shows Value is required and holds Save', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots, redeclare } = renderFollowing({ variables: { retries: 3 } }, [
      { name: 'retries', type: 'integer' },
    ])
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    redeclare([{ name: 'retries', type: 'boolean' }])

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/^Boolean$/)
    expect(screen.getByRole('checkbox', { name: 'retries' })).not.toBeChecked()
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    // A value given again is the user's and releases Save.
    await user.click(screen.getByRole('checkbox', { name: 'retries' }))
    expect(lastSlots().variables).toEqual({ retries: true })
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps the type picked for a new target that the Variable Manager does not declare', () => {
    const { redeclare } = renderFollowing({ variables: { fresh: 5 }, rowTypes: { fresh: 'integer' } }, [
      { name: 'other', type: 'string' },
    ])

    redeclare([{ name: 'other', type: 'integer' }])

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/^Integer$/)
    expect(screen.getByTestId('varset-type-select-0')).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('5')
  })

  // A Setter row never names a file: text on a table variable no longer fits, as the run and Save refuse it.
  it('drops a stored text row on a table variable when the window opens and shows Value is required', () => {
    const { props, lastSlots } = renderEditor({
      slots: { variables: { rows: 'people.csv', other: 'x' }, rowTypes: { other: 'string' } },
      availableVariables: [{ name: 'rows', type: 'table' }],
    })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/table/i)
    expect(valueBox('rows')).toHaveValue('')
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)

    // An edit on another row never writes the dropped text back, and Save stays held.
    fireEvent.change(valueBox('other'), { target: { value: 'y' } })
    expect(lastSlots().variables.other).toBe('y')
    expect(lastSlots().variables).not.toHaveProperty('rows', 'people.csv')
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })
})

// =============================================================================
// VARSET-6: Expression Mode Per Variable
// =============================================================================

describe('Expression Mode (VARSET-6)', () => {
  it('a row held as {x} draws the expression box', () => {
    renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' }, expressionFields: ['variables.myvar'] },
    })

    expect(screen.getByTestId('param-input-varset-value-0')).toBeInTheDocument()
  })

  it('pressing {x} on a held text asks first; Clear writes the row flag with no value carried over', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' } },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(props.onSlotsChange).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(lastSlots().expressionFields).toEqual(['variables.myvar'])
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('')
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
  })

  it('Clear & Empty puts the empty text in as the expression', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' } },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    await user.click(screen.getByTestId('switch-mode-clear-empty'))

    expect(lastSlots().variables).toEqual({ myvar: "''" })
    expect(lastSlots().expressionFields).toEqual(['variables.myvar'])
  })

  it('Cancel keeps the row a plain value', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' } },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    await user.click(screen.getByTestId('switch-mode-cancel'))

    expect(props.onSlotsChange).not.toHaveBeenCalled()
    expect(valueBox('myvar')).toHaveValue('hello')
  })

  it('pressing {x} on a held number asks first with Clear and no Clear & Empty', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { count: '5' }, rowTypes: { count: 'integer' } } })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('switch-mode-clear-empty')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(lastSlots().expressionFields).toEqual(['variables.count'])
  })

  it.each([
    ['string', '1 + 2'],
    ['integer', 'attempt + 1'],
  ] as const)('leaving {x} on a %s row asks first and Clear leaves null, never a value that is not set', async (type, expression) => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { myvar: expression }, rowTypes: { myvar: type }, expressionFields: ['variables.myvar'] },
    })

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getByRole('heading')).toHaveTextContent(/^Switch the field to a plain value\?$/)
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(lastSlots().expressionFields).toEqual([])
    expect(lastSlots().variables).toEqual({ myvar: null })
    // A row value takes null and has no default, so the cleared row reads null (FIELD-5) and saves.
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('an {x} row has its expand, which opens no value-editor sheet', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { myvar: '1 + 2' }, rowTypes: { myvar: 'string' }, expressionFields: ['variables.myvar'] },
    })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('editing an expression row value writes it to the row', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { myvar: '1 + 2' }, rowTypes: { myvar: 'string' }, expressionFields: ['variables.myvar'] },
    })

    const input = screen.getByTestId('param-input-varset-value-0')
    await user.clear(input)
    await user.type(input, 'attempt + 1')

    expect(lastSlots().variables).toEqual({ myvar: 'attempt + 1' })
  })

  it('titles the expression editor of a row Edit <row name>', async () => {
    expressionField.real = true
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: {
        variables: { next_attempt: 'attempt + 1' },
        rowTypes: { next_attempt: 'integer' },
        expressionFields: ['variables.next_attempt'],
      },
    })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(await screen.findByRole('dialog', { name: 'Edit next_attempt' })).toBeInTheDocument()
  })

  it('titles the expression editor of a nameless row Edit expression and shows both row messages', async () => {
    expressionField.real = true
    const user = userEvent.setup({ delay: null })
    renderEditor()

    // A new row holds null, so {x} switches at once.
    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Name is required$/)
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(await screen.findByRole('dialog', { name: 'Edit expression' })).toBeInTheDocument()
  })
})

// =============================================================================
// Inline number and true / false values
// =============================================================================

describe('Inline Scalar Affordances', () => {
  it('integer type edits inline in the number box (no sheet)', () => {
    renderEditor({ slots: { variables: { count: 0 }, rowTypes: { count: 'integer' } } })

    expect(screen.getByTestId('param-input-varset-value-0')).toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
  })

  it('float type edits inline in the number box', () => {
    renderEditor({ slots: { variables: { rate: 0 }, rowTypes: { rate: 'float' } } })

    expect(screen.getByTestId('param-input-varset-value-0')).toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-varset-value-0')).not.toBeInTheDocument()
  })

  it('boolean type edits inline as a checkbox', () => {
    renderEditor({ slots: { variables: { flag: false }, rowTypes: { flag: 'boolean' } } })

    expect(screen.getByRole('checkbox', { name: 'flag' })).not.toBeChecked()
  })
})

// =============================================================================
// Exact-text numeric propagation (no parseInt / parseFloat)
// =============================================================================

describe('Exact-text Numeric Propagation', () => {
  it('writes an integer as the exact typed string', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { count: 0 }, rowTypes: { count: 'integer' } } })

    const input = screen.getByTestId('param-input-varset-value-0')
    await user.clear(input)
    await user.type(input, '42')

    expect(lastSlots().variables).toEqual({ count: '42' })
  })

  it('writes a float as the exact typed string (no precision loss)', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { rate: 0 }, rowTypes: { rate: 'float' } } })

    const input = screen.getByTestId('param-input-varset-value-0')
    await user.clear(input)
    await user.type(input, '3.14')

    expect(lastSlots().variables).toEqual({ rate: '3.14' })
  })

  it('writes a boolean as a real boolean', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { flag: false }, rowTypes: { flag: 'boolean' } } })

    await user.click(screen.getByRole('checkbox', { name: 'flag' }))

    expect(lastSlots().variables).toEqual({ flag: true })
  })
})

// =============================================================================
// Each row's field owns its value-editor sheet (VARSET-7)
// =============================================================================

describe('Value Editor Sheet', () => {
  it('draws an array value as its one line', () => {
    renderEditor({ slots: { variables: { my_array: [1, 2, 3] }, rowTypes: { my_array: 'array' } } })

    expect(valueBox('my_array')).toHaveValue('[1, 2, 3]')
  })

  it('draws a map value as its one line', () => {
    renderEditor({ slots: { variables: { my_map: { a: 1, b: 2 } }, rowTypes: { my_map: 'map' } } })

    expect(valueBox('my_map')).toHaveValue('{"a": 1, "b": 2}')
  })

  it('opens a table row in the table editor', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: {
        variables: {
          my_table: [
            { col1: 'a', col2: 'b' },
            { col1: 'c', col2: 'd' },
          ],
        },
        rowTypes: { my_table: 'table' },
      },
    })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.getByTestId('ves-type')).toHaveTextContent(/^table$/)
    expect(screen.getByTestId('ves-label')).toHaveTextContent(/^my_table$/)
  })

  it('expand on a string row opens its value-editor sheet titled by the row name, with Literal / Template', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('ves-type')).toHaveTextContent(/^string$/)
    expect(screen.getByTestId('ves-label')).toHaveTextContent(/^greeting$/)
    // The sheet offers Template unless the field turns it off.
    expect(screen.getByTestId('ves-allow-template')).not.toHaveTextContent(/^false$/)
  })

  it('expand on an array row opens its value-editor sheet (type array)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { my_array: [1, 2] }, rowTypes: { my_array: 'array' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('ves-type')).toHaveTextContent(/^array$/)
  })

  it('takes the type of an existing row from its declared variable', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { hosts: ['web-1'] } },
      availableVariables: [{ name: 'hosts', type: 'array' }],
    })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.getByTestId('ves-type')).toHaveTextContent(/^array$/)
  })

  it('NEVER opens an array/map/table editor modal', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { my_map: { k: 'v' } }, rowTypes: { my_map: 'map' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.queryByTestId('array-editor-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-editor-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('table-editor-modal')).not.toBeInTheDocument()
  })

  it('closes the sheet without changes on Cancel/close', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    await user.click(screen.getByTestId('ves-close'))

    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    // Closing writes nothing.
    expect(props.onSlotsChange).not.toHaveBeenCalled()
  })

  it('keeps the sheets of two rows open at once', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { greeting: 'hello', farewell: 'bye' }, rowTypes: { greeting: 'string', farewell: 'string' } },
    })

    await user.click(screen.getByTestId('param-expand-varset-value-1'))
    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    const labels = screen.getAllByTestId('ves-label').map((label) => label.textContent)
    expect(sorted(labels as string[])).toEqual(['farewell', 'greeting'])
  })

  it('opens a list row on its {x} entries, offers no per-entry Template, and writes the entry flag the sheet saves', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: {
        variables: { hosts: ['web-1', 'web-2', 'backup_host'] },
        expressionFields: ['variables.hosts.2'],
        rowTypes: { hosts: 'array' },
      },
    })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    expect(screen.getByTestId('ves-expr-indices')).toHaveTextContent(/^\[2\]$/)
    expect(screen.getByTestId('ves-allow-template')).toHaveTextContent(/^false$/)

    await user.click(screen.getByTestId('ves-save-list-expr-entry'))

    expect(lastSlots().variables).toEqual({ hosts: ['web-1', 'backup_host'] })
    expect(lastSlots().expressionFields).toEqual(['variables.hosts.1'])
    expect(lastSlots().templateFields).toEqual([])
  })
})

// =============================================================================
// Sheet save + template mark
// =============================================================================

describe('Sheet Save and Template Keys', () => {
  it('saving a literal string writes the value and clears the template mark', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    await user.click(screen.getByTestId('ves-save-literal'))

    expect(lastSlots().variables).toEqual({ greeting: 'edited-value' })
    expect(lastSlots().templateFields).toEqual([])
  })

  it('saving a template string writes the value and sets the template mark', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    await user.click(screen.getByTestId('ves-save-template'))

    expect(lastSlots().variables).toEqual({ greeting: 'Hi {{ api_url }}' })
    expect(lastSlots().templateFields).toEqual(['variables.greeting'])
  })

  it('saving a complex value writes the value', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { my_array: [] }, rowTypes: { my_array: 'array' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    await user.click(screen.getByTestId('ves-save-array'))

    expect(lastSlots().variables).toEqual({ my_array: [1, 2, 3] })
  })

  it('keeps the sheet open after a save until Close (PYRUN-20)', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    await user.click(screen.getByTestId('ves-save-literal'))
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()

    await user.click(screen.getByTestId('ves-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('seeds the sheet with isTemplate=false for a non-template string row', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { greeting: 'hello' }, rowTypes: { greeting: 'string' } } })

    await user.click(screen.getByTestId('param-expand-varset-value-0'))

    expect(screen.getByTestId('ves-istemplate')).toHaveTextContent(/^false$/)
  })
})

// =============================================================================
// VARSET-8: Inline Per-Row Validation
// =============================================================================

describe('Validation (VARSET-8)', () => {
  it('shows error for invalid Python identifier', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, '123invalid')

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(
      /^Name must start with a letter or underscore, and contain only letters, numbers, and underscores$/,
    )
  })

  it('shows error for Python keyword', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'pass')

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(
      /^'pass' is a Python keyword and cannot be used as a variable name$/,
    )
  })

  it('shows error for duplicate name within this setter', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { first_var: 'a', second_var: 'b' }, rowTypes: { first_var: 'string', second_var: 'string' } },
    })

    const nameInput = screen.getByTestId('varset-name-input-1')
    await user.clear(nameInput)
    await user.type(nameInput, 'first_var')

    expect(screen.getByTestId('varset-name-error-1')).toHaveTextContent(/^Duplicate variable name in this setter$/)
  })

  it('shows the profile alias conflict under the name as it is typed', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({ availableVariables: [{ name: 'cpr', type: 'map', source: 'Profile: staging' }] })

    await user.type(screen.getByTestId('varset-name-input-0'), 'cpr')

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(
      /^'cpr' conflicts with profile alias from Profile: staging$/,
    )
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('shows Name is required for a nameless row as soon as the window opens', () => {
    const { props } = renderEditor({ slots: { variables: { '': 'value' }, rowTypes: { '': 'string' } } })

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Name is required$/)
    expect(screen.getByTestId('varset-name-input-0')).toHaveAttribute('aria-invalid', 'true')
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })
})

// =============================================================================
// VARSET-9: Value Starts on the Type Default
// =============================================================================

describe('Value Starts on the Type Default (VARSET-9)', () => {
  it('starts a picked existing string variable on empty text, shown as <empty string>, with its declared type held', () => {
    const { lastSlots } = renderEditor({ availableVariables: [{ name: 'api_url', type: 'string' }] })

    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'api_url' } })

    expect(lastSlots().variables).toEqual({ api_url: '' })
    expect(screen.getByText('<empty string>')).toBeInTheDocument()
    expect(screen.getByTestId('varset-type-select-0')).toHaveAttribute('aria-disabled', 'true')
  })
})

// =============================================================================
// Delete functionality
// =============================================================================

describe('Delete Variable Row', () => {
  it('clicking delete removes the variable row', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { var1: 'a', var2: 'b' }, rowTypes: { var1: 'string', var2: 'string' } },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().variables).toEqual({ var2: 'b' })
  })

  it('deleting also drops the row {x} flag', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: {
        variables: { var1: '1+1', var2: 'b' },
        rowTypes: { var1: 'string', var2: 'string' },
        expressionFields: ['variables.var1'],
      },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().expressionFields).toEqual([])
  })

  it('deleting also drops the row secret mark and its picked type', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: {
        variables: { var1: 'a', var2: 'b' },
        rowTypes: { var1: 'string', var2: 'string' },
        secretFields: ['variables.var1'],
      },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().secretFields).toEqual([])
    expect(lastSlots().rowTypes).not.toHaveProperty('var1')
  })

  it('deleting also drops the row template mark', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: {
        variables: { var1: 'Hi {{ x }}', var2: 'b' },
        rowTypes: { var1: 'string', var2: 'string' },
        templateFields: ['variables.var1'],
      },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().templateFields).toEqual([])
  })

  it('deleting a list row drops its entry flags and entry types', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: {
        variables: { hosts: ['web-1', 'backup_host'], var2: 'b' },
        rowTypes: { hosts: 'array', var2: 'string' },
        expressionFields: ['variables.hosts.1'],
        elementTypes: { 'variables.hosts': ['string', 'string'] },
      },
    })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().expressionFields).toEqual([])
    expect(lastSlots().elementTypes).toEqual({})
  })
})

// =============================================================================
// Name editing updates variable map key
// =============================================================================

describe('Name Editing', () => {
  it('changing name renames the variable in the map', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({ slots: { variables: { old_name: 'value' }, rowTypes: { old_name: 'string' } } })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'new_name')
    fireEvent.blur(nameInput)

    expect(props.onSlotsChange).toHaveBeenCalledWith(
      expect.objectContaining({ variables: expect.objectContaining({ new_name: 'value' }) }),
    )
  })

  it('a renamed {x} row keeps its flag under the new name', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { old_name: 'a + 1' }, rowTypes: { old_name: 'string' }, expressionFields: ['variables.old_name'] },
    })

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.clear(nameInput)
    await user.type(nameInput, 'new_name')

    expect(lastSlots().expressionFields).toEqual(['variables.new_name'])
    expect(lastSlots().variables).toEqual({ new_name: 'a + 1' })
  })
})

// =============================================================================
// Autocomplete selection
// =============================================================================

describe('Autocomplete Selection', () => {
  it('selecting a variable from autocomplete dropdown updates the name and type', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')

    await user.type(nameInput, 'time')

    await waitFor(() => {
      expect(screen.getByText('timeout')).toBeInTheDocument()
    })

    const suggestion = screen.getByText('timeout')
    fireEvent.click(suggestion.closest('[cmdk-item]')!)

    await waitFor(() => {
      expect(props.onSlotsChange).toHaveBeenCalledWith(
        expect.objectContaining({ variables: expect.objectContaining({ timeout: 0 }) }),
      )
    })
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
  })

  it('selecting an existing complex variable seeds a typed-empty value', async () => {
    // An existing array var reset to '' crashed the Edit sheet's ArrayEditBody
    // (value.map). Selecting it must reset type-appropriately ([] for an array).
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      availableVariables: [{ name: 'my_arr', type: 'array' }],
    })

    // Typing the exact existing-var name selects it (same name change path
    // as the autocomplete click): the type becomes array and the value resets.
    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'my_arr')

    await waitFor(() => {
      expect(props.onSlotsChange).toHaveBeenCalledWith(
        expect.objectContaining({ variables: expect.objectContaining({ my_arr: [] }) }),
      )
    })
    // The line shows the empty list - the value is [] not ''.
    expect(valueBox('my_arr')).toHaveValue('[]')
  })

  it('asks Change variable type? before a name change to an existing variable of another type drops a held value', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { x: 'hello' }, rowTypes: { x: 'string' } },
    })

    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'timeout' } })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable type?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Changing type to integer will clear 1 existing string value. This cannot be undone.'),
    ).toBeInTheDocument()
    expect(props.onSlotsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ variables: expect.objectContaining({ timeout: expect.anything() }) }),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Change type' }))

    expect(lastSlots().variables).toEqual({ timeout: 0 })
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
    expect(screen.getByTestId('varset-type-select-0')).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the old name, type and value on Cancel of the name change question', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      slots: { variables: { x: 'hello' }, rowTypes: { x: 'string' } },
    })

    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'timeout' } })
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('varset-name-input-0')).toHaveValue('x')
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
    expect(screen.getByTestId('varset-type-select-0')).not.toHaveAttribute('aria-disabled', 'true')
    expect(valueBox('x')).toHaveValue('hello')
    expect(props.onSlotsChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ variables: expect.objectContaining({ timeout: expect.anything() }) }),
    )
  })

  it('switches at once when a row holding nothing is renamed to an existing variable of another type', () => {
    const { lastSlots } = renderEditor()

    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'timeout' } })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ timeout: 0 })
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
  })
})

// =============================================================================
// A new target with no picked type
// =============================================================================

describe('Variable Type Fallback', () => {
  it('defaults a new target with no picked type to string', () => {
    renderEditor({ slots: { variables: { untyped_var: 'hello' } } })

    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })
})

// =============================================================================
// Expression toggle on a nameless row
// =============================================================================

describe('Expression Toggle Guard', () => {
  it('toggles expression mode on row with empty name without writing a flag', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor()

    await user.click(screen.getByTestId('varset-expression-toggle-0'))

    expect(lastSlots().expressionFields).toEqual([])
  })
})

// =============================================================================
// Escape key in name input
// =============================================================================

describe('Escape Key Handling', () => {
  it('pressing Escape in name input closes autocomplete', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, 'api')

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })

    fireEvent.keyDown(nameInput, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('api_url')).not.toBeInTheDocument()
    })
  })
})

// =============================================================================
// Expression mode with a non-text stored value
// =============================================================================

describe('Expression Mode Edge Cases', () => {
  it('shows a stored non-text expression value as its text', () => {
    renderEditor({
      slots: { variables: { num_expr: 42 }, rowTypes: { num_expr: 'integer' }, expressionFields: ['variables.num_expr'] },
    })

    expect(screen.getByTestId('param-input-varset-value-0')).toHaveValue('42')
  })
})

// =============================================================================
// Ctrl+Space keyboard shortcut
// =============================================================================

describe('Ctrl+Space Autocomplete Trigger', () => {
  it('pressing Ctrl+Space opens autocomplete dropdown', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { api: 'value' }, rowTypes: { api: 'string' } } })

    const nameInput = screen.getByTestId('varset-name-input-0')

    await user.click(document.body)
    await waitFor(() => {
      expect(screen.queryByText('api_url')).not.toBeInTheDocument()
    })

    fireEvent.keyDown(nameInput, { key: ' ', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByText('api_url')).toBeInTheDocument()
    })
  })
})

// =============================================================================
// Type change on a new target (VARSET-5)
// =============================================================================

describe('Type Change', () => {
  // The new type's default (VARSET-5, VARSET-9): '', 0, false, [], {} and an empty table.
  it.each([
    ['String', 'string', 'map', ''],
    ['Integer', 'integer', 'string', 0],
    ['Float', 'float', 'string', 0],
    ['Array', 'array', 'string', []],
    ['Map', 'map', 'string', {}],
    ['Table', 'table', 'string', []],
    ['Boolean', 'boolean', 'string', false],
  ] as const)('changes a row holding nothing to %s at once and starts it on its type default', async (label, type, from, start) => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { myvar: null }, rowTypes: { myvar: from } } })

    await pickType(user, 0, label)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ myvar: start })
    expect(lastSlots().rowTypes.myvar).toBe(type)
  })

  // One shared check decides when a value would be lost: a type default holds nothing.
  it.each([
    ['empty text', 'string', '', 'Integer', 0],
    ['0', 'integer', '0', 'String', ''],
    ['an empty list', 'array', [], 'String', ''],
  ] as const)('changes a row holding %s at once, as one holding nothing', async (_label, from, held, label, start) => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { myvar: held }, rowTypes: { myvar: from } } })

    await pickType(user, 0, label)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ myvar: start })
  })

  it('asks Change variable type? before a Type change drops a held value, and Change type starts the row on the type default', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' } },
    })

    await pickType(user, 0, 'Integer')

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable type?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Changing type to integer will clear 1 existing string value. This cannot be undone.'),
    ).toBeInTheDocument()
    expect(props.onSlotsChange).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Change type' }))

    expect(lastSlots().variables).toEqual({ myvar: 0 })
    expect(lastSlots().rowTypes.myvar).toBe('integer')
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/integer/i)
  })

  it('keeps the value and the type on Cancel', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({
      slots: { variables: { myvar: 'hello' }, rowTypes: { myvar: 'string' } },
    })

    await pickType(user, 0, 'Integer')
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(props.onSlotsChange).not.toHaveBeenCalled()
    expect(valueBox('myvar')).toHaveValue('hello')
    expect(screen.getByTestId('varset-type-select-0')).toHaveTextContent(/string/i)
  })

  it('changes a true / false row holding false at once, as one holding nothing', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { flag: false }, rowTypes: { flag: 'boolean' } } })

    await pickType(user, 0, 'String')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ flag: '' })
    expect(lastSlots().rowTypes.flag).toBe('string')
  })

  it('asks Change variable type? before a Type change drops a true / false row holding true', async () => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({ slots: { variables: { flag: true }, rowTypes: { flag: 'boolean' } } })

    await pickType(user, 0, 'String')

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable type?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Changing type to string will clear 1 existing boolean value. This cannot be undone.'),
    ).toBeInTheDocument()
    expect(props.onSlotsChange).not.toHaveBeenCalled()
  })

  it('asks the same question on a table row and counts its rows', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({
      slots: { variables: { rows: [{ a: '1' }, { a: '2' }] }, rowTypes: { rows: 'table' } },
    })

    await pickType(user, 0, 'String')

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable type?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Changing type to string will clear 2 existing table entries. This cannot be undone.'),
    ).toBeInTheDocument()
  })

  it('drops the Template mark on a Type change', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { greeting: 'Hi {{ x }}' }, rowTypes: { greeting: 'string' }, templateFields: ['variables.greeting'] },
    })

    await pickType(user, 0, 'Integer')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change type' }))

    expect(lastSlots().templateFields).toEqual([])
  })
})

// =============================================================================
// Delete last row
// =============================================================================

describe('Delete Last Row', () => {
  it('deleting the only row leaves one empty row', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({ slots: { variables: { solo: 'value' }, rowTypes: { solo: 'string' } } })

    await user.click(screen.getByTestId('varset-delete-0'))

    expect(lastSlots().variables).toEqual({})

    expect(screen.getByTestId('varset-name-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('varset-name-input-0')).toHaveValue('')
    // The kept row is the empty-state row (VARSET-10): it starts on null like a new row.
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Name is required$/)
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
  })
})

// =============================================================================
// Entry types of a list / map row (REQ-3.1.3.19)
// =============================================================================

describe('VariableSetterEditor - element types (REQ-3.1.3.19)', () => {
  it('opens a map row on its stored element types and stores the types the sheet saves', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { m: { n: '1' } }, elementTypes: { 'variables.m': { n: 'float' } } },
      availableVariables: [{ name: 'm', type: 'map' }],
    })
    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    expect(screen.getByTestId('ves-element-types')).toHaveTextContent('{"n":"float"}')

    await user.click(screen.getByTestId('ves-save-typed-map'))
    expect(lastSlots().elementTypes).toEqual({ 'variables.m': { n: 'integer', zip: 'string' } })
  })

  it("drops a row's element types when its type changes", async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { m: { n: '1' } }, rowTypes: { m: 'map' }, elementTypes: { 'variables.m': { n: 'integer' } } },
    })
    await pickType(user, 0, 'Array')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change type' }))

    expect(lastSlots().elementTypes).toEqual({})
  })

  it('stores no element types for an expression row', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor({
      slots: { variables: { m: { n: '1' } }, rowTypes: { m: 'map' }, elementTypes: { 'variables.m': { n: 'integer' } } },
    })
    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(lastSlots().elementTypes).toEqual({})
  })

  it('drops the element types of a row renamed to an existing variable of the same type, with no question', () => {
    const { lastSlots } = renderEditor({
      slots: { variables: { m: { n: '1' } }, rowTypes: { m: 'map' }, elementTypes: { 'variables.m': { n: 'integer' } } },
      availableVariables: [{ name: 'other_map', type: 'map' }],
    })
    fireEvent.change(screen.getByTestId('varset-name-input-0'), { target: { value: 'other_map' } })

    // The type does not change, so nothing asks; the row starts on the type default (VARSET-9).
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ other_map: {} })
    expect(lastSlots().elementTypes).toEqual({})
  })

  it('gives the sheet no element types for a map row that has none', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor({ slots: { variables: { m: {} }, rowTypes: { m: 'map' } } })
    await user.click(screen.getByTestId('param-expand-varset-value-0'))
    expect(screen.getByTestId('ves-element-types')).toHaveTextContent('null')
  })
})

// =============================================================================
// What the editor writes: the Block's shared slots (REQ-3.4.1.14, REQ-3.1.3.19)
// =============================================================================

describe('VariableSetterEditor - the shared slots', () => {
  it('writes the dotted flags, the entry types, the secret marks and no row type', () => {
    const { props, lastSlots } = renderEditor({
      slots: {
        variables: {
          greeting: 'hello',
          next_attempt: 'attempt + 1',
          summary: 'Run {{ run_id }} done',
          hosts: ['web-1', 'web-2', 'backup_host'],
          limits: { cpu: '2', mem: '4Gi' },
          api_token: SEALED,
        },
        expressionFields: ['variables.next_attempt', 'variables.hosts.2'],
        templateFields: ['variables.summary'],
        elementTypes: {
          'variables.hosts': ['string', 'string', 'string'],
          'variables.limits': { cpu: 'integer', mem: 'string' },
        },
        secretFields: ['variables.api_token'],
      },
      availableVariables: [
        { name: 'greeting', type: 'string' },
        { name: 'next_attempt', type: 'integer' },
        { name: 'summary', type: 'string' },
        { name: 'hosts', type: 'array' },
        { name: 'limits', type: 'map' },
        { name: 'api_token', type: 'string' },
      ],
    })

    fireEvent.click(screen.getByTestId('varset-secret-checkbox-0'))

    expect(props.onSlotsChange).toHaveBeenCalledTimes(1)
    const slots = lastSlots()
    expect(sorted(Object.keys(slots))).toEqual(SLOT_NAMES)
    expect(slots.variables).toEqual({
      greeting: 'hello',
      next_attempt: 'attempt + 1',
      summary: 'Run {{ run_id }} done',
      hosts: ['web-1', 'web-2', 'backup_host'],
      limits: { cpu: '2', mem: '4Gi' },
      api_token: SEALED,
    })
    expect(sorted(slots.expressionFields)).toEqual(['variables.hosts.2', 'variables.next_attempt'])
    expect(slots.templateFields).toEqual(['variables.summary'])
    expect(slots.elementTypes).toEqual({
      'variables.hosts': ['string', 'string', 'string'],
      'variables.limits': { cpu: 'integer', mem: 'string' },
    })
    expect(sorted(slots.secretFields)).toEqual(['variables.api_token', 'variables.greeting'])
  })

  it('keeps the type picked for a new target as window state, never in the stored slots', async () => {
    const user = userEvent.setup({ delay: null })
    const { lastSlots } = renderEditor()

    await user.type(screen.getByTestId('varset-name-input-0'), 'retries')
    await pickType(user, 0, 'Integer')

    const slots = lastSlots()
    expect(slots.rowTypes.retries).toBe('integer')
    expect(slots.variables).toEqual({ retries: 0 })
    expect(slots.elementTypes).toEqual({})
    expect(slots.expressionFields).toEqual([])
    expect(slots.templateFields).toEqual([])
    expect(slots.secretFields).toEqual([])
  })
})

// =============================================================================
// Value rules (REQ-3.4.3.8, VMGR-93, VMGR-95)
// =============================================================================

describe('Value rules - expression rows', () => {
  it.each([
    ['empty text', ''],
    ['spaces only', '   '],
    ['a stored null', null],
  ])('holds Save for an expression row holding %s and says "Value is required"', (_label, value) => {
    const { props } = renderEditor({
      slots: { variables: { result: value }, rowTypes: { result: 'string' }, expressionFields: ['variables.result'] },
    })

    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
    const message = screen.getByTestId('param-error-varset-value-0')
    expect(message).toHaveAttribute('role', 'alert')
    expect(message).toHaveTextContent(/^Value is required$/)
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('varset-name-input-0')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByTestId('param-null-varset-value-0')).not.toBeInTheDocument()
  })

  it('holds Save when the user empties an expression and releases it when one is typed', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({
      slots: { variables: { result: 'attempt + 1' }, rowTypes: { result: 'string' }, expressionFields: ['variables.result'] },
    })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    await user.clear(screen.getByTestId('param-input-varset-value-0'))
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
    expect(screen.getByTestId('param-input-varset-value-0')).toHaveAttribute('aria-invalid', 'true')

    await user.type(screen.getByTestId('param-input-varset-value-0'), 'attempt')
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(lastSlots().variables).toEqual({ result: 'attempt' })
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-varset-value-0')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('holds Save when an empty text row becomes an expression and releases it on null when it turns back', async () => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({ slots: { variables: { note: '' }, rowTypes: { note: 'string' } } })
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    // Empty text is a value, so the switch asks first.
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)

    // A blank {x} holds nothing, so it turns back at once, onto null (FIELD-5).
    await user.click(screen.getByTestId('varset-expression-toggle-0'))
    expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
    expect(lastSlots().variables).toEqual({ note: null })
    expect(lastSlots().expressionFields).toEqual([])
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
  })
})

describe('Value rules - list and map entries held as {x}', () => {
  it("shows Row 2 in 'hosts' is required under a list holding a blank {x} entry and holds Save", () => {
    const { props } = renderEditor({
      slots: { variables: { hosts: ['web-1', ''] }, rowTypes: { hosts: 'array' }, expressionFields: ['variables.hosts.1'] },
    })

    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Row 2 in 'hosts' is required$/)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it("shows 'mem' in 'limits' is required under a map holding a blank {x} entry and holds Save", () => {
    const { props } = renderEditor({
      slots: {
        variables: { limits: { cpu: '2', mem: '' } },
        rowTypes: { limits: 'map' },
        expressionFields: ['variables.limits.mem'],
      },
    })

    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^'mem' in 'limits' is required$/)
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('allows a list whose {x} entries all hold an expression', () => {
    const { props } = renderEditor({
      slots: {
        variables: { hosts: ['web-1', 'backup_host'] },
        rowTypes: { hosts: 'array' },
        expressionFields: ['variables.hosts.1'],
      },
    })

    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })
})

describe('Value rules - an emptied number box', () => {
  it.each([
    ['integer', '5'],
    ['float', '2.5'],
  ] as const)('gives null for an emptied %s box and never writes 0', async (type, stored) => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({ slots: { variables: { count: stored }, rowTypes: { count: type } } })

    await user.clear(screen.getByTestId('param-input-varset-value-0'))

    expect(lastSlots().variables).toEqual({ count: null })
    expect(props.onSlotsChange).not.toHaveBeenCalledWith(expect.objectContaining({ variables: { count: '0' } }))
    expect(props.onSlotsChange).not.toHaveBeenCalledWith(expect.objectContaining({ variables: { count: 0 } }))
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
  })

  it.each([
    ['integer', '5'],
    ['float', '2.5'],
  ] as const)('takes a number typed into the emptied %s box', async (type, stored) => {
    const user = userEvent.setup({ delay: null })
    const { props, lastSlots } = renderEditor({ slots: { variables: { count: stored }, rowTypes: { count: type } } })

    await user.clear(screen.getByTestId('param-input-varset-value-0'))
    await user.type(screen.getByTestId('param-input-varset-value-0'), '7')

    expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    expect(lastSlots().variables).toEqual({ count: '7' })
    expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-varset-value-0')).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Value rules - unfinished number text (REQ-3.1.3.14)', () => {
  it.each([
    ['integer', '5', '-', 'Enter a valid integer value'],
    ['float', '2.5', '2.', 'Enter a valid float value'],
  ] as const)('names unfinished %s text under the row as it is typed and holds Save', async (type, stored, typed, message) => {
    const user = userEvent.setup({ delay: null })
    const { props } = renderEditor({ slots: { variables: { count: stored }, rowTypes: { count: type } } })

    await user.clear(screen.getByTestId('param-input-varset-value-0'))
    await user.type(screen.getByTestId('param-input-varset-value-0'), typed)

    await waitFor(() => {
      expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(new RegExp(`^${message}$`))
    })
    expect(props.onValidChange).toHaveBeenLastCalledWith(false)
  })
})

describe('Value rules - a stored null literal', () => {
  it.each(['string', 'integer', 'float', 'array', 'map', 'table'] as const)(
    'shows a stored null %s as null with its null button pressed and lets it save',
    (type) => {
      const { props } = renderEditor({ slots: { variables: { retries: null }, rowTypes: { retries: type } } })

      expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('param-null-varset-value-0')).toHaveAccessibleName('Set retries to null')
      expect(screen.queryByTestId('param-error-varset-value-0')).not.toBeInTheDocument()
      expect(props.onValidChange).toHaveBeenLastCalledWith(true)
    },
  )

  it('keeps a string holding the text "null" an ordinary string', () => {
    renderEditor({ slots: { variables: { label: 'null' }, rowTypes: { label: 'string' } } })

    expect(valueBox('label')).toHaveValue('null')
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Accessible names and error links', () => {
  it('names the name field by its column', () => {
    renderEditor()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(screen.getByTestId('varset-name-input-0'))
  })

  it('links an invalid name to its message', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()
    const nameInput = screen.getByTestId('varset-name-input-0')
    await user.type(nameInput, '123invalid')

    const message = screen.getByTestId('varset-name-error-0')
    expect(message).toHaveAttribute('role', 'alert')
    expect(message.id).not.toBe('')
    expect(nameInput).toHaveAttribute('aria-describedby', message.id)
  })

  it('names the value field of a row with no name by the row word its Delete button uses', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: 'Delete variable' })).toBe(screen.getByTestId('varset-delete-0'))
    expect(valueBox('variable')).toBe(screen.getByTestId('param-input-varset-value-0'))
    expect(screen.getByTestId('param-null-varset-value-0')).toHaveAccessibleName('Set variable to null')
    expect(screen.getByTestId('param-expand-varset-value-0')).toHaveAccessibleName('Open editor for variable')
    expect(screen.getByTestId('varset-expression-toggle-0')).toHaveAccessibleName('variable expression mode')
  })

  it('names the true / false box of a row with no name by the row word', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    await pickType(user, 0, 'Boolean')

    expect(screen.getByRole('checkbox', { name: 'variable' })).toBeInTheDocument()
  })

  it('names the value field by the row name once the row has one', async () => {
    const user = userEvent.setup({ delay: null })
    renderEditor()

    await user.type(screen.getByTestId('varset-name-input-0'), 'greeting')

    expect(valueBox('greeting')).toBe(screen.getByTestId('param-input-varset-value-0'))
    expect(screen.getByTestId('varset-expression-toggle-0')).toHaveAccessibleName('greeting expression mode')
  })

  it('does not point a valid name at a message', () => {
    renderEditor({ slots: { variables: { count: 'a' }, rowTypes: { count: 'string' } } })
    expect(screen.getByTestId('varset-name-input-0')).not.toHaveAttribute('aria-describedby')
  })
})

describe('Row growth and the Template face (VARSET-7, VARSET-8)', () => {
  /** The row's own flex line: the element that holds the row's delete button. */
  const rowLine = (index: number) => screen.getByTestId(`varset-delete-${index}`).parentElement as HTMLElement
  const bottomMarginClasses = (element: HTMLElement) =>
    element.className.split(/\s+/).filter((token) => /^(mb|my|m)-/.test(token))

  it('grows a row by 20 px of bottom padding while its value shows a message, so the next row keeps clear of the line', () => {
    renderEditor({
      slots: { variables: { next_attempt: '', greeting: 'hi' }, expressionFields: ['variables.next_attempt'] },
      availableVariables: [
        { name: 'next_attempt', type: 'integer' },
        { name: 'greeting', type: 'string' },
      ],
    })

    expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
    expect(rowLine(0)).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine(0))).toEqual([])
    expect(rowLine(1)).not.toHaveClass('pb-5')
  })

  it('grows a row by 20 px of bottom padding while its name shows a message', () => {
    renderEditor({ slots: { variables: { '': 'value' }, rowTypes: { '': 'string' } } })

    expect(screen.getByTestId('varset-name-error-0')).toHaveTextContent(/^Name is required$/)
    expect(rowLine(0)).toHaveClass('pb-5')
    expect(bottomMarginClasses(rowLine(0))).toEqual([])
  })

  // The row centers its boxes, so the name column is the box's 36 px and the lines under it never move it.
  describe('the name counter', () => {
    const LONG_NAME = 'z'.repeat(60)
    const nameColumn = () => rowLine(0).firstElementChild as HTMLElement

    it('keeps the name column at the box height while the counter shows under the box, and grows the row 20 px', () => {
      renderEditor({ slots: { variables: { [LONG_NAME]: 'x' }, rowTypes: { [LONG_NAME]: 'string' } } })

      const counter = screen.getByTestId('varset-name-input-0-counter')
      expect(counter).toHaveTextContent(/^60\/64$/)
      expect(nameColumn()).toContainElement(counter)
      expect(nameColumn()).toHaveClass('h-9')
      expect(rowLine(0)).toHaveClass('pb-5')
      expect(rowLine(0)).not.toHaveClass('pb-10')
    })

    it('grows the row 40 px while the name shows its counter and a message under it', () => {
      const name = `9${'z'.repeat(59)}`
      renderEditor({ slots: { variables: { [name]: 'x' }, rowTypes: { [name]: 'string' } } })

      const counter = screen.getByTestId('varset-name-input-0-counter')
      const message = screen.getByTestId('varset-name-error-0')
      expect(message).toHaveTextContent(
        /^Name must start with a letter or underscore, and contain only letters, numbers, and underscores$/,
      )
      expect(nameColumn()).toContainElement(message)
      expect(counter.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(nameColumn()).toHaveClass('h-9')
      expect(rowLine(0)).toHaveClass('pb-10')
    })

    it('grows the row 20 px while the counter shows under the name and a message under the value', () => {
      renderEditor({
        slots: { variables: { [LONG_NAME]: '' }, expressionFields: [`variables.${LONG_NAME}`] },
        availableVariables: [{ name: LONG_NAME, type: 'integer' }],
      })

      expect(screen.getByTestId('varset-name-input-0-counter')).toBeInTheDocument()
      expect(screen.getByTestId('param-error-varset-value-0')).toHaveTextContent(/^Value is required$/)
      expect(rowLine(0)).toHaveClass('pb-5')
      expect(rowLine(0)).not.toHaveClass('pb-10')
    })

    it('leaves a row with a short name and no message at its box height', () => {
      renderEditor({ slots: { variables: { short: 'x' }, rowTypes: { short: 'string' } } })

      expect(screen.queryByTestId('varset-name-input-0-counter')).not.toBeInTheDocument()
      expect(nameColumn()).toHaveClass('h-9')
      expect(rowLine(0)).not.toHaveClass('pb-5')
    })
  })

  it('marks no declared variable inside {{ }} of a Template row, as the {x} rows beside it', () => {
    expressionField.real = true
    renderEditor({
      slots: {
        variables: { summary: 'Run {{ run_id }} done', next_attempt: 'attempt + 1' },
        templateFields: ['variables.summary'],
        expressionFields: ['variables.next_attempt'],
      },
      availableVariables: [
        { name: 'summary', type: 'string' },
        { name: 'run_id', type: 'string' },
        { name: 'next_attempt', type: 'integer' },
        { name: 'attempt', type: 'integer' },
      ],
    })

    const template = screen.getByTestId('param-input-varset-value-0')
    expect(template.querySelector('.cm-content')).toHaveTextContent(/^Run \{\{ run_id \}\} done$/)
    expect(template.querySelector('.cm-unknown-variable')).toBeNull()
    expect(screen.getByTestId('param-input-varset-value-1').querySelector('.cm-unknown-variable')).toBeNull()
  })

  it('still marks a name inside {{ }} that no variable declares', () => {
    expressionField.real = true
    renderEditor({
      slots: { variables: { summary: 'Run {{ not_declared }} done' }, templateFields: ['variables.summary'] },
      availableVariables: [{ name: 'summary', type: 'string' }],
    })

    const mark = screen.getByTestId('param-input-varset-value-0').querySelector('.cm-unknown-variable')
    expect(mark).toHaveTextContent(/^not_declared$/)
  })
})
