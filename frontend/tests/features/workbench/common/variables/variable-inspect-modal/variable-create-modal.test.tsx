/**
 * Tests for VariableCreateModal - the one variable window (VMGR-106): `+ Add`
 * opens it empty and a row's pencil opens it filled, for a Test variable, a
 * Function local, an input and an output. A DraggableSheet shell with the
 * labeled fields top to bottom, the one-line value field, the value switch
 * pill in Edit, and Cancel / Create (Add) or Cancel / Save (Edit).
 *
 * The number / true-false body and the host-composed ExpressionField are mocked
 * to stand-ins that expose onChange / onValidChange so this file covers the
 * WINDOW's orchestration (chrome per kind and mode, field order, the checkbox
 * locks, Create / Save gating and wiring, the type-switch confirm); each value
 * face's own behavior lives in its own test file. Edit's value switch, Current
 * writes and Edit confirms live in variable-create-modal.edit.test.tsx.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.1.1.5: Function parameter configuration forms
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.2.4: Function validation before save
 * REQ-3.1.2.10: Inputs with no default
 * REQ-3.1.2.11: Enum inputs
 * REQ-3.1.3.13: Computed variables with expressions
 * REQ-3.1.3.15: Template variables
 * REQ-3.1.3.24: Set to null by hand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Per-type value bodies: stand-ins exposing onChange / onValidChange so the
// modal's gating and create wiring can be driven without each body's internals.
function makeEditBodyStub(testid: string, changeValue: unknown, altValue?: unknown) {
  return ({
    value,
    onChange,
    onValidChange,
    format,
    onEmptyBlur,
    itemType,
    blank,
  }: {
    value?: unknown
    onChange: (v: unknown) => void
    onValidChange: (valid: boolean) => void
    format?: string
    onEmptyBlur?: () => void
    itemType?: string
    blank?: 'refuse' | 'unset'
  }) => (
    <div
      data-testid={testid}
      data-value={String(value)}
      data-format={format ?? ''}
      data-item-type={itemType ?? ''}
    >
      <button data-testid={`${testid}-change`} onClick={() => onChange(changeValue)}>
        change
      </button>
      {altValue !== undefined && (
        <button data-testid={`${testid}-change-alt`} onClick={() => onChange(altValue)}>
          change alt
        </button>
      )}
      <button data-testid={`${testid}-invalid`} onClick={() => onValidChange(false)}>
        invalid
      </button>
      <button data-testid={`${testid}-valid`} onClick={() => onValidChange(true)}>
        valid
      </button>
      {/* Stands in for the number box being emptied, reported as the real box does. */}
      <button
        data-testid={`${testid}-empty`}
        onClick={() => {
          onValidChange(blank === 'unset')
          onChange('')
        }}
      >
        empty
      </button>
      {/* Stands in for the number box losing focus while empty. */}
      <button data-testid={`${testid}-empty-blur`} onClick={() => onEmptyBlur?.()}>
        blur
      </button>
    </div>
  )
}

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: makeEditBodyStub('scalar-edit-body', 'typed'),
}))
vi.mock('@/components/shared/variable-bodies/array-edit-body', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shared/variable-bodies/array-edit-body')>()),
  ArrayEditBody: makeEditBodyStub('array-edit-body', ['x'], [1, 2]),
}))
vi.mock('@/components/shared/variable-bodies/map-edit-body', () => ({
  MapEditBody: makeEditBodyStub('map-edit-body', { x: 1 }),
}))
vi.mock('@/components/shared/variable-bodies/table-edit-body', () => ({
  TableEditBody: makeEditBodyStub('table-edit-body', [{ a: 1 }]),
}))

// CodeBody is the raw-JSON editor of the larger "Edit value" sheet; a plain stand-in keeps CodeMirror out of jsdom.
vi.mock('@/components/shared/variable-bodies/code-body', () => ({
  CodeBody: () => <div data-testid="code-body" />,
}))

// ExpressionField is the host-composed cyan source editor (CodeMirror under
// the hood); mock it to a plain input so onChange/onBlur are testable in jsdom.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string
    onChange: (val: string) => void
    onBlur?: () => void
  }) => (
    <input
      data-testid="expression-field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  ),
}))

// The window may read a live session's values; no test here talks to a server.
vi.mock('@/features/workbench/api/workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/api/workbench')>()
  return {
    ...actual,
    workbenchApi: {
      ...actual.workbenchApi,
      getSessionVariables: vi.fn(async () => ({})),
      setVariableOverride: vi.fn(async () => ({ name: '', value: null, pending: false })),
    },
  }
})

import { VariableCreateModal } from '@/features/workbench/common/variables/variable-inspect-modal/variable-create-modal'
import { focusSheet } from '@/components/shared/draggable-sheet'
import { ROLE_BADGE_CLASS } from '@/lib/variable-format'

type WindowMode = 'variable' | 'input' | 'output'
type CreateResult = { success: boolean; error?: string }

interface RenderOverrides {
  mode?: WindowMode
  onCreate?: () => CreateResult
  onClose?: () => void
  checkNameExists?: (name: string, excludeId: string) => boolean
  validateExpressionCycle?: () => string | null
  windowId?: string
  cascadeIndex?: number
  tracksUnsavedSecret?: boolean
  secretSaveTarget?: 'test' | 'Function'
}

function renderModal(overrides: RenderOverrides = {}) {
  const onCreate = vi.fn(overrides.onCreate ?? (() => ({ success: true })))
  const onClose = vi.fn(overrides.onClose)
  const checkNameExists = vi.fn(overrides.checkNameExists ?? (() => false))
  render(
    <VariableCreateModal
      mode={overrides.mode ?? 'variable'}
      availableVariables={[]}
      onCreate={onCreate}
      onClose={onClose}
      checkNameExists={checkNameExists}
      validateExpressionCycle={overrides.validateExpressionCycle ?? (() => null)}
      windowId={overrides.windowId ?? 'window-1'}
      cascadeIndex={overrides.cascadeIndex ?? 0}
      tracksUnsavedSecret={overrides.tracksUnsavedSecret}
      secretSaveTarget={overrides.secretSaveTarget}
      runLocked={false}
      sessionId={null}
      onSaveDefinition={vi.fn(() => ({ success: true }))}
      onSaveCurrent={vi.fn(async () => {})}
    />,
  )
  return { onCreate, onClose, checkNameExists }
}

/** A Variable Manager row the pencil opens, with the parameter fields an input or output row carries. */
interface EditRow {
  id: string
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  value?: unknown
  isSecret?: boolean
  isExpression?: boolean
  isTemplate?: boolean
  required?: boolean
  description?: string
  enumValues?: unknown[]
}

const EDIT_ROWS: Record<WindowMode, EditRow> = {
  variable: { id: 'var-greeting', name: 'greeting', type: 'string', value: 'hello' },
  input: {
    id: 'param:input:host',
    name: 'host',
    type: 'string',
    value: 'localhost',
    required: false,
    description: 'Target host',
  },
  output: { id: 'param:output:result', name: 'result', type: 'string', value: 'ok', description: '' },
}

interface EditOverrides {
  mode?: WindowMode
  row?: EditRow
  onSaveDefinition?: () => CreateResult
  onSaveCurrent?: () => Promise<void>
  onClose?: () => void
}

function renderEditWindow(overrides: EditOverrides = {}) {
  const mode = overrides.mode ?? 'variable'
  const row = overrides.row ?? EDIT_ROWS[mode]
  const onSaveDefinition = vi.fn(overrides.onSaveDefinition ?? (() => ({ success: true })))
  const onSaveCurrent = vi.fn(overrides.onSaveCurrent ?? (async () => {}))
  const onCreate = vi.fn(() => ({ success: true }))
  const onClose = vi.fn(overrides.onClose)
  render(
    <VariableCreateModal
      mode={mode}
      availableVariables={[]}
      onCreate={onCreate}
      onClose={onClose}
      checkNameExists={() => false}
      validateExpressionCycle={() => null}
      windowId={`edit-${row.id}`}
      cascadeIndex={0}
      editTarget={{ row, scope: mode === 'variable' ? null : ['fn-1'] }}
      runLocked={false}
      sessionId={null}
      onSaveDefinition={onSaveDefinition}
      onSaveCurrent={onSaveCurrent}
    />,
  )
  return { onSaveDefinition, onSaveCurrent, onCreate, onClose }
}

// Match the option by textContent inclusion so the helper is robust whether or
// not the Select renders a description span beside each label (the existing
// type Select does; the Kind Select may or may not).
async function pickFromSelect(
  user: ReturnType<typeof userEvent.setup>,
  triggerTestId: string,
  optionLabel: string,
) {
  await user.click(screen.getByTestId(triggerTestId))
  const options = await screen.findAllByRole('option')
  const option = options.find((o) => (o.textContent ?? '').includes(optionLabel))
  if (!option) throw new Error(`Select option "${optionLabel}" not found`)
  await user.click(option)
}

