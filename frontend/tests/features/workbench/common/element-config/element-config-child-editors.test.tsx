/**
 * ElementConfigModal and the floating editors opened from it.
 *
 * The block config is the parent: nothing changed anywhere keeps its Save
 * disabled and closes it at once; a change in the config or in any open editor
 * enables Save, which writes every open editor's unsaved value into the config
 * and saves once, and closing asks Keep Editing / Close / Save. An open editor
 * with changes that cannot be saved, or an invalid config, disables both Saves
 * with a red note naming what blocks them. Read-only asks Keep Editing / Close
 * only. The canvas counts an open editor's changes as unsaved. The Python
 * editor's Run uses what Save would save, for that run only, and waits on the
 * same blockers except the script itself. The SQL editor runs the same way,
 * pulls its tables with the block's rows, and both script editors offer Stop.
 * The OpenSearch Query editor runs without a Script Type; a script row in
 * expression mode has no script editor.
 *
 * REQ-3.4.1.6: SQL database operations (SQL-10, SQL-12, SQL-13)
 * REQ-3.4.1.2: Python script execution (PYRUN-21)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries (OS-12, OS-13)
 */

import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

function makeEditBodyStub(testid: string, changeValue: unknown) {
  return ({
    onChange,
    onValidChange,
  }: {
    onChange: (v: unknown) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid={testid}>
      <button data-testid={`${testid}-change`} onClick={() => onChange(changeValue)}>
        change
      </button>
      <button data-testid={`${testid}-invalid`} onClick={() => onValidChange(false)}>
        invalid
      </button>
    </div>
  )
}

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: makeEditBodyStub('scalar-edit-body', 'typed'),
}))

