/**
 * useTestRun.handleDebug - REQ-3.2.1.2, REQ-3.2.2.1
 *
 * Contract for the Debug flow in useTestRun:
 *   - ``handleRun`` never sends ``breakpoints`` or ``debug_options``
 *   - ``handleDebug`` always sends both from the workflow store
 *   - ``UseTestRunParams`` loses ``debugMode`` on ``startRun``
 *   - ``UseTestRunParams`` gains ``startDebugRun``
 *
 * Validation behavior mirrors ``handleRun``: if the pre-run validation
 * reports errors or is fatal the run is blocked and the validation error
 * dialog is opened. Environment / draft-test guardrails also mirror
 * ``handleRun`` so the user gets the same UX for Debug.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useTestRun,
  resolveViewRunBody,
  type UseTestRunParams,
} from '@/features/workbench/live/use-test-run'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers (mirrors use-test-run.test.ts patterns)
// ---------------------------------------------------------------------------

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
    drillPath: [] as Array<{ nodeId: string; label: string }>,
    // Debug state
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

/** The ApiError shape the client stamps a not-found response onto. */
function notFoundError(): Error & { status: number; code: string } {
  return Object.assign(new Error("Test with ID 'test-1' not found"), {
    status: 404,
    code: 'NOT_FOUND',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The "Test not found" dialog is raised through the shared store, not a prop.
const deletedTestRaise = vi.fn()

describe('useTestRun.handleDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes a handleDebug function', () => {
    setupStore()
    const params = makeParams()

    const { result } = renderHook(() => useTestRun(params))

    expect(typeof result.current.handleDebug).toBe('function')
  })

  it('calls startDebugRun with breakpoints + debugOptions on a clean canvas', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    const breakpoints = ['node-a', 'node-b']
    setupStore({
      breakpoints: new Set(breakpoints),
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
      getBreakpointList: vi.fn(() => breakpoints),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      environmentId: 'env-1',
      breakpoints,
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
      skippedNodeIds: undefined,
    })
  })

  it('forwards skippedNodeIds from the store when present', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      breakpoints: new Set(['node-1']),
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: true },
      getBreakpointList: vi.fn(() => ['node-1']),
      skippedNodeIds: ['node-skip'],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ skippedNodeIds: ['node-skip'] })
    )
  })

  it('accepts an environment override as the second argument', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      breakpoints: new Set([]),
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
      getBreakpointList: vi.fn(() => []),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ selectedEnvironment: null, startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current', 'env-override')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environmentId: 'env-override' })
    )
  })

  it('blocks the run when validation returns errors and opens the dialog', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [
        {
          path: 'nodes[0].config',
          code: 'MISSING_REQUIRED',
          node_id: 'node-bad',
          message: 'Missing required field',
          severity: 'error',
        },
      ],
      warnings: [],
      fatal: false,
    })

    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const setShowValidationErrorDialog = vi.fn()
    const setValidationErrors = vi.fn()
    const setValidationFatal = vi.fn()
    setupStore()
    const params = makeParams({
      startDebugRun,
      setShowValidationErrorDialog,
      setValidationErrors,
      setValidationFatal,
    })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).not.toHaveBeenCalled()
    expect(setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    expect(setValidationFatal).toHaveBeenCalledWith(false)
    expect(setValidationErrors).toHaveBeenCalled()
  })

  it('blocks the run and surfaces a toast when the validation API throws', async () => {
    // Production code logs a console.error on validation failure; silence
    // it here so CI's stderr-catch doesn't flag the deliberately-triggered
    // rejection as a test failure.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(new Error('backend down'))

      const startDebugRun = vi.fn().mockResolvedValue(undefined)
      setupStore()
      const params = makeParams({ startDebugRun })

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleDebug('current')
      })

      expect(startDebugRun).not.toHaveBeenCalled()
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to validate test before running.',
        'Validation Error',
      )
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('opens the deleted-test dialog instead of the generic toast when the test is gone', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockRejectedValue(notFoundError())

    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    setupStore()
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      testName: 'My Test',
    })
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  it('opens the deleted-test dialog for a scoped Function debug when the test is gone', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockRejectedValue(notFoundError())

    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    setupStore({ drillPath: [{ nodeId: 'fn-node-1', label: 'My Function' }] })
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
      testId: 'test-1',
      testName: 'My Test',
    })
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  it('warns and returns when the test is unsaved (no editingTestId)', async () => {
    setupStore({ editingTestId: null })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).not.toHaveBeenCalled()
    expect(mockToast.warning).toHaveBeenCalled()
  })

  it('warns and returns when no environment is selected and no override', async () => {
    setupStore()
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ selectedEnvironment: null, startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).not.toHaveBeenCalled()
    expect(mockToast.warning).toHaveBeenCalled()
  })

  it('dirty Debug dispatches startDebugRun with the in-memory body directly (no modal)', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      isDirty: true,
      breakpoints: new Set(['node-bp']),
      debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: true },
      getBreakpointList: vi.fn(() => ['node-bp']),
    })
    const startRun = vi.fn().mockResolvedValue(undefined)
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startRun, startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    // No run-confirm modal; the dirty body debugs directly via startDebugRun.
    expect(startRun).not.toHaveBeenCalled()
    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        testId: 'test-1',
        environmentId: 'env-1',
        breakpoints: ['node-bp'],
        debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: true },
        workflow: expect.objectContaining({ nodes: expect.any(Array) }),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // handleRun must NOT send debug payload fields
  // -------------------------------------------------------------------------

  it('handleRun calls startRun without any debug fields in the payload', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore()
    const startRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleRun('current')
    })

    expect(startRun).toHaveBeenCalledTimes(1)
    const payload = startRun.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('debugMode')
    expect(payload).not.toHaveProperty('breakpoints')
    expect(payload).not.toHaveProperty('debugOptions')
  })

  it('handleDebug surfaces FE-side UNDECLARED_VARIABLE before the dirty-Save prompt', async () => {
    // The dirty Save path would just round-trip through BE 422 with the
    // same error, so the FE short-circuits to the validation dialog.
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      isDirty: true,
      nodeIssues: new Map([
        [
          'log-1',
          [
            {
              code: 'UNRESOLVED_VARIABLE_REFERENCE',
              paramName: 'message',
              message: "Variable 'test1' is not defined",
            },
          ],
        ],
      ]),
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(params.setValidationErrors).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNDECLARED_VARIABLE',
          node_id: 'log-1',
        }),
      ])
    )
    expect(params.setValidationMode).toHaveBeenCalledWith('debug')
    expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    expect(startDebugRun).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scope-aware routing: drilled into a Function, Debug Scope routes through
  // startDebugRun with the scope payload (bypasses the dirty-Save prompt).
  // -------------------------------------------------------------------------

  it('routes Debug Scope through startDebugRun with scope payload when drilled into a Function', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      isDirty: true,
      breakpoints: new Set(['bp-1']),
      debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
      getBreakpointList: vi.fn(() => ['bp-1']),
      skippedNodeIds: ['skip-1'],
      drillPath: [{ nodeId: 'fn-node-1', label: 'My Function' }],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const params = makeParams({ startDebugRun })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        testId: 'test-1',
        environmentId: 'env-1',
        breakpoints: ['bp-1'],
        debugOptions: { pauseOnFirstBlock: true, pauseOnErrors: false },
        skippedNodeIds: ['skip-1'],
        scopeMode: 'function',
        scopedFunctionNodeId: 'fn-node-1',
        // A dirty scoped Debug also forwards the in-memory body.
        workflow: expect.objectContaining({ nodes: expect.any(Array) }),
      }),
    )
  })

  it('routes Debug Scope on a Function nested in another Function body with the path to it', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      warnings: [],
      fatal: false,
    } as Awaited<ReturnType<typeof validateTest>>)

    setupStore({
      drillPath: [
        { nodeId: 'outer-fn', label: 'Outer' },
        { nodeId: 'inner-fn', label: 'Inner' },
      ],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useTestRun(makeParams({ startDebugRun })))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        scopeMode: 'function',
        scopedFunctionNodeId: 'inner-fn',
        functionPath: ['outer-fn'],
      }),
    )
  })

  it('blocks the scoped Debug run when validation fails and never dispatches startDebugRun', async () => {
    const { validateTest } = await import('@/features/tests/api/validation')
    vi.mocked(validateTest).mockResolvedValue({
      errors: [
        {
          path: 'nodes[0].config',
          code: 'MISSING_REQUIRED',
          node_id: 'fn-node-1',
          message: 'Missing required field',
          severity: 'error',
        },
      ],
      warnings: [],
      fatal: false,
    })

    setupStore({
      drillPath: [{ nodeId: 'fn-node-1', label: 'My Function' }],
    })
    const startDebugRun = vi.fn().mockResolvedValue(undefined)
    const setShowValidationErrorDialog = vi.fn()
    const params = makeParams({ startDebugRun, setShowValidationErrorDialog })

    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('current')
    })

    expect(startDebugRun).not.toHaveBeenCalled()
    expect(setShowValidationErrorDialog).toHaveBeenCalledWith(true)
  })
})

