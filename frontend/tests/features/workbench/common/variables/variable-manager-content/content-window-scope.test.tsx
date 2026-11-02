/**
 * VariableManagerContent - a variable window checks a typed expression and a name, and offers
 * autocomplete, against its own scope, not the scope shown when the check runs (VMGR-102).
 *
 * The window itself is stubbed so the checks it receives can be called directly.
 *
 * REQ-3.1.2.4: Function validation before save
 * REQ-3.1.3.1: Variable scoping with namespace-based access
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/workbench/common/variables/variable-manager-content/variable-editor-modals', () => ({
  VariableEditorModals: () => null,
}))

interface CycleParams {
  variableName: string
  value: unknown
  isExpression: boolean
}

interface WindowProps {
  mode: string
  editTarget?: { row: { id: string; name: string } }
  availableVariables: Array<{ name: string }>
  checkNameExists: (name: string, excludeId: string) => boolean
  validateExpressionCycle: (params: CycleParams) => string | null
}

const { createModalProps } = vi.hoisted(() => ({ createModalProps: vi.fn() }))

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/variable-create-modal', () => ({
  VariableCreateModal: (props: WindowProps) => {
    createModalProps(props)
    return <div data-testid="variable-create-modal" />
  },
}))

import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import type { Variable, VariableManagerContentProps } from '@/features/workbench/common/variables/variable-manager-content/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type DrillPath = Array<{ nodeId: string; label: string }>
const PATH_A: DrillPath = [{ nodeId: 'fn-a', label: 'Function_A' }]
const PATH_B: DrillPath = [{ nodeId: 'fn-b', label: 'Function_B' }]
const PARAMS: CycleParams = { variableName: 'total', value: 'total + 1', isExpression: true }

function localFunction(id: string) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
    },
  }
}

function drillTo(path: DrillPath) {
  act(() => {
    useWorkflowStore.setState({ nodes: [localFunction('fn-a'), localFunction('fn-b')] as never, drillPath: path })
  })
}

function functionScope(scopeId: string): VariableManagerContentProps['scope'] {
  return { insideFunction: true, scopeId, declaredInputNames: [], declaredOutputNames: [], allowedVarNames: new Set() }
}

/** The cycle check the last-rendered creation window holds. */
function windowCycleCheck(): (params: CycleParams) => string | null {
  const calls = createModalProps.mock.calls
  return (calls[calls.length - 1][0] as { validateExpressionCycle: (params: CycleParams) => string | null })
    .validateExpressionCycle
}

function renderPanel(validateExpressionCycle: VariableManagerContentProps['validateExpressionCycle'], scopeId?: string) {
  const props: VariableManagerContentProps = {
    variables: [],
    runtimeValues: new Map(),
    isExecuting: false,
    onCreateVariable: vi.fn(() => ({ success: true })),
    validateExpressionCycle,
    ...(scopeId === undefined ? {} : { scope: functionScope(scopeId) }),
  }
  return render(<VariableManagerContent {...props} />)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    useWorkflowStore.setState({ nodes: [] as never, drillPath: [], namespaceVariables: NO_NAMESPACES })
  })
})

describe('VariableManagerContent - a creation window checks its own scope (VMGR-102)', () => {
  it('passes the check of a window opened at the Test root on unchanged while the root is shown', async () => {
    const user = userEvent.setup()
    const validate = vi.fn(() => null)
    renderPanel(validate)

    await user.click(screen.getByTestId('add-variable-button'))
    windowCycleCheck()(PARAMS)

    expect(validate).toHaveBeenCalledWith(PARAMS)
  })

  it('checks a window opened at the Test root against the root after the author drills in', async () => {
    const user = userEvent.setup()
    const validate = vi.fn(() => null)
    const { rerender } = renderPanel(validate)
    await user.click(screen.getByTestId('add-variable-button'))

    drillTo(PATH_A)
    rerender(
      <VariableManagerContent
        variables={[]}
        runtimeValues={new Map()}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        validateExpressionCycle={validate}
        scope={functionScope('fn-a')}
      />,
    )
    windowCycleCheck()(PARAMS)

    expect(validate).toHaveBeenCalledWith({ ...PARAMS, functionPath: [] })
  })

  it('checks a window opened in a Function against that Function after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const validate = vi.fn(() => "Circular reference detected for variable 'total': total -> total")
    drillTo(PATH_A)
    renderPanel(validate, 'fn-a')
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Variable/i }))

    drillTo(PATH_B)
    const message = windowCycleCheck()(PARAMS)

    expect(validate).toHaveBeenCalledWith({ ...PARAMS, functionPath: PATH_A })
    expect(message).toBe("Circular reference detected for variable 'total': total -> total")
  })
})

// ===========================================================================
// The name check and autocomplete of a window read its own scope
// ===========================================================================

const ADD_WINDOW_ID = '__create__'
const ROOT_VARIABLES = [{ id: 'root-1', name: 'root_var', type: 'string', value: 'r' }]

