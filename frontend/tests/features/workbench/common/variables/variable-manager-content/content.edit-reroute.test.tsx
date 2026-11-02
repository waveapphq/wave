/**
 * Tests for the Variable Manager pencil: it opens the variable's one window in Edit, filled with
 * the row, and the panel threads the window's save handlers, scope, session and run lock into it.
 * The watcher only shows values, so it gets no edit handlers.
 *
 * The watcher and the window are mocked to stand-ins so this file covers only the panel's wiring;
 * the window's own behavior lives in variable-create-modal.test.tsx.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.2.2.3: Pause/resume execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { watcherProps } = vi.hoisted(() => ({ watcherProps: vi.fn() }))

// The watcher stand-in reflects the props the panel threads through, so the wiring can be asserted from the DOM.
vi.mock(
  '@/features/workbench/common/variables/variable-inspect-modal/variable-inspect-modal',
  () => ({
    VariableInspectModal: (props: {
      variable: { id: string }
      onVariableEdit?: unknown
      onVariableRename?: unknown
      checkNameExists?: unknown
      readOnly?: boolean
    }) => {
      watcherProps(props)
      return (
        <div
          data-testid={`inspect-modal-${props.variable.id}`}
          data-has-edit={typeof props.onVariableEdit === 'function' ? 'true' : 'false'}
          data-has-rename={typeof props.onVariableRename === 'function' ? 'true' : 'false'}
          data-has-check={typeof props.checkNameExists === 'function' ? 'true' : 'false'}
          data-readonly={props.readOnly ? 'true' : 'false'}
        />
      )
    },
  }),
)

// The watcher props that only served its edit half.
const WATCHER_EDIT_PROPS = [
  'onVariableEdit',
  'onVariableRename',
  'checkNameExists',
  'validateExpressionCycle',
  'onVariableCurrentEdit',
  'initialEditing',
  'editNonce',
  'runStatus',
  'isExecuting',
] as const

interface WindowStubProps {
  mode: string
  windowId?: string
  editTarget?: {
    row: Variable
    scope: string[] | null
    current?: { value: unknown; hasValue: boolean; elementTypes?: unknown; source?: string }
    secretUnlocked?: boolean
    secretChanged?: boolean
    inFunction?: boolean
  }
  tracksUnsavedSecret?: boolean
  secretSaveTarget?: 'test' | 'Function'
  runLocked?: boolean
  sessionId?: string | null
  onClose: () => void
}

const { windowProps } = vi.hoisted(() => ({ windowProps: vi.fn() }))

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/variable-create-modal', () => ({
  VariableCreateModal: (props: WindowStubProps) => {
    windowProps(props)
    return (
      <div
        data-testid="variable-create-modal"
        data-window-id={props.windowId}
        data-window-mode={props.editTarget ? 'edit' : 'add'}
        data-row-id={props.editTarget?.row.id}
        data-mode={props.mode}
        data-run-locked={props.runLocked ? 'true' : 'false'}
      >
        <button type="button" onClick={props.onClose}>
          Close window
        </button>
      </div>
    )
  },
}))

// The test-variables reveal reads the saved Test and its workflow.
const { fetchTestMock, fetchTestWorkflowMock } = vi.hoisted(() => ({
  fetchTestMock: vi.fn(),
  fetchTestWorkflowMock: vi.fn(),
}))
vi.mock('@/features/tests/api/crud', () => ({ fetchTest: fetchTestMock, fetchTestWorkflow: fetchTestWorkflowMock }))

// The panel renders no editor-modals plumbing.
vi.mock(
  '@/features/workbench/common/variables/variable-manager-content/variable-editor-modals',
  () => ({
    VariableEditorModals: () => <div data-testid="legacy-editor-modals" />,
  }),
)

import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type {
  Variable,
  VariableManagerContentProps,
} from '@/features/workbench/common/variables/variable-manager-content/types'

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return { id: 'v1', name: 'greeting', value: 'hello', type: 'string', ...overrides }
}

const baseProps: VariableManagerContentProps = {
  variables: [createVariable()],
  runtimeValues: new Map(),
  isExecuting: false,
  onVariableEdit: vi.fn(),
  onVariableCurrentEdit: vi.fn(),
  onCreateVariable: vi.fn(() => ({ success: true })),
}

const editWindows = () =>
  screen.queryAllByTestId('variable-create-modal').filter((node) => node.dataset.windowMode === 'edit')

/** The props the last-rendered Edit window of `rowId` holds. */
function lastWindowOf(rowId: string): WindowStubProps {
  const calls = windowProps.mock.calls.map(([props]) => props as WindowStubProps)
  const found = calls.filter((props) => props.editTarget?.row.id === rowId).at(-1)
  if (!found) throw new Error(`No Edit window was rendered for ${rowId}`)
  return found
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useMaskingSettingsStore.setState({ testVariables: false })
})