async function optionTexts(
  user: ReturnType<typeof userEvent.setup>,
  triggerTestId: string,
): Promise<string[]> {
  await user.click(screen.getByTestId(triggerTestId))
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

const nameField = () => screen.getByTestId('create-variable-name')
const createButton = () => screen.getByRole('button', { name: 'Create' })
const saveButton = () => screen.getByRole('button', { name: 'Save' })
/** A caption as its field's accessible name; a required caption may add the screen-reader word "required" (FIELD-12). */
function captionName(caption: string): RegExp {
  return new RegExp(`^${caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*required)?$`)
}
/** The one-line text value field, named by its caption (Value / Default value / Allowed values). */
const textField = (caption: string) => screen.getByRole('textbox', { name: captionName(caption) })
const valueSwitch = () => screen.getByRole('combobox', { name: 'Value to edit' })
const requiredBox = () => screen.getByTestId('param-required-checkbox')
const secretBox = () => screen.getByTestId('create-secret-checkbox')
const enumBox = () => screen.getByTestId('param-create-enum-checkbox')

/** The value caption the window shows in Add, per kind (VMGR-113; an output reads "Value"). */
const ADD_VALUE_LABEL: Record<WindowMode, string> = {
  variable: 'Value',
  input: 'Default value',
  output: 'Value',
}

/** Replaces a one-line field's text, then leaves it, as a person typing and tabbing away. */
async function enterText(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  if (text !== '') await user.paste(text)
  act(() => field.blur())
}

/** The spec handed to onCreate by the first Create. */
function firstSpec(onCreate: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return onCreate.mock.calls[0][0] as Record<string, unknown>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** The texts a control's aria-describedby points at. */
function describedTexts(control: HTMLElement): string[] {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
}

// A locked row is aria-disabled and keeps its italic hint, linked to the box.
function expectLockedWithHint(control: HTMLElement, hint: string) {
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(describedTexts(control)).toContain(hint)
}

function expectFree(control: HTMLElement) {
  expect(control).toBeEnabled()
  expect(control).not.toHaveAttribute('aria-disabled', 'true')
}

describe('VariableCreateModal - variable mode shell', () => {
  it('renders the floating create sheet', () => {
    renderModal()
    expect(screen.getByTestId('variable-create-modal')).toBeInTheDocument()
  })

  it('titles the sheet "New variable"', () => {
    renderModal()
    expect(screen.getByText('New variable')).toBeInTheDocument()
  })

  it('renders the labeled form: Name, Type, Kind, secret, and Cancel/Create', () => {
    renderModal()
    expect(screen.getByTestId('create-variable-name')).toBeInTheDocument()
    expect(screen.getByTestId('create-type-select')).toBeInTheDocument()
    expect(screen.getByTestId('create-kind-select')).toBeInTheDocument()
    expect(screen.getByTestId('create-secret-checkbox')).toBeInTheDocument()
    expect(screen.getByTestId('create-cancel-button')).toBeInTheDocument()
    expect(screen.getByTestId('create-submit-button')).toBeInTheDocument()
  })

  it('does NOT render an IN/OUT role badge in variable mode', () => {
    renderModal()
    expect(screen.queryByTestId('create-role-badge')).not.toBeInTheDocument()
  })

  it('does NOT render the Function-parameter Required control in variable mode', () => {
    renderModal()
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - Kind dropdown by type', () => {
  it('offers Literal / Expression / Template for a string variable', async () => {
    const user = userEvent.setup()
    renderModal()
    const options = await optionTexts(user, 'create-kind-select')
    expect(options.some((t) => t.includes('Literal'))).toBe(true)
    expect(options.some((t) => t.includes('Expression'))).toBe(true)
    expect(options.some((t) => t.includes('Template'))).toBe(true)
  })

  it('drops Template for a non-string type (Literal / Expression only)', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', 'Integer')
    const options = await optionTexts(user, 'create-kind-select')
    expect(options.some((t) => t.includes('Literal'))).toBe(true)
    expect(options.some((t) => t.includes('Expression'))).toBe(true)
    expect(options.some((t) => t.includes('Template'))).toBe(false)
  })

  it('swaps the value body to the cyan ExpressionField when Kind=Expression', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    expect(screen.getByTestId('expression-field')).toBeInTheDocument()
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - parameter modes', () => {
  it('titles the sheet "New input parameter" with an IN badge and no Kind dropdown', () => {
    renderModal({ mode: 'input' })
    expect(screen.getByText('New input parameter')).toBeInTheDocument()
    expect(screen.getByTestId('create-role-badge')).toHaveTextContent('IN')
    expect(screen.queryByTestId('create-kind-select')).not.toBeInTheDocument()
  })

  it('titles the sheet "New output parameter" with an OUT badge and a Kind dropdown (VMGR-99)', () => {
    renderModal({ mode: 'output' })
    expect(screen.getByText('New output parameter')).toBeInTheDocument()
    expect(screen.getByTestId('create-role-badge')).toHaveTextContent('OUT')
    expect(screen.getByTestId('create-kind-select')).toBeInTheDocument()
  })

  it.each(['input', 'output'] as const)('draws the %s badge in the shared role colors', (mode) => {
    renderModal({ mode })
    expect(screen.getByTestId('create-role-badge')).toHaveClass(...ROLE_BADGE_CLASS[mode].split(' '))
  })

  it('shows Required + Description for an input parameter', () => {
    renderModal({ mode: 'input' })
    expect(screen.getByTestId('param-required-checkbox')).toBeInTheDocument()
    expect(screen.getByTestId('param-description')).toBeInTheDocument()
  })

  it('shows Description but NOT Required for an output parameter', () => {
    renderModal({ mode: 'output' })
    expect(screen.getByTestId('param-description')).toBeInTheDocument()
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
  })
})

const CHROME = [
  {
    kind: 'test variable',
    mode: 'variable',
    addTitle: 'New variable',
    editTitle: 'Edit variable',
    badge: null,
    addLabel: 'Value',
    pill: ['Initial', 'Current'],
  },
  {
    kind: 'input',
    mode: 'input',
    addTitle: 'New input parameter',
    editTitle: 'Edit input parameter',
    badge: 'IN',
    addLabel: 'Default value',
    pill: ['Default', 'Current'],
  },
  {
    kind: 'output',
    mode: 'output',
    addTitle: 'New output parameter',
    editTitle: 'Edit output parameter',
    badge: 'OUT',
    addLabel: 'Value',
    pill: ['Initial', 'Current'],
  },
] as const

function expectBadge(badge: string | null) {
  if (badge === null) {
    expect(screen.queryByTestId('create-role-badge')).not.toBeInTheDocument()
    return
  }
  expect(screen.getByTestId('create-role-badge')).toHaveTextContent(exactly(badge))
}

describe('VariableCreateModal - the window chrome per kind and mode (VMGR-106, VMGR-108, VMGR-114)', () => {
  it.each(CHROME)('$kind Add: titled $addTitle with its header badge', ({ mode, addTitle, badge }) => {
    renderModal({ mode })
    expect(screen.getByText(addTitle)).toBeInTheDocument()
    expectBadge(badge)
  })

  it.each(CHROME)('$kind Edit: titled $editTitle with its header badge', ({ mode, addTitle, editTitle, badge }) => {
    renderEditWindow({ mode })
    expect(screen.getByText(editTitle)).toBeInTheDocument()
    expect(screen.queryByText(addTitle)).not.toBeInTheDocument()
    expectBadge(badge)
  })

  it.each(CHROME)('$kind Add: the title $addTitle is the heading of the window', ({ mode, addTitle }) => {
    renderModal({ mode })
    expect(screen.getByRole('heading', { level: 2, name: addTitle })).toBeInTheDocument()
  })

  it.each(CHROME)('$kind Edit: the title $editTitle is the heading of the window', ({ mode, editTitle }) => {
    renderEditWindow({ mode })
    expect(screen.getByRole('heading', { level: 2, name: editTitle })).toBeInTheDocument()
  })

  it.each(CHROME)('$kind Add: the empty Name field shows the placeholder variable_name', ({ mode }) => {
    renderModal({ mode })
    expect(nameField()).toHaveAttribute('placeholder', 'variable_name')
  })

  it.each(CHROME)('$kind Add: the window root reads data-window-mode="add"', ({ mode }) => {
    renderModal({ mode })
    expect(screen.getByTestId('variable-create-modal')).toHaveAttribute('data-window-mode', 'add')
  })

  it.each(CHROME)('$kind Edit: the window root reads data-window-mode="edit"', ({ mode }) => {
    renderEditWindow({ mode })
    expect(screen.getByTestId('variable-create-modal')).toHaveAttribute('data-window-mode', 'edit')
  })

  it.each(CHROME)('$kind Add: labels the value $addLabel and shows no value switch', ({ mode, addLabel }) => {
    renderModal({ mode })
    const label = within(screen.getByTestId('create-value-area')).getByText(addLabel, { selector: 'label' })
    expect(label).toHaveTextContent(exactly(addLabel))
    expect(screen.queryByRole('combobox', { name: 'Value to edit' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-dropdown')).not.toBeInTheDocument()
  })

  it.each(CHROME)('$kind Edit: labels the value "Value" with the value switch right after the label', ({ mode }) => {
    renderEditWindow({ mode })
    const area = screen.getByTestId('create-value-area')
    const label = within(area).getByText('Value', { selector: 'label' })
    expect(label).toHaveTextContent(exactly('Value'))
    const pill = within(area).getByRole('combobox', { name: 'Value to edit' })
    expect(pill).toBe(screen.getByTestId('value-switch'))
    expectInDomOrder([label, pill])
  })

  it.each(CHROME)('$kind Edit: the value switch opens on $pill.0 and offers $pill.0 / $pill.1', async ({ mode, pill }) => {
    const user = userEvent.setup()
    renderEditWindow({ mode })
    expect(valueSwitch()).toHaveTextContent(exactly(pill[0]))
    await user.click(valueSwitch())
    expect((await screen.findAllByRole('option')).map((o) => o.textContent?.trim())).toEqual([...pill])
  })

  it.each(CHROME)('$kind Add: the footer reads Cancel then Create', ({ mode }) => {
    renderModal({ mode })
    expectInDomOrder([screen.getByRole('button', { name: 'Cancel' }), createButton()])
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it.each(CHROME)('$kind Edit: the footer reads Cancel then Save, Save enabled with no change', ({ mode }) => {
    renderEditWindow({ mode })
    expectInDomOrder([screen.getByRole('button', { name: 'Cancel' }), saveButton()])
    expect(saveButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - fields top to bottom (VMGR-106, VMGR-112)', () => {
  it('test variable Add: Name, Type, Kind, Mark as secret, Set to null, then the value field', () => {
    renderModal()
    expectInDomOrder(
      [
        'create-variable-name',
        'create-type-select',
        'create-kind-select',
        'create-secret-checkbox',
        'create-set-to-null-checkbox',
        'window-value-field',
      ].map((id) => screen.getByTestId(id)),
    )
    expect(screen.queryByTestId('param-description')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
  })

  it('input Add: Name, Description, Type, Required, Mark as secret, Set to null, Create enum, then the value field', () => {
    renderModal({ mode: 'input' })
    expectInDomOrder(
      [
        'create-variable-name',
        'param-description',
        'create-type-select',
        'param-required-checkbox',
        'create-secret-checkbox',
        'create-set-to-null-checkbox',
        'param-create-enum-checkbox',
        'window-value-field',
      ].map((id) => screen.getByTestId(id)),
    )
    expect(screen.queryByTestId('create-kind-select')).not.toBeInTheDocument()
  })

  it('output Add: Name, Description, Type and Kind, Mark as secret, Set to null, then the value field', () => {
    renderModal({ mode: 'output' })
    expectInDomOrder(
      [
        'create-variable-name',
        'param-description',
        'create-type-select',
        'create-kind-select',
        'create-secret-checkbox',
        'create-set-to-null-checkbox',
        'window-value-field',
      ].map((id) => screen.getByTestId(id)),
    )
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
  })

  it('test variable Edit: the same fields, the value switch between the checkboxes and the value field', () => {
    renderEditWindow()
    expectInDomOrder([
      nameField(),
      screen.getByTestId('create-type-select'),
      screen.getByTestId('create-kind-select'),
      secretBox(),
      screen.getByTestId('create-set-to-null-checkbox'),
      valueSwitch(),
      screen.getByTestId('window-value-field'),
    ])
  })

  it('input Edit: the same fields as Add, the value switch right before the value field', () => {
    renderEditWindow({ mode: 'input' })
    expectInDomOrder([
      nameField(),
      screen.getByTestId('param-description'),
      screen.getByTestId('create-type-select'),
      requiredBox(),
      secretBox(),
      screen.getByTestId('create-set-to-null-checkbox'),
      enumBox(),
      valueSwitch(),
      screen.getByTestId('window-value-field'),
    ])
    expect(screen.queryByTestId('create-kind-select')).not.toBeInTheDocument()
  })

  it('an enum input: Allowed values right under Create enum, the Default value select last', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(enumBox())
    expectInDomOrder([
      screen.getByTestId('create-set-to-null-checkbox'),
      enumBox(),
      textField('Allowed values'),
      screen.getByRole('combobox', { name: captionName('Default value') }),
    ])
    expect(screen.getByTestId('allowed-values-field')).toContainElement(textField('Allowed values'))
  })
})

describe('VariableCreateModal - focus, captions and tab order', () => {
  it.each(CHROME)('$kind Add: the Name field has focus on open', ({ mode }) => {
    renderModal({ mode })
    expect(nameField()).toHaveFocus()
  })

  it('Edit: the Name field has focus on open and holds the saved name', () => {
    renderEditWindow()
    expect(nameField()).toHaveFocus()
    expect(nameField()).toHaveValue('greeting')
  })

  it('clicking the Value caption focuses the value field', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByText('Value', { selector: 'label' }))
    expect(textField('Value')).toHaveFocus()
  })

  it('clicking the Default value caption focuses the default field', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByText('Default value', { selector: 'label' }))
    expect(textField('Default value')).toHaveFocus()
  })

  it('clicking the Allowed values caption focuses the list', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(enumBox())
    await user.click(screen.getByText('Allowed values', { selector: 'label' }))
    expect(textField('Allowed values')).toHaveFocus()
  })

  it('Edit: the controls follow the tab order Name, Type, Kind, checkboxes, value switch, value, Open editor, Cancel, Save', () => {
    renderEditWindow()
    expectInDomOrder([
      nameField(),
      screen.getByRole('combobox', { name: 'Type' }),
      screen.getByRole('combobox', { name: 'Kind' }),
      secretBox(),
      screen.getByTestId('create-set-to-null-checkbox'),
      valueSwitch(),
      textField('Value'),
      screen.getByTestId('open-value-editor-button'),
      screen.getByRole('button', { name: 'Cancel' }),
      saveButton(),
    ])
  })

  it('an enum input: Create enum, Allowed values, its Open editor, the Default value select, Cancel, Create', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(enumBox())
    expectInDomOrder([
      enumBox(),
      textField('Allowed values'),
      screen.getByTestId('open-allowed-values-editor-button'),
      screen.getByRole('combobox', { name: captionName('Default value') }),
      screen.getByRole('button', { name: 'Cancel' }),
      createButton(),
    ])
  })
})

describe('VariableCreateModal - Create gating + wiring', () => {
  it('disables Create until a valid name is entered', async () => {
    const user = userEvent.setup()
    renderModal()
    expect(screen.getByTestId('create-submit-button')).toBeDisabled()
    await user.type(screen.getByTestId('create-variable-name'), 'count')
    expect(screen.getByTestId('create-submit-button')).toBeEnabled()
  })

  it('emits the create spec and closes on a successful Create', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'greeting')
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'greeting', type: 'string' }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('creates a String variable with the text typed into the one-line value field', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()
    await user.type(nameField(), 'greeting')
    await enterText(user, textField('Value'), 'hello')
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'greeting', type: 'string', value: 'hello' }))
  })

  it('marks the spec secret when Mark-as-secret is checked', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'token')
    await user.click(screen.getByTestId('create-secret-checkbox'))
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'token', secret: true }),
    )
  })

  it('keeps the sheet open and surfaces the error when Create fails', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal({
      onCreate: () => ({ success: false, error: 'A variable with this name already exists' }),
    })
    await user.type(screen.getByTestId('create-variable-name'), 'dup')
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByText('A variable with this name already exists'),
    ).toBeInTheDocument()
  })

  it('closes without creating when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderModal()
    await user.click(screen.getByTestId('create-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('VariableCreateModal - no Visual / Code or format pickers in the window (VMGR-110)', () => {
  it.each(['String', 'Array', 'Map', 'Table'])('a %s value shows no View, Format or format-pick control', async (type) => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', type)
    for (const testId of ['view-dropdown', 'create-format-button', 'format-dropdown', 'create-string-format-button']) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
    }
  })
})

