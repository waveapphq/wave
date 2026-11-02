/** A Function Block in the one Block window: Function chrome on the shared window, rows from its definition, the shared stored shape (CANVAS-207, REQ-3.1.1.5). */

import { vi } from 'vitest'

// The version list reads these descriptors; a test may give every version a contract.
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: vi.fn((functionId: string) => {
    if (!functionId) {
      return { versions: [], latest: '', isLoading: false, failed: false, retry: () => {} }
    }
    const contract = (globalThis as { __testFunctionContract?: object }).__testFunctionContract
    const versions = (
      (globalThis as { __testFunctionVersions?: string[] }).__testFunctionVersions ?? []
    ).map((version) => ({
      version,
      published_at: '2026-01-01',
      changelog: '',
      details: '',
      description: '',
      tags: [],
      ...contract,
    }))
    return {
      versions,
      latest: versions[0]?.version ?? '',
      isLoading: false,
      failed: false,
      retry: () => {},
    }
  }),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { EditorView } from '@codemirror/view'
// Static import: a dynamically imported provider would carry a different context instance than the window.
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { CREDENTIAL_LITERAL_TOOLTIP } from '@/features/workbench/common/element-config/parameters/parameter-value-inputs'

type User = ReturnType<typeof userEvent.setup>

interface FunctionInput {
  name: string
  type: string
  required?: boolean
  description?: string
  default?: unknown
  secret?: boolean
  enumValues?: Array<string | number>
}

interface FunctionOutput {
  name: string
  type: string
  description?: string
  secret?: boolean
}

interface MockContract {
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
}

function setMockVersions(versions: string[]): void {
  ;(globalThis as { __testFunctionVersions?: string[] }).__testFunctionVersions = versions
}

function setMockContract(contract: MockContract | undefined): void {
  ;(globalThis as { __testFunctionContract?: MockContract }).__testFunctionContract = contract
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
  setMockVersions([])
  setMockContract(undefined)
})

afterEach(() => {
  setMockVersions([])
  setMockContract(undefined)
})

const FUNCTION_ID = '00000000-0000-0000-0000-000000000001'

/** The fields a Function Block holds, stored as for every Block. */
interface BlockFields {
  values?: Record<string, unknown>
  expressionFields?: string[]
  templateFields?: string[]
  elementTypes?: Record<string, unknown>
  outputBindings?: Record<string, string>
  outputSecretFields?: string[]
}

interface BlockOptions extends BlockFields {
  id?: string
  label?: string
  description?: string
  inputs?: FunctionInput[]
  outputs?: FunctionOutput[]
}

interface BlockNode {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: Record<string, unknown>
}

function storedFields(options: BlockFields): Record<string, unknown> {
  return {
    ...(options.expressionFields === undefined ? {} : { expressionFields: options.expressionFields }),
    ...(options.templateFields === undefined ? {} : { templateFields: options.templateFields }),
    ...(options.elementTypes === undefined ? {} : { elementTypes: options.elementTypes }),
    config: {
      values: options.values ?? {},
      outputBindings: options.outputBindings ?? {},
      ...(options.outputSecretFields === undefined ? {} : { outputSecretFields: options.outputSecretFields }),
    },
  }
}

function localBlock(options: BlockOptions = {}): BlockNode {
  const label = options.label ?? 'my_function'
  return {
    id: options.id ?? 'fn-node-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      ...(options.description === undefined ? {} : { description: options.description }),
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        name: label,
        workflow: { nodes: [], edges: [] },
        inputs: options.inputs ?? [{ name: 'x', type: 'string', required: false }],
        outputs: options.outputs ?? [{ name: 'result', type: 'string' }],
      },
      ...storedFields(options),
    },
  }
}

function sharedBlock(options: BlockOptions & { originalLibraryName?: string } = {}): BlockNode {
  return {
    id: options.id ?? 'fn-node-2',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: options.label ?? 'published_function',
      description: options.description ?? 'Library function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: FUNCTION_ID,
      functionVersion: '1.0.0',
      ...(options.originalLibraryName === undefined ? {} : { originalLibraryName: options.originalLibraryName }),
      resolvedInputs: options.inputs ?? [{ name: 'n', type: 'integer', required: false }],
      resolvedOutputs: options.outputs ?? [{ name: 'doubled', type: 'integer' }],
      ...storedFields(options),
    },
  }
}

function windowTree(nodes: BlockNode[], readOnly: boolean) {
  return (
    <ReactFlowProvider>
      <CanvasReadOnlyProvider value={readOnly}>
        {nodes.map((node, index) => (
          <ConfigSheetHost key={node.id} nodeId={node.id} cascadeIndex={index} />
        ))}
      </CanvasReadOnlyProvider>
    </ReactFlowProvider>
  )
}

interface WindowOptions {
  readOnly?: boolean
  /** The flow's variables, so an expression that names them has no unknown-name error. */
  variables?: Array<{ name: string; type: string }>
}