describe('VariableManagerContent - the pencil opens the variable window (VMGR-106)', () => {
  it('opens the window in Edit, filled with the row, when the row pencil is clicked', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-row-id', 'v1')
    expect(editWindows()[0]).toHaveAttribute('data-mode', 'variable')
    expect(lastWindowOf('v1').editTarget?.row).toMatchObject({
      id: 'v1',
      name: 'greeting',
      value: 'hello',
      type: 'string',
    })
  })

  it('opens no watcher from the pencil', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByTestId('inspect-modal-v1')).not.toBeInTheDocument()
  })

  it('threads the save handlers and the name check into the window', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    const props = lastWindowOf('v1') as WindowStubProps & Record<string, unknown>
    expect(typeof props.onSaveDefinition).toBe('function')
    expect(typeof props.onSaveCurrent).toBe('function')
    expect(typeof props.checkNameExists).toBe('function')
  })

  it('hands the window the live session id', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} sessionId="sess-1" runStatus="paused" isExecuting />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(lastWindowOf('v1').sessionId).toBe('sess-1')
  })

  it('names no Function as the scope of a Test variable window', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect([null, []]).toContainEqual(lastWindowOf('v1').editTarget?.scope)
  })

  it('tells the window a Test variable lives outside any Function', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(lastWindowOf('v1').editTarget?.inFunction).toBe(false)
  })

  it('raises the open window instead of opening a second one for the same variable', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))
    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
  })

  it('opens one window per variable', async () => {
    const user = userEvent.setup()
    const variables = [createVariable(), createVariable({ id: 'v2', name: 'farewell', value: 'bye' })]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    await user.click(screen.getByTestId('edit-button-v1'))
    await user.click(screen.getByTestId('edit-button-v2'))

    const windows = editWindows()
    expect(windows.map((node) => node.dataset.rowId)).toEqual(['v1', 'v2'])
    expect(windows[0].dataset.windowId).not.toBe(windows[1].dataset.windowId)
  })

  it('opens the window again once it was closed', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)
    await user.click(screen.getByTestId('edit-button-v1'))

    await user.click(screen.getByRole('button', { name: 'Close window' }))
    expect(editWindows()).toHaveLength(0)
    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
  })

  it('keeps an open Add window apart from the Edit window the pencil opens', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('add-variable-button'))
    await user.click(screen.getByTestId('edit-button-v1'))

    const windows = screen.getAllByTestId('variable-create-modal')
    expect(windows.map((node) => node.dataset.windowMode)).toEqual(['add', 'edit'])
    expect(windows[0].dataset.windowId).not.toBe(windows[1].dataset.windowId)
  })

  it('does not render the legacy VariableEditorModals plumbing', () => {
    render(<VariableManagerContent {...baseProps} />)
    expect(screen.queryByTestId('legacy-editor-modals')).not.toBeInTheDocument()
  })
})