describe('VariableCreateModal - complex types inline (no Visual-Editor hop)', () => {
  it('does NOT render an "Open Visual Editor" affordance for a complex type', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', 'Map')
    expect(screen.queryByTestId('open-visual-editor-btn')).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - destructive type-switch confirm', () => {
  it('prompts before discarding a non-empty list on type switch', async () => {
    const user = userEvent.setup()
    renderModal()
    // A one-entry list typed into the value field, then a switch to Map: the confirm must gate it.
    await pickFromSelect(user, 'create-type-select', 'Array')
    await enterText(user, textField('Value'), '["x"]')
    await pickFromSelect(user, 'create-type-select', 'Map')

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Change variable type?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Changing type to map will clear 1 existing array entry. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('switches silently when the list is still empty', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', 'Array')
    await pickFromSelect(user, 'create-type-select', 'Map')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-type-select')).toHaveTextContent('Map')
    expect(textField('Value')).toHaveValue('{}')
  })

  it('prompts before discarding a non-empty map value on type switch', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', 'Map')
    await enterText(user, textField('Value'), '{"x": "1"}')
    await pickFromSelect(user, 'create-type-select', 'Array')

    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText(
        'Changing type to array will clear 1 existing map entry. This cannot be undone.',
      ),
    ).toBeInTheDocument()
  })
})

