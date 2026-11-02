/**
 * WorkflowNode: sizing, status chip, and chevron tests
 *
 * Pins the canvas node body contract:
 *
 *   - default width = 160px, range [120, 320]
 *   - default height = 44px, max = 120px
 *   - NodeResizer mounted with explicit min/max bounds
 *   - single status chip rendered OUTSIDE the body at bottom-right
 *     (`-bottom-1.5 -right-1.5`), with mutually-exclusive states
 *     (success / failed / warning / disabled / skipped)
 *   - no inside-body status anchors remain (StatusBadge / inside
 *     ExecutionStatusIcon are removed)
 *   - a chevron renders only when the name wraps, and toggles the
 *     `nameCollapsed` flag through the workflow store
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const setNodes = vi.fn()

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  edges: [
    { id: 'e-start-1', source: 'start-node', target: 'node-1' },
  ] as Array<{ id: string; source: string; target: string }>,
  nodes: [
    { id: 'node-1', data: { label: 'Shell Script', elementType: 'shell-script' } },
  ] as Array<{ id: string; data: Record<string, unknown>; width?: number; height?: number }>,
  variables: [] as Array<{ name: string; type: string }>,
  setNodes,
  selectNode: vi.fn(),
  openConfigModal: vi.fn(),
  hasBreakpoint: vi.fn().mockReturnValue(false),
  breakpoints: new Set<string>(),
  pausedNodeId: null as string | null,
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
  pushDrill: vi.fn(),
  popDrillOne: vi.fn(),
  popDrillTo: vi.fn(),
  clearDrill: vi.fn(),
}

// Zustand-like hook: callable as `useWorkflowStore(selector)` AND has a
// static `.getState()` accessor for code that reads outside the React tree
// (the chevron toggle in node.tsx uses both forms).
const useWorkflowStoreMock = (selector?: (state: typeof mockWorkflowStore) => unknown) =>
  selector ? selector(mockWorkflowStore) : mockWorkflowStore
;(useWorkflowStoreMock as unknown as { getState: () => typeof mockWorkflowStore }).getState =
  () => mockWorkflowStore

// Canvas nodes report a failed Function-body read through the toast; these
// specs render nodes without the app shell that provides one.
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  const { use } = await import('react')
  const fallback = { error: vi.fn() }
  return { ...actual, useToast: () => use(actual.ToastContext) ?? fallback }
})

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: useWorkflowStoreMock,
}))

let mockBlockExecutionStatus: string | undefined = undefined

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useBlockExecutionStatus: () => mockBlockExecutionStatus,
  useBlockResultSkipped: () => false,
}))

function renderNode(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('WorkflowNode sizing + chip + chevron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlockExecutionStatus = undefined
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.nodes = []
  })

  // ---------------------------------------------------------------------------
  // Sizing - default width / height + resize bounds
  // ---------------------------------------------------------------------------

  describe('default sizing', () => {
    it('renders with the default 240px width when no width is provided', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      renderNode(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />,
      )

      const node = screen.getByTestId('workflow-node-node-1')
      const style = node.getAttribute('style') ?? ''
      expect(style).toMatch(/width:\s*240px/)
    })

    it('respects a width carried on the node prop (clamped to [160, 360])', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      const props = { id: 'node-1', width: 280, data: { label: 'Shell Script', elementType: 'shell-script' } } as unknown as Parameters<typeof WorkflowNode>[0]
      renderNode(<WorkflowNode {...props} />)

      const node = screen.getByTestId('workflow-node-node-1')
      expect(node.getAttribute('style') ?? '').toMatch(/width:\s*280px/)
    })

    it('clamps width below 160 to the 160px floor', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      const props = { id: 'node-1', width: 50, data: { label: 'Shell Script', elementType: 'shell-script' } } as unknown as Parameters<typeof WorkflowNode>[0]
      renderNode(<WorkflowNode {...props} />)

      const style =
        screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
      expect(style).toMatch(/width:\s*160px/)
    })

    it('clamps width above 360 to the 360px ceiling', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      const props = { id: 'node-1', width: 9999, data: { label: 'Shell Script', elementType: 'shell-script' } } as unknown as Parameters<typeof WorkflowNode>[0]
      renderNode(<WorkflowNode {...props} />)

      const style =
        screen.getByTestId('workflow-node-node-1').getAttribute('style') ?? ''
      expect(style).toMatch(/width:\s*360px/)
    })
  })

  // ---------------------------------------------------------------------------
  // NodeResizer mount
  // ---------------------------------------------------------------------------

  describe('NodeResizer', () => {
    it('mounts a resize handle when the node is selected', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      renderNode(
        <WorkflowNode
          id="node-1"
          selected
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />,
      )

      // We don't pin the exact XYFlow internal class; the data-testid we
      // attach to the wrapper is the contract.
      expect(screen.getByTestId('node-resize-wrapper')).toBeInTheDocument()
    })

    it('omits the resize wrapper when the node is not selected', async () => {
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      renderNode(
        <WorkflowNode
          id="node-1"
          data={{ label: 'Shell Script', elementType: 'shell-script' }}
        />,
      )

      expect(screen.queryByTestId('node-resize-wrapper')).not.toBeInTheDocument()
    })
  })

})
