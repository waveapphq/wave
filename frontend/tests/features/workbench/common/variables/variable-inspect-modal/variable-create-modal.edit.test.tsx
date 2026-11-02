// The one variable window in Edit (VMGR-106..VMGR-113; REQ-3.1.3.11, REQ-3.2.1.6, REQ-3.1.3.24, REQ-3.1.2.11).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/api/workbench')>()
  return {
    ...actual,
    workbenchApi: {
      ...actual.workbenchApi,
      getSessionVariables: vi.fn(),
      setVariableOverride: vi.fn(),
    },
  }
})
vi.mock('@/features/workbench/api/sql-tools')
vi.mock('@/features/workbench/api/opensearch-tools')
vi.mock('@/features/workbench/api/python-tools')

// The "Edit value" sheet's list body: one click edits the sheet's own draft.
function SheetArrayBodyStub({ onChange }: { onChange: (value: unknown) => void }) {
  return (
    <button type="button" data-testid="sheet-array-change" onClick={() => onChange(['from-sheet'])}>
      change
    </button>
  )
}

vi.mock('@/components/shared/variable-bodies/array-edit-body', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shared/variable-bodies/array-edit-body')>()),
  ArrayEditBody: SheetArrayBodyStub,
}))

vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
  }) => (
    <input
      data-testid="expression-field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  ),
}))

import { workbenchApi } from '@/features/workbench/api/workbench'
import { VariableCreateModal } from '@/features/workbench/common/variables/variable-inspect-modal/variable-create-modal'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { CurrentEditRunConflictDialog } from '@/features/workbench/common/variables/variable-inspect-modal/current-edit-run-conflict-dialog'
import { SaveCanceledError, usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'
import { useRunConflictGuard } from '@/features/workbench/live/use-run-conflict-guard'
import { ToastProvider } from '@/components/ui/toast'
import type { ElementTypes } from '@/lib/variable-validation'

type User = ReturnType<typeof userEvent.setup>
type Spec = Record<string, unknown>
type SaveResult = { success: boolean; error?: string }
type Row = Partial<Variable> & Record<string, unknown>

const mockGetSessionVariables = vi.mocked(
  (workbenchApi as unknown as {
    getSessionVariables: (sessionId: string, names?: string[], functionPath?: string[]) => Promise<unknown>
  }).getSessionVariables,
)
const mockSetVariableOverride = vi.mocked(
  (workbenchApi as unknown as { setVariableOverride: (...args: unknown[]) => Promise<unknown> })
    .setVariableOverride,
)

const BASE_ROW: Variable = { id: 'v1', name: 'user_name', value: 'bob', type: 'string' }

const EXPRESSION_ROW: Row = { name: 'api_url', value: "'http://' + host", isExpression: true }
const TEMPLATE_ROW: Row = { name: 'greeting', value: 'Hello {{user}}!', isTemplate: true }

const ENUM_INPUT_ROW: Row = {
  id: 'param:input:env',
  name: 'env',
  type: 'string',
  value: 'dev',
  required: true,
  description: 'Target environment',
  enumValues: ['dev', 'staging', 'prod'],
}

const REQUIRED_INPUT_ROW: Row = {
  id: 'param:input:host',
  name: 'host',
  type: 'string',
  value: 'db.internal',
  required: true,
  description: 'Database host',
}

const NULL_INPUT_ROW: Row = {
  id: 'param:input:level',
  name: 'level',
  type: 'string',
  value: null,
  description: 'Log level',
}

const OUTPUT_ROW: Row = {
  id: 'param:output:result',
  name: 'result',
  type: 'integer',
  value: 'n * 2',
  isExpression: true,
  description: 'Doubled count',
}

const LOCAL_ROW: Row = { id: 'loc-n', name: 'loc_n', type: 'integer', value: 5 }

// A float column whose typed cell reads as a whole number: only the stored column type keeps it a float.
const FLOAT_TABLE = { columns: [{ name: 'x', type: 'float' }], rows: [['2.5']] }

const MAKE_SECRET_TEXT =
  'Saving makes the plain variable user_name a secret. Its value is masked from then on. Making it plain again clears its value.'
const REMOVE_SECRET_TEXT =
  'Removing secret protection will permanently delete the stored value. This action cannot be undone.'
const RUN_LOCK_TEXT = 'Locked while the test is executing'

interface EditOptions {
  mode?: 'variable' | 'input' | 'output'
  row?: Row
  scope?: string[] | null
  runLocked?: boolean
  sessionId?: string | null
  runtimeValue?: unknown
  hasRuntimeValue?: boolean
  runtimeElementTypes?: ElementTypes
  currentSource?: string
  secretUnlocked?: boolean
  secretChanged?: boolean
  tracksUnsavedSecret?: boolean
  definitionReadOnly?: boolean
  onSaveDefinition?: (spec: Spec) => SaveResult
  onSaveCurrent?: (name: string, body: Spec, scope?: string[] | null) => Promise<void>
  checkNameExists?: (name: string, excludeId: string) => boolean
  validateExpressionCycle?: (params: {
    variableName: string
    value: unknown
    isExpression: boolean
  }) => string | null
}

function editProps(options: EditOptions) {
  return {
    mode: options.mode ?? 'variable',
    availableVariables: [],
    onCreate: vi.fn((): SaveResult => ({ success: true })),
    onClose: vi.fn(),
    checkNameExists: vi.fn(options.checkNameExists ?? (() => false)),
    validateExpressionCycle: vi.fn(options.validateExpressionCycle ?? (() => null)),
    windowId: 'edit-1',
    cascadeIndex: 0,
    editTarget: {
      row: { ...BASE_ROW, ...options.row } as Variable,
      scope: options.scope === undefined ? null : options.scope,
      // The Current display the panel resolves for the row: live, else staged, else run start.
      current:
        options.hasRuntimeValue || options.currentSource !== undefined
          ? {
              value: options.runtimeValue,
              hasValue: options.hasRuntimeValue ?? false,
              elementTypes: options.runtimeElementTypes,
              source: options.currentSource,
            }
          : undefined,
      secretUnlocked: options.secretUnlocked ?? false,
      secretChanged: options.secretChanged ?? false,
      definitionReadOnly: options.definitionReadOnly ?? false,
    },
    tracksUnsavedSecret: options.tracksUnsavedSecret ?? false,
    runLocked: options.runLocked ?? false,
    sessionId: options.sessionId ?? null,
    onSaveDefinition: vi.fn(options.onSaveDefinition ?? ((): SaveResult => ({ success: true }))),
    onSaveCurrent: vi.fn(options.onSaveCurrent ?? (async () => {})),
  }
}

type EditProps = ReturnType<typeof editProps>

function renderEdit(options: EditOptions = {}) {
  const props = editProps(options)
  const view = render(<VariableCreateModal {...props} />)
  const rerender = (next: Partial<EditProps>) =>
    view.rerender(<VariableCreateModal {...props} {...next} />)
  return { ...props, rerender, unmount: view.unmount }
}

function windowEl(): HTMLElement {
  return screen.getByTestId('variable-create-modal')
}

function nameField(): HTMLTextAreaElement {
  return within(windowEl()).getByTestId('create-variable-name') as HTMLTextAreaElement
}

function saveButton(): HTMLElement {
  return within(windowEl()).getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return within(windowEl()).getByRole('button', { name: 'Cancel' })
}

function valueField(): HTMLElement {
  return within(windowEl()).getByTestId('window-value-field')
}

function valueText(): HTMLInputElement {
  return within(valueField()).getByRole('textbox') as HTMLInputElement
}

function expressionBox(): HTMLInputElement {
  return within(valueField()).getByTestId('expression-field') as HTMLInputElement
}

function box(testId: string): HTMLElement {
  return within(windowEl()).getByTestId(testId)
}

function typeSelect(): HTMLElement {
  return box('create-type-select')
}

function kindSelect(): HTMLElement | null {
  return within(windowEl()).queryByTestId('create-kind-select')
}

function strip(): HTMLElement | null {
  return within(windowEl()).queryByTestId('create-validation')
}

function enumSelect(): HTMLElement {
  const element = box('enum-value-select')
  return element.getAttribute('role') === 'combobox' ? element : within(element).getByRole('combobox')
}

function allowedValuesText(): HTMLInputElement {
  const element = box('allowed-values-field')
  return (element.tagName === 'INPUT' ? element : within(element).getByRole('textbox')) as HTMLInputElement
}

function isLocked(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
}

function exact(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

function rename(name: string) {
  fireEvent.change(nameField(), { target: { value: name } })
}

function typeInto(element: HTMLElement, text: string) {
  fireEvent.change(element, { target: { value: text } })
  fireEvent.blur(element)
}

function specOf(onSaveDefinition: EditProps['onSaveDefinition'], call = 0): Spec {
  return onSaveDefinition.mock.calls[call][0] as Spec
}

async function pickView(user: User, label: 'Initial' | 'Current' | 'Default') {
  await user.click(box('value-switch'))
  await user.click(await screen.findByRole('option', { name: label }))
}

async function pickOption(user: User, trigger: HTMLElement, label: string) {
  await user.click(trigger)
  const options = await screen.findAllByRole('option')
  const option = options.find((entry) => (entry.textContent ?? '').startsWith(label))
  if (!option) throw new Error(`Option "${label}" not found`)
  await user.click(option)
}

async function confirmIn(user: User, dialogTitle: string, button: string) {
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByRole('heading', { name: dialogTitle })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: button }))
}

async function unsavedDialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: 'Unsaved changes' })
}

// The dialog's corner X is also named "Close", so each choice is read by its own test id and checked by its label.
const UNSAVED_CHOICE_IDS = { 'Keep Editing': 'unsaved-keep-editing', Close: 'unsaved-close', Save: 'unsaved-save' } as const

