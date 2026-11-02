/**
 * Tests for useLoadTest hook
 *
 * Verifies test loading from API, workflow population, variable handling,
 * validation error display, and error recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLoadTest, stampMissingFunctionVersions, reconcileOutputBindingVariables } from '@/features/workbench/live/use-load-test'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'
import { PARAM_TYPE_TO_VAR_TYPE } from '@/features/workbench/lib/node-parameters/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/features/workbench/stores/workflow-store')
vi.mock('@/components/ui/toast', () => ({
  useToast: () => mockToast,
}))

// Module-level mock functions - these are the same references used by the
// vi.mock factories, so configuring them (e.g., mockResolvedValue) in tests
// directly controls what the hook's dynamic imports return.
const mockFetchTest = vi.fn()
const mockFetchTestWorkflow = vi.fn()
const mockValidateTest = vi.fn()
const mockFetchSystemVariables = vi.fn()
const mockConvertBackendVariables = vi.fn().mockReturnValue([])
const mockConvertSystemVariables = vi.fn().mockReturnValue([])
const mockListFunctionVersions = vi.fn()

// The hook uses dynamic imports from specific submodules
vi.mock('@/features/tests/api/crud', () => ({
  fetchTest: (...args: unknown[]) => mockFetchTest(...args),
  fetchTestWorkflow: (...args: unknown[]) => mockFetchTestWorkflow(...args),
  fetchTests: vi.fn(),
  transformApiTest: vi.fn(),
  deleteTest: vi.fn(),
  cloneTest: vi.fn(),
  batchDeleteTests: vi.fn(),
  batchUpdateTests: vi.fn(),
  createTest: vi.fn(),
  updateTest: vi.fn(),
  updateTestMetadata: vi.fn(),
  fetchTestsTags: vi.fn(),
}))
vi.mock('@/features/tests/api/validation', () => ({
  validateTest: (...args: unknown[]) => mockValidateTest(...args),
  fixTest: vi.fn(),
}))

vi.mock('@/features/settings/api/global-variables/crud', () => ({
  fetchSystemVariables: (...args: unknown[]) => mockFetchSystemVariables(...args),
}))

vi.mock('@/features/workbench/lib/node-parameters', () => ({
  getInputParams: vi.fn().mockReturnValue(undefined),
  getOutputParams: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    secureRandomId: () => 'abc1234',
  }
})

vi.mock('@/features/workbench/live/variable-helpers', () => ({
  convertBackendVariables: (...args: unknown[]) => mockConvertBackendVariables(...args),
  convertSystemVariables: (...args: unknown[]) => mockConvertSystemVariables(...args),
}))

vi.mock('@/features/functions/api/functions-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/functions/api/functions-api')>()),
  listFunctionVersions: (...args: unknown[]) => mockListFunctionVersions(...args),
}))

// The parser load is one of the reads the hook settles, so it is controlled
// here rather than left to load real WASM.
const mockInitializeTreeSitter = vi.fn()
vi.mock('@/features/workbench/lib/tree-sitter-init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/tree-sitter-init')>()),
  initializeTreeSitter: (...args: unknown[]) => mockInitializeTreeSitter(...args),
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

function defaultStoreActions() {
  return {
    reset: vi.fn(),
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    setVariables: vi.fn(),
    markSaved: vi.fn(),
    setPulseValidationNodeIds: vi.fn(),
    requestFitView: vi.fn(),
    setCanvasReady: vi.fn(),
    setEditingTest: vi.fn(),
    setEditingTestSuiteIds: vi.fn(),
    setNamespaceVariables: vi.fn(),
    // State used by getState() inside reconcileOutputBindingVariables
    variables: [] as Array<{ id: string; name: string; value: unknown; type: string }>,
    nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  }
}

function setupStore(overrides: Record<string, unknown> = {}) {
  const actions = { ...defaultStoreActions(), ...overrides }

  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof actions) => unknown)(actions)
  })

  // Mock static getState for reconcile function
  ;(useWorkflowStore as unknown as { getState: () => typeof actions }).getState = () => actions

  return actions
}

/** Resolves once a mocked read has actually been invoked by the hook. */
async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 100 && mock.mock.calls.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function defaultCallbackParams() {
  return {
    clearDraft: vi.fn(),
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn() as (mode: 'load' | 'save' | 'run' | 'debug') => void,
    setShowValidationErrorDialog: vi.fn(),
  }
}

// Standard test API response shapes
function makeTestDetails(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-1',
    name: 'My Test',
    version: '1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    description: 'A test',
    tags: [],
    metadata: { parent_suite: 'suite-1' },
    variables: {},
    ...overrides,
  }
}

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      { id: 'n1', type: 'block', position: { x: 0, y: 0 }, data: { label: 'Block 1' } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n1' },
    ],
    ...overrides,
  }
}