/** Opens the Blocks' windows the way the canvas does for open sheets. */
function openWindows(nodes: BlockNode[], options: WindowOptions = {}) {
  useWorkflowStore.setState({
    nodes: nodes as never,
    edges: [],
    variables: (options.variables ?? []).map((variable) => ({ id: `var-${variable.name}`, ...variable })) as never,
    drillPath: [],
    openConfigNodeIds: nodes.map((node) => node.id),
  })
  const view = render(windowTree(nodes, options.readOnly ?? false))
  return { setReadOnly: (readOnly: boolean) => view.rerender(windowTree(nodes, readOnly)) }
}

function openWindow(node: BlockNode, options: WindowOptions = {}) {
  return openWindows([node], options)
}

function storedData(id = 'fn-node-1'): Record<string, unknown> {
  return useWorkflowStore.getState().nodes.find((node) => node.id === id)?.data as Record<string, unknown>
}

function storedConfig(data: Record<string, unknown>): Record<string, unknown> {
  return data.config as Record<string, unknown>
}

function isOpen(id = 'fn-node-1'): boolean {
  return useWorkflowStore.getState().openConfigNodeIds.includes(id)
}

function sheet(): HTMLElement {
  return screen.getByTestId('element-config-sheet')
}

/** The window's own Save, never an open editor's. */
function sheetSave(): HTMLElement {
  return within(sheet()).getByRole('button', { name: /^save$/i })
}

function descriptionField(): HTMLElement {
  return within(sheet()).getByTestId('element-description-input')
}

/** Edits the Description so Save is open whatever else changed, saves, and returns the stored Block. */
async function saveWithEditedDescription(user: User, id = 'fn-node-1'): Promise<Record<string, unknown>> {
  await user.type(descriptionField(), 'edited')
  await user.click(sheetSave())
  expect(isOpen(id)).toBe(false)
  return storedData(id)
}

function inputRow(name: string): HTMLElement {
  return screen.getByTestId(`param-row-${name}`)
}

function expressionToggle(row: HTMLElement): HTMLElement {
  return within(row).getByTestId('expression-toggle')
}

/** Every text, value and placeholder an input row shows. */
function shownTexts(row: HTMLElement): string[] {
  const fields = Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  return [
    row.textContent ?? '',
    ...fields.map((field) => field.value),
    ...fields.map((field) => field.getAttribute('placeholder') ?? ''),
  ]
}

function expressionEditor(row: HTMLElement): EditorView {
  const editor = row.querySelector<HTMLElement>('.cm-editor')
  expect(editor, 'the row holds an expression editor').not.toBeNull()
  const view = EditorView.findFromDOM(editor as HTMLElement)
  expect(view, 'the expression editor is mounted').not.toBeNull()
  return view as EditorView
}

async function openEnumOptions(user: User, row: HTMLElement): Promise<string[]> {
  await user.click(within(row).getByRole('combobox'))
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

/** One enum input per type: allowed values, the option texts, a pick and a stored value. */
interface EnumCase {
  label: string
  type: 'string' | 'integer' | 'float'
  values: Array<string | number>
  shown: string[]
  pick: string
  picked: string | number
  stored: string | number
  storedShown: string
}

const ENUM_CASES: EnumCase[] = [
  {
    label: 'String',
    type: 'string',
    values: ['low', 'medium', 'high'],
    shown: ['low', 'medium', 'high'],
    pick: 'medium',
    picked: 'medium',
    stored: 'high',
    storedShown: 'high',
  },
  {
    label: 'Integer',
    type: 'integer',
    values: [1, 2, 10],
    shown: ['1', '2', '10'],
    pick: '2',
    picked: 2,
    stored: 10,
    storedShown: '10',
  },
  {
    label: 'Float',
    type: 'float',
    values: [0.5, 1.5, 2.5],
    shown: ['0.5', '1.5', '2.5'],
    pick: '1.5',
    picked: 1.5,
    stored: 2.5,
    storedShown: '2.5',
  },
]

/** An enum input as declared (REQ-3.1.2.11): its type, allowed values of that type, Required, a default among them. */
function enumInput(enumCase: EnumCase): FunctionInput {
  return {
    name: 'level',
    type: enumCase.type,
    required: true,
    description: '',
    enumValues: enumCase.values,
    default: enumCase.values[0],
  }
}

const SECRET_INPUT: FunctionInput = { name: 'api_key', type: 'string', required: false, secret: true }
const SECRET_OUTPUT: FunctionOutput = { name: 'token', type: 'string', secret: true }
const PLAIN_OUTPUT: FunctionOutput = { name: 'status', type: 'integer' }
const SEALED_API_KEY = 'wave:enc:v1:c2VhbGVkLWFwaS1rZXk='

describe('Function Block window - open and close', () => {
  it('opens in the one Block window, not a Function-only window', () => {
    openWindow(localBlock())
    expect(sheet()).toBeInTheDocument()
    expect(screen.getAllByTestId(/-config-sheet$/)).toHaveLength(1)
  })

  it('closes when Cancel is clicked on a clean window', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    expect(isOpen()).toBe(false)
  })
})

