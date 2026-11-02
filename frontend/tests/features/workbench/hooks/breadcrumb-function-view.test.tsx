/** useBreadcrumbContext in the library View (REQ-3.2.1.1, VIEW-2, FN-BC-3). */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

interface DrillEntry {
  nodeId: string
  label: string
}

interface FunctionViewMode {
  functionId: string
  version: string
  editable: boolean
}

interface MockWorkflow {
  editingTestId: string | null
  editingTestName: string | null
  drillPath: DrillEntry[]
  functionViewMode: FunctionViewMode | null
}

const workbenchState = {
  executionId: null as string | null,
  sessionTestName: null as string | null,
  parentExecutionId: null as string | null,
}

const workflowState: MockWorkflow = {
  editingTestId: null,
  editingTestName: null,
  drillPath: [],
  functionViewMode: null,
}

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useSearchParams: () => {
      const params = new URLSearchParams()
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

vi.mock('@/features/suites/api/crud', () => ({ fetchSuiteDetail: vi.fn() }))
vi.mock('@/features/regressions/api/crud', () => ({ fetchRegressionDetail: vi.fn() }))
vi.mock('@/features/executions/api/executions', () => ({ fetchExecution: vi.fn() }))

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
  workbenchState.executionId = null
  workbenchState.sessionTestName = null
  workbenchState.parentExecutionId = null
  workflowState.editingTestId = null
  workflowState.editingTestName = null
  workflowState.drillPath = []
  workflowState.functionViewMode = null
}

beforeEach(reset)

describe('useBreadcrumbContext - library-View mode (read-only)', () => {
  it('shows ONLY the Function segment (no synthetic Test leaf)', () => {
    workflowState.functionViewMode = {
      functionId: 'fn-greet-id',
      version: '1.2.0',
      editable: false,
    }
    workflowState.drillPath = [{ nodeId: 'view-shared-root', label: 'Greet User' }]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ type: 'function', label: 'Greet User' })
    expect(segments.some((s) => s.type === 'test')).toBe(false)
  })

  it('back href returns to the Function detail page', () => {
    workflowState.functionViewMode = {
      functionId: 'fn-greet-id',
      version: '1.2.0',
      editable: false,
    }
    workflowState.drillPath = [{ nodeId: 'view-shared-root', label: 'Greet User' }]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    expect(result.current.backHref).toBe('/functions/fn-greet-id')
  })
})

describe('useBreadcrumbContext - library-View mode drilled into an inner Function', () => {
  it('gives the View root a drill target and keeps the inner leaf inert', () => {
    workflowState.functionViewMode = { functionId: 'fn-outer', version: '1.0.0', editable: false }
    workflowState.drillPath = [
      { nodeId: 'view-shared-root', label: 'Outer' },
      { nodeId: 'inner-call', label: 'Inner' },
    ]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    expect(result.current.segments).toEqual([
      { type: 'function', label: 'Outer', id: '1', href: '#drill-1' },
      { type: 'function', label: 'Inner', id: '2' },
    ])
    expect(result.current.backHref).toBe('/functions/fn-outer')
  })
})

describe('useBreadcrumbContext - non-View drill (regression guard)', () => {
  it('keeps the Test leaf when functionViewMode is null (in-Test drill unchanged)', () => {
    workflowState.editingTestId = 'test-1'
    workflowState.editingTestName = 'API Health 200'
    workflowState.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]

    const { result } = renderHook(() => useBreadcrumbContext(), { wrapper })

    const segments = result.current.segments as Segment[]
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ type: 'test', label: 'API Health 200' })
    expect(segments[1]).toMatchObject({ type: 'function', label: 'Function_1' })
  })
})