/** Set up mock returns for a typical successful API call */
function setupSuccessfulApiMocks(overrides?: {
  testDetails?: Record<string, unknown>
  workflow?: Record<string, unknown>
  validation?: { fatal: boolean; errors: unknown[]; warnings: unknown[] }
  globalVars?: Record<string, unknown>
}) {
  mockFetchTest.mockResolvedValue(makeTestDetails(overrides?.testDetails))
  mockFetchTestWorkflow.mockResolvedValue(makeWorkflow(overrides?.workflow))
  mockValidateTest.mockResolvedValue(
    overrides?.validation ?? { fatal: false, errors: [], warnings: [] }
  )
  mockFetchSystemVariables.mockResolvedValue(overrides?.globalVars ?? {})
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The "Test not found" dialog is raised through the shared store, not a callback.
const deletedTestRaise = vi.fn()

describe('useLoadTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
    usePageBlockStore.setState({ block: null, retrying: false })
    // Restore default return values after clearAllMocks clears them
    mockConvertBackendVariables.mockReturnValue([])
    mockConvertSystemVariables.mockReturnValue([])
    mockInitializeTreeSitter.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Initial state ---

  it('returns isLoadingTest=false initially', () => {
    setupStore()
    const cbs = defaultCallbackParams()

    const { result } = renderHook(() =>
      useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
    )

    expect(result.current.isLoadingTest).toBe(false)
    expect(typeof result.current.loadTest).toBe('function')
  })

  // --- Successful load ---

  describe('loadTest - successful load', () => {
    it('fetches test data, workflow, validation and sets nodes/edges', async () => {
      setupSuccessfulApiMocks()
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(mockFetchTest).toHaveBeenCalledWith('test-1')
      expect(mockFetchTestWorkflow).toHaveBeenCalledWith('test-1')
      expect(actions.setCanvasReady).toHaveBeenCalledWith(false)
      expect(actions.reset).toHaveBeenCalled()
      expect(actions.setEditingTest).toHaveBeenCalledWith('test-1', 'My Test')
      expect(actions.setNodes).toHaveBeenCalled()
      expect(actions.setEdges).toHaveBeenCalled()
      expect(actions.markSaved).toHaveBeenCalled()
      expect(cbs.clearDraft).toHaveBeenCalled()
      expect(actions.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(result.current.isLoadingTest).toBe(false)
    })

    it('sets nodes with skipDirty option', async () => {
      setupSuccessfulApiMocks()
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(actions.setNodes).toHaveBeenCalledWith(
        expect.any(Array),
        { skipDirty: true }
      )
      expect(actions.setEdges).toHaveBeenCalledWith(
        expect.any(Array),
        { skipDirty: true }
      )
    })

    it('defaults missing or invalid node positions to {x:0,y:0} so React Flow does not crash', async () => {
      // Without this guard, non-fatal MISSING_POSITION / INVALID_POSITION
      // errors let the workflow load with broken positions and React Flow
      // throws on `position.x` access.
      setupSuccessfulApiMocks({
        workflow: {
          nodes: [
            { id: 'no-pos', type: 'block', data: { label: 'A' } },
            { id: 'undef-x', type: 'block', position: { x: undefined, y: 5 }, data: {} },
            { id: 'nan-y', type: 'block', position: { x: 1, y: NaN }, data: {} },
            { id: 'inf-x', type: 'block', position: { x: Infinity, y: 0 }, data: {} },
            { id: 'good', type: 'block', position: { x: 10, y: 20 }, data: {} },
          ],
          edges: [],
        },
      })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-broken-pos')
      })

      const setNodesCall = actions.setNodes.mock.calls[0]
      const safeNodes = setNodesCall[0] as Array<{ id: string; position: { x: number; y: number } }>
      expect(safeNodes.find((n) => n.id === 'no-pos')!.position).toEqual({ x: 0, y: 0 })
      expect(safeNodes.find((n) => n.id === 'undef-x')!.position).toEqual({ x: 0, y: 5 })
      expect(safeNodes.find((n) => n.id === 'nan-y')!.position).toEqual({ x: 1, y: 0 })
      expect(safeNodes.find((n) => n.id === 'inf-x')!.position).toEqual({ x: 0, y: 0 })
      expect(safeNodes.find((n) => n.id === 'good')!.position).toEqual({ x: 10, y: 20 })
    })
  })

  // --- Empty workflow ---

  describe('loadTest - empty workflow', () => {
    it('does not call setNodes/setEdges when workflow has no nodes', async () => {
      setupSuccessfulApiMocks({ workflow: { nodes: [], edges: [] } })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // setNodes and setEdges should NOT be called for empty workflow
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(actions.setEdges).not.toHaveBeenCalled()
    })
  })

  // --- Validation errors on load ---

  describe('loadTest - validation errors', () => {
    it('shows validation dialog for fatal errors and does not load workflow', async () => {
      setupSuccessfulApiMocks({
        validation: {
          fatal: true,
          errors: [{ path: '/nodes/0', code: 'MISSING', message: 'Missing element', node_id: 'n1' }],
          warnings: [],
        },
      })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(cbs.setValidationErrors).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ code: 'MISSING' })])
      )
      expect(cbs.setValidationFatal).toHaveBeenCalledWith(true)
      expect(cbs.setValidationMode).toHaveBeenCalledWith('load')
      expect(cbs.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      // setEditingTest should still be called for fatal errors
      expect(actions.setEditingTest).toHaveBeenCalledWith('test-1', 'My Test')
      // reset should NOT be called - early return before reset
      expect(actions.reset).not.toHaveBeenCalled()
    })

    it('shows validation dialog for non-fatal errors AND still loads the workflow', async () => {
      // Per user spec: Cancel on a Load validation dialog keeps the blocks
      // visible with regular alerts. The test must therefore be loaded into
      // the canvas - the dialog overlays the loaded workflow, and Cancel
      // simply dismisses it without rolling the load back.
      setupSuccessfulApiMocks({
        validation: {
          fatal: false,
          errors: [{ path: '/nodes/0', code: 'BAD_PARAM', message: 'Bad value' }],
          warnings: [],
        },
      })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(cbs.setValidationFatal).toHaveBeenCalledWith(false)
      expect(cbs.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      // Non-fatal errors do not block the load: reset/setNodes are called.
      expect(actions.reset).toHaveBeenCalled()
      expect(actions.setNodes).toHaveBeenCalled()
    })

    it('still blocks the load when validation is fatal', async () => {
      setupSuccessfulApiMocks({
        validation: {
          fatal: true,
          errors: [
            { path: '/a', code: 'E1', message: 'err1', node_id: 'n1' },
          ],
          warnings: [],
        },
      })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Fatal errors still block: the workflow is not rendered onto the canvas.
      expect(actions.setNodes).not.toHaveBeenCalled()
    })
  })

  // Validation warnings on Load do not toast - they drive the static
  // alert icons via nodeIssues (see use-load-test-flow.test.ts for the
  // canonical contract).

  // --- Variables ---

  describe('loadTest - variables', () => {
    it('converts and loads backend variables', async () => {
      setupSuccessfulApiMocks({
        testDetails: {
          variables: { myVar: { type: 'string', value: 'hello' } },
        },
      })
      mockConvertBackendVariables.mockReturnValue([
        { id: 'v1', name: 'myVar', value: 'hello', type: 'string' },
      ])

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(mockConvertBackendVariables).toHaveBeenCalledWith({
        myVar: { type: 'string', value: 'hello' },
      })
      expect(actions.setVariables).toHaveBeenCalledWith(
        [{ id: 'v1', name: 'myVar', value: 'hello', type: 'string' }],
        { skipDirty: true }
      )
    })

    it('sets empty variables when test has no variables', async () => {
      setupSuccessfulApiMocks({ testDetails: { variables: {} } })
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(actions.setVariables).toHaveBeenCalledWith([], { skipDirty: true })
    })

    it('raises no toast for variables that carry no value', async () => {
      setupSuccessfulApiMocks({
        testDetails: {
          variables: { k8s_session: { type: 'string' } },
        },
      })
      mockConvertBackendVariables.mockReturnValue([
        { id: 'v1', name: 'k8s_session', type: 'string' },
      ])

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(mockToast.warning).not.toHaveBeenCalled()
    })
  })

  // --- Global variables ---

  describe('loadTest - system variables', () => {
    it('stores system variables as namespace entries', async () => {
      setupSuccessfulApiMocks({
        globalVars: { systemVar1: { type: 'string', value: 'hello' } },
      })
      mockConvertSystemVariables.mockReturnValue([
        { name: 'systemVar1', type: 'string' },
      ])

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(mockConvertSystemVariables).toHaveBeenCalled()
      expect(actions.setNamespaceVariables).toHaveBeenCalledWith('system', [
        { name: 'systemVar1', type: 'string' },
      ])
    })

    it('skips system variable merge when no system vars returned', async () => {
      setupSuccessfulApiMocks({ globalVars: {} })
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // convertSystemVariables should NOT be called for empty system vars
      expect(mockConvertSystemVariables).not.toHaveBeenCalled()
    })
  })

  // --- Suite variables ---

  describe('loadTest - suite variables', () => {
    it('stores suite variables from test detail response', async () => {
      setupSuccessfulApiMocks({
        testDetails: {
          suite_variables: [
            { name: 'base_url', type: 'string' },
            { name: 'timeout', type: 'integer' },
          ],
        },
      })

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(actions.setNamespaceVariables).toHaveBeenCalledWith('suite', [
        { name: 'base_url', type: 'string' },
        { name: 'timeout', type: 'integer' },
      ])
    })

    it('sets empty suite namespace entries when no suite_variables', async () => {
      setupSuccessfulApiMocks()
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(actions.setNamespaceVariables).toHaveBeenCalledWith('suite', [])
    })

    it('stores each suite variable name and type', async () => {
      setupSuccessfulApiMocks({
        testDetails: {
          suite_variables: [{ name: 'count', type: 'integer' }],
        },
      })

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(actions.setNamespaceVariables).toHaveBeenCalledWith('suite', [
        { name: 'count', type: 'integer' },
      ])
    })
  })

  // --- API errors ---

  describe('loadTest - API errors', () => {
    it('handles API error gracefully and still calls requestFitView', async () => {
      mockFetchTest.mockRejectedValue(new Error('Network error'))
      // These won't matter since Promise.all will reject, but set them to avoid noise
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load test:', expect.any(Error))
      expect(actions.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(result.current.isLoadingTest).toBe(false)
      consoleSpy.mockRestore()
    })

    it('propagates a workflow read failure to the load error path', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockRejectedValue(new Error('Workflow gone'))
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load test:', expect.any(Error))
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load test')
      consoleSpy.mockRestore()
    })
  })

  // --- The test read itself ---

  describe('loadTest - the test read blocks the canvas', () => {
    function serverError(message: string) {
      return Object.assign(new Error(message), { status: 500 })
    }

    it('blocks the canvas when the test read fails with anything but a deleted test', async () => {
      mockFetchTest.mockRejectedValue(serverError('Server error'))
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load test')
      expect(block?.detail.message).toBe('Server error')
      expect(block?.detail.status).toBe(500)
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(actions.markSaved).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('loads the canvas and clears the card when the retry succeeds', async () => {
      mockFetchTest
        .mockRejectedValueOnce(serverError('Server error'))
        .mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })
      expect(usePageBlockStore.getState().block).not.toBeNull()

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(mockFetchTest).toHaveBeenCalledTimes(2)
      expect(actions.setNodes).toHaveBeenCalled()
      expect(actions.markSaved).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('keeps the card with the newest reason when the retry fails again', async () => {
      mockFetchTest
        .mockRejectedValueOnce(serverError('Server error'))
        .mockRejectedValueOnce(serverError('Still down'))
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('Still down')
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('Still down')
      expect(actions.setNodes).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('reports the failed test read without waiting for the supporting reads', async () => {
      mockFetchTest.mockRejectedValue(serverError('Server error'))
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockImplementation(() => new Promise(() => {}))
      mockFetchSystemVariables.mockImplementation(() => new Promise(() => {}))
      mockInitializeTreeSitter.mockImplementation(() => new Promise(() => {}))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block?.title).toBe('Could not load test')
      expect(actions.requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0 })
      expect(result.current.isLoadingTest).toBe(false)
      consoleSpy.mockRestore()
    })

    it('keeps the test read reason when both primary reads fail', async () => {
      mockFetchTest.mockRejectedValue(serverError('Test store down'))
      mockFetchTestWorkflow.mockRejectedValue(serverError('Workflow store down'))
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load test')
      expect(block?.detail.message).toBe('Test store down')
      consoleSpy.mockRestore()
    })

    it('discards supporting failures when the test read fails', async () => {
      mockFetchTest.mockRejectedValue(serverError('Server error'))
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockRejectedValue(new Error('Validation down'))
      mockFetchSystemVariables.mockRejectedValue(new Error('Vars down'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block?.title).toBe('Could not load test')
      consoleSpy.mockRestore()
    })

    it('does not block a page the canvas has already left', async () => {
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      let failTest: ((reason: unknown) => void) | null = null
      mockFetchTest.mockImplementation(
        () => new Promise((_resolve, reject) => { failTest = reject })
      )
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setupStore()
      const cbs = defaultCallbackParams()

      const { result, unmount } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.loadTest('test-1')
        await waitForCall(mockFetchTest)
      })
      unmount()

      await act(async () => {
        failTest!(serverError('Server error'))
        await pending
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      consoleSpy.mockRestore()
    })
  })

  // --- A test that is gone ---

  describe('loadTest - the test no longer exists', () => {
    function notFound() {
      return Object.assign(new Error('Not found'), { status: 404 })
    }

    it('cleans up silently when a background restore hits a deleted test', async () => {
      mockFetchTest.mockRejectedValue(notFound())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-gone', { silentNotFound: true })
      })

      expect(actions.setCanvasReady).toHaveBeenLastCalledWith(true)
      expect(deletedTestRaise).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('hands a deleted test to the caller on a load the user asked for', async () => {
      mockFetchTest.mockRejectedValue(notFound())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const actions = setupStore({ editingTestName: 'My Test' })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-gone')
      })

      expect(deletedTestRaise).toHaveBeenCalledWith({ testId: 'test-gone', testName: 'My Test' })
      expect(actions.reset).not.toHaveBeenCalled()
    })

    it('hands a deleted test to the caller without waiting for the supporting reads', async () => {
      mockFetchTest.mockRejectedValue(notFound())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockImplementation(() => new Promise(() => {}))
      mockFetchSystemVariables.mockImplementation(() => new Promise(() => {}))
      mockInitializeTreeSitter.mockImplementation(() => new Promise(() => {}))
      const actions = setupStore({ editingTestName: 'My Test' })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-gone')
      })

      expect(deletedTestRaise).toHaveBeenCalledWith({ testId: 'test-gone', testName: 'My Test' })
      expect(actions.setCanvasReady).toHaveBeenLastCalledWith(true)
    })

    it('leaves a deleted test to the dialog: no block card and no generic load error', async () => {
      mockFetchTest.mockRejectedValue(notFound())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-gone')
      })

      expect(deletedTestRaise).toHaveBeenCalledOnce()
      expect(consoleSpy).not.toHaveBeenCalled()
      expect(usePageBlockStore.getState().block).toBeNull()
      consoleSpy.mockRestore()
    })
  })

  // --- Supporting reads: validation and system variables ---

  describe('loadTest - supporting reads block the page', () => {
    it('blocks the page instead of loading the canvas as if validation had passed', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockRejectedValue(new Error('Validation API down'))
      mockFetchSystemVariables.mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load test validation')
      expect(block?.detail.message).toBe('Validation API down')
      // Nothing about the test reaches the canvas.
      expect(actions.reset).not.toHaveBeenCalled()
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(actions.setEdges).not.toHaveBeenCalled()
      expect(actions.markSaved).not.toHaveBeenCalled()
      expect(cbs.clearDraft).not.toHaveBeenCalled()
      expect(cbs.setShowValidationErrorDialog).not.toHaveBeenCalled()
    })

    it('does not coerce invalid node positions when the validation read failed', async () => {
      // The (0,0) coercion is only safe because the validation dialog reports the
      // bad positions and Fix All writes real ones back. With validation
      // unavailable the canvas must not be shown altered and then marked saved.
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue({
        nodes: [
          { id: 'no-pos', type: 'block', data: { label: 'A' } },
          { id: 'good', type: 'block', position: { x: 10, y: 20 }, data: {} },
        ],
        edges: [],
      })
      mockValidateTest.mockRejectedValue(new Error('Validation API down'))
      mockFetchSystemVariables.mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-broken-pos')
      })

      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(actions.markSaved).not.toHaveBeenCalled()
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    it('blocks the page when the system variables read fails', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockRejectedValue(new Error('System vars API down'))

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load system variables')
      expect(block?.detail.message).toBe('System vars API down')
      expect(actions.setNodes).not.toHaveBeenCalled()
    })

    it('clears its own earlier block once both supporting reads succeed', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest
        .mockRejectedValueOnce(new Error('Validation API down'))
        .mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })
      expect(usePageBlockStore.getState().block).not.toBeNull()

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('leaves a failed read another surface raised alone', async () => {
      setupSuccessfulApiMocks()
      usePageBlockStore.getState().setBlock({
        owner: 'another-surface',
        label: 'environments',
        detail: { message: 'Environments API down' },
        retry: async () => {},
      })
      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
    })

    it('retries only the validation read and then loads the canvas', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest
        .mockRejectedValueOnce(new Error('Validation API down'))
        .mockResolvedValueOnce({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(mockValidateTest).toHaveBeenCalledTimes(2)
      // The read that succeeded is not run again.
      expect(mockFetchSystemVariables).toHaveBeenCalledTimes(1)
      expect(mockFetchTest).toHaveBeenCalledTimes(1)
      expect(actions.reset).toHaveBeenCalled()
      expect(actions.setNodes).toHaveBeenCalled()
      expect(actions.markSaved).toHaveBeenCalled()
    })

    it('keeps the page blocked with the newest reason when the retry fails again', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest
        .mockRejectedValueOnce(new Error('Validation API down'))
        .mockRejectedValueOnce(new Error('Still down'))
      mockFetchSystemVariables.mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('Still down')
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('Still down')
      expect(actions.setNodes).not.toHaveBeenCalled()
    })

    it('retries only the system variables read', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables
        .mockRejectedValueOnce(new Error('System vars API down'))
        .mockResolvedValueOnce({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(mockFetchSystemVariables).toHaveBeenCalledTimes(2)
      expect(mockValidateTest).toHaveBeenCalledTimes(1)
      expect(actions.setNodes).toHaveBeenCalled()
    })

    it('keeps the page blocked when the system variables retry fails again', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables
        .mockRejectedValueOnce(new Error('System vars API down'))
        .mockRejectedValueOnce(new Error('System vars still down'))

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow(
          'System vars still down'
        )
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('System vars still down')
    })

    it('names both supporting reads when both of them fail', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockRejectedValue(new Error('Validation API down'))
      mockFetchSystemVariables.mockRejectedValue(new Error('System vars API down'))

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load test validation and system variables')
      expect(block?.detail.message).toContain('Validation API down')
      expect(block?.detail.message).toContain('System vars API down')
    })

    it('loads the canvas once when both failed reads are retried together', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest
        .mockRejectedValueOnce(new Error('Validation API down'))
        .mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables
        .mockRejectedValueOnce(new Error('System vars API down'))
        .mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(actions.markSaved).toHaveBeenCalledTimes(1)
      expect(actions.setNodes).toHaveBeenCalledTimes(1)
    })

    it('treats a validation read that resolves with nothing as a clean read', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue(null)
      mockFetchSystemVariables.mockResolvedValue({})

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(actions.setNodes).toHaveBeenCalled()
      expect(actions.markSaved).toHaveBeenCalled()
    })

    it('treats a system variables read that resolves with nothing as a clean read', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue(null)

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(actions.markSaved).toHaveBeenCalled()
    })
  })

  // --- The expression parser is a read like any other ---

  describe('loadTest - the expression parser read', () => {
    it('blocks the page instead of loading a canvas that can raise no reference alerts', async () => {
      setupSuccessfulApiMocks()
      mockInitializeTreeSitter.mockRejectedValue(new Error('Tree-sitter failed to load: 404'))

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load expression validation')
      expect(block?.detail.message).toBe('Tree-sitter failed to load: 404')
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(actions.markSaved).not.toHaveBeenCalled()
    })

    it('names the parser beside the other reads that failed in the same load', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockRejectedValue(new Error('Validation API down'))
      mockFetchSystemVariables.mockResolvedValue({})
      mockInitializeTreeSitter.mockRejectedValue(new Error('WASM missing'))

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load test validation and expression validation')
      expect(block?.detail.message).toContain('WASM missing')
    })

    it('retries only the parser and then loads the canvas', async () => {
      setupSuccessfulApiMocks()
      mockInitializeTreeSitter
        .mockRejectedValueOnce(new Error('WASM missing'))
        .mockResolvedValueOnce(undefined)

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      expect(mockInitializeTreeSitter).toHaveBeenCalledTimes(2)
      expect(mockValidateTest).toHaveBeenCalledTimes(1)
      expect(actions.setNodes).toHaveBeenCalled()
      expect(actions.markSaved).toHaveBeenCalled()
    })

    it('keeps the page blocked with the newest reason when the parser retry fails again', async () => {
      setupSuccessfulApiMocks()
      mockInitializeTreeSitter
        .mockRejectedValueOnce(new Error('WASM missing'))
        .mockRejectedValueOnce(new Error('Still missing'))

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('Still missing')
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('Still missing')
    })
  })

  // --- The workbench that started the load owns the result ---

  describe('loadTest - the load belongs to the canvas that started it', () => {
    it('leaves the store alone when the canvas is gone before the reads resolve', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockFetchSystemVariables.mockResolvedValue({})
      let releaseValidation: ((value: unknown) => void) | null = null
      mockValidateTest.mockImplementation(
        () => new Promise((resolve) => { releaseValidation = resolve })
      )

      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result, unmount } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.loadTest('test-1')
        await waitForCall(mockValidateTest)
      })
      unmount()

      await act(async () => {
        releaseValidation!({ fatal: false, errors: [], warnings: [] })
        await pending
      })

      expect(actions.reset).not.toHaveBeenCalled()
      expect(actions.setEditingTest).not.toHaveBeenCalled()
      expect(actions.setNodes).not.toHaveBeenCalled()
      expect(cbs.clearDraft).not.toHaveBeenCalled()
    })

    it('does not block a page the canvas has already left', async () => {
      mockFetchTest.mockResolvedValue(makeTestDetails())
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockFetchSystemVariables.mockResolvedValue({})
      let failValidation: ((reason: unknown) => void) | null = null
      mockValidateTest.mockImplementation(
        () => new Promise((_resolve, reject) => { failValidation = reject })
      )

      setupStore()
      const cbs = defaultCallbackParams()

      const { result, unmount } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.loadTest('test-1')
        await waitForCall(mockValidateTest)
      })
      unmount()

      await act(async () => {
        failValidation!(new Error('Validation API down'))
        await pending
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })
  })

  // --- Function version reads ---

  describe('loadTest - Function versions', () => {
    function sharedNode(id: string, functionId: string) {
      return {
        id,
        data: { functionLifecycle: 'shared', functionId, functionVersion: '1.0.0' },
      }
    }

    it('reports a failed Function versions read and still loads the canvas', async () => {
      setupSuccessfulApiMocks()
      mockListFunctionVersions.mockRejectedValue(new Error('Library down'))
      const actions = setupStore({ nodes: [sharedNode('fn-1', 'lib-1')] })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const block = usePageBlockStore.getState().block
      expect(block?.title).toBe('Could not load Function versions')
      expect(block?.detail.message).toBe('Library down')
      expect(actions.markSaved).toHaveBeenCalled()
    })

    it('names every Function whose versions read failed', async () => {
      setupSuccessfulApiMocks()
      mockListFunctionVersions.mockImplementation((functionId: string) =>
        Promise.reject(new Error(`${functionId} unreachable`))
      )
      setupStore({ nodes: [sharedNode('fn-1', 'lib-1'), sharedNode('fn-2', 'lib-2')] })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const message = usePageBlockStore.getState().block!.detail.message
      expect(message).toContain('lib-1')
      expect(message).toContain('lib-1 unreachable')
      expect(message).toContain('lib-2 unreachable')
    })

    it('stamps the missing version and clears the block when the retry succeeds', async () => {
      setupSuccessfulApiMocks()
      mockListFunctionVersions
        .mockRejectedValueOnce(new Error('Library down'))
        .mockResolvedValueOnce({ versions: [{ version: '2.0.0' }] })
      const actions = setupStore({ nodes: [sharedNode('fn-1', 'lib-1')] })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })
      await act(async () => {
        await usePageBlockStore.getState().block!.retry()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
      const stamped = actions.setNodes.mock.calls.at(-1)![0] as Array<{
        data: Record<string, unknown>
      }>
      expect(stamped[0].data.missingVersion).toBe(true)
    })

    it('does not report a versions failure once the canvas is gone', async () => {
      setupSuccessfulApiMocks()
      let failVersions: ((reason: unknown) => void) | null = null
      mockListFunctionVersions.mockImplementation(
        () => new Promise((_resolve, reject) => { failVersions = reject })
      )
      setupStore({ nodes: [sharedNode('fn-1', 'lib-1')] })
      const cbs = defaultCallbackParams()

      const { result, unmount } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = result.current.loadTest('test-1')
        await waitForCall(mockListFunctionVersions)
      })
      unmount()

      await act(async () => {
        failVersions!(new Error('Library down'))
        await pending
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('keeps the block with the newest reason when the versions retry fails again', async () => {
      setupSuccessfulApiMocks()
      mockListFunctionVersions
        .mockRejectedValueOnce(new Error('Library down'))
        .mockRejectedValueOnce(new Error('Library still down'))
      setupStore({ nodes: [sharedNode('fn-1', 'lib-1')] })
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })
      await act(async () => {
        await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow(
          'Library still down'
        )
      })

      expect(usePageBlockStore.getState().block?.detail.message).toBe('Library still down')
    })
  })

  // --- Output binding reconciliation ---

  describe('reconcileOutputBindingVariables', () => {
    it('creates a missing variable when output binding references a non-existent variable', async () => {
      setupSuccessfulApiMocks()
      // The store's variables (at the time reconciliation runs) has no variable named 'my_var'.
      // A node has an output binding pointing to 'my_var'.
      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-1',
            data: {
              label: 'HTTP Request',
              elementType: 'http-request',
              version: '1.0.0',
              config: {
                outputBindings: { result: 'my_var' },
              },
            },
          },
        ],
      })

      // Schema declares an output named 'result' with type 'string'
      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'result', type: 'string', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // reconcileOutputBindingVariables should have called setVariables with the new variable
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'my_var')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ id: string; name: string; type: string; value?: unknown }>
      const createdVar = vars.find((v) => v.name === 'my_var')
      expect(createdVar).toBeDefined()
      expect(createdVar!.type).toBe('string')
      // A Block writes this variable at run time: it is declared unset.
      expect('value' in createdVar!).toBe(false)
      expect(createdVar!.id).toContain('var-my_var-')
      expect(createdVar!.id).toContain('abc1234')
      // The reconcile call should use skipDirty
      expect(reconcileCall![1]).toEqual({ skipDirty: true })
    })

    it('leaves undeclared a bound variable the load dialog reports, and declares an unreported one', async () => {
      setupSuccessfulApiMocks({
        validation: {
          fatal: false,
          errors: [
            {
              path: 'variables.reported_var',
              node_id: 'node-1',
              code: 'UNDECLARED_VARIABLE',
              message: "Variable 'reported_var' is used in 1 block(s) but not declared in variable manager",
              severity: 'error',
              fix_action: 'Add variable to manager (type: string)',
            },
          ],
          warnings: [],
        },
      })
      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-1',
            data: {
              label: 'HTTP Request',
              elementType: 'http-request',
              version: '1.0.0',
              config: { outputBindings: { result: 'reported_var', status: 'quiet_var' } },
            },
          },
        ],
      })
      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'result', type: 'string', description: '' },
        { name: 'status', type: 'string', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )
      await act(async () => {
        await result.current.loadTest('test-1')
      })

      expect(cbs.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
      const declared = actions.setVariables.mock.calls.flatMap(
        (call: unknown[]) => (call[0] as Array<{ name: string }>).map((v) => v.name),
      )
      expect(declared).toEqual(['quiet_var'])
    })

    it('fixes type mismatch when existing variable has wrong type', async () => {
      setupSuccessfulApiMocks()

      // Populate PARAM_TYPE_TO_VAR_TYPE so 'integer' maps to 'integer'
      const paramMap = PARAM_TYPE_TO_VAR_TYPE as Record<string, string>
      paramMap['integer'] = 'integer'

      const existingVar = {
        id: 'v-existing',
        name: 'counter',
        value: '0',
        type: 'string', // Wrong type - should be integer
      }

      const actions = setupStore({
        variables: [existingVar],
        nodes: [
          {
            id: 'node-2',
            data: {
              label: 'Counter Node',
              elementType: 'counter',
              version: '2.0.0',
              config: {
                outputBindings: { count: 'counter' },
              },
            },
          },
        ],
      })

      // Schema declares output 'count' with type 'integer'
      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'count', type: 'integer', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Find the reconcile setVariables call that fixes the type
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ id: string; type: string }>
          return vars.some((v) => v.id === 'v-existing' && v.type === 'integer')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ id: string; type: string }>
      const fixedVar = vars.find((v) => v.id === 'v-existing')
      expect(fixedVar!.type).toBe('integer')
      expect(reconcileCall![1]).toEqual({ skipDirty: true })

      // Clean up PARAM_TYPE_TO_VAR_TYPE mutation
      delete paramMap['integer']
    })

    it('creates a missing integer variable unset, with no value key', async () => {
      setupSuccessfulApiMocks()

      const paramMap = PARAM_TYPE_TO_VAR_TYPE as Record<string, string>
      paramMap['integer'] = 'integer'

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-int',
            data: {
              label: 'For Loop',
              elementType: 'for',
              version: '1.0.0',
              config: {
                outputBindings: { index: 'loop_i' },
              },
            },
          },
        ],
      })

      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'index', type: 'integer', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'loop_i')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ name: string; type: string; value?: unknown }>
      const createdVar = vars.find((v) => v.name === 'loop_i')
      expect(createdVar).toBeDefined()
      expect(createdVar!.type).toBe('integer')
      expect('value' in createdVar!).toBe(false)

      delete paramMap['integer']
    })

    it('does not call setVariables for reconciliation when all bindings match', async () => {
      setupSuccessfulApiMocks()

      const existingVar = {
        id: 'v-match',
        name: 'output_val',
        value: 'hello',
        type: 'string',
      }

      const actions = setupStore({
        variables: [existingVar],
        nodes: [
          {
            id: 'node-3',
            data: {
              label: 'Matched Node',
              elementType: 'simple-block',
              version: '1.0.0',
              config: {
                outputBindings: { response: 'output_val' },
              },
            },
          },
        ],
      })

      // Schema declares output 'response' with type 'string'
      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'response', type: 'string', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // setVariables should be called for regular variable loading, but NOT for reconciliation.
      // Regular load calls setVariables with [], { skipDirty: true } (line 112 - empty test vars).
      // Reconciliation should NOT produce an additional call since nothing needs fixing.
      // Check that no call contains a variable named 'output_val' with type 'string'
      // that was newly created (the reconciliation would only call setVariables
      // if there are missing vars or type fixes).
      const reconcileCalls = actions.setVariables.mock.calls.filter(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          // Reconciliation would add new vars or fix types - look for calls that
          // contain 'output_val' (which would mean it was "fixed" or re-added)
          return vars.length > 0 && vars.some((v) => v.name === 'output_val')
        }
      )
      // The only call with 'output_val' would be if reconciliation added it or fixed it.
      // Since it already exists with correct type, reconciliation should make NO call at all.
      // The regular variable loading (line 112) sets variables to [] since test has no variables.
      // So no call should have 'output_val' in the vars array.
      expect(reconcileCalls).toHaveLength(0)
    })

    it('retypes a bound variable when the Block output changed from array to table', () => {
      const paramMap = PARAM_TYPE_TO_VAR_TYPE as Record<string, string>
      paramMap['table'] = 'table'

      const actions = setupStore({
        variables: [{ id: 'v-top', name: 'res_top', type: 'array' }],
        nodes: [
          {
            id: 'node-top',
            data: {
              label: 'K8s Top',
              elementType: 'k8s-top',
              version: '1.0.0',
              config: { outputBindings: { usage: 'res_top' } },
            },
          },
        ],
      })

      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'usage', type: 'table', description: '' },
      ])

      reconcileOutputBindingVariables(actions.setVariables)

      expect(actions.setVariables).toHaveBeenCalledTimes(1)
      const [vars, opts] = actions.setVariables.mock.calls[0] as [
        Array<{ id: string; type: string }>,
        { skipDirty?: boolean },
      ]
      expect(vars.find((v) => v.id === 'v-top')!.type).toBe('table')
      expect(opts).toEqual({ skipDirty: true })

      delete paramMap['table']
    })

    it('skips nodes without outputBindings', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-no-bindings',
            data: {
              label: 'Plain Node',
              elementType: 'plain',
              version: '1.0.0',
              config: {},
            },
          },
          {
            id: 'node-no-config',
            data: {
              label: 'No Config',
              elementType: 'empty',
              version: '1.0.0',
            },
          },
        ],
      })

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // No reconciliation-related setVariables call should happen beyond
      // the regular load call (which sets vars to []).
      // The regular load sets variables to [] (line 112).
      // Reconciliation should not call setVariables since no bindings exist.
      const allCalls = actions.setVariables.mock.calls
      // Only the regular load call (empty array)
      expect(allCalls).toHaveLength(1)
      expect(allCalls[0][0]).toEqual([])
    })

    it('skips empty varName values in output bindings', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-empty-binding',
            data: {
              label: 'Empty Binding',
              elementType: 'test-block',
              version: '1.0.0',
              config: {
                outputBindings: { result: '' },
              },
            },
          },
        ],
      })

      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'result', type: 'string', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Only the regular load call; reconciliation should skip empty varName
      expect(actions.setVariables.mock.calls).toHaveLength(1)
      expect(actions.setVariables.mock.calls[0][0]).toEqual([])
    })

    it('uses default type "string" when output param is not in schema', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-unknown-output',
            data: {
              label: 'Unknown Output',
              elementType: 'custom-block',
              version: '1.0.0',
              config: {
                outputBindings: { unknown_param: 'new_var' },
              },
            },
          },
        ],
      })

      // Schema has no outputs - so outputTypes map will be empty
      vi.mocked(getOutputParams).mockReturnValue([])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Should create a variable with default type 'string'
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'new_var')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ name: string; type: string }>
      const createdVar = vars.find((v) => v.name === 'new_var')
      expect(createdVar!.type).toBe('string')
    })

    it('does not create duplicate variables for the same name across multiple nodes', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-a',
            data: {
              label: 'Node A',
              elementType: 'block-a',
              version: '1.0.0',
              config: {
                outputBindings: { result: 'shared_var' },
              },
            },
          },
          {
            id: 'node-b',
            data: {
              label: 'Node B',
              elementType: 'block-b',
              version: '1.0.0',
              config: {
                outputBindings: { output: 'shared_var' },
              },
            },
          },
        ],
      })

      vi.mocked(getOutputParams).mockReturnValue([
        { name: 'result', type: 'string', description: '' },
      ])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Find the reconciliation call
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'shared_var')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ name: string }>
      // 'shared_var' should appear exactly once (not duplicated)
      const sharedVarCount = vars.filter((v) => v.name === 'shared_var').length
      expect(sharedVarCount).toBe(1)
    })

    it('uses elementType and version defaults when not provided on node data', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-no-meta',
            data: {
              label: 'Minimal Node',
              config: {
                outputBindings: { out: 'meta_var' },
              },
            },
          },
        ],
      })

      vi.mocked(getOutputParams).mockReturnValue([])

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // getOutputParams should be called with the default element type
      expect(getOutputParams).toHaveBeenCalledWith('')

      // Variable should still be created with default 'string' type
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'meta_var')
        }
      )
      expect(reconcileCall).toBeDefined()
    })

    it('handles null schema from getOutputParams', async () => {
      setupSuccessfulApiMocks()

      const actions = setupStore({
        variables: [],
        nodes: [
          {
            id: 'node-null-schema',
            data: {
              label: 'Null Schema',
              elementType: 'unknown-type',
              version: '1.0.0',
              config: {
                outputBindings: { out: 'null_schema_var' },
              },
            },
          },
        ],
      })

      // Return null schema - the code uses schema?.outputs ?? []
      vi.mocked(getOutputParams).mockReturnValue(null as unknown as ReturnType<typeof getOutputParams>)

      const cbs = defaultCallbackParams()
      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // Should still create the variable with default 'string' type
      const reconcileCall = actions.setVariables.mock.calls.find(
        (call: unknown[]) => {
          const vars = call[0] as Array<{ name: string }>
          return vars.some((v) => v.name === 'null_schema_var')
        }
      )
      expect(reconcileCall).toBeDefined()
      const vars = reconcileCall![0] as Array<{ name: string; type: string }>
      expect(vars.find((v) => v.name === 'null_schema_var')!.type).toBe('string')
    })

    describe('an output whose declared type follows other fields (K8SREAD-6)', () => {
      const EVENTS_RESULT = [
        {
          name: 'result',
          type: 'array',
          description: '',
          typeWhen: [
            { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
            { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
          ],
        },
      ]

      const FORMAT_INPUT = [
        {
          name: 'output_format',
          label: 'Output Format',
          type: 'string',
          required: false,
          description: '',
          defaultValue: 'map',
        },
      ]

      async function loadEventsNode(
        values: Record<string, unknown>,
        storedType: string,
      ): Promise<string | undefined> {
        setupSuccessfulApiMocks()
        const paramMap = PARAM_TYPE_TO_VAR_TYPE as Record<string, string>
        paramMap.array = 'array'
        paramMap.string = 'string'
        paramMap.table = 'table'

        const actions = setupStore({
          variables: [{ id: 'v-events', name: 'ev', value: null, type: storedType }],
          nodes: [
            {
              id: 'node-events',
              data: {
                label: 'K8s Events',
                elementType: 'k8s-events',
                version: '1.0.0',
                config: { values, outputBindings: { result: 'ev' } },
              },
            },
          ],
        })

        vi.mocked(getOutputParams).mockReturnValue(
          EVENTS_RESULT as unknown as ReturnType<typeof getOutputParams>,
        )
        vi.mocked(getInputParams).mockReturnValue(
          FORMAT_INPUT as unknown as ReturnType<typeof getInputParams>,
        )

        const cbs = defaultCallbackParams()
        const { result } = renderHook(() =>
          useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
        )

        await act(async () => {
          await result.current.loadTest('test-1')
        })

        const reconcileCall = actions.setVariables.mock.calls.find((call: unknown[]) => {
          const vars = call[0] as Array<{ id: string }>
          return vars.some((v) => v.id === 'v-events')
        })
        const vars = (reconcileCall?.[0] ?? []) as Array<{ id: string; type: string }>
        delete paramMap.array
        delete paramMap.string
        delete paramMap.table
        return vars.find((v) => v.id === 'v-events')?.type
      }

      it('retypes the bound variable to string for a stored YAML format', async () => {
        expect(await loadEventsNode({ output_format: 'yaml' }, 'array')).toBe('string')
      })

      it('retypes to array when no format is stored, through the parameter default', async () => {
        expect(await loadEventsNode({}, 'string')).toBe('array')
      })

      it('leaves a variable that already matches the resolved type alone', async () => {
        expect(await loadEventsNode({ output_format: 'table' }, 'table')).toBeUndefined()
      })
    })

    // A script variable is declared by the block's own settings, so the schema
    // carries no type for it and the bound variable's type stands (SHRUN-6).
    describe('an output the schema does not declare', () => {
      const shellNode = (outputBindings: Record<string, string>) => ({
        id: 'node-shell',
        data: {
          label: 'Count lines',
          elementType: 'shell-script',
          version: '1.0.0',
          config: { outputBindings },
        },
      })

      it('leaves an integer variable bound to a script variable untouched', () => {
        const actions = setupStore({
          variables: [
            { id: 'v-out', name: 'log_text', type: 'string' },
            { id: 'v-count', name: 'line_count', type: 'integer' },
          ],
          nodes: [shellNode({ stdout: 'log_text', COUNT: 'line_count' })],
        })

        vi.mocked(getOutputParams).mockReturnValue([
          { name: 'stdout', type: 'string', description: '' },
        ])

        reconcileOutputBindingVariables(actions.setVariables)

        expect(actions.setVariables).not.toHaveBeenCalled()
      })

      it('declares a missing variable bound to a script variable as string', () => {
        const actions = setupStore({
          variables: [],
          nodes: [shellNode({ COUNT: 'line_count' })],
        })

        vi.mocked(getOutputParams).mockReturnValue([
          { name: 'stdout', type: 'string', description: '' },
        ])

        reconcileOutputBindingVariables(actions.setVariables)

        expect(actions.setVariables).toHaveBeenCalledTimes(1)
        const [vars, opts] = actions.setVariables.mock.calls[0] as [
          Array<{ id: string; name: string; type: string }>,
          { skipDirty?: boolean },
        ]
        expect(vars).toHaveLength(1)
        expect(vars[0].name).toBe('line_count')
        expect(vars[0].type).toBe('string')
        expect(vars[0].id).toContain('var-line_count-')
        expect(opts).toEqual({ skipDirty: true })
      })
    })
  })

  // --- Loading state transitions ---

  describe('loadTest - loading state', () => {
    it('sets isLoadingTest to true during load and false after', async () => {
      let resolveTest: (val: unknown) => void
      const testPromise = new Promise((resolve) => { resolveTest = resolve })

      mockFetchTest.mockReturnValue(testPromise)
      mockFetchTestWorkflow.mockResolvedValue(makeWorkflow())
      mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
      mockFetchSystemVariables.mockResolvedValue({})

      setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      // Start load without awaiting
      let loadPromise: Promise<void>
      act(() => {
        loadPromise = result.current.loadTest('test-1')
      })

      // isLoadingTest should be true during load
      expect(result.current.isLoadingTest).toBe(true)

      // Resolve the fetch
      await act(async () => {
        resolveTest!(makeTestDetails())
        await loadPromise!
      })

      expect(result.current.isLoadingTest).toBe(false)
    })

    it('sets canvasReady to false at start of load', async () => {
      setupSuccessfulApiMocks()
      const actions = setupStore()
      const cbs = defaultCallbackParams()

      const { result } = renderHook(() =>
        useLoadTest(cbs.clearDraft, cbs.setValidationErrors, cbs.setValidationFatal, cbs.setValidationMode, cbs.setShowValidationErrorDialog)
      )

      await act(async () => {
        await result.current.loadTest('test-1')
      })

      // setCanvasReady(false) should be the first call
      expect(actions.setCanvasReady).toHaveBeenCalledWith(false)
    })
  })
})