function unsavedChoice(dialog: HTMLElement, label: keyof typeof UNSAVED_CHOICE_IDS): HTMLElement {
  const choice = within(dialog).getByTestId(UNSAVED_CHOICE_IDS[label])
  expect(choice).toHaveTextContent(exact(label))
  return choice
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  mockGetSessionVariables.mockReset()
  mockGetSessionVariables.mockResolvedValue({})
  mockSetVariableOverride.mockReset()
  mockSetVariableOverride.mockResolvedValue({})
  usePendingCurrentEdits.setState({ pending: new Map() })
})

// ===========================================================================
// The pencil opens the window filled from the row (VMGR-106)
// ===========================================================================

describe('VariableCreateModal edit - the value caption names a true / false value', () => {
  it("names a Boolean value's true / false group by the Value caption", () => {
    renderEdit({ row: { name: 'enabled', type: 'boolean', value: true } })
    const group = within(windowEl()).getByRole('group', { name: 'Value' })
    expect(within(group).getByRole('button', { name: 'true' })).toHaveAttribute('aria-pressed', 'true')
  })

  it("names a Boolean input's true / false group by the Value caption on its Default view", async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: { id: 'param:input:dry', name: 'dry', type: 'boolean', value: false }, scope: ['fn-1'] })
    await pickView(user, 'Default')
    expect(within(windowEl()).getByRole('group', { name: 'Value' })).toBeInTheDocument()
  })
})

describe('VariableCreateModal edit - the window height follows its fields', () => {
  const heightOf = () => windowEl().style.height
  const LONG_NAME = `v_${'n'.repeat(62)}`

  /** Drags the window's corner down by `dy` while the window measures 410 x 434. */
  function resizeByHand(dy: number) {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(410)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(434)
    try {
      fireEvent.mouseDown(within(windowEl()).getByTestId('dialog-resize-corner'), { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: 0, clientY: dy })
      fireEvent.mouseUp(document)
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  }

  it('sets no fixed height, so its fields decide it and the screen caps it', () => {
    renderEdit()
    expect(heightOf()).toBe('')
    expect(windowEl()).toHaveClass('max-h-screen')
  })

  it('grows with the rename notice: no fixed height holds the Value row below the fold', () => {
    renderEdit({ row: { name: LONG_NAME } })
    rename('total')
    expect(within(windowEl()).getByTestId('window-rename-notice')).toHaveTextContent(LONG_NAME)
    expect(heightOf()).toBe('')
  })

  it('shrinks when Kind Expression hides the Set to null row: no fixed height keeps the blank', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickOption(user, kindSelect() as HTMLElement, 'Expression')
    await confirmIn(user, 'Change variable kind?', 'Change kind')
    expect(within(windowEl()).queryByTestId('create-set-to-null-checkbox')).not.toBeInTheDocument()
    expect(heightOf()).toBe('')
  })

  it('keeps the height the person gave it by hand through a rename notice and a hidden Set to null row', async () => {
    const user = userEvent.setup()
    renderEdit({ row: { name: LONG_NAME } })
    // The shared corner drag counts twice the pointer distance: 434 + 2 x 30.
    resizeByHand(30)
    expect(heightOf()).toBe('494px')

    rename('total')
    expect(within(windowEl()).getByTestId('window-rename-notice')).toBeInTheDocument()
    expect(heightOf()).toBe('494px')

    await pickOption(user, kindSelect() as HTMLElement, 'Expression')
    await confirmIn(user, 'Change variable kind?', 'Change kind')
    expect(within(windowEl()).queryByTestId('create-set-to-null-checkbox')).not.toBeInTheDocument()
    expect(heightOf()).toBe('494px')
  })
})

describe('VariableCreateModal edit - spacing as the wireframe draws it (I-O, VMGR-110)', () => {
  it('keeps the shared 53px header (12px above and below the title), not a tighter one', () => {
    renderEdit()
    const header = screen.getByTestId('variable-create-modal-drag-handle')
    expect(header).toHaveClass('py-3')
    expect(header).not.toHaveClass('py-2')
  })

  it('draws every field caption as a block, so its 6px gap reaches the field', () => {
    renderEdit({ mode: 'input', row: ENUM_INPUT_ROW, scope: ['fn-1'] })
    for (const caption of ['Name', 'Description', 'Type', 'Allowed values', 'Value']) {
      expect(within(windowEl()).getByText(caption, { selector: 'label' })).toHaveClass('block')
    }
  })

  it('draws the true / false control, the masked secret and the expression box as one 36px field', () => {
    const { unmount } = renderEdit({ row: { name: 'enabled', type: 'boolean', value: true } })
    expect(within(windowEl()).getByRole('group', { name: 'Value' })).toHaveClass('h-9')
    unmount()

    const secret = renderEdit({ row: { name: 'token', isSecret: true, value: '********' } })
    expect(within(windowEl()).getByRole('button', { name: 'Value: Edit protected value' })).toHaveClass('!h-9')
    secret.unmount()

    renderEdit({ row: EXPRESSION_ROW })
    expect(expressionBox().parentElement).toHaveClass('[&_.cm-content]:!py-1.5', '[&_.cm-scroller]:!leading-[22px]')
  })
})

describe('VariableCreateModal edit - the "stays visible until you save" strip of a Test secret', () => {
  const SECRET_ROW: Row = { name: 'token', isSecret: true, value: 'sk-old' }
  const NOTICE = /^Secret value stays visible until you save the test\.$/
  const notice = () => within(windowEl()).queryByTestId('inspect-secret-notice')

  it('shows no strip while a visible secret matches the saved Test, then shows it above the footer once its value changes', () => {
    renderEdit({ row: SECRET_ROW, secretUnlocked: true, tracksUnsavedSecret: true })
    expect(notice()).not.toBeInTheDocument()

    typeInto(valueText(), 'sk-new')

    expect(notice()).toHaveTextContent(NOTICE)
    expect(notice()?.nextElementSibling).toContainElement(cancelButton())
  })

  it('shows the strip on open for a secret the store already marks changed', () => {
    renderEdit({ row: SECRET_ROW, secretUnlocked: true, secretChanged: true, tracksUnsavedSecret: true })
    expect(notice()).toHaveTextContent(NOTICE)
  })

  it('shows no strip for an untouched saved null secret', () => {
    renderEdit({ row: { name: 'ssh_session', isSecret: true, value: null }, secretUnlocked: true, tracksUnsavedSecret: true })
    expect(notice()).not.toBeInTheDocument()
  })

  it('shows the strip after Delete & Edit clears a saved secret', async () => {
    const user = userEvent.setup()
    renderEdit({ row: SECRET_ROW, tracksUnsavedSecret: true })
    expect(notice()).not.toBeInTheDocument()
    await user.click(within(windowEl()).getByRole('button', { name: 'Value: Edit protected value' }))
    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))
    expect(notice()).toHaveTextContent(NOTICE)
  })

  it('shows no strip on the Current view, which the Test never stores', async () => {
    const user = userEvent.setup()
    renderEdit({ row: SECRET_ROW, secretUnlocked: true, secretChanged: true, tracksUnsavedSecret: true })
    await pickView(user, 'Current')
    expect(notice()).not.toBeInTheDocument()
  })

  it('shows no strip for a plain variable whose value changed', () => {
    renderEdit({ tracksUnsavedSecret: true })
    typeInto(valueText(), 'carol')
    expect(notice()).not.toBeInTheDocument()
  })

  it('shows no strip where the host keeps no unsaved secret visible (a Function local)', () => {
    renderEdit({ row: SECRET_ROW, secretUnlocked: true, secretChanged: true, tracksUnsavedSecret: false })
    expect(notice()).not.toBeInTheDocument()
  })
})

describe('VariableCreateModal edit - opens filled from the row', () => {
  it('opens in Edit with the saved name and value, on the Initial value', () => {
    renderEdit()
    expect(windowEl()).toHaveAttribute('data-window-mode', 'edit')
    expect(nameField()).toHaveValue('user_name')
    expect(valueText()).toHaveValue('bob')
    expect(box('value-switch')).toHaveTextContent(/^Initial$/)
  })

  it('offers Cancel and Save, with Save enabled while nothing changed', () => {
    renderEdit()
    expect(cancelButton()).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
    expect(saveButton()).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(windowEl()).queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  })

  it('opens an expression variable on Kind Expression with its source in the expression box', () => {
    renderEdit({ row: EXPRESSION_ROW })
    expect(kindSelect()).toHaveTextContent(/^Expression$/)
    expect(expressionBox()).toHaveValue("'http://' + host")
  })

  it('opens a template variable on Kind Template with its {{ }} source', () => {
    renderEdit({ row: TEMPLATE_ROW })
    expect(kindSelect()).toHaveTextContent(/^Template$/)
    expect(expressionBox()).toHaveValue('Hello {{user}}!')
  })

  it('shows Mark as secret ticked for a saved secret and unticked for a plain variable', () => {
    const { unmount } = renderEdit()
    expect(box('create-secret-checkbox')).not.toBeChecked()
    unmount()
    renderEdit({ row: { name: 'token', isSecret: true, value: '********' } })
    expect(box('create-secret-checkbox')).toBeChecked()
  })

  // REQ-3.1.1.5: rows keep Required / Description / enum, so Edit shows them.
  it("shows an enum input's Required tick, Description and allowed values", () => {
    renderEdit({ mode: 'input', row: ENUM_INPUT_ROW, scope: ['fn-1'] })
    expect(box('param-required-checkbox')).toBeChecked()
    expect(box('param-description')).toHaveValue('Target environment')
    expect(box('param-create-enum-checkbox')).toBeChecked()
    expect(allowedValuesText()).toHaveValue('["dev", "staging", "prod"]')
    expect(enumSelect()).toHaveTextContent(/^dev$/)
  })

  it('shows a Required input with its Required tick, Description and default', () => {
    renderEdit({ mode: 'input', row: REQUIRED_INPUT_ROW, scope: ['fn-1'] })
    expect(box('param-required-checkbox')).toBeChecked()
    expect(isLocked(box('param-required-checkbox'))).toBe(false)
    expect(box('param-description')).toHaveValue('Database host')
    expect(box('param-create-enum-checkbox')).not.toBeChecked()
    expect(valueText()).toHaveValue('db.internal')
  })

  it("shows an output's Description and its Kind", () => {
    renderEdit({ mode: 'output', row: OUTPUT_ROW, scope: ['fn-1'] })
    expect(box('param-description')).toHaveValue('Doubled count')
    expect(kindSelect()).toHaveTextContent(/^Expression$/)
    expect(expressionBox()).toHaveValue('n * 2')
  })
})

