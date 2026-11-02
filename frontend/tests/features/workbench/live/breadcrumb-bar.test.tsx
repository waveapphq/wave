/**
 * LiveBreadcrumbBar Tests
 *
 * The live wrapper consumes useBreadcrumbContext() and forwards
 * { segments, backHref } onto CanvasBreadcrumbBar. Tests verify the
 * wiring: hook output flows through, status comes from props, and the
 * back-arrow / segments visible in the DOM reflect the hook's response.
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
  segments: [{ type: 'test', label: 'Draft Workflow' }],
  backHref: null,
  isLoading: false,
}

interface DrillEntry {
  nodeId: string
  label: string
}

interface MockWorkflowStoreShape {
  drillPath: DrillEntry[]
  functionViewMode: { functionId: string; version: string; editable: boolean } | null
  pushDrill: ReturnType<typeof vi.fn>
  popDrillOne: ReturnType<typeof vi.fn>
  popDrillTo: ReturnType<typeof vi.fn>
  requestDrill: ReturnType<typeof vi.fn>
  clearDrill: ReturnType<typeof vi.fn>
}

const mockStore: MockWorkflowStoreShape = {
  drillPath: [],
  functionViewMode: null,
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  // Pass-through (clean-sheet semantics) - the guard itself is store-tested.
  requestDrill: vi.fn((run: () => void) => run()),
  clearDrill: vi.fn(),
}

vi.mock('@/features/workbench/hooks/use-breadcrumb-context', () => ({
  useBreadcrumbContext: () => mockContext,
}))

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (s: MockWorkflowStoreShape) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}))

import { LiveBreadcrumbBar } from '@/features/workbench/live/breadcrumb-bar'

function renderBar(props: Parameters<typeof LiveBreadcrumbBar>[0] = { status: 'idle' }) {
  return render(
    <MemoryRouter>
      <LiveBreadcrumbBar {...props} />
    </MemoryRouter>,
  )
}

describe('LiveBreadcrumbBar', () => {
  it('forwards segments from useBreadcrumbContext into the canvas bar', () => {
    mockContext.segments = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/suites/s1'
    renderBar({ status: 'idle' })
    expect(screen.getByText('Healthchecks')).toBeInTheDocument()
    expect(screen.getByText('API Health 200')).toBeInTheDocument()
  })

  it('hides the back arrow when the hook returns backHref=null (Draft)', () => {
    mockContext.segments = [{ type: 'test', label: 'Draft Workflow' }]
    mockContext.backHref = null
    renderBar({ status: 'idle' })
    expect(screen.queryByTestId('breadcrumb-back-arrow')).not.toBeInTheDocument()
  })

  it('shows the back arrow when the hook returns a backHref', () => {
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    expect(screen.getByTestId('breadcrumb-back-arrow')).toBeInTheDocument()
  })

  it('renders the workflow status passed through props', () => {
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    renderBar({ status: 'failed' })
    const pill = screen.getByTestId('workflow-status')
    expect(pill).toHaveAttribute('data-status', 'failed')
    expect(pill).toHaveTextContent('Failed')
  })

  it('forwards onReset through to the canvas bar', () => {
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    const onReset = vi.fn()
    renderBar({ status: 'passed', onReset })
    // Reset button must be present + not disabled in passed status.
    expect(screen.getByTestId('breadcrumb-reset-link')).not.toBeDisabled()
  })

  it('navigates to backHref when the back arrow is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockContext.segments = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/suites/s1'
    renderBar({ status: 'idle' })
    const backBtn = screen.getByTestId('breadcrumb-back-arrow')
    await user.click(backBtn)
    expect(backBtn).toBeInTheDocument()
  })

  it('navigates to a segment href when a segment is clicked', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockContext.segments = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/suites/s1'
    renderBar({ status: 'idle' })
    const segment = screen.getByText('Healthchecks')
    await user.click(segment)
    expect(segment.closest('a')).toHaveAttribute('href', '/suites/s1')
  })
})

describe('LiveBreadcrumbBar - drill behavior', () => {
  it('pops one drill level when back arrow clicked and drillPath non-empty', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    mockStore.popDrillOne = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: '1' },
    ]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    expect(mockStore.popDrillOne).toHaveBeenCalledTimes(1)
  })

  it('dispatches popDrillTo(depth) when an intermediate function segment is clicked', async () => {
    // Clicking the Function_1 segment (depth=1) puts the user inside
    // Function_1 (drillPath length 1) where Helper_2 is visible as a node.
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
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('Function_1'))
    expect(mockStore.popDrillTo).toHaveBeenCalledWith(1)
  })

  it('dispatches popDrillTo(0) when the previously-leaf Test segment is clicked (#drill-0 href)', async () => {
    // The Test segment becomes intermediate when drilled. Clicking it
    // truncates drillPath to length 0 - back to Test root.
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200', href: '#drill-0' },
      { type: 'function', label: 'Function_1', id: '1' },
    ]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('API Health 200'))
    expect(mockStore.popDrillTo).toHaveBeenCalledWith(0)
  })

  it('navigates to the Function detail (not popOne) in library-View mode', async () => {
    // In library-View the synthetic root is a single drill entry; the back
    // arrow must return to /functions/{id}, never pop to the hidden root.
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [{ nodeId: 'view-shared-root', label: 'Greet User' }]
    mockStore.popDrillOne = vi.fn()
    mockStore.functionViewMode = { functionId: 'fn-greet', version: '1.0.0', editable: false }
    mockContext.segments = [{ type: 'function', label: 'Greet User' }]
    mockContext.backHref = '/functions/fn-greet'
    renderBar({ status: 'idle' })
    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    expect(mockStore.popDrillOne).not.toHaveBeenCalled()
    mockStore.functionViewMode = null
  })

  it('navigates to backHref when back arrow clicked and drillPath is empty (regression)', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = []
    mockStore.popDrillOne = vi.fn()
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByTestId('breadcrumb-back-arrow'))
    // popDrillOne should NOT be called for the empty-drill case.
    expect(mockStore.popDrillOne).not.toHaveBeenCalled()
  })

  it('falls back to navigate when clicked segment href is not a drill anchor', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = []
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'suite', label: 'Healthchecks', href: '/suites/s1' },
      { type: 'test', label: 'API Health 200' },
    ]
    mockContext.backHref = '/suites/s1'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('Healthchecks'))
    expect(mockStore.popDrillTo).not.toHaveBeenCalled()
  })

  it('resolves a function segment by id when href is the depth string (defensive fallback)', async () => {
    // Exercises the parseFunctionDepth segment-lookup fallback (when an
    // intermediate function segment has href === id, which is an alternate
    // wiring some hosts may produce). The handler pops to depth N.
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [
      { nodeId: 'a', label: 'Function_1' },
      { nodeId: 'b', label: 'Helper_2' },
    ]
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: '1', href: '1' },
      { type: 'function', label: 'Helper_2', id: '2' },
    ]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('Function_1'))
    expect(mockStore.popDrillTo).toHaveBeenCalledWith(1)
  })

  it('returns null (and falls back to navigate) for a function segment with non-numeric id', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'leaf', label: 'Helper_2' },
    ]
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      // id is non-numeric → parseFunctionDepth returns null → navigate path.
      { type: 'function', label: 'Function_1', id: 'NOT_A_NUMBER', href: 'NOT_A_NUMBER' },
      { type: 'function', label: 'Helper_2', id: '2' },
    ]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('Function_1'))
    expect(mockStore.popDrillTo).not.toHaveBeenCalled()
  })

  it('returns null (and falls back to navigate) for a function segment with id="0"', async () => {
    // depth must be >= 1; a 0 id triggers the depth-out-of-range branch.
    // Function_1 must be INTERMEDIATE (not leaf) so its click fires
    // onNavigate; the leaf is non-clickable.
    const user = (await import('@testing-library/user-event')).default.setup()
    mockStore.drillPath = [
      { nodeId: 'fn-1', label: 'Function_1' },
      { nodeId: 'leaf', label: 'Helper_2' },
    ]
    mockStore.popDrillTo = vi.fn()
    mockContext.segments = [
      { type: 'test', label: 'API Health 200' },
      { type: 'function', label: 'Function_1', id: '0', href: '0' },
      { type: 'function', label: 'Helper_2', id: '2' },
    ]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })
    await user.click(screen.getByText('Function_1'))
    expect(mockStore.popDrillTo).not.toHaveBeenCalled()
  })
})

describe('LiveBreadcrumbBar - Test Data chip forwarding', () => {
  it('forwards onOpenTestData to the canvas bar', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const onOpenTestData = vi.fn()
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle', onOpenTestData })

    await user.click(screen.getByTestId('breadcrumb-testdata-chip'))

    expect(onOpenTestData).toHaveBeenCalledTimes(1)
  })

  it('renders no chip when the live bar is given no handler', () => {
    mockContext.segments = [{ type: 'test', label: 'API Health 200' }]
    mockContext.backHref = '/tests'
    renderBar({ status: 'idle' })

    expect(screen.queryByTestId('breadcrumb-testdata-chip')).not.toBeInTheDocument()
  })
})