// ---------------------------------------------------------------------------
// Library-View standalone debug (REQ-3.2.1.2)
// ---------------------------------------------------------------------------

describe('resolveViewRunBody', () => {
  const fvm = { functionId: 'fn-1', version: '1.2.0' }

  it('runs the pinned version when the root is not in edit mode', () => {
    const nodes = [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }]
    expect(resolveViewRunBody(fvm, [{ nodeId: 'view-shared-root' }], nodes)).toEqual({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
    })
  })

  it('runs the draft body with the version it was made from when the root is in edit mode', () => {
    const draft = { name: 'Greet', workflow: { nodes: [], edges: [] } }
    const nodes = [{ id: 'view-shared-root', data: { editMode: true, draft } }]
    expect(resolveViewRunBody(fvm, [{ nodeId: 'view-shared-root' }], nodes)).toEqual({
      functionId: 'fn-1',
      version: '1.2.0',
      draft,
    })
  })

  it('folds the live drilled localDefinition into the draft so the run executes unsaved View edits', () => {
    // Library View edits live in the transient localDefinition (drilled active
    // subtree); data.draft is stale until fold/save. The run must use the live body.
    const draft = { name: 'Greet', tags: ['a'], workflow: { nodes: [], edges: [] } }
    const localDefinition = {
      workflow: { nodes: [{ id: 'edited' }], edges: [] },
      inputs: [{ name: 'x' }],
      outputs: [],
    }
    const nodes = [{ id: 'view-shared-root', data: { editMode: true, draft, localDefinition } }]
    const result = resolveViewRunBody(fvm, [{ nodeId: 'view-shared-root' }], nodes)
    expect(result.version).toBe('1.2.0')
    expect((result.draft as { workflow: { nodes: unknown[] } }).workflow.nodes).toEqual([{ id: 'edited' }])
    expect((result.draft as { name: string }).name).toBe('Greet')
  })

  it('treats an edit-mode root with no draft as a version run', () => {
    const nodes = [{ id: 'view-shared-root', data: { editMode: true } }]
    expect(resolveViewRunBody(fvm, [{ nodeId: 'view-shared-root' }], nodes).draft).toBeNull()
  })

  it('falls back to the pinned version when the root node is missing', () => {
    expect(resolveViewRunBody(fvm, [{ nodeId: 'gone' }], []).version).toBe('1.2.0')
  })

  it('falls back to the pinned version when the drill path is empty', () => {
    expect(resolveViewRunBody(fvm, [], []).version).toBe('1.2.0')
  })
})