vi.mock('@/components/shared/variable-bodies/map-edit-body', () => ({
  MapEditBody: ({
    onChange,
    onValidChange,
  }: {
    onChange: (value: Record<string, unknown>, types: Record<string, unknown>) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid="map-edit-body">
      <button data-testid="map-edit-body-change" onClick={() => onChange({ x: '1' }, { x: 'string' })}>
        change
      </button>
      <button data-testid="map-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
    </div>
  ),
}))

const scriptSyntax = vi.hoisted(() => ({
  issues: [] as unknown[],
  calls: [] as unknown[][],
}))

vi.mock('@/features/workbench/hooks/use-script-syntax-issues', () => ({
  useScriptSyntaxIssues: (...args: unknown[]) => {
    scriptSyntax.calls.push(args)
    return scriptSyntax.issues
  },
}))

const sqlCatalog = vi.hoisted(() => ({
  calls: [] as unknown[],
  result: {
    state: 'idle',
    tables: null,
    count: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    settle: vi.fn(),
  },
}))

vi.mock('@/features/workbench/hooks/use-sql-catalog', () => ({
  useSqlCatalog: (request: unknown) => {
    sqlCatalog.calls.push(request)
    return sqlCatalog.result
  },
}))

vi.mock('@/features/workbench/api/sql-tools', () => ({
  checkSql: vi.fn(async () => ({ issues: [] })),
  startCatalog: vi.fn(async () => ({ job_id: 'job-1', cached: false })),
  getCatalog: vi.fn(async () => ({ status: 'connecting' })),
  cancelCatalog: vi.fn(async () => ({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/api/python-tools', () => ({
  checkPython: vi.fn(async () => ({ issues: [] })),
  completePython: vi.fn(async () => ({ items: [] })),
  renamePython: vi.fn(async () => ({ edits: [] })),
}))

const openSearchFields = vi.hoisted(() => ({
  calls: [] as unknown[],
  result: {
    state: 'idle',
    fields: null as unknown,
    indexes: null as unknown,
    jobId: null as string | null,
    count: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    settle: vi.fn(),
  },
}))

vi.mock('@/features/workbench/hooks/use-opensearch-fields', () => ({
  useOpenSearchFields: (request: unknown) => {
    openSearchFields.calls.push(request)
    return openSearchFields.result
  },
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(async () => ({ issues: [] })),
  suggestOpenSearch: vi.fn(async () => ({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(async () => ({ job_id: 'fields-job-1', cached: false })),
  getFields: vi.fn(async () => ({ status: 'connecting' })),
  cancelFields: vi.fn(async () => ({ status: 'canceled' })),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

const runState = vi.hoisted(() => ({
  status: 'idle' as string,
  runBusy: false,
  repeatBlockDraft: vi.fn(async () => undefined),
  canRunBlockDraft: vi.fn(() => true),
  stopRun: vi.fn(async () => undefined),
}))

vi.mock('@/features/workbench/hooks/use-workbench-run', () => ({
  useWorkbenchRun: () => runState,
}))

vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({
    environments: [{ id: 'env-1', name: 'Lab' }],
    loading: false,
    loaded: true,
    hasEnvironments: true,
    refresh: vi.fn(),
  }),
}))

import { ElementConfigModal } from '@/features/workbench/common/element-config'
import type { ElementData } from '@/features/workbench/common/element-config/types'
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import { AdHocActionsProvider } from '@/features/workbench/common/canvas/adhoc-actions-context'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { ToastProvider } from '@/components/ui/toast'
import { useRunConflictGuard } from '@/features/workbench/live/use-run-conflict-guard'
import { usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'
import { CurrentEditRunConflictDialog } from '@/features/workbench/common/variables/variable-inspect-modal/current-edit-run-conflict-dialog'
import {
  SAMPLE_DQL,
  SAMPLE_FIELDS_REQUEST,
  SAMPLE_INDEXES,
  SAMPLE_QUERY_DSL,
} from '../../opensearch-fixtures'

const BLOCK: ElementData = {
  id: 'node-1',
  name: 'Request',
  elementType: 'test-block',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [
    { name: 'url', label: 'URL', type: 'string', required: true },
    { name: 'body', label: 'Body', type: 'string', required: false },
    { name: 'headers', label: 'Headers', type: 'map', required: false },
  ],
  outputs: [],
  currentValues: { url: 'https://example.test', body: 'saved body', headers: {} },
  outputBindings: {},
}

const INVALID_BLOCK: ElementData = { ...BLOCK, currentValues: { body: 'saved body', headers: {} } }

function renderBlock({
  element = BLOCK,
  readOnly = false,
}: { element?: ElementData; readOnly?: boolean } = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <CanvasReadOnlyProvider value={readOnly}>
      <ElementConfigModal isOpen onClose={onClose} element={element} onSave={onSave} />
    </CanvasReadOnlyProvider>,
  )
  return { onSave, onClose }
}

const configSheet = () => screen.getByTestId('element-config-sheet')
const parentSave = () => within(configSheet()).getByRole('button', { name: 'Save' })
const parentCancel = () => within(configSheet()).getByRole('button', { name: 'Cancel' })
// The header X; a read-only footer also reads Close.
const parentClose = () => within(configSheet()).getAllByRole('button', { name: 'Close' })[0]
const unsavedDialog = () => screen.getByTestId('unsaved-changes-dialog')

function dialogAnswers() {
  return within(unsavedDialog())
    .getAllByRole('button')
    .filter((button) => button.dataset.testid !== undefined)
    .map((button) => button.textContent)
}

async function openBodyWithChange(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-expand-body'))
  const sheet = screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement
  await user.click(within(sheet).getByTestId('scalar-edit-body-change'))
  return sheet
}

async function openMap(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(screen.getByTestId(`param-row-${name}`)).getByTestId(`param-expand-${name}`))
  return screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement
}

const openHeaders = (user: ReturnType<typeof userEvent.setup>) => openMap(user, 'headers')

beforeEach(() => {
  vi.clearAllMocks()
  runState.status = 'idle'
  runState.runBusy = false
  runState.canRunBlockDraft.mockReturnValue(true)
  scriptSyntax.calls = []
  sqlCatalog.calls = []
  openSearchFields.calls = []
  openSearchFields.result.state = 'idle'
  openSearchFields.result.fields = null
  openSearchFields.result.indexes = null
  openSearchFields.result.jobId = null
  openSearchFields.result.count = 0
  useWorkflowStore.setState({ dirtyConfigNodeIds: [], pausedNodeId: null, editingTestId: null })
})

describe('ElementConfigModal - nothing changed anywhere', () => {
  it('keeps Save disabled without a note', () => {
    renderBlock()
    expect(parentSave()).toBeDisabled()
    expect(within(configSheet()).queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('closes at once, with a clean editor open, without asking', async () => {
    const user = userEvent.setup()
    const { onClose } = renderBlock()
    await user.click(screen.getByTestId('param-expand-body'))

    await user.click(parentClose())

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })
})

describe('ElementConfigModal - an open editor has changes', () => {
  it('enables Save', async () => {
    const user = userEvent.setup()
    renderBlock()
    await openBodyWithChange(user)
    expect(parentSave()).toBeEnabled()
  })

  it("saves once with the editor's unsaved value written into the config", async () => {
    const user = userEvent.setup()
    const { onSave } = renderBlock()
    await openBodyWithChange(user)

    await user.click(parentSave())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].values).toMatchObject({
      url: 'https://example.test',
      body: 'typed',
    })
  })

  it("writes every open editor's value into the one save", async () => {
    const user = userEvent.setup()
    const { onSave } = renderBlock()
    await openBodyWithChange(user)
    const headers = await openHeaders(user)
    await user.click(within(headers).getByTestId('map-edit-body-change'))

    await user.click(parentSave())

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].values).toMatchObject({ body: 'typed', headers: { x: '1' } })
  })

  it('asks Keep Editing / Close / Save when the config closes from its X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderBlock()
    await openBodyWithChange(user)

    await user.click(parentClose())

    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close', 'Save'])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks when the config closes from Cancel', async () => {
    const user = userEvent.setup()
    renderBlock()
    await openBodyWithChange(user)

    await user.click(parentCancel())

    expect(unsavedDialog()).toBeInTheDocument()
  })

  it('asks when Escape reaches the config', async () => {
    const user = userEvent.setup()
    const { onClose } = renderBlock()
    await openBodyWithChange(user)
    fireEvent.pointerDown(configSheet())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(unsavedDialog()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Close discards everything and closes without saving', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderBlock()
    await openBodyWithChange(user)
    await user.click(parentClose())

    await user.click(screen.getByTestId('unsaved-close'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("Save in the question saves exactly as the config's Save", async () => {
    const user = userEvent.setup()
    const { onSave } = renderBlock()
    await openBodyWithChange(user)
    await user.click(parentClose())

    await user.click(screen.getByTestId('unsaved-save'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].values).toMatchObject({ body: 'typed' })
  })

  it('Keep Editing returns to the config with the editor still holding its draft', async () => {
    const user = userEvent.setup()
    const { onClose } = renderBlock()
    const sheet = await openBodyWithChange(user)
    await user.click(parentClose())

    await user.click(screen.getByTestId('unsaved-keep-editing'))

    await waitFor(() =>
      expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(within(sheet).getByTestId('value-editor-save-button')).toBeEnabled()
  })

  it('counts as unsaved on the canvas', async () => {
    const user = userEvent.setup()
    renderBlock()
    await openBodyWithChange(user)
    expect(useWorkflowStore.getState().dirtyConfigNodeIds).toEqual(['node-1'])
  })

  it('stops counting once the editor closes without its value', async () => {
    const user = userEvent.setup()
    renderBlock()
    await user.click(screen.getByTestId('param-expand-body'))
    const sheet = screen.getByTestId('value-editor-sheet')
    await user.click(within(sheet).getByTestId('scalar-edit-body-change'))
    await user.click(within(sheet).getByTestId('value-editor-cancel-button'))
    await user.click(screen.getByTestId('value-editor-unsaved-discard-button'))
    expect(useWorkflowStore.getState().dirtyConfigNodeIds).toEqual([])
  })
})

describe('ElementConfigModal - something cannot be saved', () => {
  it('disables Save and names the editor that has errors', async () => {
    const user = userEvent.setup()
    renderBlock()
    const headers = await openHeaders(user)
    await user.click(within(headers).getByTestId('map-edit-body-change'))
    await user.click(within(headers).getByTestId('map-edit-body-invalid'))

    expect(parentSave()).toBeDisabled()
    expect(within(configSheet()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the Headers editor has errors$/,
    )
  })

  it("disables the question's Save with the same note, and Close still discards", async () => {
    const user = userEvent.setup()
    const { onClose, onSave } = renderBlock()
    const headers = await openHeaders(user)
    await user.click(within(headers).getByTestId('map-edit-body-change'))
    await user.click(within(headers).getByTestId('map-edit-body-invalid'))
    await user.click(parentCancel())

    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(within(unsavedDialog()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the Headers editor has errors$/,
    )

    await user.click(screen.getByTestId('unsaved-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('blocks nothing for an editor that shows errors but has no changes', async () => {
    const user = userEvent.setup()
    renderBlock()
    const headers = await openHeaders(user)
    await user.click(within(headers).getByTestId('map-edit-body-invalid'))
    await openBodyWithChange(user)

    expect(parentSave()).toBeEnabled()
    expect(within(configSheet()).queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('disables Save and names the settings while the config itself is invalid', () => {
    renderBlock({ element: INVALID_BLOCK })
    expect(parentSave()).toBeDisabled()
    expect(within(configSheet()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })
})

describe('ElementConfigModal - read-only', () => {
  it('asks Keep Editing / Close only', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <CanvasReadOnlyProvider value={false}>
        <ElementConfigModal isOpen onClose={vi.fn()} element={BLOCK} onSave={vi.fn()} />
      </CanvasReadOnlyProvider>,
    )
    await openBodyWithChange(user)
    rerender(
      <CanvasReadOnlyProvider value>
        <ElementConfigModal isOpen onClose={vi.fn()} element={BLOCK} onSave={vi.fn()} />
      </CanvasReadOnlyProvider>,
    )

    await user.click(parentClose())

    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close'])
  })

  it('shows no Save note while Save is hidden', () => {
    renderBlock({ element: INVALID_BLOCK, readOnly: true })
    expect(within(configSheet()).queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })
})

const PYTHON_BLOCK: ElementData = {
  id: 'node-py',
  name: 'Python',
  elementType: 'python',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [],
  outputs: [],
  currentValues: { script_type: 'source', script: 'print(1)', interpreter: 'python3' },
  outputBindings: {},
}

describe('ElementConfigModal - Run in the Python editor', () => {
  const dispatch = vi.fn()

  function renderPython() {
    const onSave = vi.fn()
    render(
      <AdHocActionsProvider dispatch={dispatch} environment={{ selected: 'env-1', select: vi.fn() }}>
        <ElementConfigModal isOpen onClose={vi.fn()} element={PYTHON_BLOCK} onSave={onSave} />
      </AdHocActionsProvider>,
    )
    return { onSave }
  }

  const scriptSheet = () =>
    screen
      .getAllByTestId('value-editor-sheet')
      .find((sheet) => within(sheet).queryByTestId('value-editor-run-button') !== null) as HTMLElement

  it('runs what Save would save: the unsaved config, every open editor and this script', async () => {
    const user = userEvent.setup()
    const { onSave } = renderPython()
    await user.type(screen.getByTestId('element-description-input'), 'x')
    await user.click(screen.getByTestId('param-expand-interpreter'))
    const interpreter = screen.getByTestId('value-editor-sheet')
    await user.click(within(interpreter).getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('param-expand-script'))

    await user.click(within(scriptSheet()).getByTestId('value-editor-run-button'))

    expect(dispatch).toHaveBeenCalledTimes(1)
    const [action, nodeId, options] = dispatch.mock.calls[0]
    expect(action).toBe('run-current')
    expect(nodeId).toBe('node-py')
    expect(options.environmentId).toBe('env-1')
    expect(options.blockDraft.config.values).toMatchObject({
      interpreter: 'typed',
      script: 'print(1)',
      script_type: 'source',
    })
    expect(options.blockDraft.data.description).toBe('x')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('never saves: the open editor keeps its unsaved value', async () => {
    const user = userEvent.setup()
    renderPython()
    await user.click(screen.getByTestId('param-expand-interpreter'))
    const interpreter = screen.getByTestId('value-editor-sheet')
    await user.click(within(interpreter).getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('param-expand-script'))

    await user.click(within(scriptSheet()).getByTestId('value-editor-run-button'))

    expect(within(interpreter).getByTestId('value-editor-save-button')).toBeEnabled()
    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(2)
  })

  it('disables Run and says why while another open editor blocks Save', async () => {
    const user = userEvent.setup()
    renderPython()
    const inputs = await openMap(user, 'input_vars')
    await user.click(within(inputs).getByTestId('map-edit-body-change'))
    await user.click(within(inputs).getByTestId('map-edit-body-invalid'))
    await user.click(screen.getByTestId('param-expand-script'))

    const run = within(scriptSheet()).getByTestId('value-editor-run-button')
    expect(run).toBeDisabled()
    await user.hover(run.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^Save is disabled: the Input Variables editor has errors$/,
    )
  })

  it('repeats the paused block with this script when a debug run is paused here', async () => {
    runState.status = 'paused'
    useWorkflowStore.setState({ pausedNodeId: 'node-py' })
    const user = userEvent.setup()
    renderPython()
    await user.click(screen.getByTestId('param-expand-script'))

    await act(async () => {
      fireEvent.click(within(scriptSheet()).getByTestId('value-editor-run-button'))
    })

    expect(runState.repeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-py', 'script', 'print(1)')
    expect(dispatch).not.toHaveBeenCalled()
  })
})

/** The live canvas: the editor's paused repeat goes through the run-conflict guard and its dialog. */
function GuardedCanvas({ children }: Readonly<{ children: ReactNode }>) {
  const guard = useRunConflictGuard()
  return (
    <AdHocActionsProvider
      dispatch={guard.guard(vi.fn())}
      repeatBlockDraft={guard.guard(runState.repeatBlockDraft)}
      environment={{ selected: 'env-1', select: vi.fn() }}
    >
      {children}
      <CurrentEditRunConflictDialog
        isOpen={guard.isOpen}
        entries={guard.entries}
        isSaving={guard.isSaving}
        onCancel={guard.onCancel}
        onDrop={guard.onDrop}
        onSave={guard.onSave}
      />
    </AdHocActionsProvider>
  )
}

describe('ElementConfigModal - a paused repeat held for an open Edit window (VMGR-64)', () => {
  beforeEach(() => {
    usePendingCurrentEdits.getState().clearAll()
    runState.status = 'paused'
    useWorkflowStore.setState({ pausedNodeId: 'node-py' })
  })

  /** An open Edit window holding an unsaved Current value of `count`. */
  function holdWindow() {
    const edit = { name: 'count', save: vi.fn(async () => undefined), drop: vi.fn() }
    usePendingCurrentEdits.getState().setPending(edit)
    return edit
  }

  async function pressRun() {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <GuardedCanvas>
          <ElementConfigModal isOpen onClose={vi.fn()} element={PYTHON_BLOCK} onSave={vi.fn()} />
        </GuardedCanvas>
      </ToastProvider>,
    )
    await user.click(screen.getByTestId('param-expand-script'))
    const sheet = screen
      .getAllByTestId('value-editor-sheet')
      .find((s) => within(s).queryByTestId('value-editor-run-button') !== null) as HTMLElement
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId('value-editor-run-button'))
    })
  }

  it('repeats the block only after Save Changes saved the window', async () => {
    const edit = holdWindow()
    await pressRun()

    expect(screen.getByTestId('current-edit-run-conflict-dialog')).toBeInTheDocument()
    expect(runState.repeatBlockDraft).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })

    await waitFor(() =>
      expect(runState.repeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-py', 'script', 'print(1)'),
    )
    expect(edit.save).toHaveBeenCalledTimes(1)
    expect(edit.save.mock.invocationCallOrder[0]).toBeLessThan(
      runState.repeatBlockDraft.mock.invocationCallOrder[0],
    )
  })

  it('repeats the block only after Drop Changes dropped the window', async () => {
    const edit = holdWindow()
    await pressRun()

    expect(runState.repeatBlockDraft).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Drop Changes' }))
    })

    expect(edit.drop).toHaveBeenCalledTimes(1)
    expect(edit.save).not.toHaveBeenCalled()
    expect(runState.repeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-py', 'script', 'print(1)')
  })

  it('never repeats the block when the dialog is canceled', async () => {
    holdWindow()
    await pressRun()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(runState.repeatBlockDraft).not.toHaveBeenCalled()
  })
})

// A row taken away while its editor holds unsaved text asks first: Keep Editing
// leaves the row exactly as it was, Close lets the row and the text go.
describe('ElementConfigModal - a row the config takes away', () => {
  async function typeInScript(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('param-expand-script'))
    const editor = screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement
    await user.click(within(editor).getByTestId('scalar-edit-body-change'))
    return editor
  }

  async function switchScriptType(user: ReturnType<typeof userEvent.setup>, option: string) {
    await user.click(within(screen.getByTestId('param-row-script_type')).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: option }))
  }

  function renderPythonBlock() {
    const onSave = vi.fn()
    render(
      <CanvasReadOnlyProvider value={false}>
        <ElementConfigModal isOpen onClose={vi.fn()} element={PYTHON_BLOCK} onSave={onSave} />
      </CanvasReadOnlyProvider>,
    )
  }

  it('asks Keep Editing or Close before a Script Type switch hides the open Script editor', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    await typeInScript(user)

    await switchScriptType(user, 'File')

    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close'])
    expect(screen.getByTestId('param-expand-script')).toBeInTheDocument()
  })

  it('leaves the row and its editor exactly as they were on Keep Editing', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    await typeInScript(user)
    await switchScriptType(user, 'File')

    await user.click(screen.getByTestId('unsaved-keep-editing'))

    expect(screen.getByTestId('param-expand-script')).toBeInTheDocument()
    expect(screen.queryByTestId('param-expand-script_file')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(1)
  })

  it('switches, closing the editor and dropping its text, on Close', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    await typeInScript(user)
    await switchScriptType(user, 'File')

    await user.click(screen.getByTestId('unsaved-close'))

    expect(screen.queryByTestId('param-expand-script')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-expand-script_file')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('switches at once while the open editor has no unsaved text', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    await user.click(screen.getByTestId('param-expand-script'))

    await switchScriptType(user, 'File')

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-expand-script_file')).toBeInTheDocument()
  })

  // The Arguments rows live in the shared list editor that the row's expand opens (FIELD-10).
  async function openArguments(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('param-expand-arguments'))
    return within(screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement).getByTestId('array-edit-body')
  }

  it('removes an Arguments row with no editor open at all', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    const list = await openArguments(user)
    await user.click(within(list).getByTestId('array-add-item'))

    await user.click(within(list).getByTestId('array-remove-0'))

    expect(within(list).queryByTestId('array-edit-input-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('keeps the editor of an Arguments row that stays when an earlier row goes', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    const list = await openArguments(user)
    await user.click(within(list).getByTestId('array-add-item'))
    await user.click(within(list).getByTestId('array-add-item'))
    await user.click(within(list).getByTestId('array-expand-1'))

    await user.click(within(list).getByTestId('array-remove-0'))

    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(2)
  })

  it('keeps the editor of an Arguments row that stays when a later row goes', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    const list = await openArguments(user)
    await user.click(within(list).getByTestId('array-add-item'))
    await user.click(within(list).getByTestId('array-add-item'))
    await user.click(within(list).getByTestId('array-expand-0'))

    await user.click(within(list).getByTestId('array-remove-1'))

    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(2)
  })

  it('asks before an Arguments row with an open editor is removed, and Close removes it', async () => {
    const user = userEvent.setup()
    renderPythonBlock()
    const list = await openArguments(user)
    await user.click(within(list).getByTestId('array-add-item'))
    await user.click(within(list).getByTestId('array-expand-0'))
    const editor = screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement
    await user.click(within(editor).getByTestId('scalar-edit-body-change'))

    await user.click(within(list).getByTestId('array-remove-0'))
    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close'])

    await user.click(screen.getByTestId('unsaved-close'))
    expect(within(list).queryByTestId('array-edit-input-0')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(1)
  })
})

const SQL_VALUES = {
  operation: 'run_sql',
  database_type: 'postgresql',
  host: 'db.lab',
  database: 'shop',
  username: 'wave',
  script_type: 'source',
  sql: 'SELECT 1',
  parameters: { customer: '1' },
}

const SQL_BLOCK: ElementData = {
  id: 'node-sql',
  name: 'SQL',
  elementType: 'sql-client',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [],
  outputs: [],
  currentValues: SQL_VALUES,
  outputBindings: {},
}

/** The connection rows SQL_VALUES holds, as the catalog pull sends them: no default copies (REQ-3.1.1.5). */
const SQL_CONNECTION = {
  database_type: 'postgresql',
  host: 'db.lab',
  database: 'shop',
  username: 'wave',
}

const SEALED_PASSWORD = 'wave:enc:v1:c2VhbGVk'

const DB_BINDING = {
  profileId: 'profile-1',
  profileName: 'Lab DB',
  profileType: 'database',
  alias: 'db',
}

function renderScriptBlock(element: ElementData, selected: string | null = 'env-1') {
  const dispatch = vi.fn()
  const onSave = vi.fn()
  const onClose = vi.fn()
  const environment = { selected, select: vi.fn() }
  const tree = () => (
    <AdHocActionsProvider dispatch={dispatch} environment={environment}>
      <ElementConfigModal isOpen onClose={onClose} element={element} onSave={onSave} />
    </AdHocActionsProvider>
  )
  const view = render(tree())
  return { dispatch, onSave, rerender: () => view.rerender(tree()) }
}

const editorSheet = () => screen.getByTestId('value-editor-sheet')

type ScriptCall = [string, string, string | null, Record<string, unknown>]

function lastScriptCall(): ScriptCall {
  return scriptSyntax.calls.at(-1) as ScriptCall
}

// The config turns read-only while a run is in flight; the script editor whose
// own Run started it keeps its run controls working, so Stop can end it.
describe('ElementConfigModal - a script editor while its own run is in flight (SQL-13, PYRUN-21)', () => {
  function renderReadOnlyLater(element: ElementData) {
    const tree = (readOnly: boolean) => (
      <CanvasReadOnlyProvider value={readOnly}>
        <AdHocActionsProvider dispatch={vi.fn()} environment={{ selected: 'env-1', select: vi.fn() }}>
          <ElementConfigModal isOpen onClose={vi.fn()} element={element} onSave={vi.fn()} />
        </AdHocActionsProvider>
      </CanvasReadOnlyProvider>
    )
    const view = render(tree(false))
    return (runBusy: boolean) => {
      runState.status = 'running'
      runState.runBusy = runBusy
      view.rerender(tree(true))
    }
  }

  it('keeps Kind, Help, Get Tables, Close and Stop working in the SQL editor, and Save disabled', async () => {
    const user = userEvent.setup()
    const freeze = renderReadOnlyLater(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    freeze(true)

    const sheet = editorSheet()
    expect(screen.getByTestId('element-name-input')).toBeDisabled()
    expect(within(sheet).getByTestId('kind-dropdown')).toBeEnabled()
    expect(within(sheet).getByTestId('value-editor-help-chip')).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: 'Get Tables' })).toBeEnabled()
    expect(within(sheet).getByTestId('value-editor-cancel-button')).toBeEnabled()
    expect(within(sheet).getByTestId('value-editor-save-button')).toBeDisabled()
    expect(within(sheet).queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
    const stop = within(sheet).getByTestId('value-editor-stop-button')
    expect(stop).toBeEnabled()
    expect(stop.closest('fieldset:disabled')).toBeNull()

    await user.click(stop)

    expect(runState.stopRun).toHaveBeenCalledTimes(1)
  })

  it('keeps Help, Close and Stop working in the Python editor, and Save disabled', async () => {
    const user = userEvent.setup()
    const freeze = renderReadOnlyLater(PYTHON_BLOCK)
    await user.click(screen.getByTestId('param-expand-script'))

    freeze(true)

    const sheet = editorSheet()
    expect(within(sheet).getByTestId('value-editor-help-chip')).toBeEnabled()
    expect(within(sheet).getByTestId('value-editor-cancel-button')).toBeEnabled()
    expect(within(sheet).getByTestId('value-editor-save-button')).toBeDisabled()

    await user.click(within(sheet).getByTestId('value-editor-stop-button'))

    expect(runState.stopRun).toHaveBeenCalledTimes(1)
  })

  it('freezes the SQL editor while the config is read-only for a run it did not start', async () => {
    const user = userEvent.setup()
    const freeze = renderReadOnlyLater(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    freeze(false)

    const sheet = editorSheet()
    expect(within(sheet).getByTestId('value-editor-run-button')).toBeDisabled()
    expect(within(sheet).getByTestId('kind-dropdown')).toBeDisabled()
    expect(within(sheet).queryByTestId('value-editor-stop-button')).not.toBeInTheDocument()
  })
})

describe('ElementConfigModal - the SQL editor (SQL-10, SQL-12)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ editingTestId: 'test-1' })
  })

  it('opens the SQL body in Literal kind with the Format locked to SQL and Get Tables', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    const sheet = editorSheet()
    expect(within(sheet).getByTestId('kind-dropdown')).toHaveTextContent(/^Literal$/)
    expect(within(sheet).getByTestId('format-dropdown')).toHaveTextContent(/^SQL$/)
    expect(within(sheet).getByTestId('format-dropdown')).toBeDisabled()
    expect(within(sheet).getByTestId('get-tables-chip')).toBeInTheDocument()
    expect(within(sheet).getByTestId('value-editor-run-button')).toBeEnabled()
  })

  it("pulls the catalog with the block's rows, the selected Environment and the open test", async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(sqlCatalog.calls.at(-1)).toEqual({
      connection: SQL_CONNECTION,
      expression_fields: [],
      template_fields: [],
      element_types: {},
      profile_bindings: [],
      environment_id: 'env-1',
      test_id: 'test-1',
    })
  })

  it('sends the rows as they sit, with their expression and template flags and the profile bindings', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...SQL_BLOCK,
      currentValues: {
        ...SQL_VALUES,
        host: '{{ db_host }}',
        port: '{{ db_port }}',
        database: 'shop_{{ env }}',
        password: SEALED_PASSWORD,
        parameters: '{{ params }}',
        driver_options: { timeout: '16', app: "'a' + 'b'" },
      },
      expressionFields: ['port', 'parameters', 'host', 'driver_options.app'],
      templateFields: ['sql', 'database'],
      profileBindings: [DB_BINDING],
      elementTypes: { driver_options: { timeout: 'integer' } },
    })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(sqlCatalog.calls.at(-1)).toEqual({
      connection: {
        ...SQL_CONNECTION,
        host: '{{ db_host }}',
        port: '{{ db_port }}',
        database: 'shop_{{ env }}',
        password: SEALED_PASSWORD,
        driver_options: { timeout: '16', app: "'a' + 'b'" },
      },
      expression_fields: ['port', 'host', 'driver_options.app'],
      template_fields: ['database'],
      element_types: { driver_options: { timeout: 'integer' } },
      profile_bindings: [DB_BINDING],
      environment_id: 'env-1',
      test_id: 'test-1',
    })
  })

  it('sends no Environment while none is selected', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK, null)
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(sqlCatalog.calls.at(-1)).toMatchObject({ environment_id: null, test_id: 'test-1' })
  })

  it('sends no test while none is open', async () => {
    useWorkflowStore.setState({ editingTestId: null })
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(sqlCatalog.calls.at(-1)).toMatchObject({ environment_id: 'env-1', test_id: null })
  })

  it("checks the SQL with the block's Database type and Parameters names", async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...SQL_BLOCK,
      currentValues: { ...SQL_VALUES, database_type: 'mysql', parameters: { customer: '1', status: 'open' } },
    })
    await user.click(screen.getByTestId('param-expand-sql'))

    const [nodeId, doc, mode, options] = lastScriptCall()
    expect(nodeId).toBe('node-sql')
    expect(doc).toBe('SELECT 1')
    expect(mode).toBe('sql')
    expect(options).toMatchObject({ databaseType: 'mysql', parameterNames: ['customer', 'status'] })
  })

  it('checks as postgresql while the Database type is unset', async () => {
    const user = userEvent.setup()
    const values: Record<string, unknown> = { ...SQL_VALUES }
    delete values.database_type
    renderScriptBlock({ ...SQL_BLOCK, currentValues: values })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(lastScriptCall()[3]).toMatchObject({ databaseType: 'postgresql', parameterNames: ['customer'] })
  })

  it('gives the check no Parameters names while Parameters is an expression', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...SQL_BLOCK,
      currentValues: { ...SQL_VALUES, parameters: '{{ params }}' },
      expressionFields: ['parameters'],
    })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(lastScriptCall()[3].parameterNames).toBeNull()
  })

  it('gives the check an empty entry list while the block has no Parameters value at all', async () => {
    const user = userEvent.setup()
    const values: Record<string, unknown> = { ...SQL_VALUES }
    delete values.parameters
    renderScriptBlock({ ...SQL_BLOCK, currentValues: values })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(lastScriptCall()[3].parameterNames).toEqual([])
  })

  it('gives the check an empty entry list for an empty Parameters value', async () => {
    const user = userEvent.setup()
    renderScriptBlock({ ...SQL_BLOCK, currentValues: { ...SQL_VALUES, parameters: {} } })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(lastScriptCall()[3].parameterNames).toEqual([])
  })
})

