/**
 * useRegressionRunDialog hook tests.
 *
 * Covers opening the dialog, per-(suite, test) subset mutation, suite-level
 * toggle, submission with pair-shaped selected_tests, and duplicate map
 * surfaced to consumers for badge rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createSimpleRouterWrapper } from '../../../utils/router-test-utils'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/features/executions/api/executions', () => ({
  startExecution: vi.fn(),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionSuitesWithTests: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { startExecution } from '@/features/executions/api/executions'
import { fetchRegressionSuitesWithTests } from '@/features/regressions/api/crud'
import { useRegressionRunDialog } from '@/features/regressions/hooks/use-regression-run-dialog'

const SAMPLE_SUITES = [
  {
    id: 's1',
    name: 'Auth',
    tests: [
      { id: 't1', name: 'Login' },
      { id: 't2', name: 'Logout' },
    ],
  },
  {
    id: 's2',
    name: 'Billing',
    tests: [
      { id: 't1', name: 'Login' }, // same test appears in two suites
      { id: 't3', name: 'Invoice' },
    ],
  },
]

const ENVIRONMENTS = [
  { id: 'env-1', name: 'Development' },
  { id: 'env-2', name: 'Staging' },
]

describe('useRegressionRunDialog', () => {
  const wrapper = createSimpleRouterWrapper()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the dialog with all (suite, test) pairs pre-selected', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })

    expect(result.current.isOpen).toBe(true)
    const allSelected = result.current.regressionSuites.every((s) =>
      s.tests.every((t) => t.selected)
    )
    expect(allSelected).toBe(true)
  })

  it('togglePair unselects only the (suite, test) pair, preserving other contexts of the same test', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })

    act(() => {
      result.current.togglePair('s1', 't1', false)
    })

    const s1 = result.current.regressionSuites.find((s) => s.id === 's1')!
    const s2 = result.current.regressionSuites.find((s) => s.id === 's2')!
    expect(s1.tests.find((t) => t.id === 't1')!.selected).toBe(false)
    expect(s2.tests.find((t) => t.id === 't1')!.selected).toBe(true)
  })

  it('toggleSuite selects or deselects every test inside a single suite', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })

    act(() => {
      result.current.toggleSuite('s2', false)
    })

    const s2 = result.current.regressionSuites.find((s) => s.id === 's2')!
    expect(s2.tests.every((t) => !t.selected)).toBe(true)
    // Other suite untouched
    const s1 = result.current.regressionSuites.find((s) => s.id === 's1')!
    expect(s1.tests.every((t) => t.selected)).toBe(true)
  })

  it('submit calls startExecution with pair-shaped selected_tests and navigates', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-reg' })

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })
    act(() => {
      result.current.togglePair('s2', 't1', false)
      result.current.selectEnvironment('env-2')
    })

    await act(async () => {
      await result.current.submit()
    })

    expect(startExecution).toHaveBeenCalledWith({
      type: 'regression',
      id: 'reg-1',
      environmentId: 'env-2',
      selectedTests: [
        { suiteId: 's1', testId: 't1' },
        { suiteId: 's1', testId: 't2' },
        { suiteId: 's2', testId: 't3' },
      ],
    })
    expect(mockNavigate).toHaveBeenCalledWith('/executions/exec-reg')
  })

  it('exposes a duplicate-test map for tests appearing in 2+ suites of the regression', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })

    // t1 is in s1 and s2; t2 is only in s1; t3 is only in s2.
    expect(result.current.duplicateTests).toEqual({ t1: ['s1', 's2'] })
  })

  it('toggleAll deselects then reselects every test across all suites', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)
    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })
    await act(async () => { await result.current.openForRegression('reg-1', 'N') })

    act(() => { result.current.toggleAll(false) })
    const allDeselected = result.current.regressionSuites.every((s) =>
      s.tests.every((t) => !t.selected)
    )
    expect(allDeselected).toBe(true)

    act(() => { result.current.toggleAll(true) })
    const allSelected = result.current.regressionSuites.every((s) =>
      s.tests.every((t) => t.selected)
    )
    expect(allSelected).toBe(true)
  })

  it('reports a failed suites read and does not open the dialog', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockRejectedValue(new Error('Network'))
    const setError = vi.fn()
    const { result } = renderHook(() => useRegressionRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForRegression('reg-1', 'N') })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.regressionToRun).toBeNull()
    expect(result.current.regressionSuites).toEqual([])
    expect(mockToastError).toHaveBeenCalledWith('Network', 'Could Not Load Regression Suites')
    // The gesture reports itself. Nothing is sent to the page behind it.
    expect(setError).not.toHaveBeenCalled()
  })

  it('opens with an empty list when the regression genuinely has no suites', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue([])
    const setError = vi.fn()
    const { result } = renderHook(() => useRegressionRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForRegression('reg-1', 'Empty') })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.regressionToRun).toEqual({ id: 'reg-1', name: 'Empty' })
    expect(result.current.regressionSuites).toEqual([])
    expect(result.current.duplicateTests).toEqual({})
    expect(mockToastError).not.toHaveBeenCalled()
    expect(setError).not.toHaveBeenCalled()
  })

  it('reports a rejection that is not an Error', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockRejectedValue('gateway down')
    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForRegression('reg-1', 'N') })

    expect(result.current.isOpen).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('gateway down', 'Could Not Load Regression Suites')
  })

  it('submit is a no-op when no environment is selected', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)
    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForRegression('reg-1', 'N') })
    await act(async () => { await result.current.submit() })

    expect(startExecution).not.toHaveBeenCalled()
  })

  it('toggleSuiteExpand toggles the expanded flag on a suite', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)
    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })
    await act(async () => { await result.current.openForRegression('reg-1', 'N') })

    expect(result.current.regressionSuites[0].expanded).toBe(true)
    act(() => { result.current.toggleSuiteExpand('s1') })
    expect(result.current.regressionSuites[0].expanded).toBe(false)
  })

  it('submit reports error via setError when startExecution rejects', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)
    vi.mocked(startExecution).mockRejectedValue(new Error('Boom'))
    const setError = vi.fn()
    const { result } = renderHook(() => useRegressionRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForRegression('reg-1', 'N') })
    act(() => { result.current.selectEnvironment('env-1') })
    await act(async () => { await result.current.submit() })

    expect(setError).toHaveBeenCalledWith('Boom')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('drops a test from duplicateTests once it is selected in fewer than 2 suites', async () => {
    vi.mocked(fetchRegressionSuitesWithTests).mockResolvedValue(SAMPLE_SUITES)

    const { result } = renderHook(() => useRegressionRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForRegression('reg-1', 'Nightly')
    })
    expect(result.current.duplicateTests).toEqual({ t1: ['s1', 's2'] })

    // Deselect t1 in s1 -> only selected in s2 -> no longer a duplicate.
    act(() => {
      result.current.togglePair('s1', 't1', false)
    })
    expect(result.current.duplicateTests).toEqual({})

    // Deselect t1 in s2 too -> nothing selected -> still no badge.
    act(() => {
      result.current.togglePair('s2', 't1', false)
    })
    expect(result.current.duplicateTests).toEqual({})

    // Re-select in both -> badge comes back.
    act(() => {
      result.current.togglePair('s1', 't1', true)
      result.current.togglePair('s2', 't1', true)
    })
    expect(result.current.duplicateTests).toEqual({ t1: ['s1', 's2'] })
  })
})
