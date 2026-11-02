/**
 * useSuiteRunDialog hook tests.
 *
 * Covers opening the dialog, test-subset mutation, environment selection,
 * submission (calls startExecution with selectedTests + navigates), and
 * error handling. Used by the suite list container AND the suite detail
 * page, so the hook is the single source of truth for Run dialog state.
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

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteTests: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { startExecution } from '@/features/executions/api/executions'
import { fetchSuiteTests } from '@/features/suites/api/crud'
import { useSuiteRunDialog } from '@/features/suites/hooks/use-suite-run-dialog'

const ENVIRONMENTS = [
  { id: 'env-1', name: 'Development' },
  { id: 'env-2', name: 'Staging' },
]

describe('useSuiteRunDialog', () => {
  const wrapper = createSimpleRouterWrapper()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the dialog and loads suite tests when openForSuite is called', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([
      { id: 't1', name: 'Login' },
      { id: 't2', name: 'Logout' },
    ])

    const setError = vi.fn()
    const { result } = renderHook(() => useSuiteRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForSuite('suite-1', 'Auth Suite')
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.suiteToRun).toEqual({ id: 'suite-1', name: 'Auth Suite' })
    expect(result.current.suiteTests).toEqual([
      { id: 't1', name: 'Login', selected: true },
      { id: 't2', name: 'Logout', selected: true },
    ])
  })

  it('toggles a test selection in place', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([
      { id: 't1', name: 'Login' },
      { id: 't2', name: 'Logout' },
    ])

    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForSuite('suite-1', 'Auth')
    })

    act(() => {
      result.current.toggleTest('t1', false)
    })

    expect(result.current.suiteTests.find((t) => t.id === 't1')?.selected).toBe(false)
    expect(result.current.suiteTests.find((t) => t.id === 't2')?.selected).toBe(true)
  })

  it('submit calls startExecution with selected test IDs and navigates on success', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([
      { id: 't1', name: 'Login' },
      { id: 't2', name: 'Logout' },
    ])
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-abc' })

    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForSuite('suite-1', 'Auth')
    })
    act(() => {
      result.current.toggleTest('t2', false)
      result.current.selectEnvironment('env-1')
    })

    await act(async () => {
      await result.current.submit()
    })

    expect(startExecution).toHaveBeenCalledWith({
      type: 'suite',
      id: 'suite-1',
      environmentId: 'env-1',
      selectedTests: ['t1'],
    })
    expect(mockNavigate).toHaveBeenCalledWith('/executions/exec-abc')
    expect(result.current.isOpen).toBe(false)
  })

  it('reports a failed test read and does not open the dialog', async () => {
    vi.mocked(fetchSuiteTests).mockRejectedValue(new Error('Net'))
    const setError = vi.fn()
    const { result } = renderHook(() => useSuiteRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForSuite('s1', 'S') })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.suiteToRun).toBeNull()
    expect(result.current.suiteTests).toEqual([])
    expect(mockToastError).toHaveBeenCalledWith('Net', 'Could Not Load Suite Tests')
    // The gesture reports itself. Nothing is sent to the page behind it.
    expect(setError).not.toHaveBeenCalled()
  })

  it('opens with an empty list when the suite genuinely has no tests', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([])
    const setError = vi.fn()
    const { result } = renderHook(() => useSuiteRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForSuite('s1', 'Empty Suite') })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.suiteToRun).toEqual({ id: 's1', name: 'Empty Suite' })
    expect(result.current.suiteTests).toEqual([])
    expect(mockToastError).not.toHaveBeenCalled()
    expect(setError).not.toHaveBeenCalled()
  })

  it('close clears the dialog back to its resting state', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([{ id: 't1', name: 'Login' }])
    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForSuite('s1', 'S') })
    act(() => { result.current.close() })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.suiteToRun).toBeNull()
    expect(result.current.suiteTests).toEqual([])
  })

  it('reports a rejection that is not an Error', async () => {
    vi.mocked(fetchSuiteTests).mockRejectedValue('gateway down')
    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForSuite('s1', 'S') })

    expect(result.current.isOpen).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('gateway down', 'Could Not Load Suite Tests')
  })

  it('submit is a no-op when no environment is selected', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([{ id: 't1', name: 'Login' }])
    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => { await result.current.openForSuite('s1', 'S') })
    // Don't select an environment
    await act(async () => { await result.current.submit() })

    expect(startExecution).not.toHaveBeenCalled()
  })

  it('reports error via setError when startExecution rejects', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([{ id: 't1', name: 'Login' }])
    vi.mocked(startExecution).mockRejectedValue(new Error('Boom'))

    const setError = vi.fn()
    const { result } = renderHook(() => useSuiteRunDialog({ setError, environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForSuite('suite-1', 'Auth')
    })
    act(() => {
      result.current.selectEnvironment('env-1')
    })

    await act(async () => {
      await result.current.submit()
    })

    expect(setError).toHaveBeenCalledWith('Boom')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('toggleAllTests flips every test to the given value', async () => {
    vi.mocked(fetchSuiteTests).mockResolvedValue([
      { id: 't1', name: 'A' },
      { id: 't2', name: 'B' },
      { id: 't3', name: 'C' },
    ])
    const { result } = renderHook(() => useSuiteRunDialog({ setError: vi.fn(), environments: ENVIRONMENTS }), { wrapper })

    await act(async () => {
      await result.current.openForSuite('suite-1', 'S')
    })

    act(() => {
      result.current.toggleAllTests(false)
    })
    expect(result.current.suiteTests.every((t) => !t.selected)).toBe(true)

    act(() => {
      result.current.toggleAllTests(true)
    })
    expect(result.current.suiteTests.every((t) => t.selected)).toBe(true)
  })
})
