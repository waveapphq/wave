/**
 * Tests for useTestRun hook
 *
 * Verifies subscription to skippedNodeIds during execution,
 * handleRun validation/delegation, and handleStop behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTestRun, resolveViewRunBody, type UseTestRunParams } from '@/features/workbench/live/use-test-run'
import { useStagedOverrides, type StagedOverride } from '@/features/workbench/live/staged-overrides'
import { useRunConflictGuard } from '@/features/workbench/live/use-run-conflict-guard'
import { usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'
import type { SavedBlockFields } from '@/features/workbench/lib/saved-block-fields'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { validateTest } from '@/features/tests/api/validation'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/workbench/stores/workflow-store')
vi.mock('@/components/ui/toast', () => ({
  useToast: () => mockToast,
}))

// Dynamic import mocks for @/api/tests
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
// Helpers
// ---------------------------------------------------------------------------

// Track subscribe calls to simulate the zustand subscribeWithSelector middleware
let subscribeCalls: Array<{
  selector: (s: Record<string, unknown>) => unknown
  callback: (val: unknown) => void
}> = []
let unsubFn: ReturnType<typeof vi.fn>

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
    nodeIssues: new Map(),
    drillPath: [] as Array<{ nodeId: string; label: string }>,
    ...overrides,
  }
}

function setupStore(overrides: Record<string, unknown> = {}) {
  const state = defaultStoreState(overrides)

  unsubFn = vi.fn()
  subscribeCalls = []

  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })

  // Mock static getState
  ;(useWorkflowStore as unknown as { getState: () => typeof state }).getState = () => state

  // Mock static subscribe (subscribeWithSelector pattern: (selector, callback) => unsub)
  ;(useWorkflowStore as unknown as { subscribe: (...args: unknown[]) => () => void }).subscribe = (
    selectorOrCallback: unknown,
    maybeCallback?: unknown,
  ) => {
    if (typeof maybeCallback === 'function') {
      subscribeCalls.push({
        selector: selectorOrCallback as (s: Record<string, unknown>) => unknown,
        callback: maybeCallback as (val: unknown) => void,
      })
    }
    return unsubFn
  }

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
  }
}

/** The ApiError shape the client stamps a not-found response onto. */
function apiError(status: number, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), {
    status,
    code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The "Test not found" dialog is raised through the shared store, not a prop.
const deletedTestRaise = vi.fn()

describe('useTestRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
    subscribeCalls = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Initial state ---

  it('returns all expected handler functions', () => {
    setupStore()
    const params = makeParams()

    const { result } = renderHook(() => useTestRun(params))

    expect(typeof result.current.handleRun).toBe('function')
    expect(typeof result.current.handleDebug).toBe('function')
    expect(typeof result.current.handleAdHocRun).toBe('function')
    expect(typeof result.current.handleStop).toBe('function')
  })

  // --- run-current on a dirty canvas (no run-confirm modal) ---

  describe('run-current on a dirty canvas', () => {
    it('sends the in-memory workflow to startRun without showing a run-confirm modal', async () => {
      vi.mocked(validateTest).mockResolvedValue({
        errors: [],
        fatal: false,
        warnings: [],
      } as never)
      setupStore({
        isDirty: true,
        nodes: [
          {
            id: 'n1',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'L',
              nodeType: 'plugin',
              elementType: 'log',
              config: { values: {}, profileBindings: [], outputBindings: {} },
            },
          },
        ],
        edges: [],
        variables: [],
      })
      const params = makeParams()
      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('all')
      })

      // The dirty in-memory body runs directly - there is no run-confirm modal.
      expect(params.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: expect.objectContaining({ nodes: expect.any(Array) }),
        }),
      )
    })
  })

  // --- skippedNodeIds subscription ---

  describe('skippedNodeIds subscription', () => {
    it('does NOT subscribe when workbenchStatus is idle', () => {
      setupStore()
      const params = makeParams({ workbenchStatus: 'idle' })

      renderHook(() => useTestRun(params))

      expect(subscribeCalls).toHaveLength(0)
    })

    it('subscribes to skippedNodeIds when workbenchStatus is running', () => {
      setupStore()
      const params = makeParams({ workbenchStatus: 'running' })

      renderHook(() => useTestRun(params))

      expect(subscribeCalls).toHaveLength(1)
    })

    it('subscribes to skippedNodeIds when workbenchStatus is paused', () => {
      setupStore()
      const params = makeParams({ workbenchStatus: 'paused' })

      renderHook(() => useTestRun(params))

      expect(subscribeCalls).toHaveLength(1)
    })

    it('calls updateWorkbenchSkippedNodes when subscription fires', () => {
      setupStore()
      const updateSpy = vi.fn().mockResolvedValue(undefined)
      const params = makeParams({ workbenchStatus: 'running', updateWorkbenchSkippedNodes: updateSpy })

      renderHook(() => useTestRun(params))

      expect(subscribeCalls).toHaveLength(1)
      // Simulate the subscription firing with new skippedNodeIds
      subscribeCalls[0].callback(['node-a', 'node-b'])

      expect(updateSpy).toHaveBeenCalledWith(['node-a', 'node-b'])
    })

    it('unsubscribes on cleanup', () => {
      setupStore()
      const params = makeParams({ workbenchStatus: 'running' })

      const { unmount } = renderHook(() => useTestRun(params))

      expect(unsubFn).not.toHaveBeenCalled()
      unmount()
      expect(unsubFn).toHaveBeenCalledOnce()
    })

    it('does NOT call unsubscribe on cleanup when not running', () => {
      setupStore()
      const params = makeParams({ workbenchStatus: 'idle' })

      const { unmount } = renderHook(() => useTestRun(params))

      unmount()
      // unsubFn should not have been set up
      expect(subscribeCalls).toHaveLength(0)
    })
  })

  // --- handleStop ---

  describe('handleStop', () => {
    it('opens the stop confirmation dialog and stops only after confirm', async () => {
      setupStore()
      const stopFn = vi.fn().mockResolvedValue(undefined)
      const params = makeParams({ stopWorkbenchRun: stopFn })

      const { result } = renderHook(() => useTestRun(params))

      // Stop is confirmation-gated per the Stop Confirmation Policy.
      await act(async () => {
        await result.current.handleStop('immediate')
      })

      expect(stopFn).not.toHaveBeenCalled()
      expect(result.current.showStopConfirmDialog).toBe(true)
      expect(result.current.pendingStopMode).toBe('immediate')

      await act(async () => {
        await result.current.handleStopConfirm('immediate')
      })

      expect(stopFn).toHaveBeenCalledOnce()
      expect(result.current.showStopConfirmDialog).toBe(false)
    })

    it('canceling the stop dialog does not stop the workbench', async () => {
      setupStore()
      const stopFn = vi.fn().mockResolvedValue(undefined)
      const params = makeParams({ stopWorkbenchRun: stopFn })

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleStop('finalize')
      })

      expect(result.current.showStopConfirmDialog).toBe(true)
      expect(result.current.pendingStopMode).toBe('finalize')

      await act(async () => {
        result.current.handleStopConfirmCancel()
      })

      expect(stopFn).not.toHaveBeenCalled()
      expect(result.current.showStopConfirmDialog).toBe(false)
    })
  })

  // --- handleRun ---

  describe('handleRun', () => {
    it('warns when no editingTestId', async () => {
      setupStore({ editingTestId: null })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(mockToast.warning).toHaveBeenCalledWith(
        'Save the test before running.',
        'Cannot Run Draft'
      )
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('warns when no environment selected', async () => {
      setupStore()
      const params = makeParams({ selectedEnvironment: null })

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(mockToast.warning).toHaveBeenCalledWith(
        'Select an environment before running.',
        'No Environment Selected'
      )
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('uses environmentOverride when provided', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({ isDirty: false })
      const params = makeParams({ selectedEnvironment: 'env-default' })

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current', 'env-override')
      })

      expect(params.startRun).toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: 'env-override' })
      )
    })

    it('runs the in-memory body directly when isDirty (no run-confirm modal)', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [
          {
            id: 'n1',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'L',
              nodeType: 'plugin',
              elementType: 'log',
              config: { values: {}, profileBindings: [], outputBindings: {} },
            },
          },
        ],
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalledWith(
        expect.objectContaining({ workflow: expect.objectContaining({ nodes: expect.any(Array) }) }),
      )
    })

    it('validates and calls startRun when not dirty and validation passes', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      const storeState = setupStore({ isDirty: false, skippedNodeIds: ['skip-1'] })
      // Make getState return skippedNodeIds
      ;(useWorkflowStore as unknown as { getState: () => typeof storeState }).getState = () => storeState

      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(validateTest).toHaveBeenCalledWith('test-1', 'run')
      expect(params.startRun).toHaveBeenCalledWith({
        testId: 'test-1',
        environmentId: 'env-1',
        skippedNodeIds: ['skip-1'],
      })
    })

    it('passes undefined skippedNodeIds when list is empty', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({ isDirty: false, skippedNodeIds: [] })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalledWith(
        expect.objectContaining({ skippedNodeIds: undefined })
      )
    })

    it('lists only the errors that stop the run, never a warning', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({
        fatal: false,
        errors: [
          { path: '/nodes/0', code: 'MISSING_PARAM', message: 'Missing required param', node_id: 'n1' },
        ],
        warnings: [
          { path: '/nodes/1', code: 'OPTIONAL', message: 'Optional warning' },
        ],
      })

      const setPulseValidationNodeIds = vi.fn()
      setupStore({ isDirty: false, setPulseValidationNodeIds })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationErrors).toHaveBeenCalledWith([
        expect.objectContaining({ code: 'MISSING_PARAM', severity: 'error' }),
      ])
      expect(params.setValidationFatal).toHaveBeenCalledWith(false)
      // Run flow uses 'run' mode under the unified modal design (pulse is
      // populated by handleValidationClose, not eagerly on validation failure).
      expect(params.setValidationMode).toHaveBeenCalledWith('run')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(setPulseValidationNodeIds).not.toHaveBeenCalled()
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('shows validation errors for fatal validation', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({
        fatal: true,
        errors: [{ path: '/nodes/0', code: 'FATAL', message: 'Fatal error' }],
        warnings: [],
      })

      setupStore({ isDirty: false })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationFatal).toHaveBeenCalledWith(true)
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('shows toast and does not run when validation throws', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(new Error('Network error'))

      setupStore({ isDirty: false })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      // Suppress console.error from the hook's catch block
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to validate test before running.',
        'Validation Error'
      )
      expect(params.startRun).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('opens the deleted-test dialog instead of the generic toast when the test is gone', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(apiError(404, "Test with ID 'test-1' not found"))

      setupStore({ isDirty: false })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
        testId: 'test-1',
        testName: 'My Test',
      })
      expect(mockToast.error).not.toHaveBeenCalled()
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('reports the deleted test with a null name when the canvas has no test name', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(apiError(404, 'not found'))

      setupStore({ isDirty: false, editingTestName: null })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
        testId: 'test-1',
        testName: null,
      })
    })

    it('keeps the generic toast for a server error and never opens the deleted-test dialog', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(apiError(500, 'Internal server error'))

      setupStore({ isDirty: false })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(deletedTestRaise).not.toHaveBeenCalled()
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to validate test before running.',
        'Validation Error'
      )
      expect(params.startRun).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('keeps the generic toast when the rejection carries no error object', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(undefined)

      setupStore({ isDirty: false })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(deletedTestRaise).not.toHaveBeenCalled()
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to validate test before running.',
        'Validation Error'
      )
      consoleSpy.mockRestore()
    })

    it('opens the deleted-test dialog for a scoped Function run when the test is gone', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockRejectedValue(apiError(404, "Test with ID 'test-1' not found"))

      setupStore({
        isDirty: false,
        drillPath: [{ nodeId: 'fn-node-1', label: 'My Function' }],
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(deletedTestRaise).toHaveBeenCalledExactlyOnceWith({
        testId: 'test-1',
        testName: 'My Test',
      })
      expect(mockToast.error).not.toHaveBeenCalled()
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('surfaces FE-side UNRESOLVED_VARIABLE_REFERENCE issues as UNDECLARED_VARIABLE before BE validation passes', async () => {
      // An in-memory finding still shows when the backend reports nothing at its path.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: false,
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
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNDECLARED_VARIABLE',
            node_id: 'log-1',
            path: 'variables.test1',
          }),
        ])
      )
      expect(params.setValidationMode).toHaveBeenCalledWith('run')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('ignores FE node issues that are not UNRESOLVED_VARIABLE_REFERENCE', async () => {
      // REQUIRED_PARAM_MISSING etc. are still surfaced by the BE validate
      // pass; only the variable-reference codes get the FE pre-pass.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: false,
        nodeIssues: new Map([
          [
            'http-1',
            [
              {
                code: 'REQUIRED_PARAM_MISSING',
                paramName: 'url',
                message: 'url is required',
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalled()
      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    it('blocks a dirty-canvas run when a block is missing a required parameter', async () => {
      // The in-memory required-param finding blocks even when the backend reports none.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [
          { id: 'connect-1', data: { label: 'K8s Connect', elementType: 'k8s_connect' } },
          { id: 'events-1', data: { label: 'K8s Events', elementType: 'k8s_events' } },
        ],
        nodeIssues: new Map([
          [
            'events-1',
            [
              {
                code: 'REQUIRED_PARAM_MISSING',
                paramName: 'session',
                message: "Required parameter 'session' is missing",
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'REQUIRED_PARAM_MISSING',
            node_id: 'events-1',
            node_label: 'K8s Events',
            element_type: 'k8s_events',
            path: 'nodes[1].data.config.values.session',
            message: "Required parameter 'session' is missing",
            severity: 'error',
          }),
        ])
      )
      expect(params.setValidationMode).toHaveBeenCalledWith('run')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('blocks a dirty-canvas run when a required parameter is present but empty', async () => {
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [{ id: 'get-1', data: { label: 'K8s Get', elementType: 'k8s_get' } }],
        nodeIssues: new Map([
          [
            'get-1',
            [
              {
                code: 'REQUIRED_PARAM_EMPTY',
                paramName: 'session',
                message: "Required parameter 'session' is empty",
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'REQUIRED_PARAM_EMPTY',
            node_id: 'get-1',
            path: 'nodes[0].data.config.values.session',
          }),
        ])
      )
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('blocks a dirty-canvas run when a Python block has a syntax error', async () => {
      // PYRUN-13: a block with a syntax error cannot run.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [{ id: 'py-1', data: { label: 'Python', elementType: 'python' } }],
        nodeIssues: new Map([
          [
            'py-1',
            [
              {
                code: 'SCRIPT_SYNTAX_ERROR',
                severity: 'error',
                paramName: 'script',
                message: 'Script has a syntax error on line 3',
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'SCRIPT_SYNTAX_ERROR',
            node_id: 'py-1',
            node_label: 'Python',
            element_type: 'python',
            message: 'Script has a syntax error on line 3',
            severity: 'error',
          }),
        ])
      )
      expect(params.setValidationMode).toHaveBeenCalledWith('run')
      expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      expect(params.startRun).not.toHaveBeenCalled()
    })

    it('lets a dirty-canvas run start when a Python block only carries a warning', async () => {
      // PYRUN-14: a warning never marks the block invalid, so it never blocks a run.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [{ id: 'py-1', data: { label: 'Python', elementType: 'python' } }],
        nodeIssues: new Map([
          [
            'py-1',
            [
              {
                code: 'OUTPUT_LIST_NAME',
                severity: 'warning',
                message: "Script never sets 'COUNT'",
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalled()
      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    it('leaves required-param issues on other nodes and other codes alone on a dirty run', async () => {
      // Only the two required-param codes cross over, and only for nodes the
      // canvas still holds; anything else stays with the BE pass.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: true,
        nodes: [{ id: 'log-1', data: { label: 'Log', elementType: 'log' } }],
        nodeIssues: new Map([
          ['log-1', [{ code: 'MAP_KEY_POLICY', paramName: 'headers', message: 'Duplicate key' }]],
          [
            'deleted-1',
            [
              {
                code: 'REQUIRED_PARAM_MISSING',
                paramName: 'session',
                message: "Required parameter 'session' is missing",
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalled()
      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    it('skips UNRESOLVED_VARIABLE_REFERENCE entries whose message lacks a quoted variable name', async () => {
      // Defensive: only emit the FE-side UNDECLARED_VARIABLE when the
      // variable name is extractable; otherwise let the BE pass own it.
      const { validateTest } = await import('@/features/tests/api/validation')
      vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })

      setupStore({
        isDirty: false,
        nodeIssues: new Map([
          [
            'log-1',
            [
              {
                code: 'UNRESOLVED_VARIABLE_REFERENCE',
                paramName: 'message',
                message: 'malformed message without quotes',
              },
            ],
          ],
        ]),
      })
      const params = makeParams()

      const { result } = renderHook(() => useTestRun(params))

      await act(async () => {
        await result.current.handleRun('current')
      })

      expect(params.startRun).toHaveBeenCalled()
      expect(params.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    describe('the backend checks the body that runs', () => {
      const DELAY_NODE = {
        id: 'delay-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Delay',
          elementType: 'delay',
          nodeType: 'control',
          expressionFields: ['duration'],
          config: { values: { duration: 'pause_ms' }, outputBindings: {}, profileBindings: [] },
        },
      }
      const UNDECLARED_PAUSE = {
        path: 'variables.pause_ms',
        node_id: 'delay-1',
        code: 'UNDECLARED_VARIABLE',
        message: "Variable 'pause_ms' is used in 1 block(s) but not declared in variable manager",
        fix_action: 'Add variable to manager (type: integer)',
      }
      const PAUSE_NOT_DEFINED = new Map([
        [
          'delay-1',
          [
            {
              code: 'UNRESOLVED_VARIABLE_REFERENCE',
              paramName: 'duration',
              message: "Variable 'pause_ms' is not defined",
            },
          ],
        ],
      ])

      it('sends the edited canvas to the check, the same body the run then starts with', async () => {
        vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })
        setupStore({ isDirty: true, nodes: [DELAY_NODE] })
        const params = makeParams()

        const { result } = renderHook(() => useTestRun(params))

        await act(async () => {
          await result.current.handleRun('current')
        })

        const started = vi.mocked(params.startRun).mock.calls[0][0]
        expect(started.workflow?.nodes).toEqual([expect.objectContaining({ id: 'delay-1' })])
        expect(validateTest).toHaveBeenCalledWith('test-1', 'run', {
          workflow: started.workflow,
          variables: started.variables,
        })
      })

      it("replaces the canvas finding on a variable with the backend's, which names the type", async () => {
        vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [UNDECLARED_PAUSE], warnings: [] })
        setupStore({ isDirty: true, nodes: [DELAY_NODE], nodeIssues: PAUSE_NOT_DEFINED })
        const params = makeParams()

        const { result } = renderHook(() => useTestRun(params))

        await act(async () => {
          await result.current.handleRun('current')
        })

        expect(params.setValidationErrors).toHaveBeenCalledWith([
          { ...UNDECLARED_PAUSE, severity: 'error', functionPath: undefined },
        ])
        expect(params.setValidationMode).toHaveBeenCalledWith('run')
        expect(params.startRun).not.toHaveBeenCalled()
      })

      it("replaces the canvas finding on a saved test's variable with the backend's", async () => {
        vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [UNDECLARED_PAUSE], warnings: [] })
        setupStore({ isDirty: false, nodes: [DELAY_NODE], nodeIssues: PAUSE_NOT_DEFINED })
        const params = makeParams()

        const { result } = renderHook(() => useTestRun(params))

        await act(async () => {
          await result.current.handleRun('current')
        })

        expect(validateTest).toHaveBeenCalledWith('test-1', 'run')
        expect(params.setValidationErrors).toHaveBeenCalledWith([
          { ...UNDECLARED_PAUSE, severity: 'error', functionPath: undefined },
        ])
      })

      it("replaces the canvas finding on a parameter with the backend's at the same path", async () => {
        const sessionEmpty = {
          path: 'nodes[0].data.config.values.session',
          node_id: 'get-1',
          node_label: 'K8s Get',
          element_type: 'k8s_get',
          code: 'REQUIRED_PARAM_EMPTY',
          message: "Required parameter 'session' is empty",
        }
        vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [sessionEmpty], warnings: [] })
        setupStore({
          isDirty: true,
          nodes: [{ id: 'get-1', data: { label: 'K8s Get', elementType: 'k8s_get' } }],
          nodeIssues: new Map([
            [
              'get-1',
              [
                {
                  code: 'REQUIRED_PARAM_EMPTY',
                  paramName: 'session',
                  message: "Required parameter 'session' is empty",
                },
              ],
            ],
          ]),
        })
        const params = makeParams()

        const { result } = renderHook(() => useTestRun(params))

        await act(async () => {
          await result.current.handleRun('current')
        })

        expect(params.setValidationErrors).toHaveBeenCalledWith([
          { ...sessionEmpty, severity: 'error', functionPath: undefined },
        ])
      })
    })
  })
})

describe('useTestRun.handleRun - library View', () => {
  function viewOverrides(extra: Record<string, unknown> = {}) {
    return {
      editingTestId: null,
      functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false },
      drillPath: [{ nodeId: 'view-shared-root', label: 'Greet' }],
      nodes: [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }],
      getBreakpointList: vi.fn(() => []),
      ...extra,
    }
  }

  it('dispatches a standalone run without a debug payload', async () => {
    setupStore(viewOverrides())
    const runStandaloneFunction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useTestRun(makeParams({ runStandaloneFunction, selectedEnvironment: 'env-1' })),
    )
    await act(async () => {
      await result.current.handleRun('all')
    })
    expect(runStandaloneFunction).toHaveBeenCalledWith({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
      environmentId: 'env-1',
    })
  })

  it('warns and does not dispatch when no environment is selected', async () => {
    setupStore(viewOverrides())
    const runStandaloneFunction = vi.fn()
    const { result } = renderHook(() =>
      useTestRun(makeParams({ runStandaloneFunction, selectedEnvironment: null })),
    )
    await act(async () => {
      await result.current.handleRun('all')
    })
    expect(runStandaloneFunction).not.toHaveBeenCalled()
  })
})

describe('useTestRun - a Function run alone uses the Current values set before it (FNCFG-8, REQ-3.1.2.10)', () => {
  const STAGED_WHO = { type: 'string', value: 'ann' }
  const STAGED_TRIES = { type: 'integer', value: 3 }

  function libraryView() {
    return setupStore({
      editingTestId: null,
      functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false },
      drillPath: [{ nodeId: 'view-shared-root', label: 'Greet' }],
      nodes: [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }],
      getBreakpointList: vi.fn(() => []),
    })
  }

  function renderWithStaged(runStandaloneFunction: ReturnType<typeof vi.fn>) {
    const stagedOverrides = new Map<string, StagedOverride>([
      ['who', STAGED_WHO],
      ['tries', STAGED_TRIES],
    ])
    return renderHook(() =>
      useTestRun(makeParams({ runStandaloneFunction, selectedEnvironment: 'env-1', readStagedOverrides: () => stagedOverrides })),
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends each staged Current value as the run variables of a Run', async () => {
    libraryView()
    const runStandaloneFunction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderWithStaged(runStandaloneFunction)

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(runStandaloneFunction).toHaveBeenCalledTimes(1)
    expect(runStandaloneFunction).toHaveBeenCalledWith({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
      environmentId: 'env-1',
      variables: { who: STAGED_WHO, tries: STAGED_TRIES },
    })
  })

  it('sends each staged Current value as the run variables of a Debug', async () => {
    libraryView()
    const runStandaloneFunction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderWithStaged(runStandaloneFunction)

    await act(async () => {
      await result.current.handleDebug('all')
    })

    expect(runStandaloneFunction).toHaveBeenCalledTimes(1)
    expect(runStandaloneFunction.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        debug: { breakpoints: [] },
        variables: { who: STAGED_WHO, tries: STAGED_TRIES },
      }),
    )
  })
})

/** The staged map the variable hook holds once each `[name, override, functionPath?]` is staged. */
function stagedVia(entries: Array<[string, StagedOverride, string[]?]>): Map<string, StagedOverride> {
  const { result } = renderHook(() => useStagedOverrides())
  act(() => {
    for (const [name, override, functionPath] of entries) result.current.stage(name, override, functionPath)
  })
  return result.current.read()
}

describe('useTestRun - staged Current values ride the run in their own scope (REQ-3.2.1.6)', () => {
  const TEST_COUNT: StagedOverride = { value: '7', type: 'integer' }
  const FN_COUNT: StagedOverride = { value: '9', type: 'integer' }
  const BOTH_SCOPES: Array<[string, StagedOverride, string[]?]> = [
    ['count', TEST_COUNT],
    ['count', FN_COUNT, ['fn-a']],
  ]
  const TEST_SEED = { count: { type: 'integer', value: '7' } }
  const FUNCTION_SEED = [{ function_path: ['fn-a'], variables: { count: { type: 'integer', value: '9' } } }]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })
  })

  function renderStaged(entries: Array<[string, StagedOverride, string[]?]>, overrides: Partial<UseTestRunParams> = {}) {
    const staged = stagedVia(entries)
    const params = makeParams({ readStagedOverrides: () => staged, ...overrides })
    const hook = renderHook(() => useTestRun(params))
    return { params, result: hook.result }
  }

  it('sends a Test variable value in the variables of a Run and a Function value under its instance path', async () => {
    setupStore()
    const { params, result } = renderStaged(BOTH_SCOPES)

    await act(async () => {
      await result.current.handleRun('all')
    })

    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual(TEST_SEED)
    expect(started.function_variables).toEqual(FUNCTION_SEED)
  })

  it('sends both scopes with a Debug', async () => {
    setupStore({ getBreakpointList: vi.fn(() => []), debugOptions: {} })
    const { params, result } = renderStaged(BOTH_SCOPES)

    await act(async () => {
      await result.current.handleDebug('all')
    })

    const started = vi.mocked(params.startDebugRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual(TEST_SEED)
    expect(started.function_variables).toEqual(FUNCTION_SEED)
  })

  it('sends both scopes with a Run Scope drilled into the Function', async () => {
    setupStore({ drillPath: [{ nodeId: 'fn-a', label: 'Function_A' }] })
    const { params, result } = renderStaged(BOTH_SCOPES)

    await act(async () => {
      await result.current.handleRun('current')
    })

    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started).toEqual(expect.objectContaining({ scopeMode: 'function', scopedFunctionNodeId: 'fn-a' }))
    expect(started.variables).toEqual(TEST_SEED)
    expect(started.function_variables).toEqual(FUNCTION_SEED)
  })

  it('sends both scopes with a block run', async () => {
    setupStore()
    const { params, result } = renderStaged(BOTH_SCOPES)

    await act(async () => {
      await result.current.handleAdHocRun('run-current', 'log-1', { environmentId: 'env-1' })
    })

    const started = vi.mocked(params.startDebugRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.singleNodeId).toBe('log-1')
    expect(started.variables).toEqual(TEST_SEED)
    expect(started.function_variables).toEqual(FUNCTION_SEED)
  })

  it('sends no Function values when only Test variable values are staged', async () => {
    setupStore()
    const { params, result } = renderStaged([['count', TEST_COUNT]])

    await act(async () => {
      await result.current.handleRun('all')
    })

    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual(TEST_SEED)
    expect(started.function_variables).toBeUndefined()
  })

  it('sends a run alone in the library View its own values as its variables and a nested Function instance values by path', async () => {
    setupStore({
      editingTestId: null,
      functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false },
      drillPath: [{ nodeId: 'view-shared-root', label: 'Greet' }],
      nodes: [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }],
      getBreakpointList: vi.fn(() => []),
    })
    const runStandaloneFunction = vi.fn().mockResolvedValue(undefined)
    const { result } = renderStaged(
      [
        ['who', { value: 'ann', type: 'string' }],
        ['tries', { value: 3, type: 'integer' }, ['inner-fn']],
      ],
      { runStandaloneFunction },
    )

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(runStandaloneFunction).toHaveBeenCalledWith({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
      environmentId: 'env-1',
      variables: { who: { type: 'string', value: 'ann' } },
      function_variables: [{ function_path: ['inner-fn'], variables: { tries: { type: 'integer', value: 3 } } }],
    })
  })
})

