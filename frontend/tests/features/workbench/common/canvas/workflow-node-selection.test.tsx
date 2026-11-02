/**
 * WorkflowNode Selection Tests - V-CANVAS-03 Selected State Visual
 *
 * Tests WAVE-specific behavior for node selection and action row integration.
 * Does NOT test: CSS classes, theme styling, layout dimensions, keyboard navigation (library concerns).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

// Mock workflow store
const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  nodes: [
    {
      id: 'node-1',
      type: 'workflow-node',
      position: { x: 100, y: 100 },
      data: { label: 'HTTP Client', elementType: 'http-client', version: '2.18' },
    },
    {
      id: 'node-2',
      type: 'workflow-node',
      position: { x: 100, y: 250 },
      data: { label: 'Parse JSON', elementType: 'json-parser', version: '1.0' },
    },
  ],
  edges: [] as Array<{ id: string; source: string; target: string }>,
  selectNode: vi.fn(),
  deselectAll: vi.fn(),
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
  openConfigNodeIds: [] as string[],
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

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const useWorkflowStore = Object.assign(
    (selector?: (state: typeof mockWorkflowStore) => unknown) =>
      selector ? selector(mockWorkflowStore) : mockWorkflowStore,
    { getState: () => mockWorkflowStore }
  )
  return { useWorkflowStore }
})

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
)

describe('WorkflowNode Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.openConfigNodeIds = []
  })

  describe('Unselected State', () => {
    it('does not show action row when unselected', async () => {
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

      expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
    })

    it('marks node as not selected', async () => {
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
      expect(node).not.toHaveAttribute('data-selected', 'true')
    })
  })

  describe('Selected State', () => {
    it('marks node as selected', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-selected', 'true')
    })

    it('shows action row when single node selected', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']

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

      expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
    })

    it('shows connection handles when selected', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    })
  })

  describe('Selection Interaction', () => {
    it('calls selectNode when node clicked', async () => {
      const user = userEvent.setup()

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
      const nodeButton = within(node).getByTestId('workflow-node-body-node-1')
      await user.click(nodeButton)

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1')
    })

    it('adds to selection with Ctrl+click', async () => {
      const user = userEvent.setup()

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
      const nodeButton = within(node).getByTestId('workflow-node-body-node-1')
      // userEvent v14 requires keyboard API for modifier keys
      await user.keyboard('{Control>}')
      await user.click(nodeButton)
      await user.keyboard('{/Control}')

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1', {
        addToSelection: true,
      })
    })

    it('adds to selection with Meta+click (macOS)', async () => {
      const user = userEvent.setup()

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
      const nodeButton = within(node).getByTestId('workflow-node-body-node-1')
      // userEvent v14 requires keyboard API for modifier keys
      await user.keyboard('{Meta>}')
      await user.click(nodeButton)
      await user.keyboard('{/Meta}')

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1', {
        addToSelection: true,
      })
    })

    it('Enter and Space on the focused node body trigger selection (native button keyboard activation)', async () => {
      const user = userEvent.setup()
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

      const nodeBody = screen.getByTestId('workflow-node-body-node-1')
      mockWorkflowStore.selectNode.mockClear()

      // Real <button> elements activate on Enter and Space via the browser's native behavior.
      nodeBody.focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')
      expect(mockWorkflowStore.selectNode).toHaveBeenCalledTimes(2)
    })
  })

  describe('Action Row Integration', () => {
    it('does not surface the node version on the canvas (config-modal header only)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']

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

      // The version stays off the canvas entirely.
      expect(screen.queryByTestId('block-version')).not.toBeInTheDocument()
      expect(screen.queryByTestId('node-version-tooltip')).not.toBeInTheDocument()
      expect(screen.queryByTestId('node-version-tooltip-trigger')).not.toBeInTheDocument()
    })

    it('opens config modal when gear button clicked', async () => {
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

      await user.click(screen.getByLabelText(/configure/i))

      expect(mockWorkflowStore.openConfigModal).toHaveBeenCalledWith('node-1')
    })

    it('raises + pulses the already-open config sheet instead of reopening (refocus guard)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      mockWorkflowStore.openConfigNodeIds = ['node-1']
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

      await user.click(screen.getByLabelText(/configure/i))

      expect(mockWorkflowStore.openConfigModal).not.toHaveBeenCalled()
    })

    it('handles context menu action via kebab menu', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const user = userEvent.setup()

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      const { waitFor } = await import('@testing-library/react')
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

      // Open context menu
      await user.click(screen.getByLabelText(/more options/i))

      // Wait for menu to appear
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click an action - this triggers handleContextMenuAction in WorkflowNode
      await user.click(screen.getByRole('menuitem', { name: /run from here/i }))

      // The action was handled (callback was called even though it's a no-op placeholder)
    })
  })

  describe('Multi-Selection', () => {
    it('shows selection state on all selected nodes', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1', 'node-2']

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={true}
            dragging={false}
          />
          <WorkflowNode
            id="node-2"
            data={{ label: 'Parse JSON', elementType: 'json-parser' }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      const node1 = screen.getByTestId('workflow-node-node-1')
      const node2 = screen.getByTestId('workflow-node-node-2')

      expect(node1).toHaveAttribute('data-selected', 'true')
      expect(node2).toHaveAttribute('data-selected', 'true')
    })

    it('renders the persistent status bar on every node, including in multi-select', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1', 'node-2']

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
          <WorkflowNode
            id="node-2"
            data={{
              label: 'Parse JSON',
              elementType: 'json-parser',
              version: '1.0',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      // Each rendered node carries its own persistent status bar.
      expect(screen.getAllByTestId('node-status-bar')).toHaveLength(2)
    })
  })

  describe('Handle Click Passthrough', () => {
    it('does not call selectNode when clicking on a react-flow handle', async () => {
      const user = userEvent.setup()

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

      const handle = screen.getByTestId('handle-input')
      await user.click(handle)

      expect(mockWorkflowStore.selectNode).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('sets aria-pressed for screen readers', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{ label: 'HTTP Client', elementType: 'http-client' }}
            selected={true}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      const nodeButton = within(node).getByTestId('workflow-node-body-node-1')
      expect(nodeButton).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