describe('stampMissingFunctionVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  it('does nothing when there are no Shared Function instances', async () => {
    const actions = setupStore({ nodes: [{ id: 'plugin-1', data: { elementType: 'http-client' } }] })
    await stampMissingFunctionVersions()
    expect(mockListFunctionVersions).not.toHaveBeenCalled()
    expect(actions.setNodes).not.toHaveBeenCalled()
  })

  it('stamps missingVersion on a Shared instance pinned to an absent version', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-miss', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '9.9.9' } },
        { id: 'fn-ok', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } },
      ],
    })
    mockListFunctionVersions.mockResolvedValue({ versions: [{ version: '1.0.0' }] })

    await stampMissingFunctionVersions()

    expect(mockListFunctionVersions).toHaveBeenCalledWith('lib-1')
    const [stamped, opts] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: Record<string, unknown> }>,
      { skipDirty: boolean },
    ]
    expect(opts).toEqual({ skipDirty: true })
    expect(stamped.find((n) => n.id === 'fn-miss')!.data.missingVersion).toBe(true)
    expect(stamped.find((n) => n.id === 'fn-ok')!.data.missingVersion).toBeUndefined()
  })

  it('does not stamp when every pinned version is available', async () => {
    const actions = setupStore({
      nodes: [{ id: 'fn-ok', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } }],
    })
    mockListFunctionVersions.mockResolvedValue({ versions: [{ version: '1.0.0' }, { version: '2.0.0' }] })
    await stampMissingFunctionVersions()
    expect(actions.setNodes).not.toHaveBeenCalled()
  })

  it('does not stamp when the versions fetch fails', async () => {
    const actions = setupStore({
      nodes: [{ id: 'fn-miss', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '9.9.9' } }],
    })
    mockListFunctionVersions.mockRejectedValue(new Error('boom'))
    await stampMissingFunctionVersions()
    expect(actions.setNodes).not.toHaveBeenCalled()
  })

  it('returns the failed version reads instead of dropping them', async () => {
    setupStore({
      nodes: [{ id: 'fn-miss', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '9.9.9' } }],
    })
    const reason = new Error('boom')
    mockListFunctionVersions.mockRejectedValue(reason)

    await expect(stampMissingFunctionVersions()).resolves.toEqual([
      { functionId: 'lib-1', reason },
    ])
  })

  it('treats a Function the library no longer holds as an answer, not a failure', async () => {
    const actions = setupStore({
      nodes: [{ id: 'fn-gone', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } }],
    })
    mockListFunctionVersions.mockRejectedValue(
      Object.assign(new Error("Function 'lib-1' not found"), { status: 404 }),
    )

    // No failure to report, and no missing-VERSION stamp either: the whole
    // entry is gone, which the config modal names with its own banner.
    await expect(stampMissingFunctionVersions()).resolves.toEqual([])
    expect(actions.setNodes).not.toHaveBeenCalled()
  })

  it('returns no failures when every version read succeeds', async () => {
    setupStore({
      nodes: [{ id: 'fn-ok', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } }],
    })
    mockListFunctionVersions.mockResolvedValue({ versions: [{ version: '1.0.0' }] })

    await expect(stampMissingFunctionVersions()).resolves.toEqual([])
  })

  it('ignores Shared instances missing functionId or functionVersion', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-no-id', data: { functionLifecycle: 'shared', functionVersion: '1.0.0' } },
        { id: 'fn-no-ver', data: { functionLifecycle: 'shared', functionId: 'lib-1' } },
      ],
    })
    await stampMissingFunctionVersions()
    expect(mockListFunctionVersions).not.toHaveBeenCalled()
    expect(actions.setNodes).not.toHaveBeenCalled()
  })
})

