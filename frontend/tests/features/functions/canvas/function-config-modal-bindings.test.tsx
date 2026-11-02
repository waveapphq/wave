/** A Shared Function Block's stored shape through the shared Block save, and its library chrome (CANVAS-207, REQ-3.1.1.5, REQ-3.1.2.1). */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

interface DoubleProps {
  mode: 'input' | 'output'
  parameters: Array<{ name: string; type: string }>
  values: Record<string, unknown>
  expressionFields?: string[]
  templateFields?: string[]
  onChange: (name: string, value: unknown) => void
  onExpressionFieldsChange?: (fields: string[]) => void
  onTemplateFieldsChange?: (fields: string[]) => void
  onElementTypesChange?: (name: string, types: unknown) => void
}

// The double writes as a row does: a value, a whole or dotted expression flag, a template flag, item types.
vi.mock('@/features/workbench/common/element-config/parameters/parameter-table', () => ({
  ParameterTableColumns: () => null,
  ParameterTable: ({
    mode,
    parameters,
    values,
    expressionFields = [],
    templateFields = [],
    onChange,
    onExpressionFieldsChange,
    onTemplateFieldsChange,
    onElementTypesChange,
  }: DoubleProps) =>
    mode === 'input' ? (
      <div data-testid="param-table-input">
        <span data-testid="input-rows">{parameters.map((p) => `${p.name}:${p.type}`).join(',')}</span>
        <span data-testid="input-values">{JSON.stringify(values)}</span>
        <button type="button" data-testid="n-set-number" onClick={() => onChange('n', 42)}>
          n number
        </button>
        <button
          type="button"
          data-testid="n-to-expression"
          onClick={() => onExpressionFieldsChange?.([...expressionFields, 'n'])}
        >
          n expression mode
        </button>
        <button type="button" data-testid="n-set-expression" onClick={() => onChange('n', 'count + 1')}>
          n expression
        </button>
        <button type="button" data-testid="n-set-spaces" onClick={() => onChange('n', '   ')}>
          n spaces
        </button>
        <button
          type="button"
          data-testid="greeting-to-template"
          onClick={() => onTemplateFieldsChange?.([...templateFields, 'greeting'])}
        >
          greeting template kind
        </button>
        <button type="button" data-testid="greeting-set-template" onClick={() => onChange('greeting', 'Hi {{ name }}')}>
          greeting template
        </button>
        <button
          type="button"
          data-testid="headers-set-entries"
          onClick={() => onChange('headers', { 'X-Id': 'user_id', Accept: 'json' })}
        >
          headers entries
        </button>
        <button
          type="button"
          data-testid="headers-entry-to-expression"
          onClick={() => onExpressionFieldsChange?.([...expressionFields, 'headers.X-Id'])}
        >
          headers entry expression
        </button>
        <button type="button" data-testid="ids-set-items" onClick={() => onChange('ids', [1, 2])}>
          ids items
        </button>
        <button
          type="button"
          data-testid="ids-set-item-types"
          onClick={() => onElementTypesChange?.('ids', ['integer', 'integer'])}
        >
          ids item types
        </button>
      </div>
    ) : (
      <div data-testid="param-table-output">
        <button type="button" data-testid="output-set" onClick={() => onChange('doubled', 'result_var')}>
          set
        </button>
        <button type="button" data-testid="output-clear" onClick={() => onChange('doubled', '')}>
          clear
        </button>
      </div>
    ),
}))

const useFunctionVersionsMock = vi.fn()
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (...args: unknown[]) => useFunctionVersionsMock(...args),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-bind-1'
const FUNCTION_ID = '00000000-0000-0000-0000-000000000001'
const INPUTS = [
  { name: 'n', type: 'integer', required: false, default: 5 },
  { name: 'm', type: 'string', required: false },
  { name: 'greeting', type: 'string', required: false },
  { name: 'headers', type: 'map', required: false },
  { name: 'ids', type: 'array', required: false },
]
const OUTPUTS = [{ name: 'doubled', type: 'integer' }]

const realSetFunctionLibraryOpen = useWorkflowStore.getState().setFunctionLibraryOpen
const setFunctionLibraryOpenMock = vi.fn()

interface BlockOptions {
  functionVersion?: string
  originalLibraryName?: string
  values?: Record<string, unknown>
  expressionFields?: string[]
  outputBindings?: Record<string, string>
}

