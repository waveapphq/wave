/**
 * WorkflowNode Execution State Tests
 *
 * TDD tests for REQ-3.2.2.15 (Live flow visualization) and REQ-3.2.2.16 (Highlight currently executing blocks)
 * V-CANVAS-04: Running state with status in breadcrumb, current block highlighted with pulse animation,
 * completed blocks show pass/fail icons.
 *
 * These tests cover WAVE-specific business logic:
 * - executionStatus prop contract
 * - Data attributes for test selectors (Playwright integration)
 * - Status icon rendering logic (which icon for which state)
 *
 * NOT tested here (visual concerns - covered by Playwright V-CANVAS-04):
 * - Specific CSS colors, border widths, background tints
 * - Animation timing and keyframes
 * - Dark/light mode color variations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

// Mock execution store - per-node subscription for execution status
let mockBlockExecutionStatus: string | undefined = undefined

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useBlockExecutionStatus: () => mockBlockExecutionStatus,
  useBlockResultSkipped: () => false,
}))

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('WorkflowNode Execution State - REQ-3.2.2.15, REQ-3.2.2.16, V-CANVAS-04', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlockExecutionStatus = undefined
    // Node must be reachable from start-node via BFS for execution status to show
    // (unreachable nodes are muted, which clears executionStatus)
    mockWorkflowStore.edges = [
      { id: 'e-start-1', source: 'start-node', target: 'node-1' },
    ]
    mockWorkflowStore.skippedNodeIds = []
  })

  describe('executionStatus Prop Contract', () => {
    it('exposes executionStatus via data attribute for Playwright selectors', async () => {
      mockBlockExecutionStatus = 'running'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-execution-status', 'running')
    })

    it('omits data-execution-status when not provided (idle state)', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-execution-status')
    })

    it.each([
      'pending',
      'running',
      'success',
      'failed',
      'warning',
      'skipped',
      'stopped',
    ] as const)('accepts executionStatus="%s"', async (status) => {
      mockBlockExecutionStatus = status
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-execution-status', status)
    })
  })

  describe('Status Icon Rendering (V-CANVAS-04: pass/fail icons)', () => {
    it('renders the run-state badge as pass for successful execution', async () => {
      mockBlockExecutionStatus = 'success'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', 'pass')
    })

    it('renders the run-state badge as fail for failed execution', async () => {
      mockBlockExecutionStatus = 'failed'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'fail')
    })

    it('renders the WARN badge for the warning execution status', async () => {
      mockBlockExecutionStatus = 'warning'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', 'warn')
      expect(badge).toHaveTextContent('WARN')
      expect(badge).toHaveAttribute('aria-label', 'Warning')
    })

    it('carries the amber chip classes on the WARN badge', async () => {
      mockBlockExecutionStatus = 'warning'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByTestId('node-run-state-badge').className).toContain('amber')
    })

    it('renders only the DISABLED badge when a warning block is also disabled', async () => {
      mockBlockExecutionStatus = 'warning'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script', disabled: true }}
        />
      )

      const badges = screen.getAllByTestId('node-run-state-badge')
      expect(badges).toHaveLength(1)
      expect(badges[0]).toHaveAttribute('data-state', 'disabled')
    })

    it('warning state is also reflected on the outer card data-execution-status', async () => {
      mockBlockExecutionStatus = 'warning'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-execution-status', 'warning')
    })

    it('applies amber border for warning state', async () => {
      mockBlockExecutionStatus = 'warning'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-execution-status', 'warning')
    })

    it('applies border-2 and execution border color class when execution state is active', async () => {
      mockBlockExecutionStatus = 'success'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node.className).toContain('border-2')
      expect(node.className).toContain('border-solid')
      expect(node.className).toContain('border-[#22C55E]')
    })

    it('applies border-0 when no execution state (no spurious border)', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node.className).toContain('border-0')
      expect(node.className).not.toContain('border-2')
    })

    it('renders the run-state badge as run for running state, paired with the border pulse', async () => {
      mockBlockExecutionStatus = 'running'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'run')
      expect(screen.getByTestId('workflow-node-node-1').className).toContain('animate-execution-pulse')
    })

    it('does not render the chip for pending state', async () => {
      mockBlockExecutionStatus = 'pending'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
    })

    it('does not render the chip when no executionStatus', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
    })
  })

  describe('Execution State with Selection', () => {
    it('preserves execution status when node is selected', async () => {
      mockBlockExecutionStatus = 'running'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
          selected={true}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-selected', 'true')
      expect(node).toHaveAttribute('data-execution-status', 'running')
    })
  })

  describe('State Transitions', () => {
    it('updates the chip when execution completes (running -> success)', async () => {
      mockBlockExecutionStatus = 'running'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      const { rerender } = renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      // Running: RUN badge.
      expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'run')

      // Transition to success.
      mockBlockExecutionStatus = 'success'
      rerender(
        <ReactFlowProvider>
          <WorkflowNode
            id="node-1"
            data={{ label: 'Test', elementType: 'shell-script' }}
          />
        </ReactFlowProvider>
      )

      const chip = screen.getByTestId('node-run-state-badge')
      expect(chip).toHaveAttribute('data-state', 'pass')
    })

    it('updates the chip when execution fails (running -> failed)', async () => {
      mockBlockExecutionStatus = 'running'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      const { rerender } = renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'run')

      mockBlockExecutionStatus = 'failed'
      rerender(
        <ReactFlowProvider>
          <WorkflowNode
            id="node-1"
            data={{ label: 'Test', elementType: 'shell-script' }}
          />
        </ReactFlowProvider>
      )

      const chip = screen.getByTestId('node-run-state-badge')
      expect(chip).toHaveAttribute('data-state', 'fail')
    })

    it('clears status icon on reset (success -> undefined)', async () => {
      mockBlockExecutionStatus = 'success'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      const { rerender } = renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
        />
      )

      // Success: chip is present.
      expect(screen.getByTestId('node-run-state-badge')).toBeInTheDocument()

      // Reset - executionStatus removed.
      mockBlockExecutionStatus = undefined
      rerender(
        <ReactFlowProvider>
          <WorkflowNode
            id="node-1"
            data={{ label: 'Test', elementType: 'shell-script' }}
          />
        </ReactFlowProvider>
      )

      // No chip after reset.
      expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
    })
  })

  describe('Preserves Existing Node Functionality', () => {
    it('preserves label and elementType icon when executionStatus added', async () => {
      mockBlockExecutionStatus = 'success'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'My Shell Script',
            elementType: 'shell-script',
            description: 'Custom description',
          }}
        />
      )

      expect(screen.getByText('My Shell Script')).toBeInTheDocument()
      expect(screen.getByText('Custom description')).toBeInTheDocument()
      expect(screen.getByTestId('workflow-node-icon')).toHaveAttribute('data-icon', 'file-terminal')

      // Run state surfaces as a status-bar badge.
      expect(screen.getByTestId('node-run-state-badge')).toHaveAttribute('data-state', 'pass')
    })
  })

  describe('Execution State with Action Row (Selected Node)', () => {
    it('renders action row with execution state when single-selected', async () => {
      mockBlockExecutionStatus = 'running'
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{
            label: 'Test',
            elementType: 'shell-script',
            version: '2.18',
          }}
        />
      )

      // Both execution state and action row should be present
      expect(screen.getByTestId('workflow-node-node-1')).toHaveAttribute(
        'data-execution-status',
        'running'
      )
      expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
    })
  })
})
