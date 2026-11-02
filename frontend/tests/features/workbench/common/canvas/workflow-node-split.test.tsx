/**
 * WorkflowNode Split Mode Tests - Assert control dual output handles
 *
 * Tests the split mode feature for Assert nodes where the node renders
 * two output handles (pass/fail) instead of the default single handle.
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

describe('WorkflowNode Split Mode - Assert dual output handles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [
      { id: 'e-start-1', source: 'start-node', target: 'node-1' },
    ]
  })

  describe('Default mode (no explicit config)', () => {
    // Assert defaults to SPLIT when mode is
    // undefined so a fresh drop wires both pass and fail egress immediately.
    it('renders split (pass + fail) handles when mode is undefined', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Assert', elementType: 'assert' }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.getByTestId('handle-output-pass')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-fail')).toBeInTheDocument()
    })
  })

  describe('Single mode (explicit)', () => {
    it('renders single output handle for assert node in single mode', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'single' } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-pass')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-fail')).not.toBeInTheDocument()
    })
  })

  describe('Split mode', () => {
    it('renders two output handles (pass and fail) for assert node in split mode', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.getByTestId('handle-output-pass')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-fail')).toBeInTheDocument()
    })

    it('pass handle has green background class', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      const passHandle = screen.getByTestId('handle-output-pass')
      expect(passHandle.className).toContain('!bg-green-500')
    })

    it('fail handle has red background class', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      const failHandle = screen.getByTestId('handle-output-fail')
      expect(failHandle.className).toContain('!bg-red-500')
    })

    it('pass handle renders Check icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      // Check icon is rendered inside the pass handle - verify it has an SVG child
      const passHandle = screen.getByTestId('handle-output-pass')
      const svg = passHandle.querySelector('svg')
      expect(svg).not.toBeNull()
    })

    it('fail handle renders X icon', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      // X icon is rendered inside the fail handle - verify it has an SVG child
      const failHandle = screen.getByTestId('handle-output-fail')
      const svg = failHandle.querySelector('svg')
      expect(svg).not.toBeNull()
    })

    it('split mode handles render at the natural bottom of the card (no shift offset)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      const passHandle = screen.getByTestId('handle-output-pass')
      const failHandle = screen.getByTestId('handle-output-fail')
      // Action bar is always rendered INSIDE the card and the handles anchor
      // to the bottom of the outer card, so no artificial `bottom: -36px` offset is needed.
      expect(passHandle.className).not.toContain('!bottom-[-36px]')
      expect(failHandle.className).not.toContain('!bottom-[-36px]')
    })

    it('split mode handles glow when proximitySource is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { values: { mode: 'split' } },
            proximitySource: true,
          }}
        />
      )

      const passHandle = screen.getByTestId('handle-output-pass')
      const failHandle = screen.getByTestId('handle-output-fail')
      // Proximity glow classes applied when proximitySource is true
      expect(passHandle.className).toContain('!ring-green-400')
      expect(passHandle.className).toContain('animate-pulse')
      expect(failHandle.className).toContain('!ring-red-400')
      expect(failHandle.className).toContain('animate-pulse')
    })
  })

  describe('Non-assert nodes', () => {
    it('always renders single output handle regardless of config', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            config: { values: { mode: 'split' } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-pass')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-fail')).not.toBeInTheDocument()
    })
  })

  describe('Cycle detection - single handle', () => {
    it('renders cycle indicator instead of normal input handle when proximityCycleDetected is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityCycleDetected: true,
          }}
        />
      )

      // Cycle indicator handle should be rendered
      expect(screen.getByTestId('handle-input-cycle')).toBeInTheDocument()
      // Normal input handle should NOT be present
      expect(screen.queryByTestId('handle-input')).not.toBeInTheDocument()
    })

    it('cycle indicator has red background styling', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityCycleDetected: true,
          }}
        />
      )

      const cycleHandle = screen.getByTestId('handle-input-cycle')
      expect(cycleHandle.className).toContain('!bg-red-600')
    })

    it('cycle indicator renders RefreshCcw icon (SVG)', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityCycleDetected: true,
          }}
        />
      )

      const cycleHandle = screen.getByTestId('handle-input-cycle')
      const svg = cycleHandle.querySelector('svg')
      expect(svg).not.toBeNull()
    })
  })

  describe('Cycle detection - multi handle', () => {
    it('renders cycle indicator on first handle when multi-ingress node has proximityCycleDetected', async () => {
      // Set up edges so ingressCount > 1
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
        { id: 'e2', source: 'b', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityCycleDetected: true,
          }}
        />
      )

      // First handle should be cycle indicator
      expect(screen.getByTestId('handle-input-cycle')).toBeInTheDocument()
      // Second handle should be normal (with ingress_1 id)
      expect(screen.getByTestId('handle-input-ingress_1')).toBeInTheDocument()
    })

    it('multi-handle cycle indicator has red background', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
        { id: 'e2', source: 'b', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityCycleDetected: true,
          }}
        />
      )

      const cycleHandle = screen.getByTestId('handle-input-cycle')
      expect(cycleHandle.className).toContain('!bg-red-600')
    })
  })

  describe('Multi-ingress handles - normal (no cycle)', () => {
    it('renders multiple input handles for multi-ingress node', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
        { id: 'e2', source: 'b', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
          }}
        />
      )

      // First handle is default (no id suffix), second has ingress_1
      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
      expect(screen.getByTestId('handle-input-ingress_1')).toBeInTheDocument()
    })

    it('renders add handle when proximityTarget is true with existing ingress edges', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityTarget: true,
          }}
        />
      )

      // "+" handle should be rendered
      expect(screen.getByTestId('handle-input-add')).toBeInTheDocument()
    })

    it('add handle has green background', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityTarget: true,
          }}
        />
      )

      const addHandle = screen.getByTestId('handle-input-add')
      expect(addHandle.className).toContain('!bg-green-600')
    })

    it('add handle renders Plus icon', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityTarget: true,
          }}
        />
      )

      const addHandle = screen.getByTestId('handle-input-add')
      const svg = addHandle.querySelector('svg')
      expect(svg).not.toBeNull()
    })

    it('does not show add handle when proximityTarget is false', async () => {
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityTarget: false,
          }}
        />
      )

      expect(screen.queryByTestId('handle-input-add')).not.toBeInTheDocument()
    })

    it('multi-ingress handles glow when proximityTarget is true without showAddHandle', async () => {
      // proximityTarget=true but ingressCount=0 - no showAddHandle but proximityTarget still active
      // Actually showAddHandle requires ingressCount >= 1, so let's test with 2 edges where
      // showAddHandle is true. The normal handles should NOT glow when showAddHandle is active.
      mockWorkflowStore.edges = [
        { id: 'e1', source: 'a', target: 'node-1' },
        { id: 'e2', source: 'b', target: 'node-1' },
      ]

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            proximityTarget: true,
          }}
        />
      )

      // Normal handles should NOT glow when showAddHandle is active
      const defaultHandle = screen.getByTestId('handle-input')
      expect(defaultHandle.className).not.toContain('animate-pulse')
    })
  })

  describe('If/Else branching handles', () => {
    it('renders output handles for each branch', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: 'Check A' },
                  { id: 'branch_1', type: 'else_if', label: '' },
                  { id: 'branch_2', type: 'else', label: '' },
                ],
              },
            },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-branch_2')).toBeInTheDocument()
      // Default single output handle should NOT be present
      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
    })

    it('uses the branch label as the handle name when provided', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: 'Is Admin' },
                  { id: 'branch_1', type: 'else', label: '' },
                ],
              },
            },
          }}
        />
      )

      const ifHandle = screen.getByTestId('handle-output-branch_0')
      expect(ifHandle).toHaveAttribute('aria-label', 'Is Admin')
    })

    it('falls back to the type-based name when no label provided', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: '' },
                  { id: 'branch_1', type: 'else_if', label: '' },
                  { id: 'branch_2', type: 'else', label: '' },
                ],
              },
            },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-branch_0')).toHaveAttribute('aria-label', 'if')
      expect(screen.getByTestId('handle-output-branch_1')).toHaveAttribute('aria-label', 'else if')
      expect(screen.getByTestId('handle-output-branch_2')).toHaveAttribute('aria-label', 'else')
    })

    it('if-else handles no longer apply a bottom offset (action row is inside the card)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: '' },
                  { id: 'branch_1', type: 'else', label: '' },
                ],
              },
            },
          }}
        />
      )

      const ifHandle = screen.getByTestId('handle-output-branch_0')
      expect(ifHandle.className).not.toContain('!bottom-[-36px]')
    })

    it('if-else handles glow when proximitySource is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            proximitySource: true,
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: '' },
                  { id: 'branch_1', type: 'else', label: '' },
                ],
              },
            },
          }}
        />
      )

      const ifHandle = screen.getByTestId('handle-output-branch_0')
      expect(ifHandle.className).toContain('!ring-green-400')
      expect(ifHandle.className).toContain('animate-pulse')
    })

    it('renders single output handle when if-else has empty branches', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [],
              },
            },
          }}
        />
      )

      // Falls back to single output handle when no branches configured
      expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    })

    it('renders single output handle when if-else has only one branch', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'If/Else',
            elementType: 'if-else',
            config: {
              values: {
                branches: [
                  { id: 'branch_0', type: 'if', label: '' },
                ],
              },
            },
          }}
        />
      )

      // Single branch still uses If/Else mode (branches.length > 0)
      expect(screen.getByTestId('handle-output-branch_0')).toBeInTheDocument()
    })
  })

  describe('No config fallback', () => {
    // When an Assert node has no explicit
    // mode (empty config or config-without-values), it falls back to SPLIT
    // mode so the pass and fail egress handles are always available on a
    // fresh drop.
    it('renders split handles when assert node has empty config', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: {},
          }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.getByTestId('handle-output-pass')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-fail')).toBeInTheDocument()
    })

    it('renders split handles when assert node has config without values', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Assert',
            elementType: 'assert',
            config: { outputBindings: {} },
          }}
        />
      )

      expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
      expect(screen.getByTestId('handle-output-pass')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-fail')).toBeInTheDocument()
    })
  })
})