describe('VariableCreateModal - inline validation', () => {
  it('shows the variable-name error for an invalid (keyword) name', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'class')
    expect(screen.getByTestId('create-name-error')).toHaveTextContent(
      '"class" is a Python keyword',
    )
  })

  it('ties the name error to the Name field, and a valid name to no message', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(nameField(), 'class')
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(describedTexts(nameField())).toEqual([screen.getByTestId('create-name-error').textContent])
    await user.clear(nameField())
    await user.type(nameField(), 'count')
    expect(nameField()).not.toHaveAttribute('aria-describedby')
  })

  it('ties the enum error to the Allowed values field', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('param-create-enum-checkbox'))
    const allowed = textField('Allowed values')
    expect(allowed).toHaveAttribute('aria-invalid', 'true')
    expect(allowed).toHaveAccessibleDescription(exactly('Enum allowed values cannot be empty'))
  })

  it('surfaces the expression-cycle error after blur for a variable expression', async () => {
    const user = userEvent.setup()
    renderModal({ validateExpressionCycle: () => "Circular reference detected for variable 'a': a -> a" })
    await user.type(screen.getByTestId('create-variable-name'), 'a')
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    const expr = screen.getByTestId('expression-field')
    await user.type(expr, 'a + 1')
    fireEvent.blur(expr)
    expect(screen.getByTestId('create-cycle-error')).toHaveTextContent(
      'Circular reference detected',
    )
  })

  it('blocks Create with an enum error when the allowed-values list is empty', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('param-create-enum-checkbox'))
    await user.type(screen.getByTestId('create-variable-name'), 'choices')
    expect(screen.getByTestId('create-enum-error')).toHaveTextContent(
      exactly('Enum allowed values cannot be empty'),
    )
    expect(screen.getByTestId('create-submit-button')).toBeDisabled()
  })
})

describe('VariableCreateModal - one name rule (REQ-3.1.2.4)', () => {
  it.each(['input', 'output'] as const)('%s window: refuses a name that starts with an underscore', async (mode) => {
    const user = userEvent.setup()
    renderModal({ mode })
    await user.type(nameField(), '_id')
    expect(screen.getByTestId('create-name-error')).toHaveTextContent(
      exactly('Parameter name must start with a letter, contain only letters, numbers, underscores'),
    )
    expect(createButton()).toBeDisabled()
  })

  it('test variable window: a name may still start with an underscore', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(nameField(), '_id')
    expect(screen.queryByTestId('create-name-error')).not.toBeInTheDocument()
    expect(createButton()).toBeEnabled()
  })

  it('input window: refuses a name its scope already holds with the existing text', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input', checkNameExists: (name) => name === 'host' })
    await user.type(nameField(), 'host')
    expect(screen.getByTestId('create-name-error')).toHaveTextContent(
      exactly('A variable with this name already exists'),
    )
    expect(createButton()).toBeDisabled()
  })
})

/** The red star of a required caption: an aria-hidden star in the destructive color, then the screen-reader word "required". */
function expectRequiredMark(caption: string) {
  const label = screen.getByText(caption, { selector: 'label' })
  const around = label.parentElement as HTMLElement
  const star = within(around).getByText('*')
  expect(star).toHaveAttribute('aria-hidden', 'true')
  expect(star).toHaveClass('text-destructive')
  expect(label.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(around).getByText('required')).toHaveClass('sr-only')
}

function expectNoRequiredMark(caption: string) {
  const around = screen.getByText(caption, { selector: 'label' }).parentElement as HTMLElement
  expect(within(around).queryByText('*')).not.toBeInTheDocument()
  expect(within(around).queryByText('required')).not.toBeInTheDocument()
}

describe('VariableCreateModal - required fields and errors on open (FIELD-12, REQ-3.1.3.11)', () => {
  it.each(CHROME)(
    '$kind Add: shows "Name is required" under the empty Name at once and holds Create until a valid name is typed',
    async ({ mode }) => {
      const user = userEvent.setup()
      renderModal({ mode })
      expect(screen.getByTestId('create-name-error')).toHaveTextContent(exactly('Name is required'))
      expect(nameField()).toHaveAttribute('aria-invalid', 'true')
      expect(describedTexts(nameField())).toEqual(['Name is required'])
      expect(createButton()).toBeDisabled()

      await user.type(nameField(), 'count')
      expect(screen.queryByTestId('create-name-error')).not.toBeInTheDocument()
      expect(createButton()).toBeEnabled()
    },
  )

  it.each(CHROME)('$kind Add: a red star follows the Name caption and none the $addLabel caption', ({ mode, addLabel }) => {
    renderModal({ mode })
    expectRequiredMark('Name')
    expectNoRequiredMark(addLabel)
  })

  it.each(CHROME)('$kind Edit: a red star follows the Name caption', ({ mode }) => {
    renderEditWindow({ mode })
    expectRequiredMark('Name')
  })

  it('input Add: red stars follow Allowed values and Default value only while Create enum is on', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    expectNoRequiredMark('Default value')

    await user.click(enumBox())
    expectRequiredMark('Allowed values')
    expectRequiredMark('Default value')

    await user.click(enumBox())
    expect(screen.queryByText('Allowed values', { selector: 'label' })).not.toBeInTheDocument()
    expectNoRequiredMark('Default value')
  })
})

describe("VariableCreateModal - a true / false input's default never holds null (REQ-3.1.3.24, REQ-3.1.2.10)", () => {
  it('locks Set to null off on a Boolean input, keeps the true / false control and creates it with False', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'input' })
    await user.type(nameField(), 'verbose')
    await pickFromSelect(user, 'create-type-select', 'Boolean')
    expect(setToNull()).not.toBeChecked()
    expect(setToNull()).toHaveAttribute('aria-disabled', 'true')

    await user.click(setToNull())
    expect(setToNull()).not.toBeChecked()
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', 'false')

    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith({
      name: 'verbose',
      type: 'boolean',
      value: false,
      required: false,
      description: '',
    })
  })

  it('drops a Set to null ticked before the input type moved to Boolean', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'input' })
    await user.type(nameField(), 'verbose')
    await user.click(setToNull())
    expect(setToNull()).toBeChecked()

    await pickFromSelect(user, 'create-type-select', 'Boolean')
    expect(setToNull()).not.toBeChecked()
    expect(setToNull()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', 'false')

    await user.click(createButton())
    expect(firstSpec(onCreate)).toEqual(expect.objectContaining({ name: 'verbose', type: 'boolean', value: false }))
  })
})

describe('VariableCreateModal - an emptied number box (VMGR-95)', () => {
  it.each([
    ['variable', 'Integer', 'Enter a valid integer value'],
    ['variable', 'Float', 'Enter a valid float value'],
    ['input', 'Integer', 'Enter a valid integer value'],
    ['output', 'Float', 'Enter a valid float value'],
  ] as const)(
    '%s mode: an emptied %s box keeps Create disabled and shows "%s"',
    async (mode, typeLabel, message) => {
      const user = userEvent.setup()
      renderModal({ mode })
      await user.type(screen.getByTestId('create-variable-name'), 'count')
      await pickFromSelect(user, 'create-type-select', typeLabel)
      // The stand-in reports invalid, as the real number box does once emptied.
      await user.click(screen.getByTestId('scalar-edit-body-invalid'))
      expect(screen.getByTestId('create-submit-button')).toBeDisabled()
      expect(screen.getByTestId('create-validation')).toHaveTextContent(new RegExp(`^${message}$`))
      await user.click(screen.getByTestId('scalar-edit-body-valid'))
      expect(screen.queryByTestId('create-validation')).not.toBeInTheDocument()
      expect(screen.getByTestId('create-submit-button')).toBeEnabled()
    },
  )
})

