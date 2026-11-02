/**
 * WorkflowNode Disabled/Skipped Visual State Tests
 *
 * Tests that WorkflowNode renders correct data attributes and state indicators
 * when a node's data contains disabled=true or skipped=true.
 *
 * Does NOT test: CSS classes, opacity values, border styles (Playwright handles visual validation).
 * Tests ONLY: data attributes for state signaling and menu state feedback.
 *
 * Design Reference:
 * - CANVAS-71: Disabled = structural (no connections)
 * - CANVAS-72: Skipped = runtime (bypassed)
 * - CANVAS-73: Both dashed border, Disabled also 50% opacity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

// Mock workflow store
const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  nodes: [] as Array<{ id: string }>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  selectNode: vi.fn(),
  deselectAll: vi.fn(),
  openConfigModal: vi.fn(),
  hasBreakpoint: vi.fn().mockReturnValue(false),
  toggleDisable: vi.fn(),
  toggleSkip: vi.fn(),
  unlinkNode: vi.fn(),
  deleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  toggleBreakpoint: vi.fn(),
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

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
)

describe('WorkflowNode Disabled/Skipped Visual State', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlockExecutionStatus = undefined
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.hasBreakpoint.mockReturnValue(false)
  })

  describe('Normal State (neither disabled nor skipped)', () => {
    it('does not set data-disabled attribute', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-disabled')
    })

    it('does not set data-skipped attribute', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-skipped')
    })
  })

  describe('Disabled State (CANVAS-71)', () => {
    it('sets data-disabled="true" when node data has disabled=true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              disabled: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-disabled', 'true')
    })

    it('does not set data-disabled when disabled=false', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              disabled: false,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-disabled')
    })
  })

  describe('Skipped State (CANVAS-72)', () => {
    it('sets data-skipped="true" when node is in skippedNodeIds', async () => {
      mockWorkflowStore.skippedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-skipped', 'true')
    })

    it('does not set data-skipped when node is not in skippedNodeIds', async () => {
      mockWorkflowStore.skippedNodeIds = []
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-skipped')
    })
  })

  describe('Both States (CANVAS-73)', () => {
    it('sets both data-disabled and data-skipped when both are true', async () => {
      mockWorkflowStore.skippedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              disabled: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-disabled', 'true')
      expect(node).toHaveAttribute('data-skipped', 'true')
    })
  })

  // Status chip contract:
  // the inside-body StatusBadge ("D"/"S") was merged with ExecutionStatusIcon
  // into a single chip rendered OUTSIDE the body at bottom-right.
  describe('Status Chip Rendering', () => {
    it('renders the unified chip with skipped state when node is skipped', async () => {
      mockWorkflowStore.skippedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', 'skip')
    })

    it('renders the run-state badge as disabled when node has disabled=true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              disabled: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', 'disabled')
    })

    it('prefers disabled over skipped when both are set', async () => {
      mockWorkflowStore.skippedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              disabled: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const badge = screen.getByTestId('node-run-state-badge')
      expect(badge).toHaveAttribute('data-state', 'disabled')
    })

    it('omits the run-state badge when neither disabled nor skipped and no execution status', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      expect(screen.queryByTestId('node-run-state-badge')).not.toBeInTheDocument()
      // No inside-body badge.
      expect(screen.queryByTestId('node-status-badge')).not.toBeInTheDocument()
    })
  })

  describe('Menu State Feedback', () => {
    it('shows Enable label in kebab menu when node is disabled', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const user = userEvent.setup()

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
              disabled: true,
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      await user.click(screen.getByLabelText(/more options/i))

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /^enable$/i })).toBeInTheDocument()
      })
    })

    it('shows Disable label in kebab menu when node is not disabled', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const user = userEvent.setup()

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      await user.click(screen.getByLabelText(/more options/i))

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /^disable$/i })).toBeInTheDocument()
      })
    })

    it('shows Unskip label in kebab menu when node is skipped', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      mockWorkflowStore.skippedNodeIds = ['node-1']
      const user = userEvent.setup()

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      await user.click(screen.getByLabelText(/more options/i))

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /^unskip$/i })).toBeInTheDocument()
      })
    })

    it('shows Skip label in kebab menu when node is not skipped', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const user = userEvent.setup()

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      await user.click(screen.getByLabelText(/more options/i))

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /^skip$/i })).toBeInTheDocument()
      })
    })
  })

  describe('Unreachable State (BFS from start-node)', () => {
    it('mutes execution status when node is unreachable from start', async () => {
      // No edges - node-1 is unreachable from start-node
      mockBlockExecutionStatus = 'running'
      mockWorkflowStore.edges = []

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      // Unreachable nodes are muted - executionStatus is cleared
      expect(node).not.toHaveAttribute('data-execution-status')
    })

    it('preserves execution status when node is reachable via branching edges', async () => {
      // start-node has two outgoing edges (covers adjacency list append branch)
      mockBlockExecutionStatus = 'running'
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'start-node', target: 'node-a' },
        { id: 'e2', source: 'start-node', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      // Reachable node shows execution status
      expect(node).toHaveAttribute('data-execution-status', 'running')
    })
  })
})
