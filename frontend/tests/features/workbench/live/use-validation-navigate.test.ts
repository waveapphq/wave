/**
 * `useValidation().navigateToIssue` drills to an issue's location, focuses
 * the failing leaf node, and dismisses the validation dialog.
 *
 * Navigation reuses the existing store primitives (`pushSharedDrill`,
 * `popDrillTo`, `setSelectedNodes`, `requestFitView`).
 * For a top-level issue (no enclosing-Function trail) it selects + fits the
 * leaf directly. Reduced-motion parity is preserved by fitting with no
 * animation, matching the existing fix-all behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useValidation } from '@/features/workbench/live/use-validation'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'
import type { ValidationError } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/features/workbench/stores/workflow-store')

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock('@/features/workbench/live/variable-helpers', () => ({
  convertBackendVariables: vi.fn().mockReturnValue([]),
}))

const storeFns = {
  reset: vi.fn(),
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  markSaved: vi.fn(),
  setPulseValidationNodeIds: vi.fn(),
  requestFitView: vi.fn(),
  setEditingTest: vi.fn(),
  clearEditingTest: vi.fn(),
  setVariables: vi.fn(),
  addVariable: vi.fn(),
  setSelectedNodes: vi.fn(),
  pushDrill: vi.fn(),
  pushSharedDrill: vi.fn(),
  popDrillTo: vi.fn(),
  popDrillOne: vi.fn(),
  editingTestId: 'test-1' as string | null,
}

function setupStore(overrides: Partial<typeof storeFns> = {}) {
  const state = { ...storeFns, ...overrides }
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state)
    }
    return state
  })
  // navigateToIssue drills through the shared `drillToPath` helper, which
  // reads the store via getState(); back the mock with the same fns.
  ;(useWorkflowStore as unknown as { getState: () => typeof state }).getState = () => state
  return state
}

const TOP_LEVEL_ISSUE: ValidationError = {
  path: 'nodes[0].data.config.values.url',
  node_id: 'http-1',
  node_label: 'HTTP_1',
  code: 'REQUIRED_PARAM_MISSING',
  message: "Required parameter 'url' is missing",
  severity: 'error',
}

const wrapper = createSimpleRouterWrapper()

describe('useValidation - navigateToIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes a navigateToIssue handler', () => {
    setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    expect(typeof result.current.navigateToIssue).toBe('function')
  })

  it('selects the failing leaf node for a top-level issue', () => {
    const store = setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.navigateToIssue(TOP_LEVEL_ISSUE)
    })
    expect(store.setSelectedNodes).toHaveBeenCalledWith(['http-1'])
  })

  it('fits the view after navigating', () => {
    const store = setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.navigateToIssue(TOP_LEVEL_ISSUE)
    })
    expect(store.requestFitView).toHaveBeenCalled()
  })

  it('dismisses the validation dialog after navigating', () => {
    setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.setShowValidationErrorDialog(true)
    })
    act(() => {
      result.current.navigateToIssue(TOP_LEVEL_ISSUE)
    })
    expect(result.current.showValidationErrorDialog).toBe(false)
  })

  const NESTED_ISSUE: ValidationError = {
    path: 'nodes[0]',
    functionPath: [
      { label: 'Outer_Fn', nodeId: 'outer-1' },
      { label: 'Inner_Fn', nodeId: 'inner-1' },
    ],
    node_id: 'log-1',
    node_label: 'Log_1',
    code: 'REQUIRED_PARAM_MISSING',
    message: "Required parameter 'message' is missing",
    severity: 'error',
  }

  it('drills through the enclosing Functions and selects the leaf for a nested issue', () => {
    const store = setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.navigateToIssue(NESTED_ISSUE)
    })
    expect(store.popDrillTo).toHaveBeenCalledWith(0)
    expect(store.pushDrill).toHaveBeenCalledWith('outer-1')
    expect(store.pushDrill).toHaveBeenCalledWith('inner-1')
    expect(store.setSelectedNodes).toHaveBeenCalledWith(['log-1'])
  })

  it('drills into the clicked segment without selecting the leaf', () => {
    const store = setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.navigateToIssue(NESTED_ISSUE, 0)
    })
    expect(store.pushDrill).toHaveBeenCalledWith('outer-1')
    expect(store.pushDrill).not.toHaveBeenCalledWith('inner-1')
    expect(store.setSelectedNodes).not.toHaveBeenCalled()
  })

  it('skips drill + selection when the trail has no node ids and the leaf has none', () => {
    const store = setupStore()
    const { result } = renderHook(() => useValidation(vi.fn()), { wrapper })
    act(() => {
      result.current.navigateToIssue({
        path: 'nodes[0]',
        functionPath: [{ label: 'Outer_Fn' }],
        code: 'REQUIRED_PARAM_MISSING',
        message: 'x',
        severity: 'error',
      })
    })
    expect(store.pushDrill).not.toHaveBeenCalled()
    expect(store.setSelectedNodes).not.toHaveBeenCalled()
    expect(store.requestFitView).toHaveBeenCalled()
  })
})
