/**
 * Tests for the node description row inside the WorkflowNode body.
 *
 * Contract:
 * - Description row renders only when `data.description` is non-empty.
 * - 2-line clamp class is applied.
 * - Title row still renders the entity type label (not the description).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

const mockWorkflowStore = {
  selectedNodeIds: [] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  edges: [] as Array<{ id: string; source: string; target: string }>,
  nodes: [] as Array<{ id: string; data: { elementType?: string; description?: string } }>,
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

vi.mock('@/features/workbench/stores/workflow-store', () => {
  const hook = (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore
  // node.tsx calls useWorkflowStore.getState() inside handleToggleDescriptionExpanded.
  ;(hook as unknown as { getState: () => typeof mockWorkflowStore }).getState = () => mockWorkflowStore
  return { useWorkflowStore: hook }
})

function renderWithReactFlow(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

describe('Node description row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render a description row when description is undefined', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="n1" data={{ label: 'HTTP_Client', elementType: 'http-client' }} />,
    )
    expect(screen.queryByTestId('node-description')).not.toBeInTheDocument()
  })

  it('does not render a description row when description is the empty string', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{ label: 'HTTP_Client', elementType: 'http-client', description: '' }}
      />,
    )
    expect(screen.queryByTestId('node-description')).not.toBeInTheDocument()
  })

  it('renders the description row when description is non-empty', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'Probe gateway',
        }}
      />,
    )
    const desc = screen.getByTestId('node-description')
    expect(desc).toBeInTheDocument()
    expect(desc).toHaveTextContent('Probe gateway')
  })

  it('applies the line-clamp-2 class on the description row', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'A very long description that should be clamped to two lines for display',
        }}
      />,
    )
    const desc = screen.getByTestId('node-description')
    expect(desc.className).toContain('line-clamp-2')
  })

  it('title row continues to render the entity type label, not the description', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'Probe gateway',
        }}
      />,
    )
    // Title row exists and surfaces the entity type label
    expect(screen.getByText('HTTP_Client')).toBeInTheDocument()
  })

  it('renders multiline description text verbatim', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'Line one\nLine two',
        }}
      />,
    )
    const desc = screen.getByTestId('node-description')
    expect(desc.textContent).toBe('Line one\nLine two')
  })

  it('does NOT read the legacy displayName field', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={
          {
            label: 'HTTP_Client',
            elementType: 'http-client',
            displayName: 'LEGACY',
          } as unknown as { label: string; elementType: string }
        }
      />,
    )
    expect(screen.queryByText('LEGACY')).not.toBeInTheDocument()
    expect(screen.queryByTestId('node-description')).not.toBeInTheDocument()
  })

  it('chevron carries the "Expand description" aria-label when collapsed (overflowing, not expanded)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    // Force a measured overflow so the chevron shows even though descriptionExpanded=false.
    const origDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 999 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 10 } })

    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'A long description that overflows two lines',
          descriptionExpanded: false,
        }}
      />,
    )

    const chevron = screen.getByTestId('node-description-chevron')
    expect(chevron).toHaveAttribute('aria-label', 'Expand description')
    expect(chevron).toHaveAttribute('aria-expanded', 'false')

    // Restore.
    if (origDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origDescriptor)
  })

  it('reports a measured overflow to the block without updating it during render', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 999 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 10 } })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      renderWithReactFlow(
        <StrictMode>
          <WorkflowNode
            id="n1"
            data={{
              label: 'HTTP_Client',
              elementType: 'http-client',
              description: 'A long description that overflows two lines',
              descriptionExpanded: false,
            }}
          />
        </StrictMode>,
      )

      expect(screen.getByTestId('node-description-chevron')).toBeInTheDocument()
      const duringRender = errors.mock.calls.filter((call) =>
        String(call[0]).includes('Cannot update a component'),
      )
      expect(duringRender).toEqual([])
    } finally {
      errors.mockRestore()
      if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight)
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
    }
  })

  it('keyboard Enter / Space on the description chevron toggles descriptionExpanded; other keys are ignored', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { fireEvent } = await import('@testing-library/react')
    mockWorkflowStore.nodes = [
      { id: 'n1', data: { elementType: 'http-client', description: 'desc', descriptionExpanded: true } as unknown as { elementType: string; description: string } },
    ]
    const setNodesSpy = vi.fn()
    mockWorkflowStore.setNodes = setNodesSpy

    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'Some description',
          descriptionExpanded: true,
        }}
      />,
    )

    const chevron = screen.getByTestId('node-description-chevron')

    fireEvent.keyDown(chevron, { key: 'Enter' })
    fireEvent.keyDown(chevron, { key: ' ' })
    expect(setNodesSpy).toHaveBeenCalledTimes(2)

    // Other keys are ignored - count stays at 2.
    fireEvent.keyDown(chevron, { key: 'a' })
    fireEvent.keyDown(chevron, { key: 'Escape' })
    expect(setNodesSpy).toHaveBeenCalledTimes(2)
  })

  it('clicking the description chevron toggles descriptionExpanded only on the target node', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    // Seed the store with TWO nodes so handleToggleDescriptionExpanded exercises both
    // ternary branches (the matched-id branch AND the pass-through branch).
    // The callback reads from the STORE (not the data prop), so the store node's
    // descriptionExpanded flag is what gets toggled.
    mockWorkflowStore.nodes = [
      { id: 'n1', data: { elementType: 'http-client', description: 'desc', descriptionExpanded: true } as unknown as { elementType: string; description: string } },
      { id: 'n2', data: { elementType: 'log', description: 'other', descriptionExpanded: true } as unknown as { elementType: string; description: string } },
    ]
    mockWorkflowStore.setNodes = vi.fn()

    renderWithReactFlow(
      <WorkflowNode
        id="n1"
        data={{
          label: 'HTTP_Client',
          elementType: 'http-client',
          description: 'Long description that is expanded',
          descriptionExpanded: true, // forces the chevron to be visible without measuring scrollHeight
        }}
      />,
    )

    await user.click(screen.getByTestId('node-description-chevron'))

    expect(mockWorkflowStore.setNodes).toHaveBeenCalledTimes(1)
    const next = (mockWorkflowStore.setNodes as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(next).toHaveLength(2)
    // Target node: toggled
    expect(next[0].id).toBe('n1')
    expect(next[0].data.descriptionExpanded).toBe(false)
    // Other node: untouched (pass-through branch of the ternary)
    expect(next[1].id).toBe('n2')
    expect(next[1].data.descriptionExpanded).toBe(true)
  })
})