function scopedFunction(id: string, body: { inputs?: unknown[]; outputs?: unknown[]; variables?: unknown[] }) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        workflow: { nodes: [], edges: [] },
        inputs: body.inputs ?? [],
        outputs: body.outputs ?? [],
        variables: body.variables ?? [],
      },
    },
  }
}

const SCOPED_NODES = [
  scopedFunction('fn-a', {
    inputs: [{ name: 'region', type: 'string' }],
    outputs: [{ name: 'result', type: 'string' }],
    variables: [{ id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 }],
  }),
  scopedFunction('fn-b', { variables: [{ id: 'loc-b', name: 'only_b', type: 'string', value: 'b' }] }),
]

// A root Block binding a profile, and the namespace entries the Test can address.
const PROFILE_NODE = {
  id: 'http-1',
  type: 'workflowNode',
  position: { x: 0, y: 0 },
  data: {
    label: 'Call API',
    config: { profileBindings: [{ alias: 'db', profileName: 'staging', fields: [{ name: 'host' }] }] },
  },
}
const NAMESPACES = {
  system: [{ name: 'env', type: 'string' }],
  suite: [{ name: 'owner', type: 'string' }],
  regression: [{ name: 'build', type: 'integer' }],
}
const NO_NAMESPACES = { system: [], suite: [], regression: [] }

type Shown = 'root' | 'a' | 'b'

/** What the panel is handed while each scope is shown, as the live container builds it. */
const SHOWN: Record<Shown, {
  path: DrillPath
  rows: Variable[]
  scope?: VariableManagerContentProps['scope']
  available: Array<{ name: string; type: string }>
}> = {
  root: {
    path: [],
    rows: [{ id: 'root-1', name: 'root_var', type: 'string', value: 'r' }],
    available: [{ name: 'root_var', type: 'string' }, { name: 'system.env', type: 'string' }],
  },
  a: {
    path: PATH_A,
    rows: [
      { id: 'param:input:region', name: 'region', type: 'string', value: null },
      { id: 'param:output:result', name: 'result', type: 'string', value: null },
      { id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 },
    ],
    scope: {
      insideFunction: true,
      scopeId: 'fn-a',
      declaredInputNames: ['region'],
      declaredOutputNames: ['result'],
      allowedVarNames: new Set(['region', 'result', 'loc_n']),
    },
    available: [
      { name: 'region', type: 'string' },
      { name: 'result', type: 'string' },
      { name: 'loc_n', type: 'integer' },
    ],
  },
  b: {
    path: PATH_B,
    rows: [{ id: 'loc-b', name: 'only_b', type: 'string', value: 'b' }],
    scope: {
      insideFunction: true,
      scopeId: 'fn-b',
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(['only_b']),
    },
    available: [{ name: 'only_b', type: 'string' }],
  },
}

const onCreate = vi.fn(() => ({ success: true }))
const onEdit = vi.fn()

/** Points the canvas at a scope and returns the panel props the container gives for it. */
function showScope(shown: Shown): VariableManagerContentProps {
  act(() => {
    useWorkflowStore.setState({
      nodes: SCOPED_NODES as never,
      variables: ROOT_VARIABLES as never,
      drillPath: SHOWN[shown].path,
    })
  })
  return {
    variables: SHOWN[shown].rows,
    runtimeValues: new Map(),
    isExecuting: false,
    onCreateVariable: onCreate,
    onVariableEdit: onEdit,
    availableVariables: SHOWN[shown].available,
    ...(SHOWN[shown].scope === undefined ? {} : { scope: SHOWN[shown].scope }),
  }
}

/** The props the last-rendered window holds. */
function lastWindow(): WindowProps {
  const call = createModalProps.mock.calls.at(-1)
  if (!call) throw new Error('No variable window was rendered')
  return call[0] as WindowProps
}

async function addInput(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
  await user.click(screen.getByRole('menuitem', { name: /Input parameter/i }))
}

const offeredNames = () => lastWindow().availableVariables.map((entry) => entry.name)