describe('useTestRun - a run held for an open Edit window starts with what the dialog left (VMGR-64)', () => {
  const COUNT = { id: 'v-count', name: 'count', type: 'integer', value: 3 }
  const TOTAL = { id: 'v-count', name: 'total', type: 'integer', value: 5 }
  const SEVEN: StagedOverride = { type: 'integer', value: 7 }
  const NINE: StagedOverride = { type: 'integer', value: 9 }

  function logBlock(id: string, message: string) {
    const node = runLog(id)
    return { ...node, data: { ...node.data, config: { values: { message } } } }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    usePendingCurrentEdits.getState().clearAll()
    vi.mocked(validateTest).mockResolvedValue({ fatal: false, errors: [], warnings: [] })
  })

  /** The container's wiring: the staged Current values, the run-conflict guard and the run hook. */
  function renderGuardedRun(overrides: Partial<UseTestRunParams> = {}) {
    const params = makeParams(overrides)
    const hook = renderHook(() => {
      const staged = useStagedOverrides()
      const conflict = useRunConflictGuard()
      const run = useTestRun({ ...params, readStagedOverrides: staged.read })
      return { staged, conflict, run }
    })
    return { params, result: hook.result }
  }

  type GuardedRun = ReturnType<typeof renderGuardedRun>['result']

  /** An open Edit window holding an unsaved change; its Save does `save`. */
  function openWindow(name: string, save: () => void) {
    const drop = vi.fn()
    act(() => {
      usePendingCurrentEdits.getState().setPending({
        name,
        save: async () => {
          save()
        },
        drop,
      })
    })
    return drop
  }

  function press(result: GuardedRun, pick: (run: GuardedRun['current']['run']) => (...args: never[]) => Promise<void>, ...args: unknown[]) {
    act(() => {
      ;(result.current.conflict.guard(pick(result.current.run)) as (...rest: unknown[]) => void)(...args)
    })
  }

  /** Save Changes, held in act until the run starts, as the dialog's own state settles before it. */
  async function pressSaveChanges(result: GuardedRun, start: unknown) {
    await act(async () => {
      result.current.conflict.onSave()
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    })
  }

  it('Run starts with the Current value Save Changes staged', async () => {
    setupStore({ variables: [COUNT] })
    const { params, result } = renderGuardedRun()
    openWindow('count', () => result.current.staged.stage('count', NINE))

    press(result, (run) => run.handleRun, 'all')
    expect(params.startRun).not.toHaveBeenCalled()
    await pressSaveChanges(result, params.startRun)

    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual({ count: { type: 'integer', value: 9 } })
  })

  it('Debug starts with the rename and Initial value Save Changes saved', async () => {
    const state = setupStore({ variables: [COUNT], getBreakpointList: vi.fn(() => []), debugOptions: {} })
    const { params, result } = renderGuardedRun()
    openWindow('count', () => Object.assign(state, { isDirty: true, variables: [TOTAL] }))

    press(result, (run) => run.handleDebug, 'all')
    await pressSaveChanges(result, params.startDebugRun)

    const started = vi.mocked(params.startDebugRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual({ total: { type: 'integer', value: 5 } })
    expect(vi.mocked(validateTest)).toHaveBeenCalledWith('test-1', 'run', {
      workflow: started.workflow,
      variables: { total: { type: 'integer', value: 5 } },
    })
  })

  it('Run Scope drilled into a Function starts with the Function value Save Changes staged', async () => {
    setupStore({ drillPath: [{ nodeId: 'fn-a', label: 'Function_A' }] })
    const { params, result } = renderGuardedRun()
    openWindow('count', () => result.current.staged.stage('count', NINE, ['fn-a']))

    press(result, (run) => run.handleRun, 'current')
    await pressSaveChanges(result, params.startRun)

    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started).toEqual(expect.objectContaining({ scopeMode: 'function', scopedFunctionNodeId: 'fn-a' }))
    expect(started.function_variables).toEqual([
      { function_path: ['fn-a'], variables: { count: { type: 'integer', value: 9 } } },
    ])
  })

  it('a block run with an unsaved block draft starts with the canvas and variables Save Changes saved', async () => {
    const state = setupStore({ nodes: [logBlock('log-1', '{{count}}'), logBlock('log-2', '{{count}}')], variables: [COUNT] })
    const { params, result } = renderGuardedRun()
    openWindow('count', () =>
      Object.assign(state, {
        isDirty: true,
        variables: [TOTAL],
        nodes: [logBlock('log-1', '{{total}}'), logBlock('log-2', '{{total}}')],
      }),
    )
    const blockDraft = { data: {}, config: { values: { message: 'draft' } } } as unknown as SavedBlockFields

    press(result, (run) => run.handleAdHocRun, 'run-current', 'log-1', { environmentId: 'env-1', blockDraft })
    await pressSaveChanges(result, params.startDebugRun)

    const started = vi.mocked(params.startDebugRun).mock.calls[0][0] as {
      variables: unknown
      workflow: { nodes: Array<{ data: { config: { values: { message: string } } } }> }
    }
    expect(started.workflow.nodes.map((node) => node.data.config.values.message)).toEqual(['draft', '{{total}}'])
    expect(started.variables).toEqual({ total: { type: 'integer', value: 5 } })
  })

  it('a Function run alone in the library View starts with the Current value Save Changes staged', async () => {
    setupStore({
      editingTestId: null,
      functionViewMode: { functionId: 'fn-1', version: '1.2.0', editable: false },
      drillPath: [{ nodeId: 'view-shared-root', label: 'Greet' }],
      nodes: [{ id: 'view-shared-root', data: { functionLifecycle: 'shared' } }],
      getBreakpointList: vi.fn(() => []),
    })
    const { params, result } = renderGuardedRun()
    openWindow('who', () => result.current.staged.stage('who', { type: 'string', value: 'ann' }))

    press(result, (run) => run.handleRun, 'all')
    await pressSaveChanges(result, params.runStandaloneFunction)

    expect(params.runStandaloneFunction).toHaveBeenCalledWith({
      functionId: 'fn-1',
      version: '1.2.0',
      draft: null,
      environmentId: 'env-1',
      variables: { who: { type: 'string', value: 'ann' } },
    })
  })

  it("Drop Changes starts the run with the values held before, without the window's change", async () => {
    setupStore({ variables: [COUNT] })
    const { params, result } = renderGuardedRun()
    act(() => result.current.staged.stage('count', SEVEN))
    const drop = openWindow('count', () => result.current.staged.stage('count', NINE))

    press(result, (run) => run.handleRun, 'all')
    await act(async () => {
      result.current.conflict.onDrop()
      await vi.waitFor(() => expect(params.startRun).toHaveBeenCalledTimes(1))
    })

    expect(drop).toHaveBeenCalledTimes(1)
    const started = vi.mocked(params.startRun).mock.calls[0][0] as Record<string, unknown>
    expect(started.variables).toEqual({ count: { type: 'integer', value: 7 } })
  })
})

