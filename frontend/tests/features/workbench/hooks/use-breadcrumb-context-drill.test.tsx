/**
 * useBreadcrumbContext - drill segments contract.
 *
 * The hook reads `drillPath` from the workflow store and appends one
 * BreadcrumbSegment of type 'function' per drill entry, after the
 * nav-origin / test leaf:
 *
 *   drillPath = []        -> base path is unchanged (existing behavior).
 *   drillPath = [A]       -> [...basePath, function:A]   ; A is the leaf.
 *   drillPath = [A, B]    -> [...basePath, function:A, function:B] ; B is the leaf.
 *
 * The previously-leaf segment (test or function below the new leaf) becomes
 * a regular clickable segment, while only the deepest entry renders as leaf.
 *
 * REQ scope: REQ-3.1.1.4 (drill navigation surface).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

interface MockSearchParams {
  suiteId: string | null
  regressionId: string | null
}

interface MockWorkbenchRun {
  executionId: string | null
  sessionTestName: string | null
  parentExecutionId: string | null
}

interface DrillEntry {
  nodeId: string
  label: string
}

interface MockWorkflow {
  editingTestId: string | null
  editingTestName: string | null
  drillPath: DrillEntry[]
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

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteDetail: vi.fn(),
}))
vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: vi.fn(),
}))
vi.mock('@/features/executions/api/executions', () => ({
  fetchExecution: vi.fn(),
}))

import { useBreadcrumbContext } from '@/features/workbench/hooks/use-breadcrumb-context'

interface Segment {
  type: 'execution-root' | 'execution' | 'test' | 'suite' | 'regression' | 'function'
  label: string
  href?: string
  id?: string
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function reset() {
  searchParamsState = { suiteId: null, regressionId: null }
  workbenchState.executionId = null
  workbenchState.sessionTestName = null
  workbenchState.parentExecutionId = null
  workflowState.editingTestId = null
  workflowState.editingTestName = null
  workflowState.drillPath = []
}

beforeEach(reset)

describe('useBreadcrumbContext - drillPath empty (regression check)', () => {
  it('produces the existing base path when drillPath is empty', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'API Health 200' })
  })
})

describe('useBreadcrumbContext - drillPath with one entry', () => {
  it('appends one function segment after the test leaf', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(segments[1]).toMatchObject({ type: 'function', label: 'Function_1' })
  })

  it('promotes the test segment to clickable (loses leaf status)', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    // The test segment is no longer the deepest entry; the canvas bar
    // renders any non-leaf segment as clickable. The exact rendering
    // contract is checked in canvas-breadcrumb-bar-function.test.tsx;
    // here we just confirm the function segment is now the leaf.
    expect(segments.at(-1)?.type).toBe('function')
  })
})

describe('useBreadcrumbContext - drillPath with two entries', () => {
  it('appends two function segments in descent order', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'helper-2', label: 'Helper_2' },
    ]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(3)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(segments[1]).toMatchObject({ type: 'function', label: 'Function_1' })
    expect(segments[2]).toMatchObject({ type: 'function', label: 'Helper_2' })
  })

  it('only the deepest function entry is the leaf', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'helper-2', label: 'Helper_2' },
    ]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments.at(-1)?.label).toBe('Helper_2')
  })
})

describe('useBreadcrumbContext - drill segments carry id for click-to-pop', () => {
  it('each appended function segment carries an id that addresses its drill depth', () => {
    // The canvas bar dispatches popDrillTo(depth) when a function segment
    // is clicked; the segment must carry an id that the bar can use to
    // resolve depth (either the depth-as-string or the drill entry's
    // nodeId - implementation choice). Tests assert that the id is at
    // least defined and non-empty for each appended function segment.
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'helper-2', label: 'Helper_2' },
    ]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    const functionSegments = segments.filter((s) => s.type === 'function')
    expect(functionSegments).toHaveLength(2)
    for (const seg of functionSegments) {
      expect(seg.id).toBeDefined()
      expect(seg.id).not.toBe('')
    }
  })
})