describe('VariableCreateModal - body + type coverage', () => {
  it('renders the scalar body for a boolean variable', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-type-select', 'Boolean')
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
  })

  it('renders the {{ }} source field when Kind=Template (VMGR-74)', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickFromSelect(user, 'create-kind-select', 'Template')
    expect(screen.getByTestId('expression-field')).toBeInTheDocument()
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
  })

  it('closes when the header close button is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Close create form' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('VariableCreateModal - closing an Add window with unsaved changes', () => {
  const closeGestures = [
    ['the close button', (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close create form' }))],
    ['Cancel', (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId('create-cancel-button'))],
    ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ] as const

  it.each(closeGestures)('closes an untouched Add window at once on %s', async (_label, close) => {
    const user = userEvent.setup()
    const { onClose, onCreate } = renderModal({ mode: 'input' })
    await close(user)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it.each(closeGestures)('asks Keep Editing, Close or Save on %s once something was typed', async (_label, close) => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    fireEvent.change(nameField(), { target: { value: 'total' } })
    await close(user)
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(within(dialog).getByTestId('unsaved-keep-editing')).toHaveTextContent(exactly('Keep Editing'))
    expect(within(dialog).getByTestId('unsaved-close')).toHaveTextContent(exactly('Close'))
    expect(within(dialog).getByTestId('unsaved-save')).toHaveTextContent(exactly('Save'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks after a checkbox alone was ticked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal({ mode: 'input' })
    await user.click(requiredBox())
    await user.click(screen.getByTestId('create-cancel-button'))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('creates the variable when Save is picked in the question', async () => {
    const user = userEvent.setup()
    const { onClose, onCreate } = renderModal()
    fireEvent.change(nameField(), { target: { value: 'total' } })
    await user.click(screen.getByTestId('create-cancel-button'))
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    await user.click(within(dialog).getByTestId('unsaved-save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(firstSpec(onCreate)).toMatchObject({ name: 'total' })
  })

  it('closes without creating when Close is picked, and keeps the draft on Keep Editing', async () => {
    const user = userEvent.setup()
    const { onClose, onCreate } = renderModal()
    fireEvent.change(nameField(), { target: { value: 'total' } })
    await user.click(screen.getByTestId('create-cancel-button'))
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByTestId('unsaved-keep-editing'))
    expect(onClose).not.toHaveBeenCalled()
    expect(nameField()).toHaveValue('total')

    await user.click(screen.getByTestId('create-cancel-button'))
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByTestId('unsaved-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('VariableCreateModal - the "stays visible until you save" strip in Add', () => {
  it('shows the strip above the footer once Mark as secret is ticked on a new Test variable, and not before', async () => {
    const user = userEvent.setup()
    renderModal({ tracksUnsavedSecret: true })
    expect(screen.queryByTestId('inspect-secret-notice')).not.toBeInTheDocument()

    await user.click(secretBox())

    const notice = screen.getByTestId('inspect-secret-notice')
    expect(notice).toHaveTextContent(exactly('Secret value stays visible until you save the test.'))
    expect(notice.nextElementSibling).toContainElement(screen.getByTestId('create-cancel-button'))
  })

  it('names the Function as what to save in a window of the library View', async () => {
    const user = userEvent.setup()
    renderModal({ tracksUnsavedSecret: true, secretSaveTarget: 'Function' })
    await user.click(secretBox())
    expect(screen.getByTestId('inspect-secret-notice')).toHaveTextContent(
      exactly('Secret value stays visible until you save the Function.'),
    )
  })

  it('shows no strip for a secret input, which keeps no default', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input', tracksUnsavedSecret: true })
    await user.click(secretBox())
    expect(screen.queryByTestId('inspect-secret-notice')).not.toBeInTheDocument()
  })

  it('shows no strip in a window whose host keeps no unsaved secret visible', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(secretBox())
    expect(screen.queryByTestId('inspect-secret-notice')).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - list text checks block Create', () => {
  it('blocks Create on an over-long integer inside list text', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(nameField(), 'items')
    await pickFromSelect(user, 'create-type-select', 'Array')
    await enterText(user, textField('Value'), '[12345678901234567890]')
    expect(screen.getByTestId('create-validation')).toHaveTextContent(/^(Line 1: )?Index 0: max 19 digits$/)
    expect(createButton()).toBeDisabled()
  })
})

describe('VariableCreateModal - element types (REQ-3.1.3.19)', () => {
  it('creates a map typed into the value field with the element types of its values', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'limits')
    await pickFromSelect(user, 'create-type-select', 'Map')
    await enterText(user, textField('Value'), '{"host": "db"}')
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'limits', type: 'map', value: { host: 'db' }, elementTypes: { host: 'string' } }),
    )
  })

  it('creates a scalar with no element types', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'count')
    await user.click(screen.getByTestId('create-submit-button'))
    expect((onCreate.mock.calls[0] as unknown[])[0]).not.toHaveProperty('elementTypes')
  })
})

describe('VariableCreateModal - labels name their controls', () => {
  it('names the Type and Kind selects by their visible labels', () => {
    renderModal()
    expect(screen.getByRole('combobox', { name: 'Type' })).toBe(screen.getByTestId('create-type-select'))
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBe(screen.getByTestId('create-kind-select'))
  })

  it('names the Type select of a Function input by its visible label', () => {
    renderModal({ mode: 'input' })
    expect(screen.getByRole('combobox', { name: 'Type' })).toBe(screen.getByTestId('create-type-select'))
  })

  it('gives the Name, Description and value fields their form names', () => {
    renderModal({ mode: 'input' })
    expect(nameField()).toHaveAttribute('name', 'variable-name')
    expect(screen.getByTestId('param-description')).toHaveAttribute('name', 'parameter-description')
    expect(textField('Default value')).toHaveAttribute('name', 'variable-value')
  })
})

// The four creation windows: a Function local's window is the variable window.
const CREATE_WINDOWS = [
  ['test variable', { mode: 'variable' }],
  ['Function local', { mode: 'variable' }],
  ['input', { mode: 'input' }],
  ['output', { mode: 'output' }],
] as const

const KIND_WINDOWS = CREATE_WINDOWS.filter(([, win]) => win.mode !== 'input')

const SECRET_REASON = 'A secret input has no default: the Function Block gives the value.'

function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

function expectInDomOrder(nodes: HTMLElement[]) {
  const follows = nodes
    .slice(1)
    .map((node, i) => Boolean(nodes[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
  expect(follows).toEqual(nodes.slice(1).map(() => true))
}

const setToNull = () => screen.getByTestId('create-set-to-null-checkbox')

/** The `null` field shows the word null, as a value, a placeholder or text. */
function nullFieldText(): string {
  const field = screen.getByTestId('create-null-field')
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return (field.value || field.placeholder).trim()
  }
  return (field.textContent ?? '').trim()
}

function isDisabledField(field: HTMLElement): boolean {
  return field.matches(':disabled') || field.getAttribute('aria-disabled') === 'true'
}

/** The focusable element carrying a disabled control's reason (the control or its wrapper). */
function reasonTrigger(control: HTMLElement): HTMLElement {
  let node: HTMLElement | null = control
  while (node) {
    const ownFocus =
      (node instanceof HTMLInputElement || node instanceof HTMLButtonElement) && !node.disabled
    if (ownFocus || node.getAttribute('tabindex') === '0') return node
    node = node.parentElement
  }
  throw new Error('no focusable element carries the reason')
}

async function focusReason(control: HTMLElement): Promise<HTMLElement> {
  const trigger = reasonTrigger(control)
  act(() => trigger.focus())
  return screen.findByRole('tooltip')
}

describe('VariableCreateModal - Set to null (VMGR-97, REQ-3.1.3.24)', () => {
  it.each(CREATE_WINDOWS)('%s window: shows "Set to null" unticked right under Mark as secret', (_window, win) => {
    renderModal(win)
    const box = screen.getByRole('checkbox', { name: 'Set to null' })
    expect(box).toBe(setToNull())
    expect(box).not.toBeChecked()
    expect(box).toBeEnabled()
    const boxes = within(screen.getByTestId('variable-create-modal')).getAllByRole('checkbox')
    expect(boxes.indexOf(box)).toBe(boxes.indexOf(screen.getByTestId('create-secret-checkbox')) + 1)
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
  })

  const TICK_CASES = CREATE_WINDOWS.flatMap(([window, win]) =>
    (['String', 'Map'] as const).map((type) => [window, type, win] as const),
  )

  it.each(TICK_CASES)(
    '%s window, %s: ticked, the Kind and the value field give way to one null field, its Open editor button drawn off',
    async (_window, type, win) => {
      const user = userEvent.setup()
      renderModal(win)
      await pickFromSelect(user, 'create-type-select', type)
      expect(textField(ADD_VALUE_LABEL[win.mode])).toBeInTheDocument()
      expect(screen.getByTestId('open-value-editor-button')).toBeInTheDocument()

      await user.click(setToNull())

      expect(setToNull()).toBeChecked()
      expect(nullFieldText()).toBe('null')
      expect(screen.queryByRole('textbox', { name: ADD_VALUE_LABEL[win.mode] })).not.toBeInTheDocument()
      expect(screen.getByTestId('open-value-editor-button')).toBeDisabled()
      expect(screen.queryByTestId('create-kind-select')).not.toBeInTheDocument()
    },
  )

  it.each(CREATE_WINDOWS)('%s window: unticking brings back the value held before', async (_window, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-type-select', 'Integer')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(setToNull())
    await user.click(setToNull())
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', 'typed')
  })

  it.each(CREATE_WINDOWS)('%s window: Create is enabled while ticked although the value was invalid', async (_window, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await user.type(screen.getByTestId('create-variable-name'), 'count')
    await pickFromSelect(user, 'create-type-select', 'Integer')
    await user.click(screen.getByTestId('scalar-edit-body-invalid'))
    expect(screen.getByTestId('create-submit-button')).toBeDisabled()
    await user.click(setToNull())
    expect(screen.getByTestId('create-submit-button')).toBeEnabled()
    expect(screen.queryByTestId('create-validation')).not.toBeInTheDocument()
  })

  it.each(CREATE_WINDOWS)('%s window: a type switch while ticked keeps the null and creates a plain null', async (_window, win) => {
    const user = userEvent.setup()
    const { onCreate } = renderModal(win)
    await user.type(screen.getByTestId('create-variable-name'), 'empty_one')
    await user.click(setToNull())
    await pickFromSelect(user, 'create-type-select', 'Integer')
    expect(setToNull()).toBeChecked()
    expect(nullFieldText()).toBe('null')
    await user.click(screen.getByTestId('create-submit-button'))
    const spec = (onCreate.mock.calls[0] as unknown[])[0]
    expect(spec).toEqual(expect.objectContaining({ name: 'empty_one', type: 'integer', value: null }))
    expect(spec).not.toHaveProperty('isExpression')
    expect(spec).not.toHaveProperty('isTemplate')
    expect(spec).not.toHaveProperty('elementTypes')
  })

  it('creates a test variable that is exactly a plain null', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()
    await user.type(screen.getByTestId('create-variable-name'), 'nothing_yet')
    await user.click(setToNull())
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onCreate).toHaveBeenCalledWith({ name: 'nothing_yet', type: 'string', value: null })
  })

  const BLUR_CASES = CREATE_WINDOWS.flatMap(([window, win]) =>
    (['Integer', 'Float'] as const).map((type) => [window, type, win] as const),
  )

  it.each(BLUR_CASES)('%s window: an emptied %s box ticks Set to null when it loses focus', async (_window, type, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await user.type(screen.getByTestId('create-variable-name'), 'count')
    await pickFromSelect(user, 'create-type-select', type)
    await user.click(screen.getByTestId('scalar-edit-body-invalid'))
    expect(setToNull()).not.toBeChecked()
    expect(screen.getByTestId('create-submit-button')).toBeDisabled()
    await user.click(screen.getByTestId('scalar-edit-body-empty-blur'))
    expect(setToNull()).toBeChecked()
    expect(nullFieldText()).toBe('null')
    expect(screen.queryByTestId('create-validation')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-submit-button')).toBeEnabled()
  })
})

describe('VariableCreateModal - Set to null is hidden for an Expression or a Template (VMGR-111, REQ-3.1.3.24)', () => {
  const SOURCE_CASES = KIND_WINDOWS.flatMap(([window, win]) =>
    (['Expression', 'Template'] as const).map((kind) => [window, kind, win] as const),
  )

  it.each(SOURCE_CASES)('%s window: Kind %s hides Set to null, Literal brings it back', async (_window, kind, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-kind-select', kind)
    expect(screen.queryByTestId('create-set-to-null-checkbox')).not.toBeInTheDocument()
    await pickFromSelect(user, 'create-kind-select', 'Literal')
    expect(setToNull()).not.toBeChecked()
    expectFree(setToNull())
  })
})

describe('VariableCreateModal - output Kind (VMGR-99, REQ-3.1.2.8)', () => {
  it('offers Literal, Expression and Template for a String output', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'output' })
    expect((await optionTexts(user, 'create-kind-select')).map((t) => t.trim())).toEqual([
      'Literal',
      'Expression',
      'Template',
    ])
  })

  it('offers Literal and Expression for an Integer output', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'output' })
    await pickFromSelect(user, 'create-type-select', 'Integer')
    expect((await optionTexts(user, 'create-kind-select')).map((t) => t.trim())).toEqual([
      'Literal',
      'Expression',
    ])
  })

  it('creates an output expression carrying isExpression', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'output' })
    await user.type(screen.getByTestId('create-variable-name'), 'total')
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    await user.type(screen.getByTestId('expression-field'), 'a + b')
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'total', type: 'string', value: 'a + b', isExpression: true }),
    )
  })

  it('checks an output expression for a cycle when it loses focus', async () => {
    const user = userEvent.setup()
    renderModal({
      mode: 'output',
      validateExpressionCycle: () => "Circular reference detected for variable 'total': total -> total",
    })
    await user.type(screen.getByTestId('create-variable-name'), 'total')
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    const expr = screen.getByTestId('expression-field')
    await user.type(expr, 'total + 1')
    fireEvent.blur(expr)
    expect(screen.getByTestId('create-cycle-error')).toHaveTextContent(
      exactly("Circular reference detected for variable 'total': total -> total"),
    )
    expect(screen.getByTestId('create-submit-button')).toBeDisabled()
  })
})