describe('useTestRun.handleDebug - library View', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  function viewStoreOverrides(extra: Record<string, unknown> = {}) {
    return {
      editingTestId: null,
      functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false },
      drillPath: [{ nodeId: 'view-shared-root', label: 'Greet' }],
      nodes: [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }],
      getBreakpointList: vi.fn(() => ['inner-1']),
      ...extra,
    }
  }

  it('dispatches a standalone debug run with inner-node breakpoints', async () => {
    setupStore(viewStoreOverrides())
    const runStandaloneFunction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useTestRun(makeParams({ runStandaloneFunction, selectedEnvironment: 'env-1' })),
    )
    await act(async () => {
      await result.current.handleDebug('all')
    })
    expect(runStandaloneFunction).toHaveBeenCalledWith({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
      environmentId: 'env-1',
      debug: { breakpoints: ['inner-1'] },
    })
  })

  it('warns and does not dispatch when no environment is selected', async () => {
    setupStore(viewStoreOverrides())
    const runStandaloneFunction = vi.fn()
    const { result } = renderHook(() =>
      useTestRun(makeParams({ runStandaloneFunction, selectedEnvironment: null })),
    )
    await act(async () => {
      await result.current.handleDebug('all')
    })
    expect(runStandaloneFunction).not.toHaveBeenCalled()
    expect(mockToast.warning).toHaveBeenCalled()
  })
})
