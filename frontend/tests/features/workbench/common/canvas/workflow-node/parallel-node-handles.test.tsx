/**
 * WorkflowNode Parallel lane rendering (REQ-3.1.1.3).
 *
 * Parallel is a container control: one violet lane per branch in config order
 * and the container-exit `then` lane always last. Lanes are keyed on the
 * branch's stable id so re-ordering never re-points a wired edge, they carry
 * their branch name as an accessible label instead of on-node text, and the
 * node grows one handle slot per lane.
 *
 * Design Reference:
 *   PARALLEL-1 (lane roles), PARALLEL-2 (width growth).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  edges: [] as Array<{ id: string; source: string; target: string }>,
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  selectNode: vi.fn(),
  openConfigModal: vi.fn(),
  hasBreakpoint: vi.fn().mockReturnValue(false),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  toggleBreakpoint: vi.fn(),
  toggleDisable: vi.fn(),
  toggleSkip: vi.fn(),
  unlinkNode: vi.fn(),
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  variables: [] as Array<{ id: string; name: string; value: unknown; type: string }>,
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  clearDrill: vi.fn(),
}

// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

const PARALLEL_BASE = {
  label: 'Parallel',
  elementType: 'parallel',
  nodeType: 'control',
} as const

// The node's own width floor is 160px; pinning `width` there makes the lane
// footprint the only thing that grows.
const NODE_WIDTH_FLOOR = 160

function parallelData(branches: unknown) {
  return { ...PARALLEL_BASE, config: { values: { branches } } }
}

function branch(id: string, name = '') {
  return { id, name }
}

function laneTestIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid^="handle-output"]'),
  ).map((el) => el.getAttribute('data-testid') ?? '')
}

function seedStore() {
  vi.clearAllMocks()
  mockWorkflowStore.selectedNodeIds = []
  mockWorkflowStore.skippedNodeIds = []
  mockWorkflowStore.edges = [{ id: 'e-start-1', source: 'start-node', target: 'node-1' }]
}

describe('WorkflowNode Parallel lane order (PARALLEL-1)', () => {
  beforeEach(seedStore)

  it('renders one lane per branch in config order with then last', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_1',
      'handle-output-branch_2',
      'handle-output-then',
    ])
  })

  it('grows the lane list with the branch list', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1'), branch('branch_2'), branch('branch_3')])}
      />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_1',
      'handle-output-branch_2',
      'handle-output-branch_3',
      'handle-output-then',
    ])
  })

  it('drops the single default output handle once branches are configured', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
  })

  it('re-orders the lanes with the branch list while each id keeps its branch', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container, rerender } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1', 'ingest'), branch('branch_2', 'probe')])}
      />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_1',
      'handle-output-branch_2',
      'handle-output-then',
    ])

    rerender(
      <ReactFlowProvider>
        <WorkflowNode
          id="node-1"
          data={parallelData([branch('branch_2', 'probe'), branch('branch_1', 'ingest')])}
        />
      </ReactFlowProvider>,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_2',
      'handle-output-branch_1',
      'handle-output-then',
    ])
    expect(screen.getByTestId('handle-output-branch_2')).toHaveAttribute('aria-label', 'probe')
    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'ingest')
  })

  it('binds the branch id as the React Flow handle id an edge wires to', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute(
      'data-handleid',
      'branch_1',
    )
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('data-handleid', 'then')
  })
})

describe('WorkflowNode Parallel lane roles', () => {
  beforeEach(seedStore)

  it('paints every branch lane violet', async () => {
    // A fan-out is its own role: not the blue try path, the cyan sub-flow or
    // the orange case lane.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    for (const id of ['handle-output-branch_1', 'handle-output-branch_2']) {
      expect(screen.getByTestId(id).className).toContain('!bg-violet-500')
      expect(screen.getByTestId(id).className).toContain('hover:!ring-violet-300')
    }
  })

  it('paints the then lane the container-exit neutral', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    const lane = screen.getByTestId('handle-output-then')
    expect(lane.className).toContain('!bg-zinc-600')
    expect(lane.className).toContain('hover:!ring-zinc-400')
    expect(lane.className).not.toContain('!bg-violet-500')
  })
})

describe('WorkflowNode Parallel lane names', () => {
  beforeEach(seedStore)

  it('titles a named lane with the branch name', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1', 'ingest'), branch('branch_2', 'probe')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'ingest')
    expect(screen.getByTestId('handle-output-branch_2')).toHaveAttribute('aria-label', 'probe')
  })

  it('titles an unnamed lane with its 1-based branch number', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'branch 1')
    expect(screen.getByTestId('handle-output-branch_2')).toHaveAttribute('aria-label', 'branch 2')
  })

  it('titles the then lane with its role', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={parallelData([branch('branch_1'), branch('branch_2')])} />,
    )

    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
  })

  it('names the lane through the shared tooltip, not the browser title', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1', 'ingest'), branch('branch_2')])}
      />,
    )

    const lane = screen.getByTestId('handle-output-branch_1')
    expect(lane).not.toHaveAttribute('title')
    expect(lane).toHaveAttribute('aria-label', 'ingest')
    expect(lane).toHaveAttribute('data-state', 'closed')
  })

  it('reveals the lane name on hover', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const user = userEvent.setup()
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1', 'ingest'), branch('branch_2')])}
      />,
    )

    await user.hover(screen.getByTestId('handle-output-branch_1'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('ingest')
  })

  it('renders no text label on any lane', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1', 'ingest'), branch('branch_2', 'probe')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_1').textContent).toBe('')
    expect(screen.getByTestId('handle-output-then').textContent).toBe('')
    expect(screen.queryByText('ingest')).not.toBeInTheDocument()
    expect(screen.queryByText('then')).not.toBeInTheDocument()
  })
})

describe('WorkflowNode Parallel lane positioning (PARALLEL-2)', () => {
  beforeEach(seedStore)

  it('spaces the lanes 64px apart starting at 48px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={parallelData([branch('branch_1'), branch('branch_2'), branch('branch_3')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_1').getAttribute('style') ?? '').toMatch(
      /left:\s*48px/,
    )
    expect(screen.getByTestId('handle-output-branch_2').getAttribute('style') ?? '').toMatch(
      /left:\s*112px/,
    )
    expect(screen.getByTestId('handle-output-branch_3').getAttribute('style') ?? '').toMatch(
      /left:\s*176px/,
    )
    expect(screen.getByTestId('handle-output-then').getAttribute('style') ?? '').toMatch(
      /left:\s*240px/,
    )
  })
})

describe('WorkflowNode Parallel node width (PARALLEL-2)', () => {
  beforeEach(seedStore)

  it('sizes a two-branch section to 224px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={parallelData([branch('branch_1'), branch('branch_2')])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*224px/)
  })

  it('sizes a three-branch section to 288px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={parallelData([branch('branch_1'), branch('branch_2'), branch('branch_3')])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*288px/)
  })

  it('sizes a four-branch section to 352px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={parallelData([
          branch('branch_1'),
          branch('branch_2'),
          branch('branch_3'),
          branch('branch_4'),
        ])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*352px/)
  })
})

describe('WorkflowNode Parallel without configured branches', () => {
  beforeEach(seedStore)

  it('falls back to the single output handle for an empty branch list', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={parallelData([])} />)

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })

  it('falls back to the single output handle when the branches key is absent', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={{ ...PARALLEL_BASE, config: { values: {} } }} />,
    )

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })

  it('falls back to the single output handle when branches is the old integer count', async () => {
    // Guard: the count shape is gone; reading it as two lanes would hide the change.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={parallelData(4)} />)

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-branch_1')).not.toBeInTheDocument()
  })
})