// ---------------------------------------------------------------------------
// Deep-folded run payloads + resolveViewRunBody deep fold.
// The run-current payload and the View run body must fold EVERY edit-mode
// Shared at any depth (not just the top level / synthetic root).
// ---------------------------------------------------------------------------

interface DeepRunNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

function runLog(id: string): DeepRunNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: 'plugin', elementType: 'log' },
  }
}

function runBody(nodes: DeepRunNode[]): Record<string, unknown> {
  return { workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] }
}

function runSharedInEdit(
  id: string,
  opts: { stampedNodes?: DeepRunNode[]; draftNodes?: DeepRunNode[] } = {},
): DeepRunNode {
  const data: Record<string, unknown> = {
    label: id,
    nodeType: 'function',
    functionLifecycle: 'shared',
    functionId: `lib-${id}`,
    functionVersion: '1.0.0',
    editMode: true,
    upstreamLink: { functionId: `lib-${id}`, sourceVersion: '1.0.0' },
    draft: {
      name: id,
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: opts.draftNodes ?? [], edges: [] },
    },
  }
  if (opts.stampedNodes) data.localDefinition = runBody(opts.stampedNodes)
  return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data }
}

function runLocalFn(id: string, inner: DeepRunNode[]): DeepRunNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: runBody(inner),
    },
  }
}