describe('VariableManagerContent - the pencil at a library View root (VMGR-106)', () => {
  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ functionViewMode: null, drillPath: [] })
    })
  })

  it('tells the window its local lives in the Function although the scope is empty', async () => {
    act(() => {
      useWorkflowStore.setState({
        functionViewMode: { functionId: 'fn-lib', version: '1.0.0', editable: true },
        drillPath: [{ nodeId: 'view-shared-root', label: 'Library_Fn' }],
      })
    })
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[{ id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 }]}
        scope={{
          insideFunction: true,
          scopeId: 'view-shared-root',
          declaredInputNames: [],
          declaredOutputNames: [],
          allowedVarNames: new Set(['loc_n']),
        }}
      />,
    )

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(lastWindowOf('loc-a').editTarget).toMatchObject({ scope: [], inFunction: true })
    expect(lastWindowOf('loc-a').tracksUnsavedSecret).toBe(false)
  })

  it('tracks a local of the library View against the body the View loaded, saved by the Function save', async () => {
    act(() => {
      useWorkflowStore.setState({
        functionViewMode: { functionId: 'fn-lib', version: '1.0.0', editable: true },
        drillPath: [{ nodeId: 'view-shared-root', label: 'Library_Fn' }],
        nodes: [
          {
            id: 'view-shared-root',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'Library_Fn',
              nodeType: 'function',
              functionLifecycle: 'shared',
              localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
            },
          },
        ] as never,
        functionViewBaseline: {
          nodeId: 'view-shared-root',
          body: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
        },
      })
    })
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[{ id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 }]}
        scope={{
          insideFunction: true,
          scopeId: 'view-shared-root',
          declaredInputNames: [],
          declaredOutputNames: [],
          allowedVarNames: new Set(['loc_n']),
        }}
      />,
    )

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(lastWindowOf('loc-a')).toMatchObject({ tracksUnsavedSecret: true, secretSaveTarget: 'Function' })
    act(() => {
      useWorkflowStore.setState({ functionViewBaseline: null, nodes: [] as never })
    })
  })
})