describe("VariableCreateModal - a secret input's default (VMGR-111, REQ-3.1.2.9)", () => {
  it('the default field opens its reason below the field, clear of the labels above it', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('create-secret-checkbox'))
    const tip = await focusReason(screen.getByTestId('create-null-field'))
    expect(tip.closest('[data-slot="tooltip-content"]')).toHaveAttribute('data-side', 'bottom')
  })

  it('a click leaves the forced default field read-only and unfocused', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('create-secret-checkbox'))
    const field = screen.getByTestId('create-null-field')
    await user.click(field)
    expect(field).not.toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Default value' })).toBe(field)
    expect(field).toHaveAttribute('readonly')
    expect(nullFieldText()).toBe('null')
  })

  it('Mark as secret on an input ticks Set to null, disables it and the default field', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('create-secret-checkbox'))
    expect(setToNull()).toBeChecked()
    expect(setToNull()).toHaveAttribute('aria-disabled', 'true')
    await user.click(setToNull())
    expect(setToNull()).toBeChecked()
    expect(isDisabledField(screen.getByTestId('create-null-field'))).toBe(true)
    expect(screen.queryByTestId('scalar-edit-body')).not.toBeInTheDocument()
  })

  it('Mark as secret on an input explains the disabled Set to null', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('create-secret-checkbox'))
    expect(await focusReason(setToNull())).toHaveTextContent(exactly(SECRET_REASON))
  })

  it('gives the secret reason when Required and Mark as secret are both ticked', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(screen.getByTestId('param-required-checkbox'))
    await user.click(screen.getByTestId('create-secret-checkbox'))
    expect(await focusReason(setToNull())).toHaveTextContent(exactly(SECRET_REASON))
  })

  it('creates a secret input with no default', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'input' })
    await user.type(screen.getByTestId('create-variable-name'), 'token')
    await user.click(screen.getByTestId('create-secret-checkbox'))
    await user.click(screen.getByTestId('create-submit-button'))
    const spec = (onCreate.mock.calls[0] as unknown[])[0]
    expect(spec).toEqual(expect.objectContaining({ name: 'token', secret: true }))
    expect(spec).not.toHaveProperty('value')
  })

  it('Mark as secret on a String input locks Create enum off with "off while secret is set"', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    expect(screen.queryByText('off while secret is set')).not.toBeInTheDocument()
    await user.click(secretBox())
    expect(enumBox()).not.toBeChecked()
    expectLockedWithHint(enumBox(), 'off while secret is set')
    expect(screen.queryByText('off while enum is set')).not.toBeInTheDocument()
  })

  it('a secret output keeps Set to null free and its default editable (SECUI-11)', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'output' })
    await user.type(screen.getByTestId('create-variable-name'), 'token')
    await user.click(screen.getByTestId('create-secret-checkbox'))
    expect(setToNull()).not.toBeChecked()
    expect(setToNull()).toBeEnabled()
    expect(screen.getByTestId('create-kind-select')).toBeInTheDocument()
    await enterText(user, textField('Value'), 'typed')
    await user.click(screen.getByTestId('create-submit-button'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'token', value: 'typed', secret: true }),
    )
  })
})