describe('Function Block window - Local Function Block', () => {
  it('renders the editable Function Name field labeled "Name"', () => {
    openWindow(localBlock({ label: 'my_function' }))
    expect(screen.queryByTestId('function-lifecycle-badge')).toBeNull()
    expect(screen.getByLabelText('Function name')).toHaveValue('my_function')
  })

  it('renders the name as an editable input', () => {
    openWindow(localBlock({ label: 'my_function' }))
    const nameInput = screen.getByLabelText('Function name')
    expect(['INPUT', 'TEXTAREA']).toContain(nameInput.tagName)
    expect(nameInput).toHaveValue('my_function')
    expect(nameInput).not.toBeDisabled()
  })

  it('renders no version list', () => {
    openWindow(localBlock())
    expect(screen.queryByTestId('version-selector')).toBeNull()
    expect(screen.queryByTestId('version-dropdown-trigger')).toBeNull()
    expect(screen.queryByRole('button', { name: /version/i })).not.toBeInTheDocument()
  })

  it('has a footer with Cancel and Save and no Changelog or Details', () => {
    openWindow(localBlock())
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(sheetSave()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /changelog/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /details/i })).not.toBeInTheDocument()
  })

  it('keeps Save disabled when nothing changed', () => {
    openWindow(localBlock())
    expect(sheetSave()).toBeDisabled()
  })

  it('enables Save after the Name is edited', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    const nameInput = screen.getByLabelText('Function name')
    await user.clear(nameInput)
    await user.type(nameInput, 'renamed_fn')
    expect(sheetSave()).toBeEnabled()
  })

  it('stores the edited Description on Save, with no input bindings', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.type(descriptionField(), 'updated')
    await user.click(sheetSave())
    const data = storedData()
    expect(data.description).toBe('updated')
    expect(data).not.toHaveProperty('inputBindings')
  })

  it('keeps the Function Name field and uses the shared Block Description field', () => {
    openWindow(localBlock())
    expect(screen.getByTestId('function-name-input')).toHaveAttribute('name', 'function-name')
    expect(within(sheet()).getAllByRole('textbox', { name: 'Description' })).toEqual([descriptionField()])
  })

  it('hints the Description with the Function text, not the plugin Block text', () => {
    openWindow(localBlock())
    expect(descriptionField()).toHaveAttribute('placeholder', 'Optional. Per-instance description for this Function.')
  })
})

describe('Function Block window - captions with two windows open', () => {
  it("ties each window's Name and Description captions to that window's own fields", async () => {
    const user = userEvent.setup()
    openWindows([localBlock({ id: 'fn-a' }), localBlock({ id: 'fn-b' })])
    const names = screen.getAllByTestId('function-name-input')
    const descriptions = screen.getAllByTestId('element-description-input')
    expect(names[0].id).not.toBe(names[1].id)
    expect(descriptions[0].id).not.toBe(descriptions[1].id)

    await user.click(screen.getAllByText('Name', { selector: 'label' })[1])
    expect(names[1]).toHaveFocus()
    await user.click(screen.getAllByText('Description', { selector: 'label' })[1])
    expect(descriptions[1]).toHaveFocus()
  })
})

