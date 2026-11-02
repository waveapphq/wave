/**
 * useTestRun.handleAdHocRun - REQ-3.2.1.5.
 *
 * Right-click Run/Debug Current and Run/Debug from Here go through the
 * same dirty-state guardrails as the action-bar Run/Debug buttons:
 *   - Test must be saved (editingTestId required)
 *   - Environment must be selected
 *   - A dirty canvas runs its in-memory body directly (no run-confirm modal)
 *   - Pre-run validation gate runs before startDebugRun
 *
 * Run variants force breakpoints empty + pause flags off;
 * Debug variants honor the user's current breakpoint set + debug options.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestRun, type UseTestRunParams } from '@/features/workbench/live/use-test-run'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import type { SavedBlockFields } from '@/features/workbench/lib/saved-block-fields'

vi.mock('@/features/workbench/stores/workflow-store')
vi.mock('@/components/ui/toast', () => ({
  useToast: () => mockToast,
}))

vi.mock('@/features/tests/api/crud', () => ({
  fetchTestWorkflow: vi.fn(),
  updateTest: vi.fn(),
}))
vi.mock('@/features/tests/api/validation', () => ({
  validateTest: vi.fn(),
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  toast: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  toasts: [],
  maxToasts: 5,
}

type StoreState = ReturnType<typeof defaultStoreState>

function defaultStoreState(overrides: Record<string, unknown> = {}) {
  return {
    isDirty: false,
    nodes: [],
    edges: [],
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    markSaved: vi.fn(),
    setPulseValidationNodeIds: vi.fn(),
    editingTestId: 'test-1',
    editingTestName: 'My Test',
    variables: [],
    skippedNodeIds: [] as string[],
    breakpoints: new Set<string>(),
    debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
    pausedNodeId: null,
    getBreakpointList: vi.fn(() => [] as string[]),
    nodeIssues: new Map(),
    ...overrides,
  }
}

function setupStore(overrides: Record<string, unknown> = {}) {
  const state = defaultStoreState(overrides)
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: StoreState) => unknown)(state)
  })
  ;(useWorkflowStore as unknown as { getState: () => StoreState }).getState = () => state
  ;(useWorkflowStore as unknown as { subscribe: (...args: unknown[]) => () => void }).subscribe = () => vi.fn()
  return state
}

function makeParams(overrides: Partial<UseTestRunParams> = {}): UseTestRunParams {
  return {
    selectedEnvironment: 'env-1',
    startRun: vi.fn().mockResolvedValue(undefined),
    startDebugRun: vi.fn().mockResolvedValue(undefined),
    runStandaloneFunction: vi.fn().mockResolvedValue(undefined),
    stopWorkbenchRun: vi.fn().mockResolvedValue(undefined),
    updateWorkbenchSkippedNodes: vi.fn().mockResolvedValue(undefined),
    workbenchStatus: 'idle',
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn(),
    setShowValidationErrorDialog: vi.fn(),
    ...overrides,
  } as UseTestRunParams
}

async function mockValidationPasses() {
  const { validateTest } = await import('@/features/tests/api/validation')
  vi.mocked(validateTest).mockResolvedValue({
    errors: [],
    warnings: [],
    fatal: false,
  } as Awaited<ReturnType<typeof validateTest>>)
}

// The "Test not found" dialog is raised through the shared store, not a prop.
const deletedTestRaise = vi.fn()

describe('useTestRun.handleAdHocRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes a handleAdHocRun function', () => {
    setupStore()
    const { result } = renderHook(() => useTestRun(makeParams()))
    expect(typeof result.current.handleAdHocRun).toBe('function')
  })

  it('offers ad-hoc runs for a saved Test the page holds', () => {
    setupStore()
    const { result } = renderHook(() => useTestRun(makeParams()))
    expect(result.current.adHocOffered).toBe(true)
  })

  it('offers no ad-hoc runs while the page mirrors another holder', () => {
    setupStore()
    const { result } = renderHook(() => useTestRun(makeParams({ isMirroring: true })))
    expect(result.current.adHocOffered).toBe(false)
  })

  it('offers no ad-hoc runs without a saved Test (the library View)', () => {
    setupStore({ editingTestId: null })
    const { result } = renderHook(() => useTestRun(makeParams()))
    expect(result.current.adHocOffered).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Guardrails (mirror handleRun / handleDebug)
  // ---------------------------------------------------------------------------

  it('toasts a Cannot Run Draft warning when no editingTestId is set', async () => {
    setupStore({ editingTestId: null })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9')
    })

    expect(mockToast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/save the test/i),
      expect.stringMatching(/cannot run draft/i),
    )
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  it('toasts a No Environment Selected warning when no env is set', async () => {
    setupStore()
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ selectedEnvironment: null, startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('debug-current', 'node-9')
    })

    expect(mockToast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/select an environment/i),
      expect.stringMatching(/no environment selected/i),
    )
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Direct-dispatch path (clean canvas)
  // ---------------------------------------------------------------------------

  it('Run Current dispatches startDebugRun with singleNodeId, empty breakpoints, pause flags off', async () => {
    await mockValidationPasses()
    setupStore({
      isDirty: false,
      breakpoints: new Set(['bp-existing']),
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: true },
      getBreakpointList: vi.fn(() => ['bp-existing']),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      environmentId: 'env-1',
      breakpoints: [],
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
      skippedNodeIds: undefined,
      singleNodeId: 'node-9',
    })
  })

  it('Run from Here dispatches with startNodeId, empty breakpoints, pause flags off', async () => {
    await mockValidationPasses()
    setupStore({ isDirty: false })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-from-here', 'node-3')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        startNodeId: 'node-3',
        breakpoints: [],
        debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
      }),
    )
  })

  it('Debug Current dispatches with singleNodeId + current breakpoints + current debug options', async () => {
    await mockValidationPasses()
    setupStore({
      isDirty: false,
      breakpoints: new Set(['bp-a', 'bp-b']),
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
      getBreakpointList: vi.fn(() => ['bp-a', 'bp-b']),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('debug-current', 'node-9')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        singleNodeId: 'node-9',
        breakpoints: ['bp-a', 'bp-b'],
        debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
      }),
    )
  })

  it('Debug from Here dispatches with startNodeId + current breakpoints + current debug options', async () => {
    await mockValidationPasses()
    setupStore({
      isDirty: false,
      breakpoints: new Set(['bp-x']),
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: true },
      getBreakpointList: vi.fn(() => ['bp-x']),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('debug-from-here', 'node-3')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        startNodeId: 'node-3',
        breakpoints: ['bp-x'],
        debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: true },
      }),
    )
  })

  it('Run Current on a Block in an opened Function body names the Block by its Function path', async () => {
    await mockValidationPasses()
    setupStore({
      drillPath: [
        { nodeId: 'outer-fn', label: 'Outer' },
        { nodeId: 'inner-fn', label: 'Inner' },
      ],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'body-log')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      environmentId: 'env-1',
      breakpoints: [],
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
      skippedNodeIds: undefined,
      singleNodeId: 'body-log',
      functionPath: ['outer-fn', 'inner-fn'],
    })
  })

  it('Debug from Here on a Block in an opened Function body names the Block by its Function path', async () => {
    await mockValidationPasses()
    setupStore({ drillPath: [{ nodeId: 'top-fn', label: 'Top' }] })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('debug-from-here', 'body-start')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ startNodeId: 'body-start', functionPath: ['top-fn'] }),
    )
  })

  it('forwards skippedNodeIds from the store when present', async () => {
    await mockValidationPasses()
    setupStore({ isDirty: false, skippedNodeIds: ['node-skip'] })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ skippedNodeIds: ['node-skip'] }),
    )
  })

  it('blocks the run when pre-run validation reports errors', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [
        { message: 'broken', node_id: 'node-9', path: 'node-9.config', code: 'X' },
      ],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({ isDirty: false })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const setShowValidationErrorDialog = vi.fn()
    const params = makeParams({ startDebugRun, setShowValidationErrorDialog })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9')
    })

    expect(setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  it('opens the deleted-test dialog instead of the generic toast when the test is gone', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockRejectedValue(
      Object.assign(new Error("Test with ID 'test-1' not found"), {
        status: 404,
        code: 'NOT_FOUND',
      }),
    )

    setupStore({ isDirty: false })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('debug-from-here', 'node-9')
    })

    expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      testName: 'My Test',
    })
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Dirty canvas: run-current (no run-confirm modal)
  // ---------------------------------------------------------------------------

  it('Run Current on a dirty canvas dispatches the in-memory body directly (no modal)', async () => {
    await mockValidationPasses()
    setupStore({ isDirty: true })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        singleNodeId: 'node-9',
        workflow: expect.objectContaining({ nodes: expect.any(Array) }),
      }),
    )
  })

  // ---------------------------------------------------------------------------
  // Run from the block editor (PYRUN-21): Run Current with the editor's draft
  // ---------------------------------------------------------------------------

  function pythonNode(id: string, values: Record<string, unknown>) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Python',
        elementType: 'python',
        nodeType: 'plugin',
        config: { values, outputBindings: {} },
      },
    }
  }

  const DRAFT_VALUES = { script: 'print("draft")', script_type: 'source' }
  const DRAFT_DATA = {
    description: undefined,
    version: '1.0.0',
    expressionFields: [],
    templateFields: [],
    variableExpressionKeys: undefined,
    variableTemplateKeys: undefined,
    variableTypes: undefined,
  }
  const DRAFT_CONFIG = {
    outputBindings: {},
    profileBindings: [],
    variableSecretKeys: undefined,
    outputSecretFields: [],
    unmasked_secret_fields: [],
    secret_masking: 'system' as const,
  }

  /** The block as its config sheet would save it, with these values. */
  function blockDraft(values: Record<string, unknown>): SavedBlockFields {
    return { data: DRAFT_DATA, config: { ...DRAFT_CONFIG, values } }
  }

  /** A python block as a run of its unsaved config carries it. */
  function draftedPythonNode(id: string, values: Record<string, unknown>) {
    const node = pythonNode(id, values)
    return { ...node, data: { ...node.data, ...DRAFT_DATA, config: { ...DRAFT_CONFIG, values } } }
  }

  it('runs in the Environment the caller names instead of the action bar selection', async () => {
    await mockValidationPasses()
    setupStore()
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useTestRun(makeParams({ selectedEnvironment: null, startDebugRun })),
    )

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9', { environmentId: 'env-2' })
    })

    expect(mockToast.warning).not.toHaveBeenCalled()
    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environmentId: 'env-2', singleNodeId: 'node-9' }),
    )
  })

  it('still asks for an Environment when the caller names an empty one', async () => {
    setupStore()
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useTestRun(makeParams({ selectedEnvironment: null, startDebugRun })),
    )

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'node-9', { environmentId: '' })
    })

    expect(mockToast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/select an environment/i),
      expect.stringMatching(/no environment selected/i),
    )
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  it('runs only the block, with its unsaved config, on a clean canvas', async () => {
    await mockValidationPasses()
    const logNode = {
      id: 'log-1',
      type: 'workflowNode',
      position: { x: 0, y: 100 },
      data: { label: 'Log', elementType: 'log', config: { values: { message: 'hi' } } },
    }
    setupStore({
      isDirty: false,
      nodes: [pythonNode('py-1', { script: 'print("saved")', script_type: 'file', timeout: 5 }), logNode],
      breakpoints: new Set(['py-1']),
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: true },
      getBreakpointList: vi.fn(() => ['py-1']),
      drillPath: [],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'py-1', {
        environmentId: 'env-1',
        blockDraft: blockDraft({ script: 'print("draft")', script_type: 'source', timeout: 5 }),
      })
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      environmentId: 'env-1',
      breakpoints: [],
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
      skippedNodeIds: undefined,
      singleNodeId: 'py-1',
      blockDraft: true,
      workflow: {
        nodes: [
          draftedPythonNode('py-1', { script: 'print("draft")', script_type: 'source', timeout: 5 }),
          logNode,
        ],
        edges: [],
      },
      variables: {},
    })
  })

  it("sends the block's unsaved config to the check, the same body the run then starts with", async () => {
    await mockValidationPasses()
    setupStore({
      nodes: [pythonNode('py-1', { script: 'print("saved")', script_type: 'source' })],
      drillPath: [],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'py-1', {
        environmentId: 'env-1',
        blockDraft: blockDraft(DRAFT_VALUES),
      })
    })

    const { validateTest } = await import('@/features/tests/api/validation')
    const started = startDebugRun.mock.calls[0][0]
    expect(started.workflow.nodes).toEqual([draftedPythonNode('py-1', DRAFT_VALUES)])
    expect(validateTest).toHaveBeenCalledWith('test-1', 'run', {
      workflow: started.workflow,
      variables: started.variables,
    })
  })

  it('leaves the canvas block untouched by a draft run', async () => {
    await mockValidationPasses()
    const state = setupStore({
      nodes: [pythonNode('py-1', { script: 'print("saved")', script_type: 'source' })],
      drillPath: [],
    })
    const { result } = renderHook(() => useTestRun(makeParams()))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'py-1', {
        environmentId: 'env-1',
        blockDraft: blockDraft(DRAFT_VALUES),
      })
    })

    expect(state.nodes).toEqual([
      pythonNode('py-1', { script: 'print("saved")', script_type: 'source' }),
    ])
  })

  it('gives a block that was never configured its unsaved config', async () => {
    await mockValidationPasses()
    const freshNode = {
      id: 'py-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { label: 'Python', elementType: 'python', nodeType: 'plugin' },
    }
    setupStore({ nodes: [freshNode], drillPath: [] })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'py-1', {
        environmentId: 'env-1',
        blockDraft: blockDraft(DRAFT_VALUES),
      })
    })

    expect(startDebugRun.mock.calls[0][0].workflow.nodes).toEqual([
      {
        ...freshNode,
        data: { ...freshNode.data, ...DRAFT_DATA, config: { ...DRAFT_CONFIG, values: DRAFT_VALUES } },
      },
    ])
  })

  it('replaces the block config inside the opened Function body the block sits in', async () => {
    await mockValidationPasses()
    const functionNode = {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Fn',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          workflow: { nodes: [pythonNode('py-1', { script: 'print("saved")' })], edges: [] },
          inputs: [],
          outputs: [],
        },
      },
    }
    setupStore({ nodes: [functionNode], drillPath: [{ nodeId: 'fn-1', label: 'Fn' }] })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'py-1', {
        environmentId: 'env-1',
        blockDraft: blockDraft(DRAFT_VALUES),
      })
    })

    const params = startDebugRun.mock.calls[0][0]
    expect(params).toEqual(
      expect.objectContaining({ singleNodeId: 'py-1', functionPath: ['fn-1'] }),
    )
    expect(params.workflow.nodes[0].data.localDefinition.workflow.nodes).toEqual([
      draftedPythonNode('py-1', DRAFT_VALUES),
    ])
  })

  describe("the editor's Run gate (PYRUN-21)", () => {
    const SAVED_SCRIPT_EMPTY = {
      path: 'nodes[0].data.config.values.script',
      node_id: 'py-1',
      code: 'REQUIRED_PARAM_EMPTY',
      message: "Required parameter 'script' is empty",
    }
    const OTHER_BLOCK_EMPTY = {
      path: 'nodes[1].data.config.values.message',
      node_id: 'log-1',
      code: 'REQUIRED_PARAM_EMPTY',
      message: "Required parameter 'message' is empty",
    }
    const OWN_TIMEOUT_INVALID = {
      path: 'nodes[0].data.config.values.timeout',
      node_id: 'py-1',
      code: 'INVALID_PARAM',
      message: 'Timeout must be a positive number',
    }

    function variableFinding(path: string) {
      return { path, code: 'INVALID_VARIABLE_TYPE', message: `Invalid variable type at ${path}` }
    }

    function shown(finding: Record<string, unknown>) {
      return { ...finding, severity: 'error', functionPath: undefined }
    }

    const LOG_NODE = {
      id: 'log-1',
      type: 'workflowNode',
      position: { x: 0, y: 100 },
      data: { label: 'Log', elementType: 'log', config: { values: { message: '' } } },
    }

    const READING_VALUES = {
      script: '',
      input_vars: { threshold: 'limit * 2' },
      arguments: [{ value: 'count' }],
      working_dir: '/data/{{ run_dir }}',
      retries: null,
      timeout: 5,
    }

    function readingBlock() {
      const node = pythonNode('py-1', READING_VALUES)
      return {
        ...node,
        data: {
          ...node.data,
          expressionFields: [
            'input_vars.threshold',
            'arguments.0.value',
            'arguments.7.value',
            'input_vars.absent',
            'retries.count',
            'timeout',
          ],
          templateFields: ['working_dir'],
          config: { ...node.data.config, outputBindings: { stdout: 'captured' } },
        },
      }
    }

    async function validationReturns(result: {
      errors?: Record<string, unknown>[]
      warnings?: Record<string, unknown>[]
      fatal?: boolean
    }) {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({
        errors: [],
        warnings: [],
        fatal: false,
        ...result,
      } as unknown as Awaited<ReturnType<typeof validateTest>>)
    }

    async function runFromEditor(
      params: UseTestRunParams,
      values: Record<string, unknown> = { ...READING_VALUES, ...DRAFT_VALUES },
    ) {
      const { result } = renderHook(() => useTestRun(params))
      await act(async () => {
        await result.current.handleAdHocRun('run-current', 'py-1', {
          environmentId: 'env-1',
          blockDraft: blockDraft(values),
        })
      })
    }

    function canvasWithReadingBlock(overrides: Record<string, unknown> = {}) {
      return setupStore({ nodes: [readingBlock(), LOG_NODE], drillPath: [], ...overrides })
    }

    it('runs past a finding on the saved script the draft replaces', async () => {
      await validationReturns({ errors: [SAVED_SCRIPT_EMPTY] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ singleNodeId: 'py-1', blockDraft: true }),
      )
    })

    it('runs past a finding on another block', async () => {
      await validationReturns({ errors: [OTHER_BLOCK_EMPTY] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('is refused for a finding on another parameter of this block, showing only that finding', async () => {
      await validationReturns({ errors: [SAVED_SCRIPT_EMPTY, OWN_TIMEOUT_INVALID, OTHER_BLOCK_EMPTY] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([shown(OWN_TIMEOUT_INVALID)])
      expect(params.setValidationFatal).toHaveBeenCalledExactlyOnceWith(false)
      expect(params.setValidationMode).toHaveBeenCalledExactlyOnceWith('run')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledExactlyOnceWith(true)
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })

    it('runs past a finding on another parameter of this block the unsaved config changed', async () => {
      await validationReturns({ errors: [OWN_TIMEOUT_INVALID] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params, { ...READING_VALUES, ...DRAFT_VALUES, timeout: 10 })

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('runs past a finding on a parameter the unsaved config removed', async () => {
      await validationReturns({ errors: [OWN_TIMEOUT_INVALID] })
      canvasWithReadingBlock()
      const params = makeParams()
      const { timeout: _removed, ...withoutTimeout } = READING_VALUES

      await runFromEditor(params, { ...withoutTimeout, ...DRAFT_VALUES })

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('is refused for a finding on this block that names no parameter', async () => {
      const bodyFinding = { node_id: 'py-1', code: 'REQUIRED_PARAM_MISSING', message: 'Missing' }
      await validationReturns({ errors: [bodyFinding] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([shown(bodyFinding)])
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })

    it('is refused when the test cannot be validated, showing every finding', async () => {
      const fatal = { path: 'workflow', code: 'CYCLE', message: 'The workflow has a cycle' }
      await validationReturns({ errors: [fatal, OTHER_BLOCK_EMPTY], fatal: true })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([
        shown(fatal),
        shown(OTHER_BLOCK_EMPTY),
      ])
      expect(params.setValidationFatal).toHaveBeenCalledExactlyOnceWith(true)
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })

    it.each([
      ['an expression of a map entry', 'variables.limit'],
      ['an expression of an array row', 'variables.count'],
      ['a template field', 'variables.run_dir.type'],
      ['an output binding', 'variables.captured'],
    ])('is refused for a finding on a variable this block names in %s', async (_where, path) => {
      const finding = variableFinding(path)
      await validationReturns({ errors: [finding, OTHER_BLOCK_EMPTY] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([shown(finding)])
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })

    it('runs past a finding on a variable this block never names', async () => {
      await validationReturns({ errors: [variableFinding('variables.unused')] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('runs past a variable finding when the block binds and names nothing', async () => {
      await validationReturns({ errors: [variableFinding('variables.limit')] })
      const bareBlock = {
        id: 'py-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Python', elementType: 'python', nodeType: 'plugin' },
      }
      setupStore({ nodes: [bareBlock], drillPath: [] })
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('runs past a variable finding when the block is not on the canvas', async () => {
      await validationReturns({ errors: [variableFinding('variables.limit')] })
      setupStore({ nodes: [LOG_NODE], drillPath: [] })
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('runs past the unsaved canvas findings on the replaced script and on other blocks', async () => {
      await validationReturns({})
      canvasWithReadingBlock({
        isDirty: true,
        nodeIssues: new Map([
          ['py-1', [{ code: 'REQUIRED_PARAM_EMPTY', paramName: 'script', message: 'Script is empty' }]],
          [
            'log-1',
            [
              { code: 'REQUIRED_PARAM_EMPTY', paramName: 'message', message: 'Message is empty' },
              { code: 'UNRESOLVED_VARIABLE_REFERENCE', paramName: 'message', message: "Variable 'ghost' is not defined" },
            ],
          ],
        ]),
      })
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
      expect(params.startDebugRun).toHaveBeenCalledOnce()
    })

    it('is refused for an undeclared variable this block reads on the canvas', async () => {
      await validationReturns({})
      canvasWithReadingBlock({
        nodeIssues: new Map([
          [
            'py-1',
            [{ code: 'UNRESOLVED_VARIABLE_REFERENCE', paramName: 'input_vars', message: "Variable 'ghost' is not defined" }],
          ],
        ]),
      })
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ node_id: 'py-1', path: 'variables.ghost', code: 'UNDECLARED_VARIABLE' }),
      ])
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })

    it('lists only the errors with a refusal, never a warning', async () => {
      const ownWarning = { path: 'nodes[0].data.config.values.timeout', node_id: 'py-1', code: 'W', message: 'Own' }
      const otherWarning = { path: 'nodes[1].data.config.values.message', node_id: 'log-1', code: 'W', message: 'Other' }
      await validationReturns({ errors: [OWN_TIMEOUT_INVALID], warnings: [otherWarning, ownWarning] })
      canvasWithReadingBlock()
      const params = makeParams()

      await runFromEditor(params)

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([shown(OWN_TIMEOUT_INVALID)])
    })

    it("leaves the canvas's Run Current refused for a finding on another block", async () => {
      await validationReturns({ errors: [OTHER_BLOCK_EMPTY] })
      canvasWithReadingBlock()
      const params = makeParams()
      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleAdHocRun('run-current', 'py-1')
      })

      expect(params.setValidationErrors).toHaveBeenCalledExactlyOnceWith([shown(OTHER_BLOCK_EMPTY)])
      expect(params.startDebugRun).not.toHaveBeenCalled()
    })
  })

  it('Debug from Here on a dirty canvas dispatches the in-memory body directly (no modal)', async () => {
    await mockValidationPasses()
    setupStore({ isDirty: true })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleAdHocRun('debug-from-here', 'node-3')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        startNodeId: 'node-3',
        workflow: expect.objectContaining({ nodes: expect.any(Array) }),
      }),
    )
  })
})