// ===========================================================================
// VMGR-108: the value switch only picks the value; every other field stays editable
// ===========================================================================

describe('VariableCreateModal edit - every field editable on either value', () => {
  it('keeps Name, Type, Kind, Mark as secret and Set to null editable on Current', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickView(user, 'Current')
    expect(nameField()).not.toHaveAttribute('readonly')
    expect(kindSelect()).toBeInTheDocument()
    for (const element of [
      nameField(),
      typeSelect(),
      kindSelect() as HTMLElement,
      box('create-secret-checkbox'),
      box('create-set-to-null-checkbox'),
    ]) {
      expect(isLocked(element)).toBe(false)
    }
  })

  it("keeps an input's Name, Description, Type, Required, Mark as secret and Create enum editable on Current", async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: REQUIRED_INPUT_ROW, scope: ['fn-1'] })
    await pickView(user, 'Current')
    for (const element of [
      nameField(),
      box('param-description'),
      typeSelect(),
      box('param-required-checkbox'),
      box('create-secret-checkbox'),
      box('param-create-enum-checkbox'),
    ]) {
      expect(isLocked(element)).toBe(false)
    }
  })

  it('saves a rename typed on the Current value', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit()
    await pickView(user, 'Current')
    rename('account')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'account' })
  })

  it('saves a rename typed on the Initial value together with the edited value in one definition write', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onCreate, onClose } = renderEdit()
    rename('account')
    typeInto(valueText(), 'alice')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaveDefinition).toHaveBeenCalledTimes(1)
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'account', type: 'string', value: 'alice' })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('saves the rename of a template variable', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ row: TEMPLATE_ROW })
    rename('salutation')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'salutation', isTemplate: true })
  })

  it('writes a Description and Required changed on Current into the definition', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      mode: 'input',
      row: REQUIRED_INPUT_ROW,
      scope: ['fn-1'],
    })
    await pickView(user, 'Current')
    fireEvent.change(box('param-description'), { target: { value: 'Primary host' } })
    await user.click(box('param-required-checkbox'))
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ description: 'Primary host', required: false })
  })
})

// ===========================================================================
// The value switch: what each view shows and where Save writes (VMGR-108)
// ===========================================================================

describe('VariableCreateModal edit - the value switch', () => {
  it("shows the saved definition on Initial and the run's value on Current", async () => {
    const user = userEvent.setup()
    renderEdit({ sessionId: 'session-1', runtimeValue: 'live-bob', hasRuntimeValue: true })
    expect(valueText()).toHaveValue('bob')
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('live-bob')
  })

  it('shows the Initial value on Current while the variable has no Current value', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('bob')
  })

  it('keeps both drafts while switching between Initial and Current', async () => {
    const user = userEvent.setup()
    renderEdit()
    typeInto(valueText(), 'initial-draft')
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('bob')
    typeInto(valueText(), 'current-draft')
    await pickView(user, 'Initial')
    expect(valueText()).toHaveValue('initial-draft')
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('current-draft')
  })

  it('writes an Initial edit to the definition only', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit()
    typeInto(valueText(), 'alice')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'user_name', type: 'string', value: 'alice' })
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it("writes a Current edit as its value and type, never into the definition's value", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent } = renderEdit()
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalledTimes(1))
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['user_name', { value: 'carol', type: 'string' }])
    for (const [spec] of onSaveDefinition.mock.calls) {
      expect((spec as Spec).value).toBe('bob')
    }
  })

  it('leaves the override API to the host', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({ sessionId: 'session-1' })
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(mockSetVariableOverride).not.toHaveBeenCalled()
  })

  it('closes once the definition and the Current value are written', async () => {
    const user = userEvent.setup()
    const { onClose } = renderEdit()
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("seeds an expression's Current value from its active Current source", async () => {
    const user = userEvent.setup()
    renderEdit({ row: EXPRESSION_ROW, currentSource: "'https://' + host" })
    await pickView(user, 'Current')
    expect(expressionBox()).toHaveValue("'https://' + host")
  })

  it('re-arms an expression on Current with its new source', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({ row: EXPRESSION_ROW, currentSource: "'http://' + host" })
    await pickView(user, 'Current')
    typeInto(expressionBox(), "'https://' + host")
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual([
      'api_url',
      { expression: "'https://' + host", type: 'string' },
    ])
  })

  it('re-arms a template on Current with its new source', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({ row: TEMPLATE_ROW })
    await pickView(user, 'Current')
    typeInto(expressionBox(), 'Hi {{user}}')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual([
      'greeting',
      { template: 'Hi {{user}}', type: 'string' },
    ])
  })

  // REQ-3.2.1.6: a Current value can be set to null.
  it('writes a Current value set to null as a null of its type', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({ sessionId: 'session-1' })
    await pickView(user, 'Current')
    await user.click(box('create-set-to-null-checkbox'))
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['user_name', { value: null, type: 'string' }])
  })

  it("reads the full Current value of a Function's map from that Function's scope", async () => {
    const user = userEvent.setup()
    mockGetSessionVariables.mockResolvedValue({
      loc_map: { value: { n: 16 }, type: 'map', elementTypes: { n: 'integer' } },
    })
    renderEdit({
      scope: ['fn-1'],
      row: { id: 'loc-map', name: 'loc_map', type: 'map', value: { n: '1' }, elementTypes: { n: 'string' } },
      sessionId: 'session-1',
      runtimeValue: { count: 1, changed: true },
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    await waitFor(() =>
      expect(mockGetSessionVariables).toHaveBeenCalledWith('session-1', ['loc_map'], ['fn-1']),
    )
  })

  it('edits a live map from its full value, never the summary, and saves it with its element types', async () => {
    const user = userEvent.setup()
    mockGetSessionVariables.mockResolvedValue({
      user_map: { value: { n: 16 }, type: 'map', elementTypes: { n: 'integer' } },
    })
    const { onSaveCurrent } = renderEdit({
      row: { name: 'user_map', type: 'map', value: { n: '1' }, elementTypes: { n: 'string' } },
      sessionId: 'session-1',
      runtimeValue: { count: 1, changed: true },
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    await waitFor(() => expect(valueText()).toHaveValue('{"n": 16}'))
    typeInto(valueText(), '{"n": 17}')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    const [name, body] = onSaveCurrent.mock.calls[0] as [
      string,
      { value: Record<string, unknown>; type: string; elementTypes: unknown },
    ]
    expect(name).toBe('user_map')
    expect(body).toMatchObject({ type: 'map', elementTypes: { n: 'integer' } })
    expect(String(body.value.n)).toBe('17')
  })

  it('shows a staged Current map by its own element types', async () => {
    const user = userEvent.setup()
    renderEdit({
      row: { name: 'user_map', type: 'map', value: { n: '1' }, elementTypes: { n: 'string' } },
      runtimeValue: { n: '20' },
      hasRuntimeValue: true,
      runtimeElementTypes: { n: 'float' },
    })
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('{"n": 20}')
  })

  it("saves an Initial map with the definition's element types", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'user_map', type: 'map', value: { n: '1' }, elementTypes: { n: 'string' } },
    })
    rename('settings')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: { n: '1' }, elementTypes: { n: 'string' } })
  })

  it('saves a list typed as one-line text with its element types', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'items', type: 'array', value: ['alpha', 'beta'] },
    })
    typeInto(valueText(), '["edited"]')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: ['edited'], elementTypes: ['string'] })
  })

  // REQ-3.5.5.1: a table keeps its column types through the window.
  it('saves an Initial table as columns and rows with its column types', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'rows_var', type: 'table', value: FLOAT_TABLE },
    })
    typeInto(valueText(), '[{"x": 1}]')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const saved = specOf(onSaveDefinition).value as { columns: unknown; rows: unknown[] }
    expect(saved).toMatchObject({ columns: [{ name: 'x', type: 'float' }] })
    expect(saved.rows).toHaveLength(1)
  })

  it('sends a Current table as columns and rows with its column types', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({
      row: { name: 'rows_var', type: 'table', value: FLOAT_TABLE },
      runtimeValue: FLOAT_TABLE,
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    typeInto(valueText(), '[{"x": 1}]')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    const [name, body] = onSaveCurrent.mock.calls[0] as [string, { value: { rows: unknown[] }; type: string }]
    expect(name).toBe('rows_var')
    expect(body.type).toBe('table')
    expect(body.value).toMatchObject({ columns: [{ name: 'x', type: 'float' }] })
    expect(body.value.rows).toHaveLength(1)
  })
})

// ===========================================================================
// A refused write keeps the window open
// ===========================================================================

describe('VariableCreateModal edit - a refused write keeps the window open', () => {
  it('keeps the window open with the draft when the Current write is refused', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent, onClose } = renderEdit({
      sessionId: 'session-1',
      onSaveCurrent: () => Promise.reject(new Error("Variable 'user_name' is not declared by this test")),
    })
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy', 'true'))
    expect(saveButton()).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
    expect(valueText()).toHaveValue('carol')
  })

  it('shows a refused definition write under the form and writes no Current value', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent, onClose } = renderEdit({
      mode: 'input',
      row: REQUIRED_INPUT_ROW,
      scope: ['fn-1'],
      onSaveDefinition: () => ({ success: false, error: 'Name "region" already exists in this Function' }),
    })
    await pickView(user, 'Current')
    rename('region')
    typeInto(valueText(), 'db.backup')
    await user.click(saveButton())
    expect(await within(windowEl()).findByTestId('create-submit-error')).toHaveTextContent(
      exact('Name "region" already exists in this Function'),
    )
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// VMGR-19: a live run keeps its own name, type and secrecy until it ends or Reset
// ===========================================================================

