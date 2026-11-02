/**
 * WorkflowNode Remote Locus badge tests (REQ-3.4.1.3).
 *
 * A block inside a Remote Execution container's body carries an R (remotable ->
 * runs on the host) or L (not remotable -> runs on WAVE) badge, set automatically
 * from the plugin's remotable flag. Blocks outside a container body have none.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  edges: [] as Array<{ source: string; target: string; sourceHandle?: string }>,
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

/** Put node-1 inside a Remote Execution container's body sub-flow. */
function seedInsideBody(elementType: string) {
  mockWorkflowStore.nodes = [
    { id: 'rex', data: { elementType: 'remote-execution' } },
    { id: 'node-1', data: { elementType } },
  ]
  mockWorkflowStore.edges = [{ source: 'rex', target: 'node-1', sourceHandle: 'body' }]
}

describe('WorkflowNode Remote Locus badge (REQ-3.4.1.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.nodes = []
    mockWorkflowStore.edges = []
    mockWorkflowStore.drillPath = []
  })

  it('shows R on a remotable body block (HTTP)', async () => {
    seedInsideBody('http-client')
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ label: 'HTTP', elementType: 'http-client', nodeType: 'plugin' }} />)

    const badge = screen.getByTestId('node-remote-locus-badge')
    expect(badge).toHaveTextContent('R')
  })

  it('shows L on a non-remotable body block (Log)', async () => {
    seedInsideBody('log')
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ label: 'Log', elementType: 'log', nodeType: 'plugin' }} />)

    const badge = screen.getByTestId('node-remote-locus-badge')
    expect(badge).toHaveTextContent('L')
  })

  it('shows no locus badge for a block outside any container body', async () => {
    // node-1 is the then-successor, not in the body.
    mockWorkflowStore.nodes = [
      { id: 'rex', data: { elementType: 'remote-execution' } },
      { id: 'node-1', data: { elementType: 'log' } },
    ]
    mockWorkflowStore.edges = [{ source: 'rex', target: 'node-1', sourceHandle: 'then' }]
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ label: 'Log', elementType: 'log', nodeType: 'plugin' }} />)

    expect(screen.queryByTestId('node-remote-locus-badge')).not.toBeInTheDocument()
  })

  it('shows R on a remotable block in a drilled Function body whose instance sits in a body', async () => {
    mockWorkflowStore.nodes = [
      { id: 'rex', data: { elementType: 'remote-execution' } },
      {
        id: 'fn',
        data: {
          elementType: 'function',
          nodeType: 'function',
          localDefinition: { workflow: { nodes: [{ id: 'node-1', data: { elementType: 'file-io' } }], edges: [] } },
        },
      },
    ]
    mockWorkflowStore.edges = [{ source: 'rex', target: 'fn', sourceHandle: 'body' }]
    mockWorkflowStore.drillPath = [{ nodeId: 'fn', label: 'fn' }]
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ label: 'File I/O', elementType: 'file-io', nodeType: 'plugin' }} />)

    expect(screen.getByTestId('node-remote-locus-badge')).toHaveTextContent('R')
  })

  it('shows L on a local block inside a Remote Execution body of a drilled Function body', async () => {
    const bodyNodes = [
      { id: 'inner-rex', data: { elementType: 'remote-execution' } },
      { id: 'node-1', data: { elementType: 'log' } },
    ]
    const bodyEdges = [{ source: 'inner-rex', target: 'node-1', sourceHandle: 'body' }]
    mockWorkflowStore.nodes = [
      {
        id: 'fn',
        data: { elementType: 'function', nodeType: 'function', localDefinition: { workflow: { nodes: bodyNodes, edges: bodyEdges } } },
      },
    ]
    mockWorkflowStore.drillPath = [{ nodeId: 'fn', label: 'fn' }]
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ label: 'Log', elementType: 'log', nodeType: 'plugin' }} />)

    expect(screen.getByTestId('node-remote-locus-badge')).toHaveTextContent('L')
  })
})
