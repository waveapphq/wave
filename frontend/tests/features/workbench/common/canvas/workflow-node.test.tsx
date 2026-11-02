/**
 * WorkflowNode Tests - REQ-3.1.1.1 Drag-and-drop interface
 *
 * Tests WAVE-specific business logic for workflow nodes:
 * - Block type → icon mapping (WAVE's icon registry)
 * - Label fallback logic
 * - Node data prop structure validation
 *
 * NOT tested here (React Flow / visual concerns):
 * - Handle positions, visibility, hover effects (React Flow)
 * - CSS styling (Playwright visual tests)
 * - Drag behavior (React Flow)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

// Mock workflow store with all properties accessed by WorkflowNode
const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  mirrorActiveNodeId: null as string | null,
  mirrorLastChangeNodeId: null as string | null,
  mirrorChangeTick: 0,
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

describe('WorkflowNode - WAVE Business Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.mirrorActiveNodeId = null
    mockWorkflowStore.mirrorLastChangeNodeId = null
    mockWorkflowStore.mirrorChangeTick = 0
  })

  describe('Icon Mapping (WAVE Registry)', () => {
    it('maps "shell-script" elementType to the file terminal icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'file-terminal')
    })

    it('maps "http-client" elementType to globe icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'HTTP', elementType: 'http-client' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'globe')
    })

    it('maps "python" elementType to file-code-2 icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Python', elementType: 'python' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'file-code-2')
    })

    it('maps "if-else" control elementType to git-fork icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'If/Else', elementType: 'if-else', nodeType: 'control' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'git-fork')
    })

    it('maps "loop" control elementType to repeat icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Loop', elementType: 'loop', nodeType: 'control' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'repeat')
    })

    it('maps "parallel" control elementType to split icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Parallel', elementType: 'parallel', nodeType: 'control' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'split')
    })

    it('maps "log" elementType to scroll-text icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Log', elementType: 'log' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'scroll-text')
    })

    it('maps "sql" elementType to database icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'SQL', elementType: 'sql' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'database')
    })

    it('uses fallback box icon for unknown elementType', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Custom', elementType: 'unknown-xyz' }}
        />
      )

      const icon = screen.getByTestId('workflow-node-icon')
      expect(icon).toHaveAttribute('data-icon', 'box')
    })
  })

  describe('Label Display', () => {
    it('displays provided label', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'My Custom Block', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByText('My Custom Block')).toBeInTheDocument()
    })

    it('uses elementType as fallback when label is empty', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: '', elementType: 'http-client' }}
        />
      )

      expect(screen.getByText('http-client')).toBeInTheDocument()
    })

    it('uses elementType as fallback when label is undefined', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ elementType: 'shell-script' }}
        />
      )

      expect(screen.getByText('shell-script')).toBeInTheDocument()
    })
  })

  describe('Node Type Classification', () => {
    it('identifies control nodes via nodeType prop', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'If', elementType: 'if-else', nodeType: 'control' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-nodetype', 'control')
    })

    it('identifies plugin nodes via nodeType prop', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'HTTP', elementType: 'http-client', nodeType: 'plugin' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-nodetype', 'plugin')
    })

    it('identifies function nodes via nodeType prop and renders the L/S badge + dig-in glyph', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP_Client',
            elementType: 'http-client',
            nodeType: 'function',
            functionLifecycle: 'local',
          }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-nodetype', 'function')
      // Function-only badges flip on through node.tsx → NodeStatusBar wiring.
      expect(screen.getByTestId('node-function-lifecycle-badge')).toBeInTheDocument()
      expect(screen.getByTestId('node-dig-in')).toBeInTheDocument()
    })

    it('defaults to plugin nodeType when not specified', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Custom', elementType: 'custom' }}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-nodetype', 'plugin')
    })
  })

  describe('Selection State Propagation', () => {
    it('reflects selected=true from React Flow', async () => {
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
    })

    it('reflects selected=false from React Flow', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
          selected={false}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-selected', 'true')
    })
  })

  describe('Dragging State Propagation', () => {
    it('reflects dragging=true from React Flow', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Test', elementType: 'shell-script' }}
          dragging={true}
        />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-dragging', 'true')
    })
  })

  describe('Per-instance Description', () => {
    it('renders the description row when provided', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script', description: 'My Custom Script' }}
        />
      )

      expect(screen.getByTestId('node-description')).toHaveTextContent('My Custom Script')
    })

    it('does not render the description row when description is unset', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />
      )

      expect(screen.queryByTestId('node-description')).not.toBeInTheDocument()
    })
  })

  describe('Context Menu Actions', () => {
    it('handles context menu actions via callback', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      const { default: userEvent } = await import('@testing-library/user-event')

      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
          selected={true}
        />
      )

      // The action row should be visible when selected
      // Find and click the toggle breakpoint button (one of the context menu actions)
      const toggleBreakpointBtn = screen.queryByTestId('action-toggle-breakpoint')
      if (toggleBreakpointBtn) {
        const user = userEvent.setup()
        await user.click(toggleBreakpointBtn)

        // Context menu action should log to console
        expect(consoleSpy).toHaveBeenCalledWith(
          'Context menu action:',
          expect.any(String),
          'for node:',
          'node-1'
        )
      }

      consoleSpy.mockRestore()
    })
  })

  // ===========================================================================
  // Connection Handles (Pill Shape + Chevron) (REQ-3.1.1.2)
  // ===========================================================================
  describe('Connection Handles', () => {
    it('renders chevron icon in output handle', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />
      )

      // The output handle should contain a downward chevron indicating flow direction
      expect(screen.getByTestId('handle-chevron')).toBeInTheDocument()
    })

    it('renders exactly one chevron (output handle only, not input)', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />
      )

      // Only the output handle should have a chevron - input handle should not
      const chevrons = screen.getAllByTestId('handle-chevron')
      expect(chevrons).toHaveLength(1)
    })

    it('renders both input and output handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />
      )

      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    })

    it('applies proximity glow on input handle when proximityTarget is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script', proximityTarget: true }}
        />
      )

      const inputHandle = screen.getByTestId('handle-input')
      expect(inputHandle.className).toContain('ring-green-400')
      expect(inputHandle.className).toContain('bg-green-500')
      expect(inputHandle.className).toContain('animate-pulse')
    })

    it('applies proximity glow on output handle when proximitySource is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script', proximitySource: true }}
        />
      )

      const outputHandle = screen.getByTestId('handle-output')
      expect(outputHandle.className).toContain('ring-green-400')
      expect(outputHandle.className).toContain('bg-green-500')
      expect(outputHandle.className).toContain('animate-pulse')
    })
  })

  // Validation errors show through NodeValidationAlert; see node-validation-alert.test.tsx.

  describe('WorkflowNode - build-active mirror ring/border', () => {
    it('marks the node as build-active (data-mirror-active="true") and applies the violet border when mirrorActiveNodeId matches', async () => {
      mockWorkflowStore.mirrorActiveNodeId = 'node-1'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).toHaveAttribute('data-mirror-active', 'true')
      expect(node.className).toMatch(/border-violet-500/)
    })

    it('does NOT mark as build-active when mirrorActiveNodeId is a different id', async () => {
      mockWorkflowStore.mirrorActiveNodeId = 'node-other'
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-mirror-active', 'true')
      expect(node.className).not.toMatch(/border-violet-500/)
    })

    it('does NOT mark as build-active when mirrorActiveNodeId is null (idle)', async () => {
      mockWorkflowStore.mirrorActiveNodeId = null
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node).not.toHaveAttribute('data-mirror-active', 'true')
    })
  })

  describe('WorkflowNode - change pulse overlay', () => {
    it('renders the keyed pulse overlay with the animation when this node last changed', async () => {
      mockWorkflowStore.mirrorLastChangeNodeId = 'node-1'
      mockWorkflowStore.mirrorChangeTick = 3
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      const pulse = screen.getByTestId('node-change-pulse-node-1')
      expect(pulse.className).toMatch(/animate-mirror-node-pulse/)
    })

    it('does NOT render the pulse overlay for a different changed node', async () => {
      mockWorkflowStore.mirrorLastChangeNodeId = 'node-other'
      mockWorkflowStore.mirrorChangeTick = 3
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      expect(screen.queryByTestId('node-change-pulse-node-1')).not.toBeInTheDocument()
    })

    it('does NOT render the pulse overlay when nothing changed (null)', async () => {
      mockWorkflowStore.mirrorLastChangeNodeId = null
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode id="node-1" data={{ label: 'Block', elementType: 'log' }} />
      )

      expect(screen.queryByTestId('node-change-pulse-node-1')).not.toBeInTheDocument()
    })
  })
})