describe('Function Block window - Shared Function Block', () => {
  it('renders the Name as an editable field (rename allowed)', () => {
    openWindow(sharedBlock({ label: 'published_function' }))
    expect(screen.queryByTestId('function-lifecycle-badge')).toBeNull()
    const nameInput = screen.getByLabelText('Function name')
    expect(nameInput).toHaveValue('published_function')
    expect(nameInput).not.toBeDisabled()
  })

  it('renders the version list when the library has versions', () => {
    setMockVersions(['1.0.0', '0.9.0'])
    openWindow(sharedBlock())
    expect(screen.getByRole('button', { name: /v?1\.0\.0/ })).toBeInTheDocument()
  })

  it('has a footer with Changelog, Details, Profiles, Cancel and Save', () => {
    setMockVersions(['1.0.0'])
    openWindow(sharedBlock())
    expect(screen.getByRole('button', { name: /changelog/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /profiles/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(sheetSave()).toBeInTheDocument()
  })

  it('renders the "From library: <name>" link when the Block keeps its library name', () => {
    setMockVersions(['1.0.0'])
    openWindow(sharedBlock({ label: 'Function_3', originalLibraryName: 'fetch_user' }))
    expect(screen.getByTestId('function-from-library-link')).toHaveTextContent(/^From library: fetch_user$/)
  })

  it('keeps the Description editable and stores it on Save', async () => {
    const user = userEvent.setup()
    setMockVersions(['1.0.0'])
    openWindow(sharedBlock({ description: 'library copy' }))
    await user.type(descriptionField(), ' {[}instance note{]}')
    await user.click(sheetSave())
    expect(storedData('fn-node-2').description).toBe('library copy [instance note]')
  })
})

describe('Function Block window - a pin changed on the canvas while the window is open', () => {
  it('shows the new pin in the version list while the pick is untouched', () => {
    setMockVersions(['2.0.0', '1.0.0'])
    openWindow(sharedBlock())
    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent(/1\.0\.0/)

    act(() => {
      const node = sharedBlock()
      useWorkflowStore.setState({ nodes: [{ ...node, data: { ...node.data, functionVersion: '2.0.0' } }] as never })
    })

    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent(/2\.0\.0/)
  })
})

describe('Function Block window - input rows (REQ-3.1.2.1)', () => {
  it('renders one row per declared input', () => {
    openWindow(
      localBlock({
        inputs: [
          { name: 'x', type: 'string', required: false },
          { name: 'y', type: 'integer', required: false },
        ],
      }),
    )
    expect(screen.getAllByTestId(/^param-row-/).map((row) => row.dataset.testid)).toEqual([
      'param-row-x',
      'param-row-y',
    ])
  })

  it('renders the empty-section placeholder when the Function declares no inputs', () => {
    openWindow(localBlock({ inputs: [] }))
    expect(screen.getByText('This Function declares no inputs.')).toBeInTheDocument()
  })

  it.each(ENUM_CASES)('shows an enum input as a dropdown of its allowed values ($label)', async (enumCase) => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [enumInput(enumCase)] }))
    const row = inputRow('level')
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(await openEnumOptions(user, row)).toEqual(enumCase.shown)
  })

  it('shows an enum input that lists no allowed values with nothing to pick', () => {
    openWindow(localBlock({ inputs: [{ name: 'level', type: 'string', required: true, enumValues: [] }] }))
    const row = inputRow('level')
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toEqual([])
  })
})

describe('Function Block window - enum input (FNCFG-6, REQ-3.1.2.11)', () => {
  it.each(ENUM_CASES)('stores a pick as the typed value in the Block values ($label)', async (enumCase) => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [enumInput(enumCase)] }))
    await openEnumOptions(user, inputRow('level'))
    await user.click(screen.getByRole('option', { name: enumCase.pick }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ level: enumCase.picked })
    expect(data).not.toHaveProperty('inputBindings')
  })

  it.each(ENUM_CASES)('opens a stored allowed value as that pick and saves it unchanged ($label)', async (enumCase) => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [enumInput(enumCase)], values: { level: enumCase.stored } }))
    const row = inputRow('level')
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByRole('combobox')).toHaveTextContent(new RegExp(`^${enumCase.storedShown}$`))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ level: enumCase.stored })
  })

  it.each([
    ['a variable', 'chosen_level'],
    ['an expression', 'levels[0]'],
  ])('keeps %s on an enum input in expression mode, stored with its expression flag', async (_kind, expression) => {
    const user = userEvent.setup()
    openWindow(
      localBlock({
        inputs: [enumInput(ENUM_CASES[0])],
        values: { level: expression },
        expressionFields: ['level'],
      }),
      {
        variables: [
          { name: 'chosen_level', type: 'string' },
          { name: 'levels', type: 'array' },
        ],
      },
    )
    expect(expressionToggle(inputRow('level'))).toHaveAttribute('aria-pressed', 'true')
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ level: expression })
    expect(data.expressionFields).toEqual(['level'])
  })

  it.each(ENUM_CASES)('shows the type of an enum input in the Type column ($label)', (enumCase) => {
    openWindow(localBlock({ inputs: [enumInput(enumCase)] }))
    const typeCell = within(inputRow('level')).getAllByRole('cell')[2]
    expect(typeCell).toHaveTextContent(new RegExp(`^${enumCase.type}$`))
  })
})

describe('Function Block window - secret input (FNCFG-7, REQ-3.1.2.9, REQ-3.1.3.18)', () => {
  it('draws a secret input as a Block credential field: the lock, the expand button and the expression button', () => {
    openWindow(localBlock({ inputs: [SECRET_INPUT] }))
    const row = inputRow('api_key')
    expect(within(row).getByLabelText(CREDENTIAL_LITERAL_TOOLTIP)).toBeInTheDocument()
    expect(within(row).getByTestId('param-expand-api_key')).toBeInTheDocument()
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
  })

  it('masks a stored sealed literal: dots and the lock, no expand, never the stored text', () => {
    openWindow(localBlock({ inputs: [SECRET_INPUT], values: { api_key: SEALED_API_KEY } }))
    const row = inputRow('api_key')
    expect(within(row).getByRole('button', { name: 'Edit protected value' })).toHaveTextContent(/^•{8}$/)
    expect(within(row).getByLabelText(CREDENTIAL_LITERAL_TOOLTIP)).toBeInTheDocument()
    expect(within(row).queryByTestId('param-expand-api_key')).toBeNull()
    expect(shownTexts(row).join('\n')).not.toContain(SEALED_API_KEY)
  })

  it('saves a stored sealed literal unchanged', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [SECRET_INPUT], values: { api_key: SEALED_API_KEY } }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ api_key: SEALED_API_KEY })
  })

  it('keeps a variable given to a secret input as an expression with its flag', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [SECRET_INPUT], values: { api_key: 'vault_key' }, expressionFields: ['api_key'] }), {
      variables: [{ name: 'vault_key', type: 'string' }],
    })
    expect(expressionToggle(inputRow('api_key'))).toHaveAttribute('aria-pressed', 'true')
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ api_key: 'vault_key' })
    expect(data.expressionFields).toEqual(['api_key'])
  })
})