describe('VariableManagerContent - the pencil inside a Function (VMGR-106)', () => {
  const PATH_A = [{ nodeId: 'fn-a', label: 'Function_A' }]
  const rows: Variable[] = [
    {
      id: 'param:input:region',
      name: 'region',
      type: 'string',
      value: 'eu',
      required: true,
      description: 'Region code',
      enumValues: ['eu', 'us'],
    },
    { id: 'param:output:result', name: 'result', type: 'string', value: 'ok', description: 'What came back' },
    { id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 },
  ]
  const scope: VariableManagerContentProps['scope'] = {
    insideFunction: true,
    scopeId: 'fn-a',
    declaredInputNames: ['region'],
    declaredOutputNames: ['result'],
    allowedVarNames: new Set(['region', 'result', 'loc_n']),
  }

  beforeEach(() => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: 'fn-a',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'Function_A',
              nodeType: 'function',
              functionLifecycle: 'local',
              localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
            },
          },
        ] as never,
        drillPath: PATH_A,
      })
    })
  })

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })
  })

  it.each([
    ['param:input:region', 'input'],
    ['param:output:result', 'output'],
    ['loc-a', 'variable'],
  ])('opens the window of row %s in %s mode', async (rowId, mode) => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={rows} scope={scope} />)

    await user.click(screen.getByTestId(`edit-button-${rowId}`))

    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-mode', mode)
  })

  it('names the row Function as the window scope', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={rows} scope={scope} />)

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(lastWindowOf('loc-a').editTarget?.scope).toEqual(['fn-a'])
  })

  it('keeps a changed secret local visible with the strip in a Local Function, keyed by its scope', async () => {
    const user = userEvent.setup()
    const secretLocal: Variable = { id: 'loc-s', name: 'loc_tok', type: 'string', value: 'sk-new', isSecret: true }
    const key = scopedVariableKey('loc_tok', ['fn-a'])
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[...rows, secretLocal]}
        scope={{ ...scope!, allowedVarNames: new Set(['region', 'result', 'loc_n', 'loc_tok']) }}
        unsavedSecretIds={new Set([key])}
        changedSecretIds={new Set([key])}
      />,
    )

    await user.click(screen.getByTestId('edit-button-loc-s'))

    expect(lastWindowOf('loc-s').editTarget).toMatchObject({ secretUnlocked: true, secretChanged: true })
    expect(lastWindowOf('loc-s').tracksUnsavedSecret).toBe(true)
  })

  it('opens a changed secret local\'s watcher unlocked with the strip, and closes it once the Test save locks it', async () => {
    const user = userEvent.setup()
    const secretLocal: Variable = { id: 'loc-s', name: 'loc_tok', type: 'string', value: 'sk-new', isSecret: true }
    const key = scopedVariableKey('loc_tok', ['fn-a'])
    const props = {
      ...baseProps,
      variables: [...rows, secretLocal],
      scope: { ...scope!, allowedVarNames: new Set(['region', 'result', 'loc_n', 'loc_tok']) },
    }
    const { rerender } = render(
      <VariableManagerContent {...props} unsavedSecretIds={new Set([key])} changedSecretIds={new Set([key])} />,
    )
    await user.click(screen.getByTestId('expand-button-loc-s'))
    expect(screen.getByTestId('inspect-modal-loc-s')).toBeInTheDocument()
    expect(watcherProps.mock.calls.at(-1)?.[0]).toMatchObject({ secretUnlocked: true, secretChanged: true })

    rerender(<VariableManagerContent {...props} unsavedSecretIds={new Set()} changedSecretIds={new Set()} />)
    expect(screen.queryByTestId('inspect-modal-loc-s')).not.toBeInTheDocument()
  })

  it('ignores a set entry of the same name in another scope', async () => {
    const user = userEvent.setup()
    const secretLocal: Variable = { id: 'loc-s', name: 'loc_tok', type: 'string', value: 'sk', isSecret: true }
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[...rows, secretLocal]}
        scope={{ ...scope!, allowedVarNames: new Set(['region', 'result', 'loc_n', 'loc_tok']) }}
        unsavedSecretIds={new Set(['loc_tok'])}
        changedSecretIds={new Set(['loc_tok'])}
      />,
    )

    await user.click(screen.getByTestId('edit-button-loc-s'))

    expect(lastWindowOf('loc-s').editTarget).toMatchObject({ secretUnlocked: false, secretChanged: false })
  })

  it('tells the window its row lives in the Function', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={rows} scope={scope} />)

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(lastWindowOf('loc-a').editTarget?.inFunction).toBe(true)
  })

  it('names a nested Function by its whole path, outermost first, as the window scope', async () => {
    const inner = {
      id: 'fn-inner',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Inner_Fn',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
      },
    }
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: 'fn-a',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'Function_A',
              nodeType: 'function',
              functionLifecycle: 'local',
              localDefinition: { workflow: { nodes: [inner], edges: [] }, inputs: [], outputs: [], variables: [] },
            },
          },
        ] as never,
        drillPath: [...PATH_A, { nodeId: 'fn-inner', label: 'Inner_Fn' }],
      })
    })
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={rows} scope={{ ...scope, scopeId: 'fn-a/fn-inner' }} />)

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(lastWindowOf('loc-a').editTarget?.scope).toEqual(['fn-a', 'fn-inner'])
  })

  it('hands an input window the row Required, Description and allowed values', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={rows} scope={scope} />)

    await user.click(screen.getByTestId('edit-button-param:input:region'))

    expect(lastWindowOf('param:input:region').editTarget?.row).toMatchObject({
      name: 'region',
      value: 'eu',
      required: true,
      description: 'Region code',
      enumValues: ['eu', 'us'],
    })
  })
})

