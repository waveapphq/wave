/**
 * Negative DOM tests - three surfaces that must not exist.
 *
 * Contract:
 * - No bottom-right `WorkflowNodeStatusChip`.
 * - No chevron toggle (the description has a 2-line clamp).
 * - No corner-positioned `NodeValidationAlert`; the alert sits in the
 *   status-bar left cluster.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: ['n1'] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map([
    ['n1', [{ code: 'REQUIRED_PARAM_MISSING', paramName: 'url', message: 'missing' }]],
  ]) as Map<string, Array<{ code: string; paramName?: string; message: string }>>,
  pulseValidationNodeIds: new Set() as Set<string>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
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
  pausedNodeId: null,
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

describe('Removed legacy surfaces - negative DOM guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no WorkflowNodeStatusChip in the DOM (legacy external chip)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client' }}
      />,
    )
    expect(screen.queryByTestId('workflow-node-status-chip')).not.toBeInTheDocument()
  })

  it('no name-chevron in the DOM (legacy collapse toggle)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client' }}
      />,
    )
    expect(screen.queryByTestId('workflow-node-name-chevron')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/expand name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/collapse name/i)).not.toBeInTheDocument()
  })

  it('the validation alert is not positioned at the TL corner', async () => {
    /*
     * The corner-positioning class chain (`absolute -top-1.5 -left-1.5`) is gone.
     * The alert badge lives inside the status bar left cluster (no corner positioning).
     */
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client' }}
      />,
    )
    const alert = screen.queryByTestId('node-validation-alert')
    if (alert) {
      // If rendered, it must NOT carry the corner-positioning class.
      expect(alert.className).not.toContain('-top-1.5')
      expect(alert.className).not.toContain('-left-1.5')
    }
    // Defensive: an element with the "absolute -top-1.5 -left-1.5" class set
    // must not exist anywhere in the WorkflowNode tree.
    const cornerEl = container.querySelector('.absolute.-top-1\\.5.-left-1\\.5')
    expect(cornerEl).toBeNull()
  })

  it('no BlockActionRow render (replaced by NodeStatusBar)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client' }}
      />,
    )
    expect(screen.queryByTestId('block-action-row')).not.toBeInTheDocument()
  })

  it('NodeStatusBar is present in the DOM (the bar replaces the action row)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client' }}
      />,
    )
    expect(screen.getByTestId('node-status-bar')).toBeInTheDocument()
  })
})
