/**
 * WorkflowNode Switch/Case Lane Rendering (REQ-3.5.1.20).
 *
 * Switch is a container control: one lane per case in author order, an optional
 * muted `default` lane, and the container-exit `then` lane always last. Lanes
 * are keyed on the branch's stable id so re-ordering never re-points a wired
 * edge, they carry role colors instead of text labels, and the node grows one
 * handle slot per lane.
 *
 * Design Reference:
 *   SWITCH-1 (container), SWITCH-5 (lane colors), SWITCH-6 (no lane labels),
 *   SWITCH-7 (width growth), stable ids
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

const SWITCH_BASE = {
  label: 'Switch',
  elementType: 'switch-case',
  nodeType: 'control',
} as const

// The node's own width floor is 160px; pinning `width` there makes the lane
// footprint the only thing that grows.
const NODE_WIDTH_FLOOR = 160

function switchData(branches: unknown) {
  return { ...SWITCH_BASE, config: { values: { branches } } }
}

function caseBranch(id: string, label = '') {
  return { id, type: 'case', label, conditions: [], break: true }
}

function defaultBranch(id: string, label = '') {
  return { id, type: 'default', label }
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

describe('WorkflowNode Switch/Case lane order (SWITCH-1, SWITCH-7)', () => {
  beforeEach(seedStore)

  it('renders one lane per case in author order with then last', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), caseBranch('branch_1')])}
      />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_0',
      'handle-output-branch_1',
      'handle-output-then',
    ])
  })

  it('places the default lane after every case and before then', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          defaultBranch('branch_2'),
        ])}
      />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_0',
      'handle-output-branch_1',
      'handle-output-branch_2',
      'handle-output-then',
    ])
  })

  it('renders a single case lane plus then for a freshly seeded switch', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode id="node-1" data={switchData([caseBranch('branch_0')])} />,
    )

    expect(laneTestIds(container)).toEqual(['handle-output-branch_0', 'handle-output-then'])
  })

  it('drops the single default output handle once branches are configured', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={switchData([caseBranch('branch_0')])} />,
    )

    expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
  })
})

describe('WorkflowNode Switch/Case lane identity', () => {
  beforeEach(seedStore)

  it('keys each lane on its branch id rather than a positional case index', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          defaultBranch('branch_2'),
        ])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0')).toBeInTheDocument()
    expect(screen.getByTestId('handle-output-branch_1')).toBeInTheDocument()
    expect(screen.getByTestId('handle-output-branch_2')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-case_1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-case_2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-default')).not.toBeInTheDocument()
  })

  it('binds the branch id as the React Flow handle id an edge wires to', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), defaultBranch('branch_1')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0')).toHaveAttribute(
      'data-handleid',
      'branch_0',
    )
    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute(
      'data-handleid',
      'branch_1',
    )
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('data-handleid', 'then')
  })

  it('re-orders the lanes with the branches array while each id keeps its own branch', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container, rerender } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0', 'Fast'), caseBranch('branch_1', 'Slow')])}
      />,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_0',
      'handle-output-branch_1',
      'handle-output-then',
    ])

    rerender(
      <ReactFlowProvider>
        <WorkflowNode
          id="node-1"
          data={switchData([caseBranch('branch_1', 'Slow'), caseBranch('branch_0', 'Fast')])}
        />
      </ReactFlowProvider>,
    )

    expect(laneTestIds(container)).toEqual([
      'handle-output-branch_1',
      'handle-output-branch_0',
      'handle-output-then',
    ])
    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'Slow')
    expect(screen.getByTestId('handle-output-branch_0')).toHaveAttribute('aria-label', 'Fast')
  })
})

describe('WorkflowNode Switch/Case lane roles', () => {
  beforeEach(seedStore)

  it('paints every case lane the conditional orange', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          defaultBranch('branch_2'),
        ])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0').className).toContain('!bg-orange-500')
    expect(screen.getByTestId('handle-output-branch_0').className).toContain(
      'hover:!ring-orange-300',
    )
    expect(screen.getByTestId('handle-output-branch_1').className).toContain('!bg-orange-500')
    expect(screen.getByTestId('handle-output-branch_1').className).toContain(
      'hover:!ring-orange-300',
    )
  })

  it('paints the default lane the muted neutral', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), defaultBranch('branch_1')])}
      />,
    )

    const lane = screen.getByTestId('handle-output-branch_1')
    expect(lane.className).toContain('!bg-zinc-400')
    expect(lane.className).toContain('hover:!ring-zinc-300')
    expect(lane.className).not.toContain('!bg-orange-500')
  })

  it('paints the then lane the container-exit neutral', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), defaultBranch('branch_1')])}
      />,
    )

    const lane = screen.getByTestId('handle-output-then')
    expect(lane.className).toContain('!bg-zinc-600')
    expect(lane.className).toContain('hover:!ring-zinc-400')
  })
})

describe('WorkflowNode Switch/Case lane names', () => {
  beforeEach(seedStore)

  it('titles an unnamed case lane with its 1-based case number', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), caseBranch('branch_1')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0')).toHaveAttribute('aria-label', 'case 1')
    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'case 2')
  })

  it('titles the default and then lanes with their roles', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0'), defaultBranch('branch_1')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'default')
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
  })

  it('prefers the branch label over the role fallback and numbers cases by position', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([
          caseBranch('branch_0', 'Fast'),
          caseBranch('branch_1'),
          defaultBranch('branch_2', 'Catch all'),
        ])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0')).toHaveAttribute('aria-label', 'Fast')
    expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'case 2')
    expect(screen.getByTestId('handle-output-branch_2')).toHaveAttribute('aria-label', 'Catch all')
  })

  it('names the lane through the shared tooltip, not the browser title', async () => {
    // The native `title` popup is browser-timed (~1s) and cannot be tuned, so
    // lanes carry their name as an accessible label and reveal it through the
    // app's own tooltip instead.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0', 'Fast'), defaultBranch('branch_1')])}
      />,
    )

    const lane = screen.getByTestId('handle-output-branch_0')
    expect(lane).not.toHaveAttribute('title')
    expect(lane).toHaveAttribute('aria-label', 'Fast')
    // Radix marks its trigger, so this proves the lane is the hover target.
    expect(lane).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
  })

  it('reveals the lane name on hover', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const user = userEvent.setup()
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={switchData([caseBranch('branch_0'), defaultBranch('branch_1')])} />,
    )

    await user.hover(screen.getByTestId('handle-output-branch_0'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('case 1')
  })

  it('renders no text label on any lane', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([caseBranch('branch_0', 'Fast'), defaultBranch('branch_1')])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0').textContent).toBe('')
    expect(screen.getByTestId('handle-output-branch_1').textContent).toBe('')
    expect(screen.getByTestId('handle-output-then').textContent).toBe('')
    expect(screen.queryByText('Fast')).not.toBeInTheDocument()
    expect(screen.queryByText('default')).not.toBeInTheDocument()
    expect(screen.queryByText('then')).not.toBeInTheDocument()
  })
})

describe('WorkflowNode Switch/Case lane positioning (SWITCH-7)', () => {
  beforeEach(seedStore)

  it('spaces the lanes 64px apart starting at 48px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          defaultBranch('branch_2'),
        ])}
      />,
    )

    expect(screen.getByTestId('handle-output-branch_0').getAttribute('style') ?? '').toMatch(
      /left:\s*48px/,
    )
    expect(screen.getByTestId('handle-output-branch_1').getAttribute('style') ?? '').toMatch(
      /left:\s*112px/,
    )
    expect(screen.getByTestId('handle-output-branch_2').getAttribute('style') ?? '').toMatch(
      /left:\s*176px/,
    )
    expect(screen.getByTestId('handle-output-then').getAttribute('style') ?? '').toMatch(
      /left:\s*240px/,
    )
  })
})

describe('WorkflowNode Switch/Case node width (SWITCH-7)', () => {
  beforeEach(seedStore)

  it('sizes a one-branch switch to 160px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={switchData([caseBranch('branch_0')])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*160px/)
    // The two lanes are what the 160px footprint is holding.
    expect(screen.getByTestId('handle-output-branch_0')).toBeInTheDocument()
    expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
  })

  it('sizes a two-branch switch to 224px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={switchData([caseBranch('branch_0'), caseBranch('branch_1')])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*224px/)
  })

  it('sizes a three-branch switch to 288px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          defaultBranch('branch_2'),
        ])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*288px/)
  })

  it('sizes a four-branch switch to 352px', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        width={NODE_WIDTH_FLOOR}
        data={switchData([
          caseBranch('branch_0'),
          caseBranch('branch_1'),
          caseBranch('branch_2'),
          defaultBranch('branch_3'),
        ])}
      />,
    )

    const style = screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*352px/)
  })
})

describe('WorkflowNode Switch/Case without configured branches', () => {
  beforeEach(seedStore)

  it('falls back to the single output handle for an empty branches array', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={switchData([])} />)

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })

  it('falls back to the single output handle when the branches key is absent', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={{ ...SWITCH_BASE, config: { values: {} } }} />,
    )

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })

  it('falls back to the single output handle when branches is not an array', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={switchData('branch_0')} />)

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })
})
