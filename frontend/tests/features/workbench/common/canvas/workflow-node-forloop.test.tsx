/**
 * WorkflowNode For Loop Handle Rendering Tests
 *
 * Tests the for loop control's scoped path handles:
 * - body (cyan) + then (gray) always present
 *
 * Design Reference:
 * - REQ-3.5.1.15: For loop with counter variable
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

describe('WorkflowNode For Loop Handle Rendering (REQ-3.5.1.15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [
      { id: 'e-start-1', source: 'start-node', target: 'node-1' },
    ]
  })

  describe('Default handles (body + then) - 2 handles', () => {
    it('renders body and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-body')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
    })

    it('does not render the default single output handle', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
    })

    it('still renders input handle', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
    })

    it('body handle has cyan background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      const bodyHandle = screen.getByTestId('handle-output-body')
      expect(bodyHandle.className).toContain('!bg-cyan-500')
    })

    it('then handle has gray background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      const thenHandle = screen.getByTestId('handle-output-then')
      expect(thenHandle.className).toContain('!bg-zinc-600')
    })
  })

  describe('No try/catch handles rendered', () => {
    it('does not render try/catch/finally handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      expect(screen.queryByTestId('handle-output-try')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-catch')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-finally')).not.toBeInTheDocument()
    })
  })

  describe('Handle positioning and dynamic classes', () => {
    it('applies left position style for body and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      const bodyHandle = screen.getByTestId('handle-output-body')
      expect(bodyHandle.style.left).toBe('48px')

      const thenHandle = screen.getByTestId('handle-output-then')
      expect(thenHandle.style.left).toBe('112px')
    })

    it('no longer applies a bottom offset (action row is inside the card, handles anchor to outer bottom)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      const bodyHandle = screen.getByTestId('handle-output-body')
      expect(bodyHandle.className).not.toContain('!bottom-[-36px]')
    })

    it('applies proximity source ring when proximitySource is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
            proximitySource: true,
          }}
        />
      )

      const bodyHandle = screen.getByTestId('handle-output-body')
      expect(bodyHandle.className).toContain('!ring-2')
      expect(bodyHandle.className).toContain('!ring-green-400')
      expect(bodyHandle.className).toContain('animate-pulse')
    })
  })

  describe('Handle names', () => {
    it('each handle carries its role as an accessible name', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'For Loop',
            elementType: 'for',
            nodeType: 'control',
            config: { values: { mode: 'count', count: 5 } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-body')).toHaveAttribute('aria-label', 'body')
      expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
    })
  })
})