describe('VariableCreateModal edit - a live run keeps its own name, type and secrecy', () => {
  it('writes Current under the new name, after the rename, when a rename is saved while a session lives', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent } = renderEdit({
      sessionId: 'session-1',
      runtimeValue: 'live-bob',
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    rename('account')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'account' })
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['account', { value: 'carol', type: 'string' }])
    expect(onSaveDefinition.mock.invocationCallOrder[0]).toBeLessThan(onSaveCurrent.mock.invocationCallOrder[0])
  })

  it('writes Current under the new name when a rename is saved before a run', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit()
    await pickView(user, 'Current')
    rename('account')
    typeInto(valueText(), 'carol')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['account', { value: 'carol', type: 'string' }])
  })

  it('skips the Current write when a retype is saved while a session lives', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      sessionId: 'session-1',
      runtimeValue: 'live-bob',
      hasRuntimeValue: true,
    })
    await pickOption(user, typeSelect(), 'Integer')
    await confirmIn(user, 'Change variable type?', 'Change type')
    await pickView(user, 'Current')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ type: 'integer', value: 0 })
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('skips the Current write when Mark as secret is turned on while a session lives', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      sessionId: 'session-1',
      runtimeValue: 'live-bob',
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(box('create-secret-checkbox'))
    await user.click(saveButton())
    await confirmIn(user, 'Make this variable secret?', 'Make secret and save')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ secret: true })
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('skips the Current write when Mark as secret is turned off while a session lives', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      row: { name: 'token', isSecret: true, value: '********' },
      sessionId: 'session-1',
      runtimeValue: '********',
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    await user.click(box('create-secret-checkbox'))
    await confirmIn(user, 'Remove Secret Protection?', 'Remove & Delete Value')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaveDefinition).toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Set to null in Edit (REQ-3.1.3.24, VMGR-111)
// ===========================================================================

describe('VariableCreateModal edit - Set to null', () => {
  it('opens a wholly null value with Set to null ticked, the null field and no Kind', () => {
    renderEdit({ row: { value: null } })
    expect(box('create-set-to-null-checkbox')).toBeChecked()
    expect(within(windowEl()).getByTestId('create-null-field')).toBeInTheDocument()
    expect(kindSelect()).not.toBeInTheDocument()
  })

  it("shows the type's default when Set to null is unticked after a saved null", async () => {
    const user = userEvent.setup()
    renderEdit({ row: { name: 'count', type: 'integer', value: null } })
    await user.click(box('create-set-to-null-checkbox'))
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(valueText()).toHaveValue('0')
    expect(kindSelect()).toBeInTheDocument()
  })

  it('brings back the value from before the tick when Set to null is unticked', async () => {
    const user = userEvent.setup()
    renderEdit()
    typeInto(valueText(), 'bobby')
    await user.click(box('create-set-to-null-checkbox'))
    expect(within(windowEl()).getByTestId('create-null-field')).toBeInTheDocument()
    await user.click(box('create-set-to-null-checkbox'))
    expect(valueText()).toHaveValue('bobby')
  })

  it('ticks Set to null on Current only when the Current value is null', async () => {
    const user = userEvent.setup()
    renderEdit({ sessionId: 'session-1', runtimeValue: null, hasRuntimeValue: true })
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    await pickView(user, 'Current')
    expect(box('create-set-to-null-checkbox')).toBeChecked()
  })

  it('saves Set to null on Initial as a null definition value', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit()
    await user.click(box('create-set-to-null-checkbox'))
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: null })
  })

  it('locks Set to null off on both values of a Required input', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: REQUIRED_INPUT_ROW, scope: ['fn-1'] })
    for (const view of ['Default', 'Current'] as const) {
      await pickView(user, view)
      expect(box('create-set-to-null-checkbox')).not.toBeChecked()
      expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
      expect(within(windowEl()).getByText('off while Required is set')).toBeInTheDocument()
    }
  })

  it("locks Set to null on a secret input's Default with its reason, and frees it on Current", async () => {
    const user = userEvent.setup()
    renderEdit({
      mode: 'input',
      row: { id: 'param:input:tok', name: 'tok', type: 'string', isSecret: true, value: undefined },
      scope: ['fn-1'],
    })
    const setToNull = box('create-set-to-null-checkbox')
    expect(setToNull).toBeChecked()
    expect(isLocked(setToNull)).toBe(true)
    act(() => setToNull.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      exact('A secret input has no default: the Function Block gives the value.'),
    )
    await pickView(user, 'Current')
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(false)
  })

  it('locks Set to null off on Current of a Required secret input', async () => {
    const user = userEvent.setup()
    renderEdit({
      mode: 'input',
      row: { id: 'param:input:tok', name: 'tok', type: 'string', isSecret: true, required: true },
      scope: ['fn-1'],
    })
    await pickView(user, 'Current')
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
    expect(within(windowEl()).getByText('off while Required is set')).toBeInTheDocument()
  })
})

describe("VariableCreateModal edit - a true / false input's Default never holds null (REQ-3.1.3.24, REQ-3.1.2.10)", () => {
  const BOOLEAN_INPUT_ROW: Row = { id: 'param:input:dry', name: 'dry', type: 'boolean', value: false, description: '' }

  it('locks Set to null off on the Default view of a Boolean input and drops a click', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: BOOLEAN_INPUT_ROW, scope: ['fn-1'] })
    const setToNull = box('create-set-to-null-checkbox')
    expect(setToNull).not.toBeChecked()
    expect(isLocked(setToNull)).toBe(true)

    await user.click(setToNull)
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(within(windowEl()).queryByTestId('create-null-field')).not.toBeInTheDocument()
    const group = within(windowEl()).getByRole('group', { name: 'Value' })
    expect(within(group).getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens a Boolean input whose saved default is null on False, with Set to null off and locked', () => {
    renderEdit({ mode: 'input', row: { ...BOOLEAN_INPUT_ROW, value: null }, scope: ['fn-1'] })
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
    expect(within(windowEl()).queryByTestId('create-null-field')).not.toBeInTheDocument()
    const group = within(windowEl()).getByRole('group', { name: 'Value' })
    expect(within(group).getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
  })
})

// ===========================================================================
// Required in Edit (VMGR-113, REQ-3.1.2.10)
// ===========================================================================