function nodesIn(def: unknown): DeepRunNode[] {
  return (
    (def as { workflow?: { nodes?: DeepRunNode[] } } | undefined)?.workflow?.nodes ?? []
  )
}

describe('useTestRun run-current payload - deep fold', () => {
  it('startRun receives a workflow whose NESTED edit-mode draft is folded', async () => {
    vi.mocked(validateTest).mockResolvedValue({
      errors: [],
      fatal: false,
      warnings: [],
    } as never)
    const nested = runSharedInEdit('s2', {
      stampedNodes: [runLog('deep-edit')],
      draftNodes: [runLog('stale')],
    })
    setupStore({
      isDirty: true,
      nodes: [runLocalFn('outer', [nested])],
      edges: [],
      variables: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(params.startRun).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(params.startRun).mock.calls[0][0] as {
      workflow?: { nodes: DeepRunNode[] }
    }
    const outer = payload.workflow?.nodes.find((n) => n.id === 'outer')
    const inner = nodesIn(outer?.data.localDefinition).find((n) => n.id === 's2')
    expect(inner?.data).not.toHaveProperty('localDefinition')
    expect(nodesIn(inner?.data.draft).map((n) => n.id)).toEqual(['deep-edit'])
  })
})

describe('resolveViewRunBody - deep fold', () => {
  const fvm = { functionId: 'lib-root', version: '1.0.0' }
  const drillPath = [{ nodeId: 'view-shared-root' }]

  function viewRoot(bodyNodes: DeepRunNode[]): DeepRunNode {
    return runSharedInEdit('view-shared-root', { stampedNodes: bodyNodes })
  }

  it('folds a nested edit-mode Shared inside the root working body', () => {
    const nested = runSharedInEdit('s2', {
      stampedNodes: [runLog('deep-edit')],
      draftNodes: [runLog('stale')],
    })
    const root = viewRoot([nested])

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    expect(resolved.version).toBe('1.0.0')
    const draftNodes = nodesIn(resolved.draft)
    const inner = draftNodes.find((n) => n.id === 's2')
    expect(inner?.data).not.toHaveProperty('localDefinition')
    expect(nodesIn(inner?.data.draft).map((n) => n.id)).toEqual(['deep-edit'])
  })

  it('folds a depth-3 chain: edit-mode Shared inside a local fn inside the root body', () => {
    const deepest = runSharedInEdit('s3', { stampedNodes: [runLog('deepest-edit')] })
    const mid = runLocalFn('mid', [deepest])
    const root = viewRoot([mid])

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    const midNode = nodesIn(resolved.draft).find((n) => n.id === 'mid')
    const inner = nodesIn(midNode?.data.localDefinition).find((n) => n.id === 's3')
    expect(inner?.data).not.toHaveProperty('localDefinition')
    expect(nodesIn(inner?.data.draft).map((n) => n.id)).toEqual(['deepest-edit'])
  })

  it('uses the persisted draft when the root has no transient working body', () => {
    const root = runSharedInEdit('view-shared-root', { draftNodes: [runLog('persisted')] })

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    expect(resolved.version).toBe('1.0.0')
    expect(nodesIn(resolved.draft).map((n) => n.id)).toEqual(['persisted'])
  })

  it('pins the published version when the edit-mode root has no draft at all', () => {
    const root = runSharedInEdit('view-shared-root')
    delete root.data.draft

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    expect(resolved.draft).toBeNull()
    expect(resolved.version).toBe('1.0.0')
  })

  it('defaults an absent draft workflow to empty nodes/edges', () => {
    const root = runSharedInEdit('view-shared-root')
    root.data.draft = { name: 'view-shared-root', inputs: [], outputs: [] }

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    expect(resolved.version).toBe('1.0.0')
    expect(resolved.draft?.workflow).toEqual({ nodes: [], edges: [] })
  })

  it('defaults a draft workflow without a nodes array to empty nodes', () => {
    const root = runSharedInEdit('view-shared-root')
    root.data.draft = { name: 'view-shared-root', inputs: [], outputs: [], workflow: {} }

    const resolved = resolveViewRunBody(fvm, drillPath, [root] as never)

    expect(resolved.version).toBe('1.0.0')
    expect(nodesIn(resolved.draft)).toEqual([])
  })
})