describe('Function Block window - a secret literal read back as the mask (FNCFG-7, REQ-3.1.2.9)', () => {
  const READ_BACK_MASK = '********'

  it('masks a secret literal that reads back as the mask: dots and the lock, never the stars as text', () => {
    openWindow(localBlock({ inputs: [SECRET_INPUT], values: { api_key: READ_BACK_MASK } }))
    const row = inputRow('api_key')
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByRole('button', { name: 'Edit protected value' })).toHaveTextContent(/^•{8}$/)
    expect(within(row).getByLabelText(CREDENTIAL_LITERAL_TOOLTIP)).toBeInTheDocument()
    expect(shownTexts(row).join('\n')).not.toContain(READ_BACK_MASK)
  })

  it('sends the mask back unchanged when the secret literal is not edited, so the stored value is kept', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [SECRET_INPUT], values: { api_key: READ_BACK_MASK } }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ api_key: READ_BACK_MASK })
  })
})

describe('Function Block window - secret output (FNCFG-7, REQ-3.1.2.9)', () => {
  it('seeds the Secret box ticked for an output declared secret and unticked for a plain one', () => {
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, PLAIN_OUTPUT] }))
    expect(screen.getByTestId('output-secret-token')).toBeChecked()
    expect(screen.getByTestId('output-secret-status')).not.toBeChecked()
  })

  it('stores no Secret list while the seeded boxes are left alone, so the run seeds from the Function', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, PLAIN_OUTPUT] }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).outputSecretFields).toBeUndefined()
  })

  it('stores the list without an output declared secret that the author unticks', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, PLAIN_OUTPUT] }))
    const box = screen.getByTestId('output-secret-token')
    await user.click(box)
    expect(box).not.toBeChecked()
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).outputSecretFields).toEqual([])
  })

  it('stores a plain output the author ticks Secret on', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ outputs: [PLAIN_OUTPUT] }))
    const box = screen.getByTestId('output-secret-status')
    await user.click(box)
    expect(box).toBeChecked()
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).outputSecretFields).toEqual(['status'])
  })
})

describe('Function Block window - a saved Secret column reopens as saved (FNCFG-7, REQ-3.1.2.9)', () => {
  const SECOND_SECRET_OUTPUT: FunctionOutput = { name: 'refresh', type: 'string', secret: true }

  it('reopens an output declared secret unticked when the saved list leaves it out, beside one it kept', () => {
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, SECOND_SECRET_OUTPUT], outputSecretFields: ['refresh'] }))
    expect(screen.getByTestId('output-secret-refresh')).toBeChecked()
    expect(screen.getByTestId('output-secret-token')).not.toBeChecked()
  })

  it('reopens a plain output ticked when the saved list holds it, and the saved list wins over the seed', () => {
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, PLAIN_OUTPUT], outputSecretFields: ['status'] }))
    expect(screen.getByTestId('output-secret-status')).toBeChecked()
    expect(screen.getByTestId('output-secret-token')).not.toBeChecked()
  })

  it('keeps a saved empty list on the next Save, so the output stays plain', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ outputs: [SECRET_OUTPUT, PLAIN_OUTPUT], outputSecretFields: [] }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).outputSecretFields).toEqual([])
  })
})

describe('Function Block window - Shared Function contract (FNCFG-6, FNCFG-7)', () => {
  function openLibraryBlock(inputs: FunctionInput[], outputs: FunctionOutput[], values: Record<string, unknown> = {}) {
    setMockVersions(['1.0.0'])
    setMockContract({ inputs, outputs })
    openWindow(sharedBlock({ inputs, outputs, values }))
  }

  it.each(ENUM_CASES)(
    'shows an enum input of a library Function as a dropdown of its allowed values ($label)',
    async (enumCase) => {
      const user = userEvent.setup()
      openLibraryBlock([enumInput(enumCase)], [])
      expect(await openEnumOptions(user, inputRow('level'))).toEqual(enumCase.shown)
    },
  )

  it('seeds the Secret box ticked for a library Function output declared secret', () => {
    openLibraryBlock([], [SECRET_OUTPUT])
    expect(screen.getByTestId('output-secret-token')).toBeChecked()
  })

  it("stores the pinned version's enum and secret metadata in the Block's contract stamps", async () => {
    const user = userEvent.setup()
    const inputs = [enumInput(ENUM_CASES[1]), SECRET_INPUT]
    const outputs = [SECRET_OUTPUT]
    openLibraryBlock(inputs, outputs, { level: 2 })
    const data = await saveWithEditedDescription(user, 'fn-node-2')
    expect(data.resolvedInputs).toEqual(inputs)
    expect(data.resolvedOutputs).toEqual(outputs)
  })
})