describe('VariableCreateModal edit - Required', () => {
  function expectNullLockedByRequired() {
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
    expect(within(windowEl()).getByText('off while Required is set')).toBeInTheDocument()
    expect(within(windowEl()).queryByTestId('create-null-field')).not.toBeInTheDocument()
  }

  it.each([
    ['no default', undefined],
    ['a null default', null],
  ] as const)('opens a Required input with %s on an empty field with no placeholder', (_label, value) => {
    renderEdit({
      mode: 'input',
      row: { id: 'param:input:must', name: 'must', type: 'string', required: true, value, description: '' },
      scope: ['fn-1'],
    })
    expect(valueText()).toHaveValue('')
    expect(valueText().placeholder).toBe('')
    expectNullLockedByRequired()
  })

  it('keeps the default and locks Set to null off when Required is ticked', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      mode: 'input',
      row: { id: 'param:input:host', name: 'host', type: 'string', value: 'localhost', required: false, description: '' },
      scope: ['fn-1'],
    })
    await user.click(box('param-required-checkbox'))
    expect(box('param-required-checkbox')).toBeChecked()
    expect(valueText()).toHaveValue('localhost')
    expectNullLockedByRequired()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'host', required: true, value: 'localhost' })
  })

  it('turns a saved null default into no default when Required is ticked', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ mode: 'input', row: NULL_INPUT_ROW, scope: ['fn-1'] })
    expect(box('create-set-to-null-checkbox')).toBeChecked()
    await user.click(box('param-required-checkbox'))
    expectNullLockedByRequired()
    expect(valueText()).toHaveValue('')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const spec = specOf(onSaveDefinition)
    expect(spec).toMatchObject({ name: 'level', required: true })
    expect(spec.value).toBeUndefined()
  })

  it('shows False on a true/false input ticked Required from a saved null, and saves it', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      mode: 'input',
      row: { id: 'param:input:verbose', name: 'verbose', type: 'boolean', value: null, description: '' },
      scope: ['fn-1'],
    })
    await user.click(box('param-required-checkbox'))
    expectNullLockedByRequired()
    expect(within(valueField()).getByRole('button', { name: 'false' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(valueField()).getByRole('button', { name: 'true' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'verbose', required: true, value: false })
  })

  it('keeps the default and frees Set to null when Required is unticked', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: REQUIRED_INPUT_ROW, scope: ['fn-1'] })
    await user.click(box('param-required-checkbox'))
    expect(box('param-required-checkbox')).not.toBeChecked()
    expect(valueText()).toHaveValue('db.internal')
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(false)
    expect(within(windowEl()).queryByText('off while Required is set')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Enum in Edit (VMGR-112)
// ===========================================================================

describe('VariableCreateModal edit - an input turned into an enum', () => {
  it('keeps Save disabled until the allowed values and a default are given, then sets Current to the default', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: NULL_INPUT_ROW, scope: ['fn-1'] })
    expect(box('create-set-to-null-checkbox')).toBeChecked()

    await user.click(box('param-create-enum-checkbox'))
    expect(box('create-set-to-null-checkbox')).not.toBeChecked()
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
    expect(box('param-required-checkbox')).toBeChecked()
    expect(isLocked(box('param-required-checkbox'))).toBe(true)
    expect(box('create-enum-error')).toHaveTextContent(exact('Enum allowed values cannot be empty'))
    expect(box('create-enum-default-error')).toHaveTextContent(exact('Default value is required'))
    expect(saveButton()).toBeDisabled()

    typeInto(allowedValuesText(), '["low", "high"]')
    expect(within(windowEl()).queryByTestId('create-enum-error')).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    await pickOption(user, enumSelect(), 'low')
    expect(within(windowEl()).queryByTestId('create-enum-default-error')).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()

    await pickView(user, 'Current')
    expect(enumSelect()).toHaveTextContent(/^low$/)
  })

  it('names an emptied allowed value and keeps the Default select working', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: ENUM_INPUT_ROW, scope: ['fn-1'] })
    typeInto(allowedValuesText(), '["", "staging", "prod"]')
    expect(box('create-enum-error')).toHaveTextContent(exact('Allowed value at index 0 is empty'))
    expect(box('create-enum-default-error')).toHaveTextContent(exact('Default value is required'))
    expect(saveButton()).toBeDisabled()
    await user.click(enumSelect())
    expect(screen.getAllByRole('option').map((option) => option.textContent ?? '')).toEqual(['staging', 'prod'])
  })

  it('keeps Save disabled while only the Current value is picked', async () => {
    const user = userEvent.setup()
    renderEdit({ mode: 'input', row: NULL_INPUT_ROW, scope: ['fn-1'] })
    await user.click(box('param-create-enum-checkbox'))
    typeInto(allowedValuesText(), '["low", "high"]')
    await pickView(user, 'Current')
    await pickOption(user, enumSelect(), 'high')
    expect(saveButton()).toBeDisabled()
  })

  it('shows the empty Current select marked invalid with "Current value is required"', async () => {
    const user = userEvent.setup()
    renderEdit({
      mode: 'input',
      row: ENUM_INPUT_ROW,
      scope: ['fn-1'],
      runtimeValue: 'qa',
      hasRuntimeValue: true,
    })
    expect(within(windowEl()).queryByTestId('create-enum-default-error')).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    await pickView(user, 'Current')
    expect(box('create-enum-default-error')).toHaveTextContent(exact('Current value is required'))
    expect(enumSelect()).not.toHaveTextContent(/qa/)
  })

  it('sets Current to the picked default when Current is not an allowed value', async () => {
    const user = userEvent.setup()
    renderEdit({
      mode: 'input',
      row: { ...NULL_INPUT_ROW, value: 'low' },
      scope: ['fn-1'],
      runtimeValue: 'verbose',
      hasRuntimeValue: true,
    })
    await user.click(box('param-create-enum-checkbox'))
    typeInto(allowedValuesText(), '["low", "high"]')
    await pickOption(user, enumSelect(), 'high')
    await pickView(user, 'Current')
    expect(enumSelect()).toHaveTextContent(/^high$/)
  })

  it('keeps an allowed Current value when the default is picked and saves the enum', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      mode: 'input',
      row: { ...NULL_INPUT_ROW, value: 'low' },
      scope: ['fn-1'],
      runtimeValue: 'high',
      hasRuntimeValue: true,
    })
    await user.click(box('param-create-enum-checkbox'))
    typeInto(allowedValuesText(), '["low", "high"]')
    await pickOption(user, enumSelect(), 'low')
    await pickView(user, 'Current')
    expect(enumSelect()).toHaveTextContent(/^high$/)
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({
      name: 'level',
      type: 'string',
      required: true,
      enumValues: ['low', 'high'],
      value: 'low',
    })
  })

  it('saves a Current pick of an enum input as its value', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent } = renderEdit({
      mode: 'input',
      row: ENUM_INPUT_ROW,
      scope: ['fn-1'],
      sessionId: 'session-1',
      runtimeValue: 'staging',
      hasRuntimeValue: true,
    })
    await pickView(user, 'Current')
    expect(enumSelect()).toHaveTextContent(/^staging$/)
    await pickOption(user, enumSelect(), 'prod')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['env', { value: 'prod', type: 'string' }])
  })
})

// ===========================================================================
// A type change in Edit confirms and resets both values (VMGR-108)
// ===========================================================================

describe('VariableCreateModal edit - type change', () => {
  it('asks before a retype and keeps the type and the value on Cancel', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickOption(user, typeSelect(), 'Integer')
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable type?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText(exact('Changing type to integer will clear 1 existing string value. This cannot be undone.')),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(typeSelect()).toHaveTextContent(/^String/)
    expect(valueText()).toHaveValue('bob')
  })

  it("resets both the Initial and the Current value to the new type's default on confirm", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'items', type: 'array', value: ['a', 'b'] },
      runtimeValue: ['c'],
      hasRuntimeValue: true,
    })
    await pickOption(user, typeSelect(), 'String')
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(exact('Changing type to string will clear 2 existing array entries. This cannot be undone.')),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Change type' }))
    expect(valueText()).toHaveValue('')
    await pickView(user, 'Current')
    expect(valueText()).toHaveValue('')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ type: 'string', value: '' })
  })
})

// ===========================================================================
// A Kind change in Edit confirms and starts both values over (VMGR-108)
// ===========================================================================

describe('VariableCreateModal edit - Kind change', () => {
  const EXPR_ROW: Row = { name: 'expr_n', type: 'integer', value: 'n_int + 1', isExpression: true }

  it('asks before a Kind change and keeps the Kind and the expression on Cancel', async () => {
    const user = userEvent.setup()
    renderEdit({ row: EXPR_ROW })
    await pickOption(user, kindSelect() as HTMLElement, 'Literal')
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Change variable kind?' })).toBeInTheDocument()
    expect(
      within(dialog).getByText(exact('Changing kind to literal will clear the existing expression. This cannot be undone.')),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(kindSelect()).toHaveTextContent(/^Expression/)
    expect(expressionBox()).toHaveValue('n_int + 1')
  })

  it("starts both the Initial and the Current value on the type's default on confirm", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      row: EXPR_ROW,
      sessionId: 'sess-1',
      currentSource: 'n_int + 1',
    })
    await pickOption(user, kindSelect() as HTMLElement, 'Literal')
    await confirmIn(user, 'Change variable kind?', 'Change kind')
    expect(within(valueField()).getByDisplayValue('0')).toBeInTheDocument()
    await pickView(user, 'Current')
    expect(within(valueField()).getByDisplayValue('0')).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toEqual({ name: 'expr_n', type: 'integer', value: 0 })
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it('clears a saved secret: the dots give way to the empty field of the new Kind', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'tok', type: 'integer', value: '********', isSecret: true, isExpression: true },
    })
    expect(within(valueField()).getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
    await pickOption(user, kindSelect() as HTMLElement, 'Literal')
    await confirmIn(user, 'Change variable kind?', 'Change kind')
    expect(within(valueField()).queryByRole('button', { name: /Edit protected value$/ })).not.toBeInTheDocument()
    expect(within(valueField()).getByDisplayValue('0')).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toEqual({ name: 'tok', type: 'integer', value: 0, secret: true })
  })

  it('clears a saved secret on a type change too', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ row: { name: 'tok', isSecret: true, value: 'raw-t0ken' } })
    await pickOption(user, typeSelect(), 'Integer')
    await confirmIn(user, 'Change variable type?', 'Change type')
    expect(within(valueField()).queryByRole('button', { name: /Edit protected value$/ })).not.toBeInTheDocument()
    expect(within(valueField()).getByDisplayValue('0')).toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toEqual({ name: 'tok', type: 'integer', value: 0, secret: true })
  })
})

// ===========================================================================
// Mark as secret in Edit confirms each way (VMGR-109, REQ-4.5.20)
// ===========================================================================

describe('VariableCreateModal edit - Mark as secret', () => {
  it('asks before a saved plain variable is made secret, and saves it secret on confirm', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit()
    await user.click(box('create-secret-checkbox'))
    await user.click(saveButton())
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Make this variable secret?' })).toBeInTheDocument()
    expect(within(dialog).getByText(exact(MAKE_SECRET_TEXT))).toBeInTheDocument()
    expect(onSaveDefinition).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Make secret and save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ secret: true })
  })

  it('returns to the window unsaved when the make-secret confirm is canceled', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit()
    await user.click(box('create-secret-checkbox'))
    await user.click(saveButton())
    await confirmIn(user, 'Make this variable secret?', 'Cancel')
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(box('create-secret-checkbox')).toBeChecked()
  })

  it('saves an already secret variable without the make-secret confirm', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'token', isSecret: true, value: '********' },
    })
    rename('api_token')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'api_token' })
  })

  it('asks nothing when Mark as secret is ticked and unticked again before Save', async () => {
    const user = userEvent.setup()
    const { onClose } = renderEdit()
    await user.click(box('create-secret-checkbox'))
    await user.click(box('create-secret-checkbox'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks to remove the protection when Mark as secret is unticked on a saved secret holding a value', async () => {
    const user = userEvent.setup()
    renderEdit({ row: { name: 'token', isSecret: true, value: '********' } })
    await user.click(box('create-secret-checkbox'))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Remove Secret Protection?' })).toBeInTheDocument()
    expect(within(dialog).getByText(exact(REMOVE_SECRET_TEXT))).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove & Delete Value' })).toBeInTheDocument()
  })

  it('keeps the secret when removing the protection is canceled', async () => {
    const user = userEvent.setup()
    renderEdit({ row: { name: 'token', isSecret: true, value: '********' } })
    await user.click(box('create-secret-checkbox'))
    await confirmIn(user, 'Remove Secret Protection?', 'Cancel')
    expect(box('create-secret-checkbox')).toBeChecked()
    expect(within(valueField()).getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
  })

  it("clears the value to the type's default when the protection is removed", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'token', isSecret: true, value: '********' },
    })
    await user.click(box('create-secret-checkbox'))
    await confirmIn(user, 'Remove Secret Protection?', 'Remove & Delete Value')
    expect(box('create-secret-checkbox')).not.toBeChecked()
    expect(valueText()).toHaveValue('')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const spec = specOf(onSaveDefinition)
    expect(spec.secret).not.toBe(true)
    expect(spec.value).toBe('')
  })

  it('unticks Mark as secret on a saved secret holding no value without asking', async () => {
    const user = userEvent.setup()
    renderEdit({ row: { name: 'token', isSecret: true, value: undefined } })
    await user.click(box('create-secret-checkbox'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(box('create-secret-checkbox')).not.toBeChecked()
  })
})