describe('VariableCreateModal - a Required input default (VMGR-113, REQ-3.1.2.10)', () => {
  const defaultField = () => textField('Default value')

  async function openRequired(user: ReturnType<typeof userEvent.setup>, typeLabel = 'String') {
    const handles = renderModal({ mode: 'input' })
    await user.type(nameField(), 'host')
    if (typeLabel !== 'String') await pickFromSelect(user, 'create-type-select', typeLabel)
    await user.click(requiredBox())
    return handles
  }

  it('locks Set to null off with "off while Required is set" and keeps an empty, editable default field', async () => {
    const user = userEvent.setup()
    await openRequired(user)
    expect(setToNull()).not.toBeChecked()
    expectLockedWithHint(setToNull(), 'off while Required is set')
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
    const field = defaultField()
    expect(field).toHaveValue('')
    expect(field.getAttribute('placeholder') ?? '').toBe('')
    expect(field).not.toHaveAttribute('readonly')
    expect(isDisabledField(field)).toBe(false)
    expect(createButton()).toBeEnabled()
  })

  it.each(['String', 'Array', 'Map', 'Table'])(
    'ticking Required clears the %s preset: an empty field with no placeholder and its Open editor, created with no default',
    async (typeLabel) => {
      const user = userEvent.setup()
      const { onCreate } = await openRequired(user, typeLabel)
      expect(defaultField()).toHaveValue('')
      expect(defaultField().getAttribute('placeholder') ?? '').toBe('')
      expect(screen.getByTestId('open-value-editor-button')).toBeInTheDocument()
      expect(setToNull()).not.toBeChecked()
      await user.click(createButton())
      const spec = firstSpec(onCreate)
      expect(spec).toEqual(expect.objectContaining({ name: 'host', required: true }))
      expect(spec.value).toBeUndefined()
    },
  )

  it.each(['Integer', 'Float'])('ticking Required clears the %s preset: created with no default', async (typeLabel) => {
    const user = userEvent.setup()
    const { onCreate } = await openRequired(user, typeLabel)
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(setToNull()).not.toBeChecked()
    await user.click(createButton())
    const spec = firstSpec(onCreate)
    expect(spec).toEqual(expect.objectContaining({ name: 'host', required: true }))
    expect(spec.value).toBeUndefined()
  })

  it('keeps a default typed after ticking Required', async () => {
    const user = userEvent.setup()
    const { onCreate } = await openRequired(user)
    await enterText(user, defaultField(), 'localhost')
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'host', required: true, value: 'localhost' }),
    )
  })

  it('a Required true/false input always has one side picked: Add starts on False', async () => {
    const user = userEvent.setup()
    const { onCreate } = await openRequired(user, 'Boolean')
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', 'false')
    expect(setToNull()).not.toBeChecked()
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'host', required: true, value: false }))
  })

  it('ticking Required while Set to null is ticked unticks it and leaves no default', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'input' })
    await user.type(nameField(), 'host')
    await user.click(setToNull())
    await user.click(requiredBox())
    expect(setToNull()).not.toBeChecked()
    expectLockedWithHint(setToNull(), 'off while Required is set')
    expect(defaultField()).toHaveValue('')
    await user.click(createButton())
    const spec = firstSpec(onCreate)
    expect(spec).toEqual(expect.objectContaining({ name: 'host', required: true }))
    expect(spec.value).toBeUndefined()
  })

  it('a true/false input ticked Required from null shows False', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ mode: 'input' })
    await user.type(nameField(), 'verbose')
    await pickFromSelect(user, 'create-type-select', 'Boolean')
    await user.click(setToNull())
    await user.click(requiredBox())
    expect(setToNull()).not.toBeChecked()
    expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-value', 'false')
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'verbose', required: true, value: false }))
  })

  it('unticking Required keeps the default as it is and frees Set to null', async () => {
    const user = userEvent.setup()
    await openRequired(user)
    await enterText(user, defaultField(), 'localhost')
    await user.click(requiredBox())
    expect(requiredBox()).not.toBeChecked()
    expect(defaultField()).toHaveValue('localhost')
    expect(setToNull()).not.toBeChecked()
    expectFree(setToNull())
    expect(screen.queryByText('off while Required is set')).not.toBeInTheDocument()
  })

  it('an emptied number box means no default: Set to null stays off and Create stays enabled', async () => {
    const user = userEvent.setup()
    const { onCreate } = await openRequired(user, 'Integer')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('scalar-edit-body-empty'))
    await user.click(screen.getByTestId('scalar-edit-body-empty-blur'))
    expect(setToNull()).not.toBeChecked()
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-validation')).not.toBeInTheDocument()
    expect(createButton()).toBeEnabled()
    await user.click(createButton())
    expect(firstSpec(onCreate).value).toBeUndefined()
  })
})