describe('VariableManagerContent - a window checks a name against its own scope (VMGR-102)', () => {
  it('refuses in an input window the name of a local of its Function after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('a')} />)
    await addInput(user)

    rerender(<VariableManagerContent {...showScope('b')} />)

    expect(lastWindow().checkNameExists('loc_n', ADD_WINDOW_ID)).toBe(true)
  })

  it.each(['region', 'result'])(
    'refuses in an input window the name %s its Function already uses after the author drills elsewhere',
    async (name) => {
      const user = userEvent.setup()
      const { rerender } = render(<VariableManagerContent {...showScope('a')} />)
      await addInput(user)

      rerender(<VariableManagerContent {...showScope('b')} />)

      expect(lastWindow().checkNameExists(name, ADD_WINDOW_ID)).toBe(true)
    },
  )

  it('accepts in an input window a name free in its Function though the shown Function uses it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('a')} />)
    await addInput(user)

    rerender(<VariableManagerContent {...showScope('b')} />)

    expect(lastWindow().checkNameExists('only_b', ADD_WINDOW_ID)).toBe(false)
  })

  it('refuses in a Test-root window a Test variable name after the author drills into a Function', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('root')} />)
    await user.click(screen.getByTestId('add-variable-button'))

    rerender(<VariableManagerContent {...showScope('a')} />)

    expect(lastWindow().checkNameExists('root_var', ADD_WINDOW_ID)).toBe(true)
  })

  it('accepts in a Test-root window a name only the shown Function uses', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('root')} />)
    await user.click(screen.getByTestId('add-variable-button'))

    rerender(<VariableManagerContent {...showScope('a')} />)

    expect(lastWindow().checkNameExists('loc_n', ADD_WINDOW_ID)).toBe(false)
  })

  it('checks a window against its own Function while that Function is shown', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...showScope('a')} />)
    await addInput(user)

    expect(lastWindow().checkNameExists('loc_n', ADD_WINDOW_ID)).toBe(true)
    expect(lastWindow().checkNameExists('root_var', ADD_WINDOW_ID)).toBe(false)
  })

  it('accepts the saved name in an Edit window and refuses another name of its Function', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...showScope('a')} />)

    await user.click(screen.getByTestId('edit-button-loc-a'))

    expect(screen.getByTestId('variable-create-modal')).toBeInTheDocument()
    expect(lastWindow().editTarget?.row.id).toBe('loc-a')
    expect(lastWindow().checkNameExists('loc_n', 'loc-a')).toBe(false)
    expect(lastWindow().checkNameExists('region', 'loc-a')).toBe(true)
  })
})

describe('VariableManagerContent - a window autocompletes its own scope (VMGR-102)', () => {
  it('offers a window whose own scope is shown the panel autocomplete list', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...showScope('root')} />)

    await user.click(screen.getByTestId('add-variable-button'))

    expect(lastWindow().availableVariables).toEqual(SHOWN.root.available)
  })

  it('offers an input window the names of its own Function after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('a')} />)
    await addInput(user)

    rerender(<VariableManagerContent {...showScope('b')} />)

    expect(offeredNames()).toEqual(expect.arrayContaining(['region', 'result', 'loc_n']))
    expect(offeredNames()).not.toContain('only_b')
  })

  it('offers a Test-root window the system, suite, regression and profile entries after the author drills into a Function', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('root')} />)
    await user.click(screen.getByTestId('add-variable-button'))

    const drilled = showScope('a')
    act(() => {
      useWorkflowStore.setState({ nodes: [...SCOPED_NODES, PROFILE_NODE] as never, namespaceVariables: NAMESPACES })
    })
    rerender(<VariableManagerContent {...drilled} />)

    expect(offeredNames()).toEqual(
      expect.arrayContaining([
        'root_var',
        'system',
        'system.env',
        'suite',
        'suite.owner',
        'regression',
        'regression.build',
        'db',
        'db.host',
      ]),
    )
    expect(offeredNames()).not.toContain('loc_n')
  })

  it('offers an input window none of the Test-level entries after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('a')} />)
    await addInput(user)

    const drilled = showScope('b')
    act(() => {
      useWorkflowStore.setState({ nodes: [...SCOPED_NODES, PROFILE_NODE] as never, namespaceVariables: NAMESPACES })
    })
    rerender(<VariableManagerContent {...drilled} />)

    expect(offeredNames()).toEqual(['region', 'result', 'loc_n'])
  })

  it('offers a Test-root window the Test variables after the author drills into a Function', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('root')} />)
    await user.click(screen.getByTestId('add-variable-button'))

    rerender(<VariableManagerContent {...showScope('a')} />)

    expect(offeredNames()).toContain('root_var')
    expect(offeredNames()).not.toContain('loc_n')
  })
})

describe('VariableManagerContent - a watcher belongs to its scope, not to a name', () => {
  it('keeps a Test variable watcher and opens a second one for a same-named Function local', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<VariableManagerContent {...showScope('root')} />)
    await user.click(screen.getByTestId('expand-button-root-1'))
    expect(screen.getByTestId('variable-inspect-modal-root-1')).toBeInTheDocument()

    const drilled = showScope('a')
    const sameName: Variable = { id: 'loc-rv', name: 'root_var', type: 'string', value: 'l' }
    const props = {
      ...drilled,
      variables: [...drilled.variables, sameName],
      scope: { ...drilled.scope!, allowedVarNames: new Set(['region', 'result', 'loc_n', 'root_var']) },
    }
    rerender(<VariableManagerContent {...props} />)

    expect(screen.getByTestId('variable-inspect-modal-root-1')).toBeInTheDocument()
    expect(screen.queryByTestId('variable-inspect-modal-loc-rv')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('expand-button-loc-rv'))
    expect(screen.getByTestId('variable-inspect-modal-loc-rv')).toBeInTheDocument()
    expect(screen.getByTestId('variable-inspect-modal-root-1')).toBeInTheDocument()
  })
})