// ===========================================================================
// A saved secret's value is replaced, never shown (REQ-3.1.3.5)
// ===========================================================================

describe('VariableCreateModal edit - a saved secret is replaced, never shown', () => {
  const SECRET_ROW: Row = { name: 'token', isSecret: true, value: 'raw-t0ken' }

  it('shows a saved secret masked, with no Open editor button and no stored text', () => {
    renderEdit({ row: SECRET_ROW })
    expect(within(valueField()).getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
    expect(within(windowEl()).queryByTestId('open-value-editor-button')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('raw-t0ken')).not.toBeInTheDocument()
  })

  it('opens an empty field after "Delete & Edit" and saves what is typed', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ row: SECRET_ROW })
    await user.click(within(valueField()).getByRole('button', { name: /Edit protected value$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Protected Value?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete & Edit' }))
    expect(valueText()).toHaveValue('')
    typeInto(valueText(), 'n3w-t0ken')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: 'n3w-t0ken' })
  })

  it.each([
    ['array', []],
    ['map', {}],
    ['string', ''],
  ] as const)('saves the empty %s after "Delete & Edit" with nothing typed', async (type, empty) => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'token', type, isSecret: true, value: '********' },
    })
    await user.click(within(valueField()).getByRole('button', { name: /Edit protected value$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Protected Value?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete & Edit' }))
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition).value).toEqual(empty)
  })

  it('keeps the masked value when "Edit Protected Value?" is canceled', async () => {
    const user = userEvent.setup()
    renderEdit({ row: SECRET_ROW })
    await user.click(within(valueField()).getByRole('button', { name: /Edit protected value$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Protected Value?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(valueField()).getByRole('button', { name: /Edit protected value$/ })).toBeInTheDocument()
  })

  it('asks before closing after "Delete & Edit", and Close writes nothing', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({ row: SECRET_ROW })
    await user.click(within(valueField()).getByRole('button', { name: /Edit protected value$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Protected Value?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete & Edit' }))
    await user.click(cancelButton())
    await user.click(unsavedChoice(await unsavedDialog(), 'Close'))
    expect(onClose).toHaveBeenCalled()
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it("edits an unsaved secret's own value", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ row: SECRET_ROW, secretUnlocked: true })
    expect(valueText()).toHaveValue('raw-t0ken')
    typeInto(valueText(), 'raw-t0ken-2')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: 'raw-t0ken-2', secret: true })
  })
})

// ===========================================================================
// The rename notice: a rename is never a silent identity change
// ===========================================================================

describe('VariableCreateModal edit - rename notice', () => {
  it('names the old Test variable once a new valid name is typed', () => {
    renderEdit()
    expect(within(windowEl()).queryByTestId('window-rename-notice')).not.toBeInTheDocument()
    rename('account')
    expect(box('window-rename-notice')).toHaveTextContent(
      exact('Renaming updates all references to user_name across the test.'),
    )
  })

  it('shows no notice for an invalid name and hides it when the saved name is typed back', () => {
    renderEdit()
    rename('')
    expect(within(windowEl()).queryByTestId('window-rename-notice')).not.toBeInTheDocument()
    rename('temp')
    expect(box('window-rename-notice')).toBeInTheDocument()
    rename('user_name')
    expect(within(windowEl()).queryByTestId('window-rename-notice')).not.toBeInTheDocument()
  })

  it.each([
    ['a Function local', 'variable', LOCAL_ROW, 'loc_n'],
    ['an input', 'input', REQUIRED_INPUT_ROW, 'host'],
    ['an output', 'output', OUTPUT_ROW, 'result'],
  ] as const)('names the old name of %s across the Function', (_label, mode, row, oldName) => {
    renderEdit({ mode, row, scope: ['fn-1'] })
    rename('renamed_one')
    expect(box('window-rename-notice')).toHaveTextContent(
      exact(`Renaming updates all references to ${oldName} across the Function.`),
    )
  })
})

describe('VariableCreateModal edit - rename notice of a local at a library View root', () => {
  it('names the old name across the Function although the scope is empty', () => {
    const props = editProps({ row: LOCAL_ROW, scope: [] })
    render(<VariableCreateModal {...props} editTarget={{ ...props.editTarget, inFunction: true }} />)
    rename('renamed_one')
    expect(box('window-rename-notice')).toHaveTextContent(
      exact('Renaming updates all references to loc_n across the Function.'),
    )
  })
})

// ===========================================================================
// Name check in Edit
// ===========================================================================

describe('VariableCreateModal edit - name check', () => {
  it("refuses a name the window's scope already has and blocks Save", () => {
    const { checkNameExists } = renderEdit({ checkNameExists: (name) => name === 'taken' })
    expect(within(windowEl()).queryByTestId('create-name-error')).not.toBeInTheDocument()
    rename('taken')
    expect(box('create-name-error')).toHaveTextContent(exact('A variable with this name already exists'))
    expect(saveButton()).toBeDisabled()
    expect(checkNameExists.mock.calls.some(([name, id]) => name === 'taken' && id === 'v1')).toBe(true)
  })

  it('flags an emptied name, marks the field invalid and blocks Save', () => {
    renderEdit()
    rename('')
    expect(box('create-name-error')).toHaveTextContent(exact('Name is required'))
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()
  })

  it('shows the name counter near the limit and reddens it at the cap', () => {
    renderEdit()
    rename('a'.repeat(55))
    const counter = box('create-variable-name-counter')
    expect(counter).toHaveTextContent(/^55\/64$/)
    expect(counter.className).not.toMatch(/text-destructive/)
    rename('a'.repeat(64))
    expect(box('create-variable-name-counter')).toHaveTextContent(/^64\/64$/)
    expect(box('create-variable-name-counter').className).toMatch(/text-destructive/)
  })
})

// ===========================================================================
// Value checks block Save in Edit
// ===========================================================================