describe('Function Block window - output rows', () => {
  it('renders one row per declared output', () => {
    openWindow(
      localBlock({
        outputs: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'integer' },
        ],
      }),
    )
    expect(screen.getAllByTestId(/^output-row-/).map((row) => row.dataset.testid)).toEqual([
      'output-row-a',
      'output-row-b',
    ])
  })

  it('keeps a stored input value through Save', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ values: { x: 'hello' }, description: 'pre-existing' }))
    const data = await saveWithEditedDescription(user)
    expect(storedConfig(data).values).toEqual({ x: 'hello' })
  })

  it('stores the variable picked for an output', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ outputBindings: { result: 'old_var' } }), {
      variables: [
        { name: 'old_var', type: 'string' },
        { name: 'new_var', type: 'string' },
      ],
    })
    const combobox = within(screen.getByTestId('output-row-result')).getByRole('combobox')
    expect((combobox as HTMLTextAreaElement).value).toBe('old_var')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'new_var')
    await user.click(await screen.findByRole('option', { name: /new_var/ }))
    await user.click(sheetSave())
    expect(storedConfig(storedData()).outputBindings).toEqual({ result: 'new_var' })
  })

  it('renders the empty-section placeholder when the Function declares no outputs', () => {
    openWindow(localBlock({ outputs: [] }))
    expect(screen.getByText('This Function declares no outputs.')).toBeInTheDocument()
  })
})

describe('Function Block window - stored values (REQ-3.1.1.5, REQ-3.1.3.19)', () => {
  /** A value of each input type held in `config.values`, with the item types a typed list or map stores beside it. */
  const STORED_VALUES: Array<[string, string, unknown, unknown]> = [
    ['a string', 'string', 'hello', undefined],
    ['an empty string', 'string', '', undefined],
    ['an integer', 'integer', 5, undefined],
    ['a float', 'float', 2.5, undefined],
    ['false', 'boolean', false, undefined],
    ['a typed list', 'array', ['a', 1], ['string', 'integer']],
    ['a typed map', 'map', { k: 1, s: 'x' }, { k: 'integer', s: 'string' }],
    ['a table', 'table', [{ id: 1 }], undefined],
  ]

  it.each(STORED_VALUES)(
    'opens %s held in the Block values in plain mode and saves it unchanged',
    async (_kind, type, value, itemTypes) => {
      const user = userEvent.setup()
      openWindow(
        localBlock({
          inputs: [{ name: 'arg', type, required: false }],
          values: { arg: value },
          ...(itemTypes === undefined ? {} : { elementTypes: { arg: itemTypes } }),
        }),
      )
      expect(expressionToggle(inputRow('arg'))).toHaveAttribute('aria-pressed', 'false')
      expect(sheetSave()).toBeDisabled()

      const data = await saveWithEditedDescription(user)

      expect(storedConfig(data).values).toEqual({ arg: value })
      expect(data.elementTypes).toEqual(itemTypes === undefined ? undefined : { arg: itemTypes })
      expect((data.expressionFields as string[] | undefined) ?? []).not.toContain('arg')
      expect(data).not.toHaveProperty('inputBindings')
    },
  )

  it('opens an input in expression mode because its name is flagged, showing the expression text', async () => {
    const user = userEvent.setup()
    openWindow(
      localBlock({
        inputs: [{ name: 'arg', type: 'integer', required: false }],
        values: { arg: 'count + 1' },
        expressionFields: ['arg'],
      }),
      { variables: [{ name: 'count', type: 'integer' }] },
    )
    const row = inputRow('arg')
    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'true')
    expect(expressionEditor(row).state.doc.toString()).toBe('count + 1')
    expect(sheetSave()).toBeDisabled()

    const data = await saveWithEditedDescription(user)

    expect(storedConfig(data).values).toEqual({ arg: 'count + 1' })
    expect(data.expressionFields).toEqual(['arg'])
  })

  it('opens text that reads like an expression in plain mode when its name is not flagged', async () => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [{ name: 'arg', type: 'string', required: false }], values: { arg: 'count + 1' } }))
    expect(expressionToggle(inputRow('arg'))).toHaveAttribute('aria-pressed', 'false')

    const data = await saveWithEditedDescription(user)

    expect(storedConfig(data).values).toEqual({ arg: 'count + 1' })
    expect((data.expressionFields as string[] | undefined) ?? []).not.toContain('arg')
  })

  it('keeps the Template kind of a string input on Save (REQ-3.1.3.15)', async () => {
    const user = userEvent.setup()
    openWindow(
      localBlock({
        inputs: [{ name: 'greeting', type: 'string', required: false }],
        values: { greeting: 'Hi {{ name }}' },
        templateFields: ['greeting'],
      }),
      { variables: [{ name: 'name', type: 'string' }] },
    )
    expect(expressionToggle(inputRow('greeting'))).toHaveAttribute('aria-pressed', 'false')

    const data = await saveWithEditedDescription(user)

    expect(storedConfig(data).values).toEqual({ greeting: 'Hi {{ name }}' })
    expect(data.templateFields).toEqual(['greeting'])
  })

  it('keeps a per-entry expression of a map input under its dotted name on Save', async () => {
    const user = userEvent.setup()
    openWindow(
      localBlock({
        inputs: [{ name: 'headers', type: 'map', required: false }],
        values: { headers: { 'X-Id': 'user_id', Accept: 'json' } },
        expressionFields: ['headers.X-Id'],
      }),
      { variables: [{ name: 'user_id', type: 'string' }] },
    )
    expect(expressionToggle(inputRow('headers'))).toHaveAttribute('aria-pressed', 'false')

    const data = await saveWithEditedDescription(user)

    expect(storedConfig(data).values).toEqual({ headers: { 'X-Id': 'user_id', Accept: 'json' } })
    expect(data.expressionFields).toEqual(['headers.X-Id'])
  })
})