function sharedBlock(options: BlockOptions = {}) {
  return {
    id: NODE_ID,
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'published_function',
      description: 'Library function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: FUNCTION_ID,
      ...('functionVersion' in options ? { functionVersion: options.functionVersion } : { functionVersion: '1.0.0' }),
      originalLibraryName: 'originalLibraryName' in options ? options.originalLibraryName : 'fetch_user',
      resolvedInputs: INPUTS,
      resolvedOutputs: OUTPUTS,
      ...(options.expressionFields === undefined ? {} : { expressionFields: options.expressionFields }),
      config: { values: options.values ?? {}, outputBindings: options.outputBindings ?? {} },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(node = sharedBlock()) {
  useWorkflowStore.setState({
    nodes: [node] as never,
    edges: [],
    variables: [],
    drillPath: [],
    openConfigNodeIds: [NODE_ID],
  })
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={NODE_ID} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

function storedData(): Record<string, unknown> {
  return useWorkflowStore.getState().nodes.find((node) => node.id === NODE_ID)?.data as Record<string, unknown>
}

function storedConfig(): Record<string, unknown> {
  return storedData().config as Record<string, unknown>
}

/** Clicks the double's buttons in order, then the window's Save. */
async function saveAfter(node: ReturnType<typeof sharedBlock>, ...testIds: string[]) {
  const user = userEvent.setup()
  openWindow(node)
  for (const testId of testIds) await user.click(screen.getByTestId(testId))
  await user.click(within(screen.getByTestId('element-config-sheet')).getByRole('button', { name: /^save$/i }))
  expect(useWorkflowStore.getState().openConfigNodeIds).toEqual([])
  return storedData()
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
  useWorkflowStore.setState({ setFunctionLibraryOpen: setFunctionLibraryOpenMock })
  useFunctionVersionsMock.mockReset()
  setFunctionLibraryOpenMock.mockReset()
  useFunctionVersionsMock.mockReturnValue({
    versions: [
      {
        version: '1.0.0',
        published_at: '2026-01-01',
        // A blank line among the changelog lines is dropped; each line is trimmed.
        changelog: 'First line\n\n  Second line  ',
        details: 'Some details',
        description: 'Desc',
        tags: [],
        inputs: INPUTS,
        outputs: OUTPUTS,
      },
    ],
    latest: '1.0.0',
    isLoading: false,
    failed: false,
    retry: () => {},
  })
})

afterEach(() => {
  // The window is still mounted here, so the store write goes through act.
  act(() => {
    useWorkflowStore.setState({ setFunctionLibraryOpen: realSetFunctionLibraryOpen })
  })
})

describe('Function Block window - rows from the Function definition (REQ-3.1.2.1)', () => {
  it('hands the input rows the field list of the pinned Function version', () => {
    openWindow()
    expect(screen.getByTestId('input-rows')).toHaveTextContent(
      /^n:integer,m:string,greeting:string,headers:map,ids:array$/,
    )
  })

  it('hands the input rows the values the Block holds in its config values', () => {
    openWindow(sharedBlock({ values: { n: 7 } }))
    expect(screen.getByTestId('input-values')).toHaveTextContent(/^\{"n":7\}$/)
  })
})

describe('Function Block window - the stored shape (REQ-3.1.1.5)', () => {
  it('stores a value given to an input in the config values, never in input bindings', async () => {
    const data = await saveAfter(sharedBlock(), 'n-set-number')
    expect(storedConfig().values).toEqual({ n: 42 })
    expect((data.expressionFields as string[] | undefined) ?? []).not.toContain('n')
    expect(data).not.toHaveProperty('inputBindings')
  })

  it('stores an expression with its whole-field expression flag', async () => {
    const data = await saveAfter(sharedBlock(), 'n-to-expression', 'n-set-expression')
    expect(storedConfig().values).toEqual({ n: 'count + 1' })
    expect(data.expressionFields).toEqual(['n'])
    expect(data).not.toHaveProperty('inputBindings')
  })

  it('stores a Template string input with its template flag (REQ-3.1.3.15)', async () => {
    const data = await saveAfter(sharedBlock(), 'greeting-to-template', 'greeting-set-template')
    expect(storedConfig().values).toEqual({ greeting: 'Hi {{ name }}' })
    expect(data.templateFields).toEqual(['greeting'])
  })

  it('stores a per-entry expression of a map input under its dotted name', async () => {
    const data = await saveAfter(sharedBlock(), 'headers-set-entries', 'headers-entry-to-expression')
    expect(storedConfig().values).toEqual({ headers: { 'X-Id': 'user_id', Accept: 'json' } })
    expect(data.expressionFields).toEqual(['headers.X-Id'])
  })

  it('stores the item types of a typed list input beside its value (REQ-3.1.3.19)', async () => {
    const data = await saveAfter(sharedBlock(), 'ids-set-items', 'ids-set-item-types')
    expect(storedConfig().values).toEqual({ ids: [1, 2] })
    expect(data.elementTypes).toEqual({ ids: ['integer', 'integer'] })
  })

  it('stores nothing for an input whose whole-field expression is left blank', async () => {
    const data = await saveAfter(sharedBlock({ values: { n: 5 } }), 'n-to-expression', 'n-set-spaces')
    expect(storedConfig().values).not.toHaveProperty('n')
    expect((data.expressionFields as string[] | undefined) ?? []).not.toContain('n')
  })

  it('keeps the other inputs when one expression is left blank', async () => {
    const data = await saveAfter(
      sharedBlock({ values: { n: 5, m: 'count + 1' }, expressionFields: ['m'] }),
      'n-to-expression',
      'n-set-spaces',
    )
    expect(storedConfig().values).toEqual({ m: 'count + 1' })
    expect(data.expressionFields).toEqual(['m'])
  })

  it('drops the key of an output binding that is cleared', async () => {
    await saveAfter(sharedBlock({ outputBindings: { doubled: 'result_var' } }), 'output-clear')
    expect(storedConfig().outputBindings).toEqual({})
  })

  it('stores an output binding that is set', async () => {
    await saveAfter(sharedBlock(), 'output-set')
    expect(storedConfig().outputBindings).toEqual({ doubled: 'result_var' })
  })
})

describe('Function Block window - changelog line splitting', () => {
  it('splits a multi-line changelog into trimmed, non-empty bullets', async () => {
    const user = userEvent.setup()
    openWindow()
    await user.click(screen.getByRole('button', { name: /changelog/i }))
    expect(screen.getByText('First line')).toBeInTheDocument()
    expect(screen.getByText('Second line')).toBeInTheDocument()
  })
})

describe('Function Block window - From library link opens the library', () => {
  it('opens the Functions Library seeded with the library name and keeps the window open', async () => {
    const user = userEvent.setup()
    openWindow(sharedBlock({ originalLibraryName: 'fetch_user' }))
    await user.click(screen.getByTestId('function-from-library-link'))
    expect(useWorkflowStore.getState().openConfigNodeIds).toEqual([NODE_ID])
    expect(setFunctionLibraryOpenMock).toHaveBeenCalledWith(true, 'fetch_user')
  })
})

describe('Function Block window - missing library entry (deleted Function)', () => {
  const NO_VERSIONS = { versions: [], latest: undefined, isLoading: false, failed: false, retry: () => {} }

  it('renders the missing-function banner without a library name when the Block keeps none', () => {
    useFunctionVersionsMock.mockReturnValue(NO_VERSIONS)
    openWindow(sharedBlock({ originalLibraryName: undefined }))
    const banner = screen.getByTestId('missing-function-banner')
    expect(banner).toHaveTextContent(
      /^Function is no longer available in the library\. Replace this instance or recreate the library entry\.$/,
    )
    expect(screen.getByTestId('version-dropdown-trigger')).toBeInTheDocument()
  })

  it('names the deleted library entry in the banner when the Block keeps its name', () => {
    useFunctionVersionsMock.mockReturnValue(NO_VERSIONS)
    openWindow(sharedBlock({ originalLibraryName: 'fetch_user' }))
    expect(screen.getByTestId('missing-function-banner')).toHaveTextContent(
      /^Function 'fetch_user' is no longer available in the library\. Replace this instance or recreate the library entry\.$/,
    )
  })

  it('does not claim the Function is gone when the version read failed', () => {
    useFunctionVersionsMock.mockReturnValue({ ...NO_VERSIONS, latest: '', failed: true })
    openWindow(sharedBlock({ originalLibraryName: 'fetch_user' }))
    expect(screen.queryByTestId('missing-function-banner')).toBeNull()
  })

  it('asks the version read to block the window, which owns no error state', () => {
    openWindow()
    expect(useFunctionVersionsMock).toHaveBeenCalledWith(FUNCTION_ID, null, true)
  })
})

describe('Function Block window - version pick with no pinned version', () => {
  it('does not pick a version while the library is still loading', () => {
    useFunctionVersionsMock.mockReturnValue({ versions: [], latest: '', isLoading: true, failed: false, retry: () => {} })
    openWindow(sharedBlock({ functionVersion: undefined }))
    expect(screen.queryByTestId('missing-function-banner')).toBeNull()
    expect(screen.queryByTestId('version-dropdown-trigger')).toBeNull()
  })

  it('picks the first fetched version when the library names no latest one', () => {
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '4.2.0', published_at: '2026-05-01', changelog: '', details: '', description: '', tags: [] }],
      latest: undefined,
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    openWindow(sharedBlock({ functionVersion: undefined }))
    expect(screen.getByRole('button', { name: /4\.2\.0/ })).toBeInTheDocument()
  })

  it('picks the first fetched version when the latest one is empty', () => {
    useFunctionVersionsMock.mockReturnValue({
      versions: [
        { version: '3.1.0', published_at: '2026-04-01', changelog: 'note', details: 'details', description: 'desc', tags: [] },
      ],
      latest: '',
      isLoading: false,
      failed: false,
      retry: () => {},
    })
    openWindow(sharedBlock({ functionVersion: undefined }))
    expect(screen.getByRole('button', { name: /3\.1\.0/ })).toBeInTheDocument()
  })
})