describe('VariableCreateModal edit - value checks block Save', () => {
  const TABLE_ROW: Row = { name: 'rows_var', type: 'table', value: [{ id: 1 }] }
  const BAD_CELL = /^(Line 1: )?Row 0 "id": expected integer$/
  const UNEXPECTED_COLUMN = 'Unexpected column "extra" - change columns in the Visual view'

  it('blocks Save on an unfinished number and frees it once the number is valid', () => {
    renderEdit({ row: { name: 'count', type: 'integer', value: 5 } })
    fireEvent.change(valueText(), { target: { value: '-' } })
    expect(strip()).toHaveTextContent(exact('Enter a valid integer value'))
    expect(saveButton()).toBeDisabled()
    fireEvent.change(valueText(), { target: { value: '7' } })
    expect(strip()).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('blocks Save on list text that is not a list and keeps the text', () => {
    renderEdit({ row: { name: 'items', type: 'array', value: ['alpha'] } })
    typeInto(valueText(), '{"a": 1}')
    expect(strip()).toHaveTextContent(exact('Must be a JSON array'))
    expect(saveButton()).toBeDisabled()
    expect(valueText()).toHaveValue('{"a": 1}')
  })

  it('blocks Save on list text that does not parse and keeps the text', () => {
    renderEdit({ row: { name: 'items', type: 'array', value: ['alpha'] } })
    typeInto(valueText(), '[bad')
    expect(strip()).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(valueText()).toHaveValue('[bad')
  })

  it('blocks Save on an over-long integer inside list text', () => {
    renderEdit({ row: { name: 'items', type: 'array', value: ['alpha'] } })
    typeInto(valueText(), '[12345678901234567890]')
    expect(strip()).toHaveTextContent(/^(Line 1: )?Index 0: max 19 digits$/)
    expect(saveButton()).toBeDisabled()
  })

  it('blocks Save on an over-long integer inside map text', () => {
    renderEdit({ row: { name: 'conf', type: 'map', value: { a: 'x' } } })
    typeInto(valueText(), '{"big": 12345678901234567890}')
    expect(strip()).toHaveTextContent(/^(Line 1: )?Key "big": max 19 digits$/)
    expect(saveButton()).toBeDisabled()
  })

  it('blocks Save on a table cell of the wrong type and frees it once fixed', () => {
    renderEdit({ row: TABLE_ROW })
    typeInto(valueText(), '[{"id": "x"}]')
    expect(strip()).toHaveTextContent(BAD_CELL)
    expect(saveButton()).toBeDisabled()
    typeInto(valueText(), '[{"id": 2}]')
    expect(strip()).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('refuses table text that adds a column to the saved ones', () => {
    renderEdit({ row: TABLE_ROW })
    typeInto(valueText(), '[{"id": 1, "extra": 2}]')
    expect(strip()).toHaveTextContent(exact(UNEXPECTED_COLUMN))
    expect(saveButton()).toBeDisabled()
  })

  it('lists every table problem behind "(+N more)"', async () => {
    const user = userEvent.setup()
    renderEdit({ row: TABLE_ROW })
    typeInto(valueText(), '[{"id": "x", "extra": 1}]')
    expect(strip()).toHaveTextContent(exact(`${UNEXPECTED_COLUMN}(+1 more)`))
    await user.click(box('create-validation-more'))
    const list = await screen.findByTestId('create-validation-more-list')
    expect(within(list).getByText(exact(UNEXPECTED_COLUMN))).toBeInTheDocument()
    expect(within(list).getByText(BAD_CELL)).toBeInTheDocument()
  })

  it('shows a name error and a value error together, each in its own place', () => {
    renderEdit({ row: TABLE_ROW })
    typeInto(valueText(), '[{"id": "x"}]')
    rename('')
    expect(box('create-name-error')).toHaveTextContent(exact('Name is required'))
    expect(strip()).toHaveTextContent(BAD_CELL)
    rename('tbl')
    expect(within(windowEl()).queryByTestId('create-name-error')).not.toBeInTheDocument()
    expect(strip()).toHaveTextContent(BAD_CELL)
    expect(saveButton()).toBeDisabled()
  })

  it('shows a cycle and blocks Save when the expression refers back to the variable', () => {
    const cycle = "Circular reference detected for variable 'api_url': api_url -> api_url"
    const { validateExpressionCycle } = renderEdit({
      row: EXPRESSION_ROW,
      validateExpressionCycle: () => cycle,
    })
    typeInto(expressionBox(), "'v1/' + api_url")
    expect(box('create-cycle-error')).toHaveTextContent(exact(cycle))
    expect(saveButton()).toBeDisabled()
    expect(validateExpressionCycle).toHaveBeenCalledWith(
      expect.objectContaining({ variableName: 'api_url', isExpression: true }),
    )
  })

  it('keeps Save enabled for an expression with no cycle and saves its source', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({ row: EXPRESSION_ROW })
    typeInto(expressionBox(), "'https://' + host")
    expect(within(windowEl()).queryByTestId('create-cycle-error')).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ isExpression: true, value: "'https://' + host" })
  })
})

// ===========================================================================
// Required fields and errors on open (FIELD-12)
// ===========================================================================

/** The red star of a required caption: an aria-hidden star in the destructive color, then the screen-reader word "required". */
function expectRequiredMark(caption: string) {
  const label = within(windowEl()).getByText(caption, { selector: 'label' })
  const around = label.parentElement as HTMLElement
  const star = within(around).getByText('*')
  expect(star).toHaveAttribute('aria-hidden', 'true')
  expect(star).toHaveClass('text-destructive')
  expect(label.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(around).getByText('required')).toHaveClass('sr-only')
}

describe('VariableCreateModal edit - required fields and errors on open (FIELD-12, REQ-3.1.3.11)', () => {
  it('an enum input: red stars follow the Name and Allowed values captions', () => {
    renderEdit({ mode: 'input', row: ENUM_INPUT_ROW, scope: ['fn-1'] })
    expectRequiredMark('Name')
    expectRequiredMark('Allowed values')
  })

  it('a saved expression that refers back to the variable shows its cycle as soon as the window opens and holds Save', () => {
    const cycle = "Circular reference detected for variable 'api_url': api_url -> api_url"
    const { validateExpressionCycle } = renderEdit({
      row: { ...EXPRESSION_ROW, value: "'v1/' + api_url" },
      validateExpressionCycle: () => cycle,
    })
    expect(box('create-cycle-error')).toHaveTextContent(exact(cycle))
    expect(saveButton()).toBeDisabled()
    expect(validateExpressionCycle).toHaveBeenCalledWith(
      expect.objectContaining({ variableName: 'api_url', value: "'v1/' + api_url", isExpression: true }),
    )
  })

  it('a saved table cell of the wrong column type shows its problem as soon as the window opens and holds Save', () => {
    renderEdit({
      row: { name: 'rows_var', type: 'table', value: { columns: [{ name: 'id', type: 'integer' }], rows: [['x']] } },
    })
    expect(strip()).toHaveTextContent(/^(Line 1: )?Row 0 "id": expected integer$/)
    expect(saveButton()).toBeDisabled()
  })
})

// ===========================================================================
// Run state (VMGR-107, blueprint 7.9)
// ===========================================================================

describe('VariableCreateModal edit - while a run is running', () => {
  it('locks Save with the run-lock tooltip', async () => {
    renderEdit({ runLocked: true, sessionId: 'session-1' })
    const save = saveButton()
    expect(save).toHaveAttribute('aria-disabled', 'true')
    act(() => save.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(exact(RUN_LOCK_TEXT))
  })

  it('writes nothing when the locked Save is clicked', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      runLocked: true,
      sessionId: 'session-1',
    })
    rename('account')
    await user.click(saveButton())
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the fields and the value switch usable while the run is running', () => {
    renderEdit({ runLocked: true, sessionId: 'session-1' })
    expect(isLocked(nameField())).toBe(false)
    expect(isLocked(box('value-switch'))).toBe(false)
    expect(isLocked(box('create-secret-checkbox'))).toBe(false)
  })

  it('keeps the draft through a run and saves it once the run pauses', async () => {
    const user = userEvent.setup()
    const { onSaveCurrent, rerender } = renderEdit({ sessionId: 'session-1' })
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    rerender({ runLocked: true })
    expect(valueText()).toHaveValue('carol')
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    rerender({ runLocked: false })
    expect(saveButton()).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(saveButton())
    await waitFor(() => expect(onSaveCurrent).toHaveBeenCalled())
    expect(onSaveCurrent.mock.calls[0].slice(0, 2)).toEqual(['user_name', { value: 'carol', type: 'string' }])
  })

  it('enables Save while the run is paused', () => {
    renderEdit({ sessionId: 'session-1', runtimeValue: 'live-bob', hasRuntimeValue: true })
    expect(saveButton()).toBeEnabled()
    expect(saveButton()).not.toHaveAttribute('aria-disabled', 'true')
  })
})

// ===========================================================================
// VMGR-64: an open Edit window with unsaved changes holds a Run / Resume
// ===========================================================================

describe('VariableCreateModal edit - unsaved changes held for Run and Resume', () => {
  function pending() {
    return usePendingCurrentEdits.getState().pending
  }

  it('registers nothing while the window matches the saved variable', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickView(user, 'Current')
    expect(pending().size).toBe(0)
  })

  it('registers the variable once its Current value changes', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await waitFor(() => expect(pending().size).toBe(1))
    expect([...pending().values()][0]).toMatchObject({ name: 'user_name' })
  })

  it('registers the variable for a definition-only change', async () => {
    renderEdit()
    rename('account')
    await waitFor(() => expect(pending().size).toBe(1))
  })

  it('marks a Current-only change and a definition change apart in the registration', async () => {
    const user = userEvent.setup()
    renderEdit()
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await waitFor(() => expect(pending().size).toBe(1))
    expect([...pending().values()][0]).toMatchObject({ name: 'user_name', definitionChanged: false })

    rename('account')
    await waitFor(() => expect([...pending().values()][0]).toMatchObject({ definitionChanged: true }))
  })

  it('drops the registration when the change is undone', async () => {
    renderEdit()
    typeInto(valueText(), 'carol')
    await waitFor(() => expect(pending().size).toBe(1))
    typeInto(valueText(), 'bob')
    await waitFor(() => expect(pending().size).toBe(0))
  })

  it("carries the window's Function scope in the registration", async () => {
    renderEdit({ row: LOCAL_ROW, scope: ['fn-1'] })
    rename('loc_count')
    await waitFor(() => expect(pending().size).toBe(1))
    const entry = [...pending().values()][0] as { functionPath?: Array<string | { nodeId: string }> }
    expect((entry.functionPath ?? []).map((step) => (typeof step === 'string' ? step : step.nodeId))).toEqual([
      'fn-1',
    ])
  })

  it("runs the window's own Save when the held run asks to save the changes", async () => {
    const { onSaveDefinition } = renderEdit()
    rename('account')
    await waitFor(() => expect(pending().size).toBe(1))
    const entry = [...pending().values()][0] as { save: () => void | Promise<void> }
    await act(async () => {
      await entry.save()
    })
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'account' })
  })

  it("rejects the held run's save with the reason and stays open when the window cannot save", async () => {
    const refusal = 'Name "account" already exists in this scope'
    const { onClose } = renderEdit({ onSaveDefinition: () => ({ success: false, error: refusal }) })
    rename('account')
    await waitFor(() => expect(pending().size).toBe(1))
    const entry = [...pending().values()][0] as { save: () => Promise<void> }
    await act(async () => {
      await expect(entry.save()).rejects.toThrow(exact(refusal))
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(box('create-submit-error')).toHaveTextContent(exact(refusal))
  })

  it('returns the window to its saved state when the held run drops the changes', async () => {
    const { onSaveDefinition, onClose } = renderEdit()
    rename('account')
    typeInto(valueText(), 'alice')
    await waitFor(() => expect(pending().size).toBe(1))
    const entry = [...pending().values()][0] as { drop: () => void }
    act(() => entry.drop())
    expect(nameField()).toHaveValue('user_name')
    expect(valueText()).toHaveValue('bob')
    await waitFor(() => expect(pending().size).toBe(0))
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('drops the registration when the window closes', async () => {
    const { unmount } = renderEdit()
    rename('account')
    await waitFor(() => expect(pending().size).toBe(1))
    unmount()
    expect(pending().size).toBe(0)
  })

  it('never registers an Add window', () => {
    render(
      <VariableCreateModal
        mode="variable"
        availableVariables={[]}
        onCreate={vi.fn(() => ({ success: true }))}
        onClose={vi.fn()}
        checkNameExists={vi.fn(() => false)}
        validateExpressionCycle={vi.fn(() => null)}
        windowId="add-1"
        runLocked={false}
        sessionId={null}
        onSaveDefinition={vi.fn((): SaveResult => ({ success: true }))}
        onSaveCurrent={vi.fn(async () => {})}
      />,
    )
    rename('fresh')
    expect(pending().size).toBe(0)
  })
})

// ===========================================================================
// VMGR-64: Save Changes on a held run runs the window's own Save, confirms included
// ===========================================================================

// The live container's Run button and run-conflict dialog, wired to the real guard.
function HeldRunControls({ run }: Readonly<{ run: () => void }>) {
  const conflict = useRunConflictGuard()
  return (
    <>
      <button type="button" onClick={conflict.guard(run)}>
        Run
      </button>
      <CurrentEditRunConflictDialog
        isOpen={conflict.isOpen}
        entries={conflict.entries}
        onCancel={conflict.onCancel}
        onDrop={conflict.onDrop}
        onSave={conflict.onSave}
        isSaving={conflict.isSaving}
      />
    </>
  )
}

function renderWithHeldRun(options: EditOptions = {}) {
  const props = editProps(options)
  const run = vi.fn()
  render(
    <ToastProvider>
      <VariableCreateModal {...props} />
      <HeldRunControls run={run} />
    </ToastProvider>,
  )
  return { ...props, run }
}

async function makeSecretThenSaveChanges(user: User) {
  await user.click(box('create-secret-checkbox'))
  await waitFor(() => expect(usePendingCurrentEdits.getState().pending.size).toBe(1))
  await user.click(screen.getByRole('button', { name: 'Run' }))
  const conflict = await screen.findByTestId('current-edit-run-conflict-dialog')
  await user.click(within(conflict).getByRole('button', { name: 'Save Changes' }))
}

describe('VariableCreateModal edit - Save Changes on a held run asks the window\'s confirms', () => {
  it('asks the make-secret confirm before it saves anything or starts the run', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, run } = renderWithHeldRun()
    await makeSecretThenSaveChanges(user)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Make this variable secret?' })).toBeInTheDocument()
    expect(within(dialog).getByText(exact(MAKE_SECRET_TEXT))).toBeInTheDocument()
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('saves the variable secret and starts the run once the confirm is accepted', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose, run } = renderWithHeldRun()
    await makeSecretThenSaveChanges(user)
    await confirmIn(user, 'Make this variable secret?', 'Make secret and save')
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(specOf(onSaveDefinition)).toMatchObject({ secret: true })
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('current-edit-run-conflict-dialog')).not.toBeInTheDocument())
  })

  it('says Unsaved changes when the held window holds a definition change', async () => {
    const user = userEvent.setup()
    renderWithHeldRun()
    rename('account')
    await waitFor(() => expect(usePendingCurrentEdits.getState().pending.size).toBe(1))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    const conflict = await screen.findByTestId('current-edit-run-conflict-dialog')
    expect(within(conflict).getByRole('heading', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(within(conflict).getByText('user_name').closest('p')).toHaveTextContent(
      /^This variable has unsaved changes: user_name\.$/,
    )
  })

  it('keeps the draft, stays open and holds the run when the confirm is canceled', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose, run } = renderWithHeldRun()
    await makeSecretThenSaveChanges(user)
    await confirmIn(user, 'Make this variable secret?', 'Cancel')
    await waitFor(() => expect(screen.queryByTestId('current-edit-run-conflict-dialog')).not.toBeInTheDocument())
    expect(run).not.toHaveBeenCalled()
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(box('create-secret-checkbox')).toBeChecked()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(1)
    expect(screen.queryByText(/^The run did not start/)).not.toBeInTheDocument()
  })

  it("ends the held run's save as canceled when the window closes while its confirm is open", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, unmount } = renderEdit()
    await user.click(box('create-secret-checkbox'))
    await waitFor(() => expect(usePendingCurrentEdits.getState().pending.size).toBe(1))
    const entry = [...usePendingCurrentEdits.getState().pending.values()][0]
    let held!: Promise<void>
    act(() => {
      held = entry.save()
    })
    await screen.findByRole('alertdialog')
    unmount()
    await expect(held).rejects.toBeInstanceOf(SaveCanceledError)
    expect(onSaveDefinition).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// SAVE-1 in the window: it owns its "Edit value" sheet and asks before losing changes