// A SQLite block still holding Call procedure from a network type (SQL-6).
const SQLITE_CALL_VALUES = {
  operation: 'call_procedure',
  database_type: 'sqlite',
  file: 'testdata://shop.db',
  procedure: 'apply_discount',
}

const CALL_UNAVAILABLE = "Operation 'Call procedure' is not available on SQLite"

describe('ElementConfigModal - Call procedure on SQLite (SQL-6, FIELDERR-1)', () => {
  const operationRow = () => within(configSheet()).getByTestId('param-row-operation')

  it('names the operation SQLite does not offer under the Operation field', () => {
    renderScriptBlock({ ...SQL_BLOCK, currentValues: SQLITE_CALL_VALUES })

    const message = within(operationRow()).getByTestId('param-error-operation')
    expect(message.textContent).toBe(CALL_UNAVAILABLE)
    expect(message).toHaveAttribute('role', 'alert')
  })

  it('marks the Operation field invalid and describes it with the message', () => {
    renderScriptBlock({ ...SQL_BLOCK, currentValues: SQLITE_CALL_VALUES })

    const operation = within(operationRow()).getByRole('combobox', { name: 'Operation' })
    expect(operation).toHaveAttribute('aria-invalid', 'true')
    expect(operation).toHaveAccessibleDescription(CALL_UNAVAILABLE)
  })

  it('blocks Save with the generic note', () => {
    renderScriptBlock({ ...SQL_BLOCK, currentValues: SQLITE_CALL_VALUES })

    expect(parentSave()).toBeDisabled()
    expect(within(configSheet()).getByTestId('save-blocked-note').textContent).toBe(
      'Save is disabled: the settings have errors',
    )
  })

  it('keeps Save blocked after another change', async () => {
    const user = userEvent.setup()
    renderScriptBlock({ ...SQL_BLOCK, currentValues: SQLITE_CALL_VALUES })

    await user.type(screen.getByTestId('element-description-input'), 'x')

    expect(parentSave()).toBeDisabled()
    expect(within(configSheet()).getByTestId('save-blocked-note').textContent).toBe(
      'Save is disabled: the settings have errors',
    )
  })

  it.each([
    ['Call procedure on PostgreSQL', { ...SQL_VALUES, operation: 'call_procedure', procedure: 'apply_discount' }],
    ['Run SQL on SQLite', { operation: 'run_sql', database_type: 'sqlite', file: 'testdata://shop.db', sql: 'SELECT 1' }],
    ['Load table on SQLite', {
      operation: 'load_table',
      database_type: 'sqlite',
      file: 'testdata://shop.db',
      table: 'testdata://orders.csv',
      target_table: 'orders',
    }],
  ])('shows no Operation message for %s', (_title, values) => {
    renderScriptBlock({ ...SQL_BLOCK, currentValues: values })

    expect(within(operationRow()).queryByTestId('param-error-operation')).not.toBeInTheDocument()
    expect(within(operationRow()).getByRole('combobox', { name: 'Operation' })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})

describe('ElementConfigModal - Run in the SQL editor (SQL-13, PYRUN-21)', () => {
  it('runs what Save would save with this SQL, as Source', async () => {
    const user = userEvent.setup()
    const { dispatch, onSave } = renderScriptBlock(SQL_BLOCK)
    await user.type(screen.getByTestId('element-description-input'), 'x')
    await user.click(screen.getByTestId('param-expand-sql'))
    await user.click(within(editorSheet()).getByTestId('scalar-edit-body-change'))

    await user.click(within(editorSheet()).getByTestId('value-editor-run-button'))

    expect(dispatch).toHaveBeenCalledTimes(1)
    const [action, nodeId, options] = dispatch.mock.calls[0]
    expect(action).toBe('run-current')
    expect(nodeId).toBe('node-sql')
    expect(options.environmentId).toBe('env-1')
    expect(options.blockDraft.config.values).toMatchObject({
      sql: 'typed',
      script_type: 'source',
      host: 'db.lab',
      parameters: { customer: '1' },
    })
    expect(options.blockDraft.data.description).toBe('x')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('repeats the paused block with this SQL when a debug run is paused here', async () => {
    runState.status = 'paused'
    useWorkflowStore.setState({ pausedNodeId: 'node-sql' })
    const user = userEvent.setup()
    const { dispatch } = renderScriptBlock(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    await act(async () => {
      fireEvent.click(within(editorSheet()).getByTestId('value-editor-run-button'))
    })

    expect(runState.repeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-sql', 'sql', 'SELECT 1')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('disables Run and says why while another row blocks Save', async () => {
    const user = userEvent.setup()
    const values: Record<string, unknown> = { ...SQL_VALUES }
    delete values.host
    renderScriptBlock({ ...SQL_BLOCK, currentValues: values })
    await user.click(screen.getByTestId('param-expand-sql'))

    const run = within(editorSheet()).getByTestId('value-editor-run-button')
    expect(run).toBeDisabled()
    await user.hover(run.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })

  it('never waits on the SQL row itself', async () => {
    const user = userEvent.setup()
    renderScriptBlock({ ...SQL_BLOCK, currentValues: { ...SQL_VALUES, sql: '' } })
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(within(editorSheet()).getByTestId('value-editor-run-button')).toBeEnabled()
  })
})

// A draft whose saved config holds no Script Type still runs as Source.
describe.each([
  ['Python', PYTHON_BLOCK, 'script'],
  ['SQL', SQL_BLOCK, 'sql'],
] as Array<[string, ElementData, string]>)(
  'ElementConfigModal - the Script Type a Run of the %s editor uses (SQL-13, PYRUN-21)',
  (_editor, element, param) => {
    it('runs the draft as Source while the saved config names no Script Type', async () => {
      const user = userEvent.setup()
      const values: Record<string, unknown> = { ...element.currentValues }
      delete values.script_type
      const { dispatch } = renderScriptBlock({ ...element, currentValues: values })
      await user.click(screen.getByTestId(`param-expand-${param}`))

      await user.click(within(editorSheet()).getByTestId('value-editor-run-button'))

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][2].blockDraft.config.values).toMatchObject({ script_type: 'source' })
    })
  },
)

const OS_VALUES = {
  url: 'https://opensearch.example:9200',
  index: 'filebeat-*',
  username: 'wave',
  password: 'os-secret',
  query_language: 'dql',
  query: SAMPLE_DQL,
  mode: 'search',
}

/** The connection rows OS_VALUES holds, as the Get fields pull sends them: no default copies (REQ-3.1.1.5). */
const OS_HELD_CONNECTION = {
  url: 'https://opensearch.example:9200',
  username: 'wave',
  password: 'os-secret',
  index: 'filebeat-*',
}

const OS_BLOCK: ElementData = {
  id: 'node-os',
  name: 'OpenSearch',
  elementType: 'opensearch',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [],
  outputs: [],
  currentValues: OS_VALUES,
  outputBindings: {},
}

const OS_BINDING = {
  profileId: 'profile-os',
  profileName: 'Lab cluster',
  profileType: 'opensearch',
  alias: 'os',
}

describe('ElementConfigModal - the OpenSearch Query editor (OS-12, OS-13)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ editingTestId: 'test-1' })
  })

  it('opens the DQL query in Literal kind with the Format locked to DQL, Get fields and Run', async () => {
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)
    await user.click(screen.getByTestId('param-expand-query'))

    const sheet = editorSheet()
    expect(within(sheet).getByTestId('kind-dropdown')).toHaveTextContent(/^Literal$/)
    expect(within(sheet).getByTestId('format-dropdown')).toHaveTextContent(/^DQL$/)
    expect(within(sheet).getByTestId('format-dropdown')).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Get fields' })).toBeInTheDocument()
    expect(within(sheet).getByTestId('value-editor-run-button')).toBeEnabled()
  })

  it('opens the Query DSL query with the Format locked to Query DSL', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...OS_BLOCK,
      currentValues: { ...OS_VALUES, query_language: 'query_dsl', query: SAMPLE_QUERY_DSL },
    })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(within(editorSheet()).getByTestId('format-dropdown')).toHaveTextContent(/^Query DSL$/)
    expect(lastScriptCall()[1]).toBe(SAMPLE_QUERY_DSL)
    expect(lastScriptCall()[2]).toBe('query-dsl')
  })

  it("gives the editor the fields request of the block's rows, the selected Environment and the open test", async () => {
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)
    await user.click(screen.getByTestId('param-expand-query'))

    expect(openSearchFields.calls.at(-1)).toEqual({
      ...SAMPLE_FIELDS_REQUEST,
      connection: OS_HELD_CONNECTION,
      environment_id: 'env-1',
      test_id: 'test-1',
    })
  })

  it('sends the connection rows as they sit, with their expression and template flags and the profile bindings', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...OS_BLOCK,
      currentValues: {
        ...OS_VALUES,
        url: 'https://{{ os_host }}:9200',
        password: SEALED_PASSWORD,
        from: 'window_start',
        index: 'index_name',
      },
      expressionFields: ['from', 'index'],
      templateFields: ['query', 'url'],
      profileBindings: [OS_BINDING],
    })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(openSearchFields.calls.at(-1)).toEqual({
      connection: {
        ...OS_HELD_CONNECTION,
        url: 'https://{{ os_host }}:9200',
        password: SEALED_PASSWORD,
        index: 'index_name',
      },
      expression_fields: ['index'],
      template_fields: ['url'],
      element_types: {},
      profile_bindings: [OS_BINDING],
      environment_id: 'env-1',
      test_id: 'test-1',
    })
  })

  it('sends no Environment while none is selected', async () => {
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK, null)
    await user.click(screen.getByTestId('param-expand-query'))

    expect(openSearchFields.calls.at(-1)).toMatchObject({ environment_id: null, test_id: 'test-1' })
  })

  it('sends no test while none is open', async () => {
    useWorkflowStore.setState({ editingTestId: null })
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)
    await user.click(screen.getByTestId('param-expand-query'))

    expect(openSearchFields.calls.at(-1)).toMatchObject({ environment_id: 'env-1', test_id: null })
  })

  it('checks the query with the Index pattern and no fields job while none is loaded', async () => {
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)
    await user.click(screen.getByTestId('param-expand-query'))

    const [nodeId, doc, mode, options] = lastScriptCall()
    expect(nodeId).toBe('node-os')
    expect(doc).toBe(SAMPLE_DQL)
    expect(mode).toBe('dql')
    expect(options.openSearch).toEqual({ index: 'filebeat-*', fieldsJobId: null })
  })

  it('checks the query with the job of the loaded fields', async () => {
    openSearchFields.result.state = 'settled'
    openSearchFields.result.jobId = 'fields-job-1'
    const user = userEvent.setup()
    renderScriptBlock({ ...OS_BLOCK, currentValues: { ...OS_VALUES, index: 'app-logs' } })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(lastScriptCall()[3].openSearch).toEqual({ index: 'app-logs', fieldsJobId: 'fields-job-1' })
  })

  it("offers the block's pulled indexes and its pull to the rows before any editor opens", async () => {
    openSearchFields.result.state = 'settled'
    openSearchFields.result.indexes = SAMPLE_INDEXES
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)

    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(openSearchFields.calls.at(-1)).toEqual({
      ...SAMPLE_FIELDS_REQUEST,
      connection: OS_HELD_CONNECTION,
      environment_id: 'env-1',
      test_id: 'test-1',
    })
    await user.click(within(screen.getByTestId('param-row-index')).getByRole('combobox', { name: 'Index pattern' }))
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-value'))).toEqual([
      'filebeat-*',
      'app-logs',
      'logs-current',
      'metrics-app',
    ])
  })

  it("starts the block's pull from the Index pattern row's list", async () => {
    const user = userEvent.setup()
    renderScriptBlock(OS_BLOCK)

    await user.click(within(screen.getByTestId('param-row-index')).getByRole('combobox', { name: 'Index pattern' }))
    await user.click(screen.getByRole('button', { name: 'Get indexes' }))

    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
  })

  it('asks for no fields for a block that is not OpenSearch', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK)
    await user.click(screen.getByTestId('param-expand-sql'))

    expect(openSearchFields.calls.every((request) => request === null)).toBe(true)
  })
})

