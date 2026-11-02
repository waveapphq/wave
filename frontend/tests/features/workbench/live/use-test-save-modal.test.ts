/**
 * Tests for useTestSave - unified validation modal flow.
 *
 * After the unification, on 422 from updateTest:
 * - modal opens with mode='save'
 * - the pulse set is NOT populated eagerly; it is populated by
 *   handleValidationClose (the modal Close handler) based on the
 *   stored validationMode.
 *
 * The dead `validateOutputBindings` toast in handleSaveClick / handleSave is
 * removed; output-binding mismatches are gated INLINE in the config modal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useTestSave } from '@/features/workbench/live/use-test-save'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

vi.mock('@/features/workbench/stores/workflow-store')

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastWarning = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: mockToastWarning,
    info: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

const mockCreateTest = vi.fn()
const mockUpdateTest = vi.fn()
const mockUpdateTestMetadata = vi.fn()
vi.mock('@/features/tests/api/crud', () => ({
  createTest: (...args: unknown[]) => mockCreateTest(...args),
  updateTest: (...args: unknown[]) => mockUpdateTest(...args),
  updateTestMetadata: (...args: unknown[]) => mockUpdateTestMetadata(...args),
}))

// node-parameters: validateOutputBindings is not part of the save flow.
// We mock the module so callers don't fetch it. Tests rely on this mock to
// assert that the save flow does not toast on output binding mismatches.
const mockValidateOutputBindings = vi.fn().mockReturnValue([])
vi.mock('@/features/workbench/lib/node-parameters', () => ({
  validateOutputBindings: (...args: unknown[]) => mockValidateOutputBindings(...args),
}))

interface StoreShape {
  nodes: Array<{ id: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string }>
  reset: ReturnType<typeof vi.fn>
  markSaved: ReturnType<typeof vi.fn>
  setPulseValidationNodeIds: ReturnType<typeof vi.fn>
  clearPulseValidationNodeId: ReturnType<typeof vi.fn>
  requestFitView: ReturnType<typeof vi.fn>
  editingTestId: string | null
  editingTestName: string | null
  setEditingTest: ReturnType<typeof vi.fn>
  clearEditingTest: ReturnType<typeof vi.fn>
  variables: Array<{ id: string; name: string; value: unknown; type: string; isExpression?: boolean }>
  setSaveInFlight: ReturnType<typeof vi.fn>
}

const baseStore: StoreShape = {
  nodes: [],
  edges: [],
  reset: vi.fn(),
  markSaved: vi.fn(),
  setPulseValidationNodeIds: vi.fn(),
  clearPulseValidationNodeId: vi.fn(),
  requestFitView: vi.fn(),
  editingTestId: null,
  editingTestName: null,
  setEditingTest: vi.fn(),
  clearEditingTest: vi.fn(),
  variables: [],
  setSaveInFlight: vi.fn(),
}

function setupStore(overrides: Partial<StoreShape> = {}): StoreShape {
  const state = { ...baseStore, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: StoreShape) => unknown)(state)
  })
  // The save handlers reach the save-in-flight gate via getState().setSaveInFlight.
  ;(useWorkflowStore as unknown as { getState: () => StoreShape }).getState = () => state
  return state
}

function defaultParams() {
  return {
    pendingEditTestId: null as string | null,
    setPendingEditTestId: vi.fn(),
    loadTest: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn(),
    resetWorkbenchRun: vi.fn(),
    setValidationErrors: vi.fn(),
    setValidationFatal: vi.fn(),
    setValidationMode: vi.fn() as unknown as (mode: 'load' | 'save' | 'run' | 'debug') => void,
    setShowValidationErrorDialog: vi.fn(),
  }
}

const wrapper = createSimpleRouterWrapper(['/workbench'])

describe('useTestSave - unified validation modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the modal with mode="save" on 422 with REQUIRED_PARAM_MISSING', async () => {
    setupStore({
      editingTestId: 'test-42',
      editingTestName: 'My Test',
      nodes: [{ id: 'n1', data: { label: 'A' } }],
      edges: [],
      variables: [],
    })
    mockUpdateTest.mockRejectedValueOnce({
      status: 422,
      details: [
        {
          path: 'workflow.nodes[0].data.config.values.url',
          node_id: 'n1',
          node_label: 'HTTP',
          element_type: 'http-client',
          code: 'REQUIRED_PARAM_MISSING',
          message: "Required parameter 'url' is missing",
        },
      ],
    })
    const params = defaultParams()
    const { result } = renderHook(() => useTestSave(params), { wrapper })

    await act(async () => {
      await result.current.handleSaveClick()
    })

    expect(params.setValidationMode).toHaveBeenCalledWith('save')
    expect(params.setShowValidationErrorDialog).toHaveBeenCalledWith(true)
    expect(params.setValidationFatal).toHaveBeenCalledWith(false)
  })

  it('does NOT populate the pulse set on 422 receipt (only on modal Close)', async () => {
    const store = setupStore({
      editingTestId: 'test-42',
      editingTestName: 'My Test',
      nodes: [{ id: 'n1', data: { label: 'A' } }],
      edges: [],
      variables: [],
    })
    mockUpdateTest.mockRejectedValueOnce({
      status: 422,
      details: [
        {
          node_id: 'n1',
          code: 'REQUIRED_PARAM_MISSING',
          message: "Required parameter 'url' is missing",
        },
      ],
    })
    const params = defaultParams()
    const { result } = renderHook(() => useTestSave(params), { wrapper })

    await act(async () => {
      await result.current.handleSaveClick()
    })

    // Pulse is populated by handleValidationClose, not by save error handling.
    expect(store.setPulseValidationNodeIds).not.toHaveBeenCalled()
  })

  it('does NOT show the legacy output-binding-type toast on save attempts (gated inline now)', async () => {
    // Even if validateOutputBindings reports errors, the unified flow does not
    // toasts in the save handler - the inline gate in the config modal blocks
    // saving before the user can hit Save with a mismatched binding.
    mockValidateOutputBindings.mockReturnValueOnce([
      { nodeLabel: 'Shell Script', paramName: 'stdout', paramType: 'string', varName: 'count', varType: 'integer' },
    ])
    setupStore({
      editingTestId: 'test-42',
      editingTestName: 'My Test',
      nodes: [{ id: 'n1', data: { label: 'A' } }],
      edges: [],
      variables: [],
    })
    mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
    const params = defaultParams()
    const { result } = renderHook(() => useTestSave(params), { wrapper })

    await act(async () => {
      await result.current.handleSaveClick()
    })

    const calls = mockToastError.mock.calls
    expect(calls.find((c) => String(c[1]) === 'Output binding type mismatch')).toBeUndefined()
    // Save still proceeds (no toast short-circuit)
    expect(mockUpdateTest).toHaveBeenCalled()
  })

  it('clears the pulse set on successful save', async () => {
    const store = setupStore({
      editingTestId: 'test-42',
      editingTestName: 'My Test',
      nodes: [{ id: 'n1', data: { label: 'A' } }],
      edges: [],
      variables: [],
    })
    mockUpdateTest.mockResolvedValueOnce({ id: 'test-42' })
    const params = defaultParams()
    const { result } = renderHook(() => useTestSave(params), { wrapper })

    await act(async () => {
      await result.current.handleSaveClick()
    })

    expect(store.setPulseValidationNodeIds).toHaveBeenCalledWith([])
  })
})