// ===========================================================================

describe('VariableCreateModal edit - closing with unsaved changes', () => {
  it('closes at once when nothing changed', async () => {
    const user = userEvent.setup()
    const { onClose } = renderEdit()
    await user.click(cancelButton())
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it.each([
    ['Cancel', (user: User) => user.click(cancelButton())],
    ['the close button', (user: User) => user.click(within(windowEl()).getByRole('button', { name: /^Close/ }))],
    ['Escape', (user: User) => user.keyboard('{Escape}')],
  ] as const)('asks Keep Editing, Close or Save on %s with an unsaved change', async (_label, close) => {
    const user = userEvent.setup()
    const { onClose } = renderEdit()
    rename('account')
    await close(user)
    const dialog = await unsavedDialog()
    for (const name of ['Keep Editing', 'Close', 'Save'] as const) {
      expect(unsavedChoice(dialog, name)).toBeInTheDocument()
    }
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the draft on Keep Editing', async () => {
    const user = userEvent.setup()
    const { onClose } = renderEdit()
    rename('account')
    await user.click(cancelButton())
    await user.click(within(await unsavedDialog()).getByRole('button', { name: 'Keep Editing' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument(),
    )
    expect(nameField()).toHaveValue('account')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('drops both drafts and writes nothing on Close', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit()
    typeInto(valueText(), 'alice')
    await pickView(user, 'Current')
    typeInto(valueText(), 'carol')
    await user.click(cancelButton())
    await user.click(unsavedChoice(await unsavedDialog(), 'Close'))
    expect(onClose).toHaveBeenCalled()
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).not.toHaveBeenCalled()
  })

  it("runs the window's Save on Save", async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit()
    rename('account')
    await user.click(cancelButton())
    await user.click(within(await unsavedDialog()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ name: 'account' })
  })

  it('writes the open "Edit value" sheet\'s unsaved value into the draft before saving', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onClose } = renderEdit({
      row: { name: 'items', type: 'array', value: ['alpha'] },
    })
    await user.click(box('open-value-editor-button'))
    const sheet = await screen.findByTestId('value-editor-sheet')
    await user.click(within(sheet).getByTestId('sheet-array-change'))
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(specOf(onSaveDefinition)).toMatchObject({ value: ['from-sheet'] })
  })

  it('names the "Edit value" sheet\'s text editor by the value caption', async () => {
    const user = userEvent.setup()
    renderEdit()
    await user.click(box('open-value-editor-button'))
    const sheet = await screen.findByTestId('value-editor-sheet')
    expect(within(sheet).getByRole('textbox', { name: 'Value' })).toHaveTextContent('bob')
  })

  it('asks before closing while the open "Edit value" sheet holds an unsaved change', async () => {
    const user = userEvent.setup()
    const { onClose } = renderEdit({ row: { name: 'items', type: 'array', value: ['alpha'] } })
    await user.click(box('open-value-editor-button'))
    const sheet = await screen.findByTestId('value-editor-sheet')
    await user.click(within(sheet).getByTestId('sheet-array-change'))
    await user.click(cancelButton())
    expect(await unsavedDialog()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// A read-only definition (a Function opened in View, a drilled-in Shared Function) takes only a Current value
// ===========================================================================

function isReadOnlyField(element: HTMLElement): boolean {
  return isLocked(element) || element.hasAttribute('readonly') || element.getAttribute('aria-readonly') === 'true'
}

describe('VariableCreateModal edit - a read-only definition takes only a Current value (REQ-3.1.2.10)', () => {
  it('opens on the Current value, showing it', () => {
    renderEdit({ definitionReadOnly: true, sessionId: 'session-1', runtimeValue: 'live-bob', hasRuntimeValue: true })
    expect(box('value-switch')).toHaveTextContent('Current')
    expect(valueText()).toHaveValue('live-bob')
    expect(isReadOnlyField(valueText())).toBe(false)
  })

  it('keeps the Initial value selectable and read-only', async () => {
    const user = userEvent.setup()
    renderEdit({ definitionReadOnly: true, sessionId: 'session-1', runtimeValue: 'live-bob', hasRuntimeValue: true })
    await pickView(user, 'Initial')
    expect(box('value-switch')).toHaveTextContent('Initial')
    expect(valueText()).toHaveValue('bob')
    expect(isReadOnlyField(valueText())).toBe(true)
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(true)
  })

  it('locks Name, Type, Kind and Mark as secret on both values', async () => {
    const user = userEvent.setup()
    renderEdit({ definitionReadOnly: true })
    for (const view of ['Current', 'Initial'] as const) {
      await pickView(user, view)
      for (const element of [nameField(), typeSelect(), kindSelect() as HTMLElement, box('create-secret-checkbox')]) {
        expect(isReadOnlyField(element)).toBe(true)
      }
    }
  })

  it("locks an input's Name, Description, Type, Required, Mark as secret and Create enum", () => {
    renderEdit({
      mode: 'input',
      row: REQUIRED_INPUT_ROW,
      scope: ['fn-1'],
      definitionReadOnly: true,
    })
    for (const element of [
      nameField(),
      box('param-description'),
      typeSelect(),
      box('param-required-checkbox'),
      box('create-secret-checkbox'),
      box('param-create-enum-checkbox'),
    ]) {
      expect(isReadOnlyField(element)).toBe(true)
    }
  })

  it('keeps Set to null free on the Current value', () => {
    renderEdit({ definitionReadOnly: true })
    expect(isLocked(box('create-set-to-null-checkbox'))).toBe(false)
  })

  it('saves a changed Current value and never the definition', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      definitionReadOnly: true,
      scope: ['fn-1'],
      sessionId: 'session-1',
      runtimeValue: 'live-bob',
      hasRuntimeValue: true,
    })
    typeInto(valueText(), 'alice')
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent).toHaveBeenCalledTimes(1)
    const [name, body, scope] = onSaveCurrent.mock.calls[0]
    expect([name, body, scope]).toEqual(['user_name', { value: 'alice', type: 'string' }, ['fn-1']])
  })

  it('saves a Current value set to null', async () => {
    const user = userEvent.setup()
    const { onSaveDefinition, onSaveCurrent, onClose } = renderEdit({
      definitionReadOnly: true,
      sessionId: 'session-1',
      runtimeValue: 'live-bob',
      hasRuntimeValue: true,
    })
    await user.click(box('create-set-to-null-checkbox'))
    await user.click(saveButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaveDefinition).not.toHaveBeenCalled()
    expect(onSaveCurrent.mock.calls[0][1]).toEqual({ value: null, type: 'string' })
  })

  it('shows no rename notice', () => {
    renderEdit({ definitionReadOnly: true })
    rename('account')
    expect(within(windowEl()).queryByTestId('window-rename-notice')).not.toBeInTheDocument()
    expect(nameField()).toHaveValue('user_name')
  })
})
