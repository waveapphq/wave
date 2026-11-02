/**
 * useBreadcrumbContext Tests
 *
 * Exercises the workbench breadcrumb-context hook.
 * The hook computes:
 *   - segments[] (the breadcrumb path)
 *   - backHref (one step up)
 *   - isLoading (pending suite/regression/parent-execution name fetches)
 *
 * Inputs the hook reads:
 *   - useSearchParams: 'suiteId', 'regressionId'
 *   - useWorkbenchRun: executionId, sessionTestName, parentExecutionId
 *   - useWorkflowStore: editingTestId, editingTestName
 *   - fetchSuiteDetail / fetchRegressionDetail / fetchExecution for names
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockSearchParams {
  suiteId: string | null
  regressionId: string | null
}

interface MockWorkbenchRun {
  executionId: string | null
  sessionTestName: string | null
  parentExecutionId: string | null
}

interface MockWorkflow {
  editingTestId: string | null
  editingTestName: string | null
  drillPath: { nodeId: string; label: string }[]
}

const workbenchState: MockWorkbenchRun = {
  executionId: null,
  sessionTestName: null,
  parentExecutionId: null,
}

const workflowState: MockWorkflow = {
  editingTestId: null,
  editingTestName: null,
  drillPath: [],
}

let searchParamsState: MockSearchParams = { suiteId: null, regressionId: null }

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useSearchParams: () => {
      const params = new URLSearchParams()
      if (searchParamsState.suiteId) params.set('suiteId', searchParamsState.suiteId)
      if (searchParamsState.regressionId) params.set('regressionId', searchParamsState.regressionId)
      const setParams = vi.fn()
      return [params, setParams] as const
    },
  }
})

vi.mock('@/features/workbench/hooks/use-workbench-run', () => ({
  useWorkbenchRun: () => workbenchState,
}))

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const selectorImpl = (selector: (state: MockWorkflow) => unknown) => selector(workflowState)
  const useWorkflowStore = vi.fn(selectorImpl) as unknown as ((
    selector: (state: MockWorkflow) => unknown,
  ) => unknown) & { getState: () => MockWorkflow }
  useWorkflowStore.getState = () => workflowState
  return { useWorkflowStore }
})

const fetchSuiteDetailMock = vi.fn()
const fetchRegressionDetailMock = vi.fn()
const fetchExecutionMock = vi.fn()

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteDetail: (...args: unknown[]) => fetchSuiteDetailMock(...args),
}))
vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: (...args: unknown[]) => fetchRegressionDetailMock(...args),
}))
vi.mock('@/features/executions/api/executions', () => ({
  fetchExecution: (...args: unknown[]) => fetchExecutionMock(...args),
}))

import { useBreadcrumbContext } from '@/features/workbench/hooks/use-breadcrumb-context'
import { usePageBlockStore } from '@/stores/page-block-store'

interface Segment {
  type: 'execution-root' | 'execution' | 'test' | 'suite' | 'regression'
  label: string
  href?: string
  id?: string
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function resetState() {
  searchParamsState = { suiteId: null, regressionId: null }
  workbenchState.executionId = null
  workbenchState.sessionTestName = null
  workbenchState.parentExecutionId = null
  workflowState.editingTestId = null
  workflowState.editingTestName = null
  workflowState.drillPath = []
  fetchSuiteDetailMock.mockReset()
  fetchRegressionDetailMock.mockReset()
  fetchExecutionMock.mockReset()
}

describe('useBreadcrumbContext - segments matrix', () => {
  beforeEach(resetState)

  it('Draft mode: returns a single "Draft Workflow" test segment with null backHref', () => {
    // No test loaded, no execution active, no nav-origin params.
    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'Draft Workflow' })
    expect(result.current.backHref).toBeNull()
  })

  it('Edit Tests-origin: single test segment + backHref = /tests', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/tests')
  })

  it('Edit Suite-origin: [suite, test] + backHref = /suites/<id>', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(2)
    })
    const segments = result.current.segments as Segment[]
    expect(segments[0]).toMatchObject({ type: 'suite', label: 'Healthchecks', href: '/suites/suite-1' })
    expect(segments[1]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/suites/suite-1')
  })

  it('Edit Regression-origin: [regression, suite, test] + backHref preserves regressionId', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    searchParamsState.regressionId = 'reg-1'
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })
    fetchRegressionDetailMock.mockResolvedValue({ regression: { id: 'reg-1', name: 'Smoke - Prod' }, suites: [] })

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(3)
    })
    const segments = result.current.segments as Segment[]
    expect(segments[0]).toMatchObject({ type: 'regression', label: 'Smoke - Prod', href: '/regressions/reg-1' })
    expect(segments[1]).toMatchObject({ type: 'suite', label: 'Healthchecks', href: '/suites/suite-1?regressionId=reg-1' })
    expect(segments[2]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/suites/suite-1?regressionId=reg-1')
  })

  it('Standalone Test execution: [Executions, test] + backHref = /executions', () => {
    workbenchState.executionId = 'exec-1'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = null

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ type: 'execution-root', label: 'Executions', href: '/executions' })
    expect(segments[1]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/executions')
  })

  it('Suite child execution: [Executions, suite, test] + backHref = /executions/<parentId>', async () => {
    workbenchState.executionId = 'exec-child'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = 'exec-suite'
    fetchExecutionMock.mockImplementation((id: string) => {
      if (id === 'exec-suite') {
        return Promise.resolve({
          success: true,
          data: { id: 'exec-suite', name: 'Healthchecks Run', entity_type: 'suite' },
        })
      }
      return Promise.reject(new Error(`Unexpected fetchExecution(${id})`))
    })

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(3)
    })
    const segments = result.current.segments as Segment[]
    expect(segments[0]).toMatchObject({ type: 'execution-root', label: 'Executions', href: '/executions' })
    expect(segments[1]).toMatchObject({ type: 'suite', label: 'Healthchecks Run', href: '/executions/exec-suite' })
    expect(segments[2]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/executions/exec-suite')
  })

  it('Regression child execution: [Executions, regression, suite, test] + backHref = /executions/<suite-exec>', async () => {
    workbenchState.executionId = 'exec-test'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = 'exec-suite'
    fetchExecutionMock.mockImplementation((id: string) => {
      if (id === 'exec-suite') {
        return Promise.resolve({
          success: true,
          data: {
            id: 'exec-suite',
            name: 'Healthchecks Run',
            entity_type: 'suite',
            parent_execution_id: 'exec-reg',
          },
        })
      }
      if (id === 'exec-reg') {
        return Promise.resolve({
          success: true,
          data: { id: 'exec-reg', name: 'Smoke Prod Run', entity_type: 'regression' },
        })
      }
      return Promise.reject(new Error(`Unexpected fetchExecution(${id})`))
    })

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(4)
    })
    const segments = result.current.segments as Segment[]
    expect(segments[0]).toMatchObject({ type: 'execution-root', label: 'Executions', href: '/executions' })
    expect(segments[1]).toMatchObject({ type: 'regression', label: 'Smoke Prod Run', href: '/executions/exec-reg' })
    expect(segments[2]).toMatchObject({ type: 'suite', label: 'Healthchecks Run', href: '/executions/exec-suite' })
    expect(segments[3]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(result.current.backHref).toBe('/executions/exec-suite')
  })

  it('Tracked execution overrides nav-origin params', async () => {
    // Both an execution AND suite-origin nav params are set. Execution
    // path wins; suite-origin breadcrumb is suppressed.
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    workbenchState.executionId = 'exec-1'
    workbenchState.sessionTestName = 'API Health 200'

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].type).toBe('execution-root')
    })
    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(2)
    expect(segments[1]).toMatchObject({ type: 'test', label: 'API Health 200' })
  })
})

describe('useBreadcrumbContext - caching', () => {
  beforeEach(resetState)

  it('caches suite/regression name fetches per id across re-renders', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })

    const { result, rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(2)
    })
    const callsAfterFirstRender = fetchSuiteDetailMock.mock.calls.length

    rerender()
    rerender()
    rerender()

    // Re-renders MUST NOT re-fetch the same suite id; the cache holds.
    expect(fetchSuiteDetailMock.mock.calls.length).toBe(callsAfterFirstRender)
  })

  it('uses the cached suite name when suiteId toggles A -> B -> A', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    fetchSuiteDetailMock.mockImplementation((id: string) =>
      Promise.resolve({ suite: { id, name: `Suite ${id}` }, tests: [] }),
    )

    searchParamsState.suiteId = 'suite-A'
    const { result, rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Suite suite-A')
    })

    // Switch to a different suite id - new fetch.
    searchParamsState.suiteId = 'suite-B'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Suite suite-B')
    })

    const callsAfterB = fetchSuiteDetailMock.mock.calls.length

    // Switch back to suite-A. The cache should serve it without re-fetch.
    searchParamsState.suiteId = 'suite-A'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Suite suite-A')
    })
    expect(fetchSuiteDetailMock.mock.calls.length).toBe(callsAfterB)
  })

  it('uses the cached regression name when regressionId toggles A -> B -> A', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })
    fetchRegressionDetailMock.mockImplementation((id: string) =>
      Promise.resolve({ regression: { id, name: `Reg ${id}` }, suites: [] }),
    )

    searchParamsState.regressionId = 'reg-A'
    const { result, rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Reg reg-A')
    })

    searchParamsState.regressionId = 'reg-B'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Reg reg-B')
    })

    const callsAfterB = fetchRegressionDetailMock.mock.calls.length
    searchParamsState.regressionId = 'reg-A'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[0].label).toBe('Reg reg-A')
    })
    expect(fetchRegressionDetailMock.mock.calls.length).toBe(callsAfterB)
  })

  it('uses the cached parent execution info when parentExecutionId toggles A -> B -> A', async () => {
    workbenchState.executionId = 'exec-child'
    workbenchState.sessionTestName = 'API Health 200'
    fetchExecutionMock.mockImplementation((id: string) =>
      Promise.resolve({
        success: true,
        data: { id, name: `Parent ${id}`, entity_type: 'suite' },
      }),
    )

    workbenchState.parentExecutionId = 'exec-A'
    const { result, rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect((result.current.segments as Segment[])[1]?.label).toBe('Parent exec-A')
    })

    workbenchState.parentExecutionId = 'exec-B'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[1]?.label).toBe('Parent exec-B')
    })

    const callsAfterB = fetchExecutionMock.mock.calls.length
    workbenchState.parentExecutionId = 'exec-A'
    rerender()
    await waitFor(() => {
      expect((result.current.segments as Segment[])[1]?.label).toBe('Parent exec-A')
    })
    expect(fetchExecutionMock.mock.calls.length).toBe(callsAfterB)
  })
})

describe('useBreadcrumbContext - loading state', () => {
  beforeEach(resetState)

  it('reports isLoading=true while name fetches are pending', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    let resolveFetch: (value: { suite: { id: string; name: string }; tests: unknown[] }) => void = () => {}
    fetchSuiteDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    expect(result.current.isLoading).toBe(true)

    resolveFetch({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('stops reporting a pending name read once a run supersedes it', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    let resolveFetch: (value: { suite: { id: string; name: string }; tests: unknown[] }) => void = () => {}
    fetchSuiteDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { result, rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    expect(result.current.isLoading).toBe(true)

    workbenchState.executionId = 'exec-1'
    workbenchState.sessionTestName = 'API Health 200'
    rerender()

    await act(async () => {
      resolveFetch({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })
      await Promise.resolve()
    })

    expect(result.current.isLoading).toBe(false)
  })
})

describe('useBreadcrumbContext - a name read that fails', () => {
  beforeEach(() => {
    resetState()
    usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
  })

  it('clears a failed suite name report when a run takes over the breadcrumb', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockRejectedValue(new Error('Suites API down'))

    const { rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load suite name')
    })

    workbenchState.executionId = 'exec-1'
    workbenchState.sessionTestName = 'API Health 200'
    await act(async () => {
      rerender()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears a failed regression name report when a run takes over the breadcrumb', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.regressionId = 'reg-1'
    fetchRegressionDetailMock.mockRejectedValue(new Error('Regressions API down'))

    const { rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load regression name')
    })

    workbenchState.executionId = 'exec-1'
    workbenchState.sessionTestName = 'API Health 200'
    await act(async () => {
      rerender()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears a failed parent execution report when the run is no longer tracked', async () => {
    workbenchState.executionId = 'exec-child'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = 'exec-suite'
    fetchExecutionMock.mockRejectedValue(new Error('Executions API down'))

    const { rerender } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load parent execution')
    })

    workbenchState.executionId = null
    workbenchState.parentExecutionId = null
    await act(async () => {
      rerender()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reports a failed suite name read instead of shortening the trail silently', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockRejectedValue(new Error('Suites API down'))

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })
    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load suite name')
    expect(block?.detail.message).toBe('Suites API down')
    expect(result.current.isLoading).toBe(false)
  })

  it('names both name reads when the suite and the regression both fail', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    searchParamsState.regressionId = 'reg-1'
    fetchSuiteDetailMock.mockRejectedValue(new Error('Suites API down'))
    fetchRegressionDetailMock.mockRejectedValue(new Error('Regressions API down'))

    renderHook(() => useBreadcrumbContext(), { wrapper })

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe(
        'Could not load suite name and regression name',
      )
    })
    const message = usePageBlockStore.getState().block!.detail.message
    expect(message).toContain('Suites API down')
    expect(message).toContain('Regressions API down')
  })

  it('clears the report and shows the segment when the retry succeeds', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockRejectedValueOnce(new Error('Suites API down'))
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })

    await waitFor(() => {
      expect((result.current.segments as Segment[]).length).toBe(2)
    })
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('keeps the report with the newest reason when the retry fails again', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    fetchSuiteDetailMock.mockRejectedValueOnce(new Error('Suites API down'))
    fetchSuiteDetailMock.mockRejectedValueOnce(new Error('Suites API still down'))

    renderHook(() => useBreadcrumbContext(), { wrapper })
    await waitFor(() => {
      expect(usePageBlockStore.getState().block).not.toBeNull()
    })

    await act(async () => {
      await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow(
        'Suites API still down',
      )
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('Suites API still down')
  })

  it('reports a failed regression name read', async () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    searchParamsState.suiteId = 'suite-1'
    searchParamsState.regressionId = 'reg-1'
    fetchSuiteDetailMock.mockResolvedValue({ suite: { id: 'suite-1', name: 'Healthchecks' }, tests: [] })
    fetchRegressionDetailMock.mockRejectedValue(new Error('Regressions API down'))

    renderHook(() => useBreadcrumbContext(), { wrapper })

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load regression name')
    })
  })

  it('reports a failed parent execution read', async () => {
    workbenchState.executionId = 'exec-child'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = 'exec-suite'
    fetchExecutionMock.mockRejectedValue(new Error('Executions API down'))

    renderHook(() => useBreadcrumbContext(), { wrapper })

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load parent execution')
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('Executions API down')
  })

  it('reports a failed parent regression execution read', async () => {
    workbenchState.executionId = 'exec-test'
    workbenchState.sessionTestName = 'API Health 200'
    workbenchState.parentExecutionId = 'exec-suite'
    fetchExecutionMock.mockImplementation((id: string) => {
      if (id === 'exec-suite') {
        return Promise.resolve({
          success: true,
          data: {
            id: 'exec-suite',
            name: 'Healthchecks Run',
            entity_type: 'suite',
            parent_execution_id: 'exec-reg',
          },
        })
      }
      return Promise.reject(new Error('Executions API down'))
    })

    renderHook(() => useBreadcrumbContext(), { wrapper })

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe(
        'Could not load parent regression execution',
      )
    })
  })
})