describe('VariableManagerContent - the window run lock follows the run state (VMGR-107)', () => {
  it('opens the window from the pencil while paused, with Save free', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} isExecuting runStatus="paused" />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-run-locked', 'false')
  })

  it('locks an open window while the run is running and frees it again once the run pauses or ends', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...baseProps} isExecuting runStatus="paused" />)
    await user.click(screen.getByTestId('edit-button-v1'))

    rerender(<VariableManagerContent {...baseProps} isExecuting runStatus="running" />)
    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-run-locked', 'true')

    rerender(<VariableManagerContent {...baseProps} isExecuting runStatus="paused" />)
    expect(editWindows()[0]).toHaveAttribute('data-run-locked', 'false')

    rerender(<VariableManagerContent {...baseProps} isExecuting={false} runStatus="passed" />)
    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-run-locked', 'false')
  })
})

describe('VariableManagerContent - the pencil hands the window the Current value it shows (VMGR-108)', () => {
  const currentOf = (rowId = 'v1') => lastWindowOf(rowId).editTarget?.current

  it('hands the window the live value of a paused run', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        runtimeValues={new Map([['greeting', 'live hello']])}
        sessionId="sess-1"
        runStatus="paused"
        isExecuting
      />,
    )

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(currentOf()).toMatchObject({ value: 'live hello', hasValue: true })
  })

  it('hands the window the value staged for the next run', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        appliedOverrides={new Map([['greeting', { value: 'staged hello', type: 'string' }]])}
      />,
    )

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(currentOf()).toMatchObject({ value: 'staged hello', hasValue: true })
  })

  it('hands the window no Current value while no run gave one and none is staged', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(currentOf()?.hasValue ?? false).toBe(false)
  })

  it('hands the window the staged Current source of an expression variable, never its result', async () => {
    const user = userEvent.setup()
    const total = createVariable({ id: 'v2', name: 'total', value: 'a + 1', type: 'integer', isExpression: true })
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[total]}
        appliedOverrides={new Map([['total', { expression: 'a + 2', type: 'integer' }]])}
      />,
    )

    await user.click(screen.getByTestId('edit-button-v2'))

    expect(currentOf('v2')?.source).toBe('a + 2')
  })

  it('hands a variable made an expression since the run started its definition source, never the literal the run started with', async () => {
    const user = userEvent.setup()
    const greeting = createVariable({ value: "'hi ' + who", isExpression: true })
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[greeting]}
        runStartSnapshot={new Map([['greeting', 'hello']])}
        sessionId="sess-1"
        runStatus="paused"
        isExecuting
      />,
    )

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(currentOf()?.source).toBe("'hi ' + who")
  })

  it('tells the window a secret set in this session still holds its own value', async () => {
    const user = userEvent.setup()
    const secret = createVariable({ isSecret: true, name: 'token', value: 'fresh-token' })
    render(<VariableManagerContent {...baseProps} variables={[secret]} unsavedSecretIds={new Set(['token'])} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(lastWindowOf('v1').editTarget?.secretUnlocked).toBe(true)
  })

  it('tells the window whether the saved Test holds a secret\'s value yet (new or edited)', async () => {
    const user = userEvent.setup()
    const secret = createVariable({ isSecret: true, name: 'token', value: 'fresh-token' })
    const { rerender } = render(
      <VariableManagerContent
        {...baseProps}
        variables={[secret]}
        unsavedSecretIds={new Set(['token'])}
        changedSecretIds={new Set(['token'])}
      />,
    )
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(lastWindowOf('v1').editTarget?.secretChanged).toBe(true)

    rerender(<VariableManagerContent {...baseProps} variables={[secret]} unsavedSecretIds={new Set(['token'])} />)
    expect(lastWindowOf('v1').editTarget?.secretChanged).toBe(false)
  })

  it('tells a Test variable window, Add and Edit, that an unsaved secret stays visible until the Test is saved', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))
    expect(lastWindowOf('v1').tracksUnsavedSecret).toBe(true)

    await user.click(screen.getByTestId('add-variable-button'))
    const added = windowProps.mock.calls.map(([props]) => props as WindowStubProps).filter((props) => !props.editTarget)
    expect(added.at(-1)?.tracksUnsavedSecret).toBe(true)
  })

  it('tells the window a saved secret holds no readable value', async () => {
    const user = userEvent.setup()
    const secret = createVariable({ isSecret: true, name: 'token', value: '********' })
    render(<VariableManagerContent {...baseProps} variables={[secret]} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(lastWindowOf('v1').editTarget?.secretUnlocked ?? false).toBe(false)
  })
})

