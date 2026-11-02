/**
 * Tests for useTestRun - unified validation modal flow.
 *
 * Pre-run validation distinguishes Run vs Debug:
 * - handleRun -> blockIfValidationFails(testId, 'run') -> setValidationMode('run')
 * - handleDebug -> blockIfValidationFails(testId, 'debug') -> setValidationMode('debug')
 *
 * The pulse set is populated on modal Close via handleValidationClose,
 * NOT eagerly on validation failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useTestRun, type UseTestRunParams } from '@/features/workbench/live/use-test-run'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useDeletedTestStore } from '@/features/workbench/stores/deleted-test-store'

vi.mock('@/features/workbench/stores/workflow-store')

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
vi.mock('@/components/ui/toast', () => ({ useToast: () => mockToast }))

vi.mock('@/features/tests/api/crud', () => ({
  fetchTestWorkflow: vi.fn(),
  updateTest: vi.fn(),
}))
const mockValidateTest = vi.fn()
vi.mock('@/features/tests/api/validation', () => ({
  validateTest: (...args: unknown[]) => mockValidateTest(...args),
}))

interface StoreState {
  isDirty: boolean
  nodes: unknown[]
  edges: unknown[]
  setNodes: ReturnType<typeof vi.fn>
  setEdges: ReturnType<typeof vi.fn>
  markSaved: ReturnType<typeof vi.fn>
  setPulseValidationNodeIds: ReturnType<typeof vi.fn>
  clearPulseValidationNodeId: ReturnType<typeof vi.fn>
  editingTestId: string | null
  editingTestName: string | null
  variables: unknown[]
  skippedNodeIds: string[]
  getBreakpointList: () => string[]
  debugOptions: { pauseOnFirstBlock: boolean; pauseOnErrors: boolean }
  nodeIssues: Map<string, unknown[]>
}

function defaultStoreState(overrides: Partial<StoreState> = {}): StoreState {
  return {
    isDirty: false,
    nodes: [],
    edges: [],
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    markSaved: vi.fn(),
    setPulseValidationNodeIds: vi.fn(),
    clearPulseValidationNodeId: vi.fn(),
    editingTestId: 'test-1',
    editingTestName: 'My Test',
    variables: [],
    skippedNodeIds: [],
    getBreakpointList: () => [],
    debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false },
    nodeIssues: new Map(),
    ...overrides,
  }
}

function setupStore(overrides: Partial<StoreState> = {}) {
  const state = defaultStoreState(overrides)
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: StoreState) => unknown)(state)
  })
  ;(useWorkflowStore as unknown as { getState: () => StoreState }).getState = () => state
  ;(useWorkflowStore as unknown as { subscribe: (...args: unknown[]) => () => void }).subscribe = () => () => {}
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
    setValidationMode: vi.fn() as unknown as (mode: 'load' | 'save' | 'run' | 'debug') => void,
    setShowValidationErrorDialog: vi.fn(),
    ...overrides,
  }
}

// The "Test not found" dialog is raised through the shared store, not a prop.
const deletedTestRaise = vi.fn()

describe('useTestRun - unified validation modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDeletedTestStore.setState({ info: null, raise: deletedTestRaise })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Run flow: setValidationMode is called with "run" when pre-run validation fails', async () => {
    setupStore()
    mockValidateTest.mockResolvedValueOnce({
      fatal: false,
      errors: [
        { node_id: 'n1', code: 'REQUIRED_PARAM_MISSING', message: 'Missing url' },
      ],
      warnings: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(params.setValidationMode).toHaveBeenCalledWith('run')
    expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
  })

  it('Debug flow: setValidationMode is called with "debug" when pre-run validation fails', async () => {
    setupStore()
    mockValidateTest.mockResolvedValueOnce({
      fatal: false,
      errors: [
        { node_id: 'n1', code: 'REQUIRED_PARAM_MISSING', message: 'Missing url' },
      ],
      warnings: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('all')
    })

    expect(params.setValidationMode).toHaveBeenCalledWith('debug')
    expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
  })

  it('Run flow: does NOT populate pulse set on validation failure (handled by modal close)', async () => {
    const store = setupStore()
    mockValidateTest.mockResolvedValueOnce({
      fatal: false,
      errors: [
        { node_id: 'n1', code: 'REQUIRED_PARAM_MISSING', message: 'Missing url' },
      ],
      warnings: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(store.setPulseValidationNodeIds).not.toHaveBeenCalled()
  })

  it('Debug flow: does NOT populate pulse set on validation failure', async () => {
    const store = setupStore()
    mockValidateTest.mockResolvedValueOnce({
      fatal: false,
      errors: [
        { node_id: 'n1', code: 'REQUIRED_PARAM_MISSING', message: 'Missing url' },
      ],
      warnings: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleDebug('all')
    })

    expect(store.setPulseValidationNodeIds).not.toHaveBeenCalled()
  })

  it('Run flow: does not open the modal when validation passes', async () => {
    setupStore()
    mockValidateTest.mockResolvedValueOnce({
      fatal: false,
      errors: [],
      warnings: [],
    })
    const params = makeParams()
    const { result } = renderHook(() => useTestRun(params))

    await act(async () => {
      await result.current.handleRun('all')
    })

    expect(params.setShowValidationErrorDialog).not.toHaveBeenCalledWith(true)
  })
})