// REQ-3.1.2.4: the stamp puts each Shared instance's pinned contract on the node, where blockInputParams reads it.
describe('stampMissingFunctionVersions - resolved schema (REQ-3.1.2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  it('stamps resolvedInputs from the pinned version contract', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-1', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } },
      ],
    })
    mockListFunctionVersions.mockResolvedValue({
      versions: [
        {
          version: '1.0.0',
          inputs: [{ name: 'user_id', type: 'string', required: true }],
          outputs: [{ name: 'token', type: 'string' }],
        },
      ],
    })

    await stampMissingFunctionVersions()

    expect(actions.setNodes).toHaveBeenCalled()
    const [stamped] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: Record<string, unknown> }>,
      { skipDirty: boolean },
    ]
    expect(stamped.find((n) => n.id === 'fn-1')!.data.resolvedInputs).toEqual([
      { name: 'user_id', type: 'string', required: true },
    ])
  })

  it('stamps resolvedOutputs from the pinned version contract', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-1', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } },
      ],
    })
    mockListFunctionVersions.mockResolvedValue({
      versions: [
        {
          version: '1.0.0',
          inputs: [{ name: 'user_id', type: 'string', required: true }],
          outputs: [{ name: 'token', type: 'string' }],
        },
      ],
    })

    await stampMissingFunctionVersions()

    const [stamped] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: Record<string, unknown> }>,
      { skipDirty: boolean },
    ]
    expect(stamped.find((n) => n.id === 'fn-1')!.data.resolvedOutputs).toEqual([
      { name: 'token', type: 'string' },
    ])
  })

  it('resolves the contract from the pinned version, not the latest', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-1', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } },
      ],
    })
    // v1 requires user_id; v2 (latest) drops it. The stamp must resolve v1.
    mockListFunctionVersions.mockResolvedValue({
      versions: [
        { version: '1.0.0', inputs: [{ name: 'user_id', type: 'string', required: true }], outputs: [] },
        { version: '2.0.0', inputs: [], outputs: [] },
      ],
    })

    await stampMissingFunctionVersions()

    const [stamped] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: Record<string, unknown> }>,
      { skipDirty: boolean },
    ]
    expect(stamped.find((n) => n.id === 'fn-1')!.data.resolvedInputs).toEqual([
      { name: 'user_id', type: 'string', required: true },
    ])
  })

  it('stamps the contract on a Shared instance inside a Local Function body', async () => {
    const actions = setupStore({
      nodes: [
        {
          id: 'fn-host',
          data: {
            functionLifecycle: 'local',
            localDefinition: {
              inputs: [],
              outputs: [],
              workflow: {
                nodes: [{ id: 'fn-inner', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } }],
                edges: [],
              },
            },
          },
        },
      ],
    })
    mockListFunctionVersions.mockResolvedValue({
      versions: [{ version: '1.0.0', inputs: [{ name: 'who', type: 'string', required: true }], outputs: [] }],
    })

    await stampMissingFunctionVersions()

    expect(mockListFunctionVersions).toHaveBeenCalledWith('lib-1')
    const [stamped] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: { localDefinition: { workflow: { nodes: Array<{ data: Record<string, unknown> }> } } } }>,
    ]
    expect(stamped[0].data.localDefinition.workflow.nodes[0].data.resolvedInputs).toEqual([
      { name: 'who', type: 'string', required: true },
    ])
  })

  it('does not stamp resolved schema onto a Local Function node', async () => {
    const actions = setupStore({
      nodes: [
        { id: 'fn-shared', data: { functionLifecycle: 'shared', functionId: 'lib-1', functionVersion: '1.0.0' } },
        {
          id: 'fn-local',
          data: {
            functionLifecycle: 'local',
            localDefinition: { inputs: [], outputs: [], workflow: { nodes: [], edges: [] } },
          },
        },
      ],
    })
    mockListFunctionVersions.mockResolvedValue({
      versions: [{ version: '1.0.0', inputs: [{ name: 'user_id', type: 'string', required: true }], outputs: [] }],
    })

    await stampMissingFunctionVersions()

    const [stamped] = actions.setNodes.mock.calls[0] as [
      Array<{ id: string; data: Record<string, unknown> }>,
      { skipDirty: boolean },
    ]
    expect(stamped.find((n) => n.id === 'fn-local')!.data.resolvedInputs).toBeUndefined()
  })
})
