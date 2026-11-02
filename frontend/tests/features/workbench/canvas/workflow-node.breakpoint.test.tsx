/**
 * WorkflowNode - Breakpoint dot + Paused amber border - CANVAS-81, CANVAS-82
 *
 * Contract for the two debug-time decorations a workflow node must
 * render:
 *
 *   1. Red filled dot at the top-right of the node when its id is in the
 *      workflow store's ``breakpoints`` set. Visible in all canvas states
 *      (CANVAS-82). Exposed via ``data-testid="node-breakpoint-dot"``.
 *   2. Amber 3-4px border when the node's id matches the store's
 *      ``pausedNodeId`` (CANVAS-81). Rendered without the normal
 *      selection halo per CANVAS-81. Exposed via
 *      ``data-paused="true"`` on the node root.
 *
 * Both must co-exist when a paused node also has a breakpoint.
 *
 * The tests drive the node through a mocked workflow store so they can
 * vary ``breakpoints`` and ``pausedNodeId`` independently without pulling
 * in React Flow state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWorkflowStore: Record<string, unknown> = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  breakpoints: new Set<string>(),
  pausedNodeId: null as string | null,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  selectNode: vi.fn(),
  openConfigModal: vi.fn(),
  hasBreakpoint: vi.fn((id: string) =>
    (mockWorkflowStore.breakpoints as Set<string>).has(id)
  ),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  toggleBreakpoint: vi.fn(),
  toggleDisable: vi.fn(),
  toggleSkip: vi.fn(),
  unlinkNode: vi.fn(),
  setPausedNodeId: vi.fn(),
  drillPath: [] as Array<{ nodeId: string; label: string }>,
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowNode - breakpoint dot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.breakpoints = new Set<string>()
    mockWorkflowStore.pausedNodeId = null
  })

  it('renders the red breakpoint dot when node id is in the breakpoints set', async () => {
    mockWorkflowStore.breakpoints = new Set(['node-1'])
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const dot = screen.getByTestId('node-breakpoint-dot')
    expect(dot).toBeInTheDocument()
    // Red filled dot (CANVAS-82). Tailwind utility form.
    expect(dot.className).toMatch(/bg-red-500|rounded-full/)
  })

  it('does NOT render the breakpoint dot when node is not in the breakpoints set', async () => {
    mockWorkflowStore.breakpoints = new Set<string>()
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    expect(screen.queryByTestId('node-breakpoint-dot')).not.toBeInTheDocument()
  })

  it('renders the breakpoint dot in all canvas states (dragging=true)', async () => {
    mockWorkflowStore.breakpoints = new Set(['node-1'])
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
        dragging={true}
      />
    )

    expect(screen.getByTestId('node-breakpoint-dot')).toBeInTheDocument()
  })
})

describe('WorkflowNode - paused amber border', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.breakpoints = new Set<string>()
    mockWorkflowStore.pausedNodeId = null
  })

  it('marks node as paused (data-paused="true") when pausedNodeId matches', async () => {
    mockWorkflowStore.pausedNodeId = 'node-1'
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const node = screen.getByTestId('workflow-node-node-1')
    expect(node).toHaveAttribute('data-paused', 'true')
  })

  it('does NOT mark as paused when pausedNodeId is different', async () => {
    mockWorkflowStore.pausedNodeId = 'node-other'
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const node = screen.getByTestId('workflow-node-node-1')
    expect(node).not.toHaveAttribute('data-paused', 'true')
  })

  it('does NOT mark as paused when pausedNodeId is null', async () => {
    mockWorkflowStore.pausedNodeId = null
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const node = screen.getByTestId('workflow-node-node-1')
    expect(node).not.toHaveAttribute('data-paused', 'true')
  })

  it('applies an amber border tailwind class when paused', async () => {
    mockWorkflowStore.pausedNodeId = 'node-1'
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const node = screen.getByTestId('workflow-node-node-1')
    expect(node.className).toMatch(/border-amber-500/)
  })
})

describe('WorkflowNode - breakpoint + paused coexistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.breakpoints = new Set<string>()
    mockWorkflowStore.pausedNodeId = null
  })

  it('renders both the red dot AND the amber border when a paused node has a breakpoint', async () => {
    mockWorkflowStore.breakpoints = new Set(['node-1'])
    mockWorkflowStore.pausedNodeId = 'node-1'
    const { WorkflowNode } = await import(
      '@/features/workbench/common/canvas/workflow-node'
    )

    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{ label: 'Block', elementType: 'log' }}
      />
    )

    const node = screen.getByTestId('workflow-node-node-1')
    expect(screen.getByTestId('node-breakpoint-dot')).toBeInTheDocument()
    expect(node).toHaveAttribute('data-paused', 'true')
  })
})
