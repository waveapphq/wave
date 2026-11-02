/**
 * HistoryBreadcrumbBar Tests
 *
 * The history wrapper consumes useBreadcrumbContext() and forwards
 * { segments, backHref } onto CanvasBreadcrumbBar. History mode always
 * hides the reset link (showReset=false) because the canvas is read-only.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

interface MockSegment {
  type: 'execution-root' | 'execution' | 'test' | 'suite' | 'regression' | 'function'
  label: string
  href?: string
  id?: string
}

const mockContext: {
  segments: MockSegment[]
  backHref: string | null
  isLoading: boolean
} = {
  segments: [
    { type: 'execution-root', label: 'Executions', href: '/executions' },
    { type: 'test', label: 'API Health 200' },
  ],
  backHref: '/executions',
  isLoading: false,
}

interface MockStoreShape {
  drillPath: Array<{ nodeId: string; label: string }>
  pushDrill: ReturnType<typeof vi.fn>
  popDrillOne: ReturnType<typeof vi.fn>
  popDrillTo: ReturnType<typeof vi.fn>
  clearDrill: ReturnType<typeof vi.fn>
  requestDrill: ReturnType<typeof vi.fn>
}

const mockStore: MockStoreShape = {
  drillPath: [],
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  clearDrill: vi.fn(),
  // Pass-through (clean-sheet semantics) - the guard itself is store-tested.
  requestDrill: vi.fn((run: () => void) => run()),
}

vi.mock('@/features/workbench/hooks/use-breadcrumb-context', () => ({
  useBreadcrumbContext: () => mockContext,
}))

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (s: MockStoreShape) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}))

import { HistoryBreadcrumbBar } from '@/features/workbench/history/breadcrumb-bar'

function renderBar(props: Parameters<typeof HistoryBreadcrumbBar>[0] = { status: 'passed' }) {
  return render(
    <MemoryRouter>
      <HistoryBreadcrumbBar {...props} />
    </MemoryRouter>,
  )
}

describe('HistoryBreadcrumbBar', () => {
  it('renders segments from useBreadcrumbContext', () => {
    mockContext.segments = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'suite', label: 'Healthchecks Run', href: '/executions/exec-suite' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/executions/exec-suite'
    renderBar({ status: 'passed' })
    expect(screen.getByText('Executions')).toBeInTheDocument()
    expect(screen.getByText('Healthchecks Run')).toBeInTheDocument()
    expect(screen.getByText('API Health 200')).toBeInTheDocument()
  })

  it('does not render the reset link in history mode', () => {
    mockContext.segments = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/executions'
    renderBar({ status: 'passed' })
    expect(screen.queryByTestId('breadcrumb-reset-link')).not.toBeInTheDocument()
  })

  it('shows the back arrow when the hook returns a backHref', () => {
    mockContext.segments = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/executions'
    renderBar({ status: 'passed' })
    expect(screen.getByTestId('breadcrumb-back-arrow')).toBeInTheDocument()
  })

  it('passes through the status prop to the canvas bar status pill', () => {
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/executions'
    renderBar({ status: 'failed' })
    const pill = screen.getByTestId('workflow-status')
    expect(pill).toHaveAttribute('data-status', 'failed')
    expect(pill).toHaveTextContent('Failed')
  })

  it('navigates on back-arrow click and on segment click', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockContext.segments = [
      { type: 'execution-root', label: 'Executions', href: '/executions' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/executions'
    mockStore.drillPath = []
    renderBar({ status: 'passed' })
    const backBtn = screen.getByTestId('breadcrumb-back-arrow')
    await user.click(backBtn)
    expect(backBtn).toBeInTheDocument()
    const segment = screen.getByText('Executions')
    await user.click(segment)
    expect(segment.closest('a')).not.toBeNull()
  })
})

describe('HistoryBreadcrumbBar - drill behavior', () => {
  it('pops one drill level on back arrow when drillPath non-empty', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    mockStore.popDrillOne = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: '1' },
    ]
    mockContext.backHref = '/executions'
    renderBar({ status: 'passed' })
    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    expect(mockStore.popDrillOne).toHaveBeenCalledTimes(1)
  })

  it('dispatches popDrillTo(depth) when a #drill-N segment is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'helper-2', label: 'Helper_2' },
    ]
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: '1', href: '#drill-1' },
      { type: 'function', label: 'Helper_2', id: '2' },
    ]
    mockContext.backHref = '/executions'
    renderBar({ status: 'passed' })
    await user.click(screen.getByText('Function_1'))
    expect(mockStore.popDrillTo).toHaveBeenCalledWith(1)
  })
})