describe('ElementConfigModal - Run in the OpenSearch Query editor (OS-12, SQL-13, PYRUN-21)', () => {
  it('runs what Save would save with this query, and no Script Type', async () => {
    const user = userEvent.setup()
    const { dispatch, onSave } = renderScriptBlock(OS_BLOCK)
    await user.type(screen.getByTestId('element-description-input'), 'x')
    await user.click(screen.getByTestId('param-expand-query'))
    await user.click(within(editorSheet()).getByTestId('scalar-edit-body-change'))

    await user.click(within(editorSheet()).getByTestId('value-editor-run-button'))

    expect(dispatch).toHaveBeenCalledTimes(1)
    const [action, nodeId, options] = dispatch.mock.calls[0]
    expect(action).toBe('run-current')
    expect(nodeId).toBe('node-os')
    expect(options.environmentId).toBe('env-1')
    expect(options.blockDraft.config.values).toMatchObject({
      query: 'typed',
      query_language: 'dql',
      url: 'https://opensearch.example:9200',
      index: 'filebeat-*',
      mode: 'search',
    })
    expect(options.blockDraft.config.values).not.toHaveProperty('script_type')
    expect(options.blockDraft.data.description).toBe('x')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('repeats the paused block with this query when a debug run is paused here', async () => {
    runState.status = 'paused'
    useWorkflowStore.setState({ pausedNodeId: 'node-os' })
    const user = userEvent.setup()
    const { dispatch } = renderScriptBlock(OS_BLOCK)
    await user.click(screen.getByTestId('param-expand-query'))

    await act(async () => {
      fireEvent.click(within(editorSheet()).getByTestId('value-editor-run-button'))
    })

    expect(runState.repeatBlockDraft).toHaveBeenCalledExactlyOnceWith('node-os', 'query', SAMPLE_DQL)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('disables Run and says why while another row blocks Save', async () => {
    const user = userEvent.setup()
    const values: Record<string, unknown> = { ...OS_VALUES }
    delete values.url
    renderScriptBlock({ ...OS_BLOCK, currentValues: values })
    await user.click(screen.getByTestId('param-expand-query'))

    const run = within(editorSheet()).getByTestId('value-editor-run-button')
    expect(run).toBeDisabled()
    await user.hover(run.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })

  it('never waits on the Query row itself', async () => {
    const user = userEvent.setup()
    renderScriptBlock({ ...OS_BLOCK, currentValues: { ...OS_VALUES, query: '' } })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(within(editorSheet()).getByTestId('value-editor-run-button')).toBeEnabled()
  })
})

// With {}, the SQL and Query rows are expressions: no script editor, checks or Run (SQL-10, OS-12).
describe('ElementConfigModal - a script row in expression mode (SQL-10, OS-12)', () => {
  const SQL_EXPRESSION_BLOCK: ElementData = {
    ...SQL_BLOCK,
    currentValues: { ...SQL_VALUES, sql: 'report_sql' },
    expressionFields: ['sql'],
  }

  const sqlRow = () => screen.getByTestId('param-row-sql')
  const sqlToggle = () => within(sqlRow()).getByRole('button', { name: 'SQL expression mode' })

  it('offers the expression toggle on the SQL row', () => {
    renderScriptBlock(SQL_BLOCK)

    expect(sqlToggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the expression editor and no SQL editor while the SQL row is an expression', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_EXPRESSION_BLOCK)

    expect(sqlToggle()).toHaveAttribute('aria-pressed', 'true')
    expect(within(sqlRow()).getByTestId('param-input-sql')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
    expect(scriptSyntax.calls.filter((call) => call[2] === 'sql')).toEqual([])

    await user.click(within(sqlRow()).getByTestId('param-expand-sql'))

    expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('turns the SQL row into the expression editor from the toggle', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_BLOCK)

    await user.click(sqlToggle())
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(sqlToggle()).toHaveAttribute('aria-pressed', 'true')
    expect(within(sqlRow()).getByTestId('param-input-sql')).toBeInTheDocument()
  })

  it('turns the SQL row back into the SQL editor from the toggle', async () => {
    const user = userEvent.setup()
    renderScriptBlock(SQL_EXPRESSION_BLOCK)

    await user.click(sqlToggle())
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(sqlToggle()).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(sqlRow()).getByTestId('param-expand-sql'))
    expect(editorSheet()).toBeInTheDocument()
    expect(screen.queryByTestId('expression-editor-modal')).not.toBeInTheDocument()
  })

  it('shows the expression editor and no Query editor while the Query row is an expression', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...OS_BLOCK,
      currentValues: { ...OS_VALUES, query: 'dashboard_query' },
      expressionFields: ['query'],
    })

    const row = screen.getByTestId('param-row-query')
    expect(within(row).getByTestId('param-input-query')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(scriptSyntax.calls.filter((call) => call[2] === 'dql')).toEqual([])

    await user.click(within(row).getByTestId('param-expand-query'))

    expect(screen.getByTestId('expression-editor-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })
})

const SCRIPT_EDITORS: Array<[string, ElementData, string]> = [
  ['Python', PYTHON_BLOCK, 'script'],
  ['SQL', SQL_BLOCK, 'sql'],
  ['OpenSearch', OS_BLOCK, 'query'],
]

describe.each(SCRIPT_EDITORS)(
  'ElementConfigModal - Stop in the %s editor (SQL-13, PYRUN-21)',
  (_editor, element, param) => {
    const openEditor = (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByTestId(`param-expand-${param}`))

    it('offers Stop during a repeat and ends the run once on Stop', async () => {
      runState.status = 'paused'
      runState.runBusy = true
      useWorkflowStore.setState({ pausedNodeId: element.id })
      const user = userEvent.setup()
      renderScriptBlock(element)
      await openEditor(user)

      expect(within(editorSheet()).queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
      await act(async () => {
        fireEvent.click(within(editorSheet()).getByTestId('value-editor-stop-button'))
      })

      expect(runState.stopRun).toHaveBeenCalledTimes(1)
      expect(runState.repeatBlockDraft).not.toHaveBeenCalled()
    })

    it('swallows a Stop that fails', async () => {
      runState.status = 'paused'
      runState.runBusy = true
      runState.stopRun.mockRejectedValueOnce(new Error('Stop failed'))
      useWorkflowStore.setState({ pausedNodeId: element.id })
      const user = userEvent.setup()
      renderScriptBlock(element)
      await openEditor(user)

      await act(async () => {
        fireEvent.click(within(editorSheet()).getByTestId('value-editor-stop-button'))
      })

      expect(runState.stopRun).toHaveBeenCalledTimes(1)
      expect(editorSheet()).toBeInTheDocument()
    })

    it('turns Run into Stop once a Run from this editor is running', async () => {
      const user = userEvent.setup()
      const { dispatch, rerender } = renderScriptBlock(element)
      await openEditor(user)
      await user.click(within(editorSheet()).getByTestId('value-editor-run-button'))
      expect(dispatch).toHaveBeenCalledTimes(1)

      runState.status = 'running'
      rerender()

      expect(within(editorSheet()).queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
      await act(async () => {
        fireEvent.click(within(editorSheet()).getByTestId('value-editor-stop-button'))
      })
      expect(runState.stopRun).toHaveBeenCalledTimes(1)
    })

    it('keeps Run for a run started elsewhere', async () => {
      runState.status = 'running'
      const user = userEvent.setup()
      renderScriptBlock(element)
      await openEditor(user)

      expect(within(editorSheet()).getByTestId('value-editor-run-button')).toBeInTheDocument()
      expect(within(editorSheet()).queryByTestId('value-editor-stop-button')).not.toBeInTheDocument()
    })

    it('keeps Run once that run ended and another one runs', async () => {
      const user = userEvent.setup()
      const { rerender } = renderScriptBlock(element)
      await openEditor(user)
      await user.click(within(editorSheet()).getByTestId('value-editor-run-button'))
      runState.status = 'running'
      rerender()
      expect(within(editorSheet()).getByTestId('value-editor-stop-button')).toBeInTheDocument()

      runState.status = 'passed'
      rerender()
      expect(within(editorSheet()).getByTestId('value-editor-run-button')).toBeInTheDocument()

      runState.status = 'running'
      rerender()
      expect(within(editorSheet()).getByTestId('value-editor-run-button')).toBeInTheDocument()
      expect(within(editorSheet()).queryByTestId('value-editor-stop-button')).not.toBeInTheDocument()
    })
  },
)

describe('ElementConfigModal - typed Driver options (REQ-3.1.3.19, SQL-8)', () => {
  it('saves the Driver options rows with their element types', async () => {
    const user = userEvent.setup()
    const { onSave } = renderScriptBlock(SQL_BLOCK)
    fireEvent.click(screen.getByTestId('group-header-Advanced'))
    const sheet = await openMap(user, 'driver_options')
    await user.click(within(sheet).getByTestId('map-edit-body-change'))
    await user.click(within(sheet).getByTestId('value-editor-save-button'))
    await user.click(within(sheet).getByTestId('value-editor-cancel-button'))
    await user.click(parentSave())

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ elementTypes: { driver_options: { x: 'string' } } }),
    )
  })
})

// A Custom (JSON) stat's editor joins the block's Get fields pull and names its Index pattern (OS-7, OS-12, OS-13).
describe('ElementConfigModal - the Custom (JSON) stat editor (OS-7, OS-12, OS-13)', () => {
  const CUSTOM_JSON = '{"percentiles": {"field": "latency_ms"}}'
  const AGGREGATE_BLOCK: ElementData = {
    ...OS_BLOCK,
    currentValues: { ...OS_VALUES, mode: 'aggregate', stats: [{ value: { stat: 'custom', json: CUSTOM_JSON } }] },
  }

  beforeEach(() => {
    useWorkflowStore.setState({ editingTestId: 'test-1' })
  })

  async function openCustomJson(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('param-expand-stats'))
    await user.click(screen.getByRole('button', { name: /^Stat 1:/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Stat 1' })).getByRole('button', { name: 'Edit JSON' }))
  }

  it("pulls the fields with the block's request", async () => {
    const user = userEvent.setup()
    renderScriptBlock(AGGREGATE_BLOCK)
    const before = openSearchFields.calls.length

    await openCustomJson(user)

    // The Stats editor sheet itself pulls nothing (a null request); every pull made is the block's.
    const fromEditor = openSearchFields.calls.slice(before).filter((request) => request !== null)
    expect(fromEditor.length).toBeGreaterThan(0)
    for (const request of fromEditor) {
      expect(request).toEqual({
        ...SAMPLE_FIELDS_REQUEST,
        connection: OS_HELD_CONNECTION,
        environment_id: 'env-1',
        test_id: 'test-1',
      })
    }
  })

  it('checks the aggregation with the Index pattern', async () => {
    const user = userEvent.setup()
    renderScriptBlock(AGGREGATE_BLOCK)

    await openCustomJson(user)

    const [, doc, mode, options] = lastScriptCall()
    expect(doc).toBe(CUSTOM_JSON)
    expect(mode).toBe('aggregation-json')
    expect(options.openSearch).toEqual({ index: 'filebeat-*', fieldsJobId: null })
  })

  it('names no Index pattern while that row is an expression', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...AGGREGATE_BLOCK,
      currentValues: { ...AGGREGATE_BLOCK.currentValues, index: 'index_name' },
      expressionFields: ['index'],
    })

    await openCustomJson(user)

    expect(lastScriptCall()[3].openSearch).toEqual({ index: '', fieldsJobId: null })
  })
})

// A field list needs an Index pattern: the block's editors offer no pull while it is blank (OS-12, OS-13).
describe('ElementConfigModal - a blank Index pattern (OS-13)', () => {
  const FILL_IN = 'Fill in Index pattern to get fields'
  const CUSTOM_JSON = '{"percentiles": {"field": "latency_ms"}}'

  beforeEach(() => {
    useWorkflowStore.setState({ editingTestId: 'test-1' })
  })

  function chipOf(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole('button', { name: 'Get fields' })
  }

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('shows Get fields disabled in the Query editor while Index pattern is %s', async (_label, index) => {
    const user = userEvent.setup()
    renderScriptBlock({ ...OS_BLOCK, currentValues: { ...OS_VALUES, index } })
    await user.click(screen.getByTestId('param-expand-query'))
    const chip = chipOf(editorSheet())

    expect(chip).toHaveAttribute('aria-disabled', 'true')
    act(() => {
      chip.focus()
    })
    expect(screen.getByRole('tooltip').textContent).toBe(FILL_IN)
    await user.click(chip)
    expect(openSearchFields.result.start).not.toHaveBeenCalled()
  })

  it('shows Get fields disabled in the Query editor while Index pattern was never set', async () => {
    const user = userEvent.setup()
    const { index: _index, ...values } = OS_VALUES
    renderScriptBlock({ ...OS_BLOCK, currentValues: values })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(chipOf(editorSheet())).toHaveAttribute('aria-disabled', 'true')
  })

  it('checks the query with no fields job while Index pattern is blank, even with a loaded pull', async () => {
    openSearchFields.result.state = 'settled'
    openSearchFields.result.jobId = 'fields-job-1'
    const user = userEvent.setup()
    renderScriptBlock({ ...OS_BLOCK, currentValues: { ...OS_VALUES, index: '' } })
    await user.click(screen.getByTestId('param-expand-query'))

    expect(lastScriptCall()[3].openSearch).toEqual({ index: '', fieldsJobId: null })
  })

  it('offers Get fields while Index pattern is an expression', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...OS_BLOCK,
      currentValues: { ...OS_VALUES, index: 'index_name' },
      expressionFields: ['index'],
    })
    await user.click(screen.getByTestId('param-expand-query'))
    const chip = chipOf(editorSheet())

    expect(chip).not.toHaveAttribute('aria-disabled')
    await user.click(chip)
    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
  })

  it('shows Get fields disabled in a Custom (JSON) stat editor while Index pattern is blank', async () => {
    const user = userEvent.setup()
    renderScriptBlock({
      ...OS_BLOCK,
      currentValues: {
        ...OS_VALUES,
        index: '',
        mode: 'aggregate',
        stats: [{ value: { stat: 'custom', json: CUSTOM_JSON } }],
      },
    })
    await user.click(screen.getByTestId('param-expand-stats'))
    await user.click(screen.getByRole('button', { name: /^Stat 1:/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Stat 1' })).getByRole('button', { name: 'Edit JSON' }))
    const chip = chipOf(screen.getAllByTestId('value-editor-sheet').at(-1) as HTMLElement)

    expect(chip).toHaveAttribute('aria-disabled', 'true')
    await user.click(chip)
    expect(openSearchFields.result.start).not.toHaveBeenCalled()
  })
})

describe('ElementConfigModal - pressing the opener of an editor that is already open', () => {
  const zOf = (el: HTMLElement) => Number(el.style.zIndex)
  const isPulsing = (el: HTMLElement) => el.className.includes('animate-sheet-select-pulse')

  it('brings the Edit value sheet back in front of the config and pulses it', async () => {
    const user = userEvent.setup()
    renderBlock()
    await user.click(screen.getByTestId('param-expand-body'))
    const editor = screen.getByTestId('value-editor-sheet')
    fireEvent.pointerDown(configSheet())
    expect(zOf(configSheet())).toBeGreaterThan(zOf(editor))

    await user.click(screen.getByTestId('param-expand-body'))

    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(1)
    expect(zOf(editor)).toBeGreaterThan(zOf(configSheet()))
    expect(isPulsing(editor)).toBe(true)
  })

  it('brings a map editor back in front of the config and pulses it', async () => {
    const user = userEvent.setup()
    renderBlock()
    const editor = await openHeaders(user)
    fireEvent.pointerDown(configSheet())

    await openHeaders(user)

    expect(screen.getAllByTestId('value-editor-sheet')).toHaveLength(1)
    expect(zOf(editor)).toBeGreaterThan(zOf(configSheet()))
    expect(isPulsing(editor)).toBe(true)
  })

  it('brings the Profiles sheet back in front of the config and pulses it', async () => {
    const user = userEvent.setup()
    renderBlock()
    const profilesButton = within(configSheet()).getByRole('button', { name: 'Profiles' })
    await user.click(profilesButton)
    const profiles = await screen.findByTestId('profile-binding-sheet')
    fireEvent.pointerDown(configSheet())
    expect(zOf(configSheet())).toBeGreaterThan(zOf(profiles))

    await user.click(profilesButton)

    expect(screen.getAllByTestId('profile-binding-sheet')).toHaveLength(1)
    expect(zOf(profiles)).toBeGreaterThan(zOf(configSheet()))
    expect(isPulsing(profiles)).toBe(true)
  })
})
