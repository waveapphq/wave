/**
 * Tests for useLoadTest - validation taxonomy branching.
 *
 * Per the unified flow:
 * - validation.fatal === true       -> open modal (mode='load', fatal=true)
 * - validation.errors.length > 0    -> open modal (mode='load', fatal=false) with Fix All
 * - only validation.warnings        -> NO modal; canvas loads with static alert icons
 *
 * Warnings are conveyed exclusively by the static alert icons via nodeIssues;
 * there is no load-warnings toast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useLoadTest } from '@/features/workbench/live/use-load-test'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

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

const mockFetchTest = vi.fn()
const mockFetchTestWorkflow = vi.fn()
const mockValidateTest = vi.fn()
const mockFetchSystemVariables = vi.fn()

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
  getOutputParams: vi.fn().mockReturnValue([]),
}))
vi.mock('@/lib/variable-defaults', () => ({
  getDefaultValueForType: () => '',
}))
vi.mock('@/features/workbench/live/variable-helpers', () => ({
  convertBackendVariables: () => [],
  convertSystemVariables: () => [],
}))
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual, secureRandomId: () => 'abc1234' }
})

interface StoreShape {
  reset: ReturnType<typeof vi.fn>
  setNodes: ReturnType<typeof vi.fn>
  setEdges: ReturnType<typeof vi.fn>
  setVariables: ReturnType<typeof vi.fn>
  markSaved: ReturnType<typeof vi.fn>
  setPulseValidationNodeIds: ReturnType<typeof vi.fn>
  requestFitView: ReturnType<typeof vi.fn>
  setCanvasReady: ReturnType<typeof vi.fn>
  setEditingTest: ReturnType<typeof vi.fn>
  setEditingTestSuiteIds: ReturnType<typeof vi.fn>
  setNamespaceVariables: ReturnType<typeof vi.fn>
  variables: unknown[]
  nodes: unknown[]
}

function defaultStore(): StoreShape {
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
    variables: [],
    nodes: [],
  }
}

function setupStore(overrides: Partial<StoreShape> = {}) {
  const actions = { ...defaultStore(), ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: StoreShape) => unknown)(actions)
  })
  ;(useWorkflowStore as unknown as { getState: () => StoreShape }).getState = () => actions
  return actions
}

function defaultCallbackParams() {
  return {
    clearDraft: vi.fn(),
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn() as unknown as (mode: 'load' | 'save' | 'run' | 'debug') => void,
    setShowValidationErrorDialog: vi.fn(),
  }
}

function makeTestDetails(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-1',
    name: 'My Test',
    version: '1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    description: '',
    tags: [],
    metadata: {},
    variables: {},
    suite_ids: [],
    suite_variables: [],
    regression_variables: [],
    ...overrides,
  }
}

describe('useLoadTest - validation branching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens modal mode="load" with fatal=true on fatal validation', async () => {
    setupStore()
    const cbs = defaultCallbackParams()
    mockFetchTest.mockResolvedValue(makeTestDetails())
    mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
    mockValidateTest.mockResolvedValue({
      fatal: true,
      errors: [{ code: 'MISSING_WORKFLOW', message: 'No workflow' }],
      warnings: [],
    })
    mockFetchSystemVariables.mockResolvedValue({})

    const { result } = renderHook(() =>
      useLoadTest(
        cbs.clearDraft,
        cbs.setValidationErrors,
        cbs.setValidationFatal,
        cbs.setValidationMode,
        cbs.setShowValidationErrorDialog,
      )
    )
    await act(async () => {
      await result.current.loadTest('test-1')
    })

    expect(cbs.setValidationFatal).toHaveBeenCalledWith(true)
    expect(cbs.setValidationMode).toHaveBeenCalledWith('load')
    expect(cbs.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
  })

  it('opens modal mode="load" with fatal=false on non-fatal errors', async () => {
    setupStore()
    const cbs = defaultCallbackParams()
    mockFetchTest.mockResolvedValue(makeTestDetails())
    mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
    mockValidateTest.mockResolvedValue({
      fatal: false,
      errors: [{ node_id: 'n1', code: 'MISSING_POSITION', message: 'No position' }],
      warnings: [],
    })
    mockFetchSystemVariables.mockResolvedValue({})

    const { result } = renderHook(() =>
      useLoadTest(
        cbs.clearDraft,
        cbs.setValidationErrors,
        cbs.setValidationFatal,
        cbs.setValidationMode,
        cbs.setShowValidationErrorDialog,
      )
    )
    await act(async () => {
      await result.current.loadTest('test-1')
    })

    expect(cbs.setValidationFatal).toHaveBeenCalledWith(false)
    expect(cbs.setValidationMode).toHaveBeenCalledWith('load')
    expect(cbs.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
  })

  it('does NOT open the modal when only warnings exist (warnings drive nodeIssues, no toast)', async () => {
    setupStore()
    const cbs = defaultCallbackParams()
    mockFetchTest.mockResolvedValue(makeTestDetails())
    mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
    mockValidateTest.mockResolvedValue({
      fatal: false,
      errors: [],
      warnings: [
        { node_id: 'n1', code: 'REQUIRED_PARAM_MISSING', message: 'Required url is missing' },
      ],
    })
    mockFetchSystemVariables.mockResolvedValue({})

    const { result } = renderHook(() =>
      useLoadTest(
        cbs.clearDraft,
        cbs.setValidationErrors,
        cbs.setValidationFatal,
        cbs.setValidationMode,
        cbs.setShowValidationErrorDialog,
      )
    )
    await act(async () => {
      await result.current.loadTest('test-1')
    })

    expect(cbs.setShowValidationErrorDialog).not.toHaveBeenCalledWith(true)
    // No load-warnings toast on load
    expect(mockToast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('required'),
      'Validation Warnings'
    )
  })

  it('does NOT open the modal when validation is fully clean', async () => {
    setupStore()
    const cbs = defaultCallbackParams()
    mockFetchTest.mockResolvedValue(makeTestDetails())
    mockFetchTestWorkflow.mockResolvedValue({ nodes: [], edges: [] })
    mockValidateTest.mockResolvedValue({ fatal: false, errors: [], warnings: [] })
    mockFetchSystemVariables.mockResolvedValue({})

    const { result } = renderHook(() =>
      useLoadTest(
        cbs.clearDraft,
        cbs.setValidationErrors,
        cbs.setValidationFatal,
        cbs.setValidationMode,
        cbs.setShowValidationErrorDialog,
      )
    )
    await act(async () => {
      await result.current.loadTest('test-1')
    })

    expect(cbs.setShowValidationErrorDialog).not.toHaveBeenCalledWith(true)
  })
})