describe('Function Block window - a Required input shows no default, only that it is required (REQ-3.1.2.10)', () => {
  it.each<[string, unknown, string]>([
    ['string', 'eu-west', 'eu-west'],
    ['integer', 5, '5'],
    ['array', ['north', 'south'], 'north'],
  ])('shows a Required %s input with a declared default empty, with its required message in both modes', async (type, declared, trace) => {
    const user = userEvent.setup()
    openWindow(localBlock({ inputs: [{ name: 'arg', type, required: true, default: declared }] }))
    const row = inputRow('arg')

    expect(expressionToggle(row)).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByTestId('param-error-arg')).toHaveTextContent(/^arg is required$/)
    expect(shownTexts(row).join('\n')).not.toContain(trace)

    await user.click(expressionToggle(row))
    expect(expressionEditor(row).state.doc.toString()).toBe('')
    expect(row.querySelector('.cm-placeholder')).toBeNull()
    expect(within(row).getByTestId('param-error-arg')).toHaveTextContent(/^arg is required$/)
  })
})

describe('Function Block window - a Block that holds only its name and definition', () => {
  function sparseBlock(id: string, label: string): BlockNode {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: label,
          workflow: { nodes: [], edges: [] },
          inputs: [{ name: 'x', type: 'string', required: false }],
          outputs: [{ name: 'y', type: 'string' }],
        },
      },
    }
  }

  it('opens with no description, values, flags or bindings stored', () => {
    openWindow(sparseBlock('fn-sparse', 'sparse_fn'))
    expect(sheet()).toBeInTheDocument()
    expect(screen.getByTestId('param-row-x')).toBeInTheDocument()
  })

  it('stays open when the canvas strips the Block down to its name and definition', () => {
    openWindow(localBlock({ description: 'first', values: { x: 'v1' }, outputBindings: { result: 'r1' } }))
    act(() => {
      useWorkflowStore.setState({ nodes: [sparseBlock('fn-node-1', 'my_function')] as never })
    })
    expect(sheet()).toBeInTheDocument()
  })
})

