/**
 * Tests for the node's run-state visuals via NodeStatusBar.
 *
 * Contract:
 * - Each run state renders the correct badge (PASS / FAIL / SKIP / RUN / PAUSED / DISABLED).
 * - RUN applies an animated border-pulse class to the outer card.
 * - DISABLED applies grayscale + opacity 0.55 to the outer card.
 * - Run-state badges are mutually exclusive (one at a time).
 *
 * The run state surfaces on the persistent bar - not as a corner chip or chevron.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  edges: [
    { id: 'e-start-1', source: 'start-node', target: 'n1' },
  ] as Array<{ id: string; source: string; target: string }>,
  nodes: [] as Array<{ id: string; data: { elementType?: string } }>,
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
  setNodes: vi.fn(),
  breakpoints: new Set<string>(),
  pausedNodeId: null as string | null,
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

let mockBlockExecutionStatus: string | undefined = undefined
let mockBlockResultSkipped = false

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useBlockExecutionStatus: () => mockBlockExecutionStatus,
  useBlockResultSkipped: () => mockBlockResultSkipped,
}))

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('Node run state - status bar badges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlockExecutionStatus = undefined
    mockBlockResultSkipped = false
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.pausedNodeId = null
  })

  it('renders the PASS badge when execution status is success', async () => {
    mockBlockExecutionStatus = 'success'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    const badge = screen.getByTestId('node-run-state-badge')
    expect(badge).toHaveAttribute('data-state', 'pass')
  })

  it('renders the FAIL badge when execution status is failed', async () => {
    mockBlockExecutionStatus = 'failed'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'fail')
  })

  it('renders the RUN badge when execution status is running', async () => {
    mockBlockExecutionStatus = 'running'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'run')
  })

  it('RUN applies the animate-execution-pulse class to the outer card wrapper', async () => {
    mockBlockExecutionStatus = 'running'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    const card = screen.getByTestId('workflow-node-n1')
    expect(card.className).toContain('animate-execution-pulse')
  })

  it('renders the SKIP badge when the node is in skippedNodeIds', async () => {
    mockWorkflowStore.skippedNodeIds = ['n1']
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'skip')
  })

  it('renders the SKIP badge for a result-skip (ran then reported skipped)', async () => {
    // A function-scope Halt(skipped) makes the Function instance run then report
    // skipped; the execution store flags resultSkipped, which paints SKIP.
    mockBlockExecutionStatus = 'skipped'
    mockBlockResultSkipped = true
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'skip')
  })

  it('renders NO badge for a structural skip (skipped without ever running)', async () => {
    // Drain-after-halt / not-taken branch: block_state 'skipped' but never ran,
    // so it stays neutral (no SKIP badge).
    mockBlockExecutionStatus = 'skipped'
    mockBlockResultSkipped = false
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
  })

  it('renders the SKIP badge for a Halt(status=skipped) node (amber warning status)', async () => {
    // A skipped Halt is the only node mapped to the amber 'warning' status; it is
    // an intentional skip and must carry the SKIP badge.
    mockBlockExecutionStatus = 'warning'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'Halt', elementType: 'halt' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'skip')
  })

  it('renders the WARN badge for a plugin block that recorded a failure', async () => {
    // A K8s read set to Record and continue whose read the cluster refused paints
    // amber and says WARN; the run verdict is untouched.
    mockBlockExecutionStatus = 'warning'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'K8s Get', elementType: 'k8s-get' }} />,
    )
    const badge = screen.getByTestId('node-run-state-badge')
    expect(badge).toHaveAttribute('data-state', 'warn')
    expect(badge).toHaveTextContent('WARN')
  })

  it('renders the STOPPED badge when execution status is stopped', async () => {
    mockBlockExecutionStatus = 'stopped'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'stopped')
  })

  it('renders the DISABLED badge when data.disabled is true', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client', disabled: true }}
      />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'disabled')
  })

  it('DISABLED applies grayscale + opacity-55 classes to the outer card wrapper', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client', disabled: true }}
      />,
    )
    const card = screen.getByTestId('workflow-node-n1')
    expect(card.className).toMatch(/grayscale/)
    // Opacity 0.55 maps to a Tailwind opacity class (opacity-55) or arbitrary value.
    expect(card.className).toMatch(/opacity-\[?0?\.?55\]?|opacity-55/)
  })

  it('renders the PAUSED badge when the node is the pausedNodeId', async () => {
    mockWorkflowStore.pausedNodeId = 'n1'
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'paused')
  })

  it('does NOT render multiple run-state badges simultaneously', async () => {
    mockBlockExecutionStatus = 'success'
    mockWorkflowStore.skippedNodeIds = ['n1']
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client', disabled: true }}
      />,
    )
    const badges = screen.getAllByTestId('node-run-state-badge')
    expect(badges).toHaveLength(1)
  })

  it('no run-state badge in idle state (no execution, no skip, not disabled)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
  })
})