describe('VariableCreateModal - enum input (VMGR-112, REQ-3.1.2.11)', () => {
  const allowedField = () => textField('Allowed values')
  const defaultSelect = () => screen.getByRole('combobox', { name: captionName('Default value') })

  async function openEnum(user: ReturnType<typeof userEvent.setup>, typeLabel = 'String') {
    const handles = renderModal({ mode: 'input' })
    await user.type(nameField(), 'env')
    if (typeLabel !== 'String') await pickFromSelect(user, 'create-type-select', typeLabel)
    await user.click(enumBox())
    return handles
  }

  async function pickDefault(user: ReturnType<typeof userEvent.setup>, option: string) {
    await user.click(defaultSelect())
    await screen.findAllByRole('option')
    await user.click(screen.getByRole('option', { name: option }))
  }

  it.each(['String', 'Integer', 'Float'])('offers Create enum on a %s input', async (typeLabel) => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await pickFromSelect(user, 'create-type-select', typeLabel)
    expect(enumBox()).toBeInTheDocument()
  })

  it.each(['Boolean', 'Array', 'Map', 'Table'])('offers no Create enum on a %s input', async (typeLabel) => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await pickFromSelect(user, 'create-type-select', typeLabel)
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
  })

  it('narrows the Type choices to String, Integer and Float while Create enum is on', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    const options = await optionTexts(user, 'create-type-select')
    expect(options).toHaveLength(3)
    expect(options[0]).toMatch(/^String/)
    expect(options[1]).toMatch(/^Integer/)
    expect(options[2]).toMatch(/^Float/)
  })

  it('ticks and locks Required with "locked on while enum is set"', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(requiredBox()).toBeChecked()
    expectLockedWithHint(requiredBox(), 'locked on while enum is set')
  })

  it('locks Mark as secret off with "off while enum is set"', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(secretBox()).not.toBeChecked()
    expectLockedWithHint(secretBox(), 'off while enum is set')
    expect(screen.queryByText('off while secret is set')).not.toBeInTheDocument()
  })

  it('unticks and locks Set to null with "off while enum is set", also after a tick', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(setToNull())
    await user.click(enumBox())
    expect(setToNull()).not.toBeChecked()
    expectLockedWithHint(setToNull(), 'off while enum is set')
    expect(screen.queryByText('off while Required is set')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-null-field')).not.toBeInTheDocument()
  })

  it('opens the "Edit value" window on the Allowed values typed by the input type', async () => {
    const user = userEvent.setup()
    await openEnum(user, 'Integer')
    const openEditor = screen.getByTestId('open-allowed-values-editor-button')
    expect(openEditor).toHaveAccessibleName('Open editor')
    await user.click(openEditor)
    const sheet = await screen.findByTestId('value-editor-sheet')
    expect(await within(sheet).findByTestId('array-edit-body')).toHaveAttribute('data-item-type', 'integer')
  })

  it('shows the empty Allowed values list right under Create enum with "Enum allowed values cannot be empty" at once', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(allowedField()).toHaveValue('[]')
    expectInDomOrder([enumBox(), allowedField()])
    expect(screen.getByTestId('create-enum-error')).toHaveTextContent(exactly('Enum allowed values cannot be empty'))
  })

  it('shows the empty Default value select marked invalid with "Default value is required"', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(defaultSelect()).toHaveTextContent(exactly('Select…'))
    expect(defaultSelect()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('create-enum-default-error')).toHaveTextContent(exactly('Default value is required'))
  })

  it('keeps Create disabled until the allowed values are valid and a default is picked', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(createButton()).toBeDisabled()
    await enterText(user, allowedField(), '["dev", "staging", "prod"]')
    expect(screen.queryByTestId('create-enum-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-enum-default-error')).toBeInTheDocument()
    expect(createButton()).toBeDisabled()
    await pickDefault(user, 'dev')
    expect(screen.queryByTestId('create-enum-default-error')).not.toBeInTheDocument()
    expect(defaultSelect()).not.toHaveAttribute('aria-invalid', 'true')
    expect(createButton()).toBeEnabled()
  })

  it('creates a String enum: its allowed values, the picked default, Required, never secret', async () => {
    const user = userEvent.setup()
    const { onCreate } = await openEnum(user)
    await enterText(user, allowedField(), '["dev", "staging", "prod"]')
    await pickDefault(user, 'dev')
    await user.click(createButton())
    const spec = firstSpec(onCreate)
    expect(spec).toEqual(
      expect.objectContaining({
        name: 'env',
        type: 'string',
        required: true,
        enumValues: ['dev', 'staging', 'prod'],
        value: 'dev',
      }),
    )
    expect(spec).not.toHaveProperty('enumValueType')
    expect(spec).not.toHaveProperty('secret')
  })

  it('creates an Integer enum whose allowed values and default carry the input type', async () => {
    const user = userEvent.setup()
    const { onCreate } = await openEnum(user, 'Integer')
    await enterText(user, allowedField(), '[1, 2]')
    await pickDefault(user, '2')
    await user.click(createButton())
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'env', type: 'integer', required: true, enumValues: [1, 2], value: 2 }),
    )
  })

  it('refuses an allowed value that is not of the input type with the exact message', async () => {
    const user = userEvent.setup()
    await openEnum(user, 'Integer')
    await enterText(user, allowedField(), '[1, "abc"]')
    expect(screen.getByTestId('create-enum-error')).toHaveTextContent(
      exactly('Allowed value at index 1 (abc) is not a valid integer'),
    )
    expect(createButton()).toBeDisabled()
  })

  it('returns the default to the empty select when the allowed values no longer hold it', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    await enterText(user, allowedField(), '["dev", "staging"]')
    await pickDefault(user, 'staging')
    await enterText(user, allowedField(), '["dev"]')
    expect(defaultSelect()).toHaveTextContent(exactly('Select…'))
    expect(defaultSelect()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('create-enum-default-error')).toHaveTextContent(exactly('Default value is required'))
    expect(createButton()).toBeDisabled()
  })

  it('unticking Create enum hides Allowed values, unlocks Required and gives the default back to the type field', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    await enterText(user, allowedField(), '["dev", "staging"]')
    await pickDefault(user, 'dev')
    await user.click(enumBox())
    expect(screen.queryByRole('textbox', { name: captionName('Allowed values') })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: captionName('Default value') })).not.toBeInTheDocument()
    expect(requiredBox()).toBeChecked()
    expectFree(requiredBox())
    expectLockedWithHint(setToNull(), 'off while Required is set')
    expect(textField('Default value')).toHaveValue('dev')
  })

  it('never offers a Value Type select', async () => {
    const user = userEvent.setup()
    await openEnum(user)
    expect(screen.queryByTestId('param-enum-value-type-select')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Value Type' })).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal - one window per Add (VMGR-101)', () => {
  it('registers each window under its own sheet id', () => {
    renderModal({ windowId: 'alpha' })
    renderModal({ mode: 'input', windowId: 'beta', cascadeIndex: 1 })
    expect(screen.getAllByTestId('variable-create-modal')).toHaveLength(2)
    let alpha = false
    let beta = false
    act(() => {
      alpha = focusSheet('variable-create-alpha')
      beta = focusSheet('variable-create-beta')
    })
    expect(alpha).toBe(true)
    expect(beta).toBe(true)
  })

  it('offsets a window by 24px per cascade index', () => {
    renderModal({ windowId: 'cascade-two', cascadeIndex: 2 })
    expect(screen.getByTestId('variable-create-modal').style.transform).toBe(
      'translate(calc(-50% + 48px), calc(-50% + 48px))',
    )
  })

  it('wraps the cascade offset every 8 windows', () => {
    renderModal({ windowId: 'cascade-nine', cascadeIndex: 9 })
    expect(screen.getByTestId('variable-create-modal').style.transform).toBe(
      'translate(calc(-50% + 24px), calc(-50% + 24px))',
    )
  })
})

describe('VariableCreateModal - a short window scrolls to the whole value area', () => {
  const valueArea = () => screen.getByTestId('create-value-area')

  // The value area sits in the scrolling form, fills its spare height and never shrinks below its label and editor.
  function expectKeepsEditor(editor: HTMLElement) {
    const area = valueArea()
    expect(area.parentElement).toHaveClass('overflow-y-auto')
    expect(area).toHaveClass('flex', 'flex-1', 'flex-col')
    expect(area).not.toHaveClass('min-h-0')
    expect(area.firstElementChild?.tagName).toBe('LABEL')
    expect(area).toContainElement(editor)
  }

  function expectFullBox(editor: HTMLElement) {
    expectKeepsEditor(editor)
    expect(valueArea()).not.toHaveClass('min-h-40')
  }

  it.each(CREATE_WINDOWS)('%s window: a String Literal is the one-line value field (VMGR-110)', (_window, win) => {
    renderModal(win)
    const field = screen.getByTestId('window-value-field')
    expectFullBox(field)
    expect(within(field).getByRole('textbox').tagName).toBe('INPUT')
    expect(screen.queryByTestId('create-string-box')).not.toBeInTheDocument()
  })

  it.each(KIND_WINDOWS)('%s window: a Template is the {{ }} source field (VMGR-74)', async (_window, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-kind-select', 'Template')
    expectFullBox(screen.getByTestId('expression-field'))
    expect(screen.queryByTestId('create-string-box')).not.toBeInTheDocument()
  })

  it.each(KIND_WINDOWS)('%s window: an Expression field keeps its full box', async (_window, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    expectFullBox(screen.getByTestId('expression-field'))
    expect(screen.queryByTestId('create-string-box')).not.toBeInTheDocument()
  })

  const SCALAR_CASES = CREATE_WINDOWS.flatMap(([window, win]) =>
    (['Integer', 'Float', 'Boolean'] as const).map((type) => [window, type, win] as const),
  )

  it.each(SCALAR_CASES)('%s window: the %s editor keeps its full box', async (_window, type, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-type-select', type)
    expectFullBox(screen.getByTestId('scalar-edit-body'))
    expect(screen.queryByTestId('create-string-box')).not.toBeInTheDocument()
  })

  it.each(CREATE_WINDOWS)('%s window: the Set to null field keeps its full box', async (_window, win) => {
    const user = userEvent.setup()
    renderModal(win)
    await pickFromSelect(user, 'create-type-select', 'Map')
    await user.click(setToNull())
    expectFullBox(screen.getByTestId('create-null-field'))
  })

  it('input window: the forced null field of a secret input keeps its full box under "Default value"', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await user.click(secretBox())
    expectFullBox(screen.getByTestId('create-null-field'))
    expect(valueArea().firstElementChild).toHaveTextContent(exactly('Default value'))
  })

  it('output window: the cycle error line stays in the value area under the Expression field', async () => {
    const user = userEvent.setup()
    renderModal({
      mode: 'output',
      validateExpressionCycle: () => "Circular reference detected for variable 'total': total -> total",
    })
    await user.type(screen.getByTestId('create-variable-name'), 'total')
    await pickFromSelect(user, 'create-kind-select', 'Expression')
    const expr = screen.getByTestId('expression-field')
    await user.type(expr, 'total + 1')
    fireEvent.blur(expr)
    const error = screen.getByTestId('create-cycle-error')
    expectFullBox(expr)
    expect(valueArea()).toContainElement(error)
    expectInDomOrder([expr, error])
  })

  it('input window: the enum error line follows the Allowed values list', async () => {
    const user = userEvent.setup()
    renderModal({ mode: 'input' })
    await pickFromSelect(user, 'create-type-select', 'Integer')
    await user.click(enumBox())
    await enterText(user, textField('Allowed values'), '["x"]')
    expectInDomOrder([textField('Allowed values'), screen.getByTestId('create-enum-error')])
  })
})

describe('VariableCreateModal - Edit fills the window from the row (VMGR-106, REQ-3.1.1.5)', () => {
  it('fills a Test variable: its name, type, Kind and value', () => {
    renderEditWindow()
    expect(nameField()).toHaveValue('greeting')
    expect(screen.getByTestId('create-type-select')).toHaveTextContent('String')
    expect(screen.getByTestId('create-kind-select')).toHaveTextContent('Literal')
    expect(textField('Value')).toHaveValue('hello')
  })

  it("fills an input's Required tick and Description", () => {
    renderEditWindow({ mode: 'input', row: { ...EDIT_ROWS.input, required: true } })
    expect(nameField()).toHaveValue('host')
    expect(requiredBox()).toBeChecked()
    expect(screen.getByTestId('param-description')).toHaveValue('Target host')
  })

  it("fills an enum input's Create enum, allowed values and default", () => {
    renderEditWindow({
      mode: 'input',
      row: {
        id: 'param:input:env',
        name: 'env',
        type: 'string',
        value: 'staging',
        required: true,
        description: '',
        enumValues: ['dev', 'staging', 'prod'],
      },
    })
    expect(enumBox()).toBeChecked()
    expect(textField('Allowed values')).toHaveValue('["dev", "staging", "prod"]')
    expect(screen.getByRole('combobox', { name: 'Value' })).toHaveTextContent(exactly('staging'))
  })

  it('leaves every field of a Test variable editable, as in Add', () => {
    renderEditWindow()
    expect(nameField()).toBeEnabled()
    expect(nameField()).toHaveValue('greeting')
    for (const testId of ['create-type-select', 'create-kind-select', 'create-secret-checkbox', 'create-set-to-null-checkbox']) {
      expectFree(screen.getByTestId(testId))
    }
  })

  it('leaves every field of an input editable, as in Add', () => {
    renderEditWindow({ mode: 'input' })
    expect(screen.getByTestId('param-description')).toHaveValue('Target host')
    for (const testId of [
      'param-description',
      'create-type-select',
      'param-required-checkbox',
      'create-secret-checkbox',
      'create-set-to-null-checkbox',
      'param-create-enum-checkbox',
    ]) {
      expectFree(screen.getByTestId(testId))
    }
  })
})

describe('VariableCreateModal - Save busy while the write is in flight (VMGR-108)', () => {
  it('shows Save busy until the write lands, and a second click sends nothing', async () => {
    const user = userEvent.setup()
    const write = deferred<void>()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEditWindow({ onSaveCurrent: () => write.promise })
    await user.click(valueSwitch())
    await screen.findAllByRole('option')
    await user.click(screen.getByRole('option', { name: 'Current' }))
    await enterText(user, textField('Value'), 'bye')

    await user.click(saveButton())

    await waitFor(() => expect(saveButton()).toHaveAttribute('aria-busy', 'true'))
    expect(onSaveCurrent).toHaveBeenCalledTimes(1)
    const writesSent = onSaveDefinition.mock.calls.length + onSaveCurrent.mock.calls.length
    await user.click(saveButton())
    expect(onSaveDefinition.mock.calls.length + onSaveCurrent.mock.calls.length).toBe(writesSent)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      write.resolve()
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
