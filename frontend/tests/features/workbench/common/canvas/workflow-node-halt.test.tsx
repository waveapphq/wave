/**
 * WorkflowNode Halt Mode Tests - No output handle for terminating node
 *
 * Tests the halt control's dead-end behavior where the node renders
 * NO source (bottom/output) handle since execution stops at halt.
 *
 * Design Reference:
 * - REQ-3.5.1.4: Halt block (stop test/suite/regression execution)
 * - "The halt node is a terminal dead-end. It renders with a top target handle
 *    (input) but no bottom source handle (output)."
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

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('WorkflowNode Halt Mode - No output handle (REQ-3.5.1.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [
      { id: 'e-start-1', source: 'start-node', target: 'node-1' },
    ]
  })

  describe('No output handle (dead-end)', () => {
    it('renders NO source (bottom/output) handle for halt node', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Halt', elementType: 'halt' }}
        />
      )

      // Halt is a dead-end - no output handles of any kind
      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-pass')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-fail')).not.toBeInTheDocument()
    })

    it('still renders input (top/target) handle for halt node', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Halt', elementType: 'halt' }}
        />
      )

      // Halt still has an input handle - edges can flow INTO it
      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
    })

    it('renders no output handle even when halt node is selected (action row visible)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{ label: 'Halt', elementType: 'halt' }}
        />
      )

      // Even with action row showing, halt must not have output handles
      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
    })

    it('renders no output handle even with config values set', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Halt',
            elementType: 'halt',
            config: {
              values: { scope: 'test', status: 'failed', message: 'stopping' },
            },
          }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-pass')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-fail')).not.toBeInTheDocument()
    })

    it('renders no output handle even with proximitySource active', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Halt',
            elementType: 'halt',
            proximitySource: true,
          }}
        />
      )

      // Even with proximity glow active, halt has no output handle to glow
      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
    })
  })

  describe('Non-halt nodes still have output handles', () => {
    it('non-halt flow control (try-catch-finally) still renders output handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Try/Catch', elementType: 'try-catch-finally' }}
        />
      )

      // Try-catch renders named path handles instead of single handle-output
      expect(screen.getByTestId('handle-output-try')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
    })

    it('delay control still renders output handle', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Delay', elementType: 'delay' }}
        />
      )

      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    })
  })
})