describe('Function Block window - sheet shell and header', () => {
  it('displays the "<Name> - Edit Config" title', () => {
    openWindow(localBlock())
    expect(screen.getByRole('heading', { name: 'my_function - Edit Config' })).toBeInTheDocument()
  })

  it('live-follows the Name field in the title', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    const nameInput = screen.getByTestId('function-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'renamed_fn')
    expect(screen.getByRole('heading', { name: 'renamed_fn - Edit Config' })).toBeInTheDocument()
  })

  it('falls back to "Function" in the title when the Name field is empty', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.clear(screen.getByTestId('function-name-input'))
    expect(screen.getByRole('heading', { name: 'Function - Edit Config' })).toBeInTheDocument()
  })

  it('renders as a non-blocking sheet with no dialog shell', () => {
    openWindow(localBlock())
    expect(sheet()).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes a clean window directly from the header X', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.click(within(screen.getByTestId('element-config-sheet-drag-handle')).getByRole('button', { name: /^close$/i }))
    expect(isOpen()).toBe(false)
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('routes the header X through the unsaved-changes question when something changed', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.type(descriptionField(), 'edited')
    await user.click(within(screen.getByTestId('element-config-sheet-drag-handle')).getByRole('button', { name: /^close$/i }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(isOpen()).toBe(true)
  })
})

describe('Function Block window - unsaved-changes question', () => {
  async function openChanged(): Promise<User> {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.type(descriptionField(), 'edited')
    return user
  }

  it('closes a clean window from Cancel without the question', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    expect(isOpen()).toBe(false)
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('asks the Unsaved changes question from Cancel when something changed', async () => {
    const user = await openChanged()
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(isOpen()).toBe(true)
  })

  it('keeps the window open on Keep Editing', async () => {
    const user = await openChanged()
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    await user.click(screen.getByRole('button', { name: /keep editing/i }))
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(isOpen()).toBe(true)
    expect(sheet()).toBeInTheDocument()
  })

  it('closes without saving on Close', async () => {
    const user = await openChanged()
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    const close = screen.getByTestId('unsaved-close')
    expect(close).toHaveTextContent(/^Close$/)
    await user.click(close)
    expect(isOpen()).toBe(false)
    expect(storedData()).not.toHaveProperty('description')
  })

  it('saves the edited values from the question', async () => {
    const user = await openChanged()
    await user.click(within(sheet()).getByRole('button', { name: /^cancel$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect(storedData().description).toBe('edited')
    expect(isOpen()).toBe(false)
  })
})

describe('Function Block window - read-only window', () => {
  it('shows the READ-ONLY pill in the header', () => {
    openWindow(localBlock(), { readOnly: true })
    expect(screen.getByTestId('element-config-read-only-pill')).toBeInTheDocument()
  })

  it('shows no pill on an editable window', () => {
    openWindow(localBlock())
    expect(screen.queryByTestId('element-config-read-only-pill')).not.toBeInTheDocument()
  })

  it('freezes the form: Name disabled, footer Close, no Save, no Profiles', () => {
    openWindow(localBlock(), { readOnly: true })
    expect(screen.getByTestId('function-name-input')).toBeDisabled()
    expect(within(sheet()).getByText('Close')).toBeInTheDocument()
    expect(within(sheet()).queryByText('Cancel')).not.toBeInTheDocument()
    expect(within(sheet()).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(within(sheet()).queryByRole('button', { name: /profiles/i })).not.toBeInTheDocument()
  })

  it('hides the From library link and disables the version list of a Shared Function Block', () => {
    setMockVersions(['1.0.0', '0.9.0'])
    openWindow(sharedBlock({ originalLibraryName: 'fetch_user' }), { readOnly: true })
    expect(screen.queryByTestId('function-from-library-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('version-dropdown-trigger')).toBeDisabled()
  })

  it('closes a clean read-only window directly from the header X', async () => {
    const user = userEvent.setup()
    openWindow(localBlock(), { readOnly: true })
    await user.click(within(screen.getByTestId('element-config-sheet-drag-handle')).getByRole('button', { name: /^close$/i }))
    expect(isOpen()).toBe(false)
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('keeps the unsaved question when the window turned read-only with edits, without offering Save', async () => {
    const user = userEvent.setup()
    const { setReadOnly } = openWindow(localBlock())
    await user.type(descriptionField(), 'edited')

    setReadOnly(true)

    await user.click(within(screen.getByTestId('element-config-sheet-drag-handle')).getByRole('button', { name: /^close$/i }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(isOpen()).toBe(true)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    const close = within(dialog).getByTestId('unsaved-close')
    expect(close).toHaveTextContent(/^Close$/)
    await user.click(close)
    expect(isOpen()).toBe(false)
  })
})

describe('Function Block window - Name field error (FIELDERR-1, FIELDERR-3)', () => {
  function openLocal(): HTMLElement {
    openWindow(localBlock({ label: 'my_function' }))
    return screen.getByTestId('function-name-input')
  }

  it('shows Name is required under the Name the moment it is blank, and disables Save with the settings note', async () => {
    const user = userEvent.setup()
    const nameInput = openLocal()

    await user.clear(nameInput)

    expect(nameInput).toHaveFocus()
    const message = screen.getByTestId('function-name-error')
    expect(message.textContent).toBe('Name is required')
    expect(message).toHaveAttribute('role', 'alert')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription('Name is required')
    expect(sheetSave()).toBeDisabled()
    expect(within(sheet()).getByTestId('save-blocked-note').textContent).toBe(
      'Save is disabled: the settings have errors',
    )
  })

  it('clears the message and enables Save once a name is typed', async () => {
    const user = userEvent.setup()
    const nameInput = openLocal()
    await user.clear(nameInput)

    fireEvent.change(nameInput, { target: { value: 'renamed_fn' } })

    expect(screen.queryByTestId('function-name-error')).not.toBeInTheDocument()
    expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).not.toHaveAccessibleDescription()
    expect(sheetSave()).toBeEnabled()
    expect(within(sheet()).queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('shows nothing when a filled-in Name is left', async () => {
    const user = userEvent.setup()
    const nameInput = openLocal()

    await user.click(nameInput)
    await user.tab()

    expect(screen.queryByTestId('function-name-error')).not.toBeInTheDocument()
    expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
  })
})