describe('VariableManagerContent - pencil on a saved (locked) secret', () => {
  const secretProps: VariableManagerContentProps = {
    ...baseProps,
    variables: [createVariable({ isSecret: true, name: 'token', value: '********' })],
  }

  it('opens the window in Edit at once, asking nothing (the window\'s masked field asks before it clears)', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...secretProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    expect(editWindows()).toHaveLength(1)
    expect(editWindows()[0]).toHaveAttribute('data-row-id', 'v1')
  })

  it('opens the window directly for an unset secret - no value to protect', async () => {
    const user = userEvent.setup()
    const unsetSecret = { id: 'v1', name: 'k8s_session', type: 'string', isSecret: true } as Variable
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[unsetSecret]}
        unsavedSecretIds={new Set(['k8s_session'])}
      />,
    )

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    expect(editWindows()).toHaveLength(1)
  })

  it('opens the window directly for an unsaved (unlocked) secret', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent {...secretProps} unsavedSecretIds={new Set(['token'])} />,
    )

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    expect(editWindows()).toHaveLength(1)
  })

  it('keeps a locked secret watcher open when test_variables reveal is on', async () => {
    fetchTestMock.mockResolvedValue({ variables: { token: { value: 'sk-real', type: 'string', secret: true } } })
    fetchTestWorkflowMock.mockResolvedValue({ nodes: [], edges: [] })
    act(() => {
      useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    })
    useMaskingSettingsStore.setState({ testVariables: true })
    const user = userEvent.setup()
    render(<VariableManagerContent {...secretProps} />)

    // The revealed value enables the expand (inspect) button for the saved secret; the
    // watcher-close effect must NOT close it while inspection is revealed.
    await waitFor(() => expect(screen.getByTestId('expand-button-v1')).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(screen.getByTestId('expand-button-v1'))

    expect(screen.getByTestId('inspect-modal-v1')).toBeInTheDocument()
    act(() => {
      useWorkflowStore.getState().clearEditingTest()
    })
  })

  it('keeps a secret masked and closed when the reveal returned no value for it', () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    render(<VariableManagerContent {...secretProps} />)

    expect(screen.getByTestId('expand-button-v1')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('VariableManagerContent - flag threading into the watcher', () => {
  it('hands the watcher no edit handler, rename or name check (it only shows values)', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} />)

    await user.click(screen.getByTestId('expand-button-v1'))

    const watcher = screen.getByTestId('inspect-modal-v1')
    expect(watcher).toHaveAttribute('data-has-edit', 'false')
    expect(watcher).toHaveAttribute('data-has-rename', 'false')
    expect(watcher).toHaveAttribute('data-has-check', 'false')
  })

  it('hands the watcher none of the edit wiring, also while a run is paused', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        sessionId="sess-1"
        isExecuting
        runStatus="paused"
        validateExpressionCycle={() => null}
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    const props = watcherProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props.sessionId).toBe('sess-1')
    for (const name of WATCHER_EDIT_PROPS) {
      expect(props[name], name).toBeUndefined()
    }
  })

  it('threads readOnly into an inspected modal', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} readOnly />)

    await user.click(screen.getByTestId('expand-button-v1'))

    expect(screen.getByTestId('inspect-modal-v1')).toHaveAttribute(
      'data-readonly',
      'true',
    )
  })
})
