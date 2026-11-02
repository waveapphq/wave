/**
 * WorkflowNode Wait Until lane rendering (REQ-3.5.4.3).
 *
 * Retry mode is a container: a cyan `retry` lane for the sub-flow that runs
 * each round, then the container-exit `then` lane. Watch mode has no sub-flow,
 * so the node falls back to the single default egress every sequential block
 * uses. Lanes carry role colors and accessible names, never rendered text.
 *
 * Design Reference:
 *   WAIT-3 (mode selection), WAIT-5 (no lane labels), WAIT-7 (width growth),
 *   lane colors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const WAIT_BASE = {
  label: 'Wait Until',
  elementType: 'wait-until',
  nodeType: 'control',
} as const

const NODE_WIDTH_FLOOR = 160

function waitData(mode?: string) {
  const values: Record<string, unknown> = {
    conditions: [{ id: 'c-1', type: 'expression', expression: 'ready' }],
    timeout: 30000,
  }
  if (mode !== undefined) values.mode = mode
  return { ...WAIT_BASE, config: { values } }
}

function laneTestIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid^="handle-output"]'),
  ).map((el) => el.getAttribute('data-testid') ?? '')
}

function seedStore() {
  vi.clearAllMocks()
  mockWorkflowStore.selectedNodeIds = []
  mockWorkflowStore.skippedNodeIds = []
  mockWorkflowStore.edges = [{ id: 'e-start-1', source: 'start-node', target: 'node-1' }]
}

describe('WorkflowNode Wait Until lanes in Retry mode', () => {
  beforeEach(seedStore)

  it('renders the retry lane then the container-exit lane', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode id="node-1" data={waitData('retry')} />,
    )

    expect(laneTestIds(container)).toEqual(['handle-output-retry', 'handle-output-then'])
  })

  it('treats an unconfigured wait as Retry', async () => {
    // A fresh drop waits with a retry lane, the shape that works today.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(<WorkflowNode id="node-1" data={waitData()} />)

    expect(laneTestIds(container)).toEqual(['handle-output-retry', 'handle-output-then'])
  })

  it('drops the single default output handle', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
  })

  it('binds each lane name as the React Flow handle id an edge wires to', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    expect(screen.getByTestId('handle-output-retry')).toHaveAttribute('data-handleid', 'retry')
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('data-handleid', 'then')
  })

  it('paints the retry lane the loop-body cyan', async () => {
    // Lane colors are role-based across the whole canvas: cyan means "a
    // sub-flow that runs repeatedly", exactly as a loop body does.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    const lane = screen.getByTestId('handle-output-retry')
    expect(lane.className).toContain('!bg-cyan-500')
    expect(lane.className).toContain('hover:!ring-cyan-300')
  })

  it('paints the then lane the container-exit neutral', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    const lane = screen.getByTestId('handle-output-then')
    expect(lane.className).toContain('!bg-zinc-600')
    expect(lane.className).toContain('hover:!ring-zinc-400')
  })

  it('names each lane for assistive technology without rendering text', async () => {
    // WAIT-5: the wireframe prints the lane names as annotation; the node
    // itself never does - every other multi-output control behaves this way.
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode id="node-1" data={waitData('retry')} />,
    )

    expect(screen.getByTestId('handle-output-retry')).toHaveAttribute('aria-label', 'retry')
    expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
    expect(container.textContent).not.toContain('retry')
  })

  it('names the lane through the shared tooltip, not the browser title', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    const lane = screen.getByTestId('handle-output-retry')
    expect(lane).not.toHaveAttribute('title')
    expect(lane).toHaveAttribute('data-state', 'closed')
  })

  it('reveals the lane name on hover', async () => {
    const user = userEvent.setup()
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('retry')} />)

    await user.hover(screen.getByTestId('handle-output-retry'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('retry')
  })

  it('widens the node to fit two lanes', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode id="node-1" data={waitData('retry')} width={NODE_WIDTH_FLOOR} />,
    )

    expect(screen.getByTestId('workflow-node-node-1')).toHaveStyle({ width: '160px' })
  })
})

describe('WorkflowNode Wait Until lanes in Watch mode', () => {
  beforeEach(seedStore)

  it('renders the single default egress', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('watch')} />)

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
  })

  it('renders no retry or then lane', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={waitData('watch')} />)

    expect(screen.queryByTestId('handle-output-retry')).not.toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-then')).not.toBeInTheDocument()
  })

  it('swaps the lanes for the default egress when the mode changes', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container, rerender } = renderWithReactFlow(
      <WorkflowNode id="node-1" data={waitData('retry')} />,
    )

    expect(laneTestIds(container)).toEqual(['handle-output-retry', 'handle-output-then'])

    rerender(
      <ReactFlowProvider>
        <WorkflowNode id="node-1" data={waitData('watch')} />
      </ReactFlowProvider>,
    )

    expect(laneTestIds(container)).toEqual(['handle-output'])
  })
})

describe('WorkflowNode Wait Until leaves other controls alone', () => {
  beforeEach(seedStore)

  it('does not give a Delay node lanes', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{
          label: 'Delay',
          elementType: 'delay',
          nodeType: 'control',
          config: { values: { duration: 500, mode: 'retry' } },
        }}
      />,
    )

    expect(screen.getByTestId('handle-output')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-output-retry')).not.toBeInTheDocument()
  })

  it('still gives a While node its body and then lanes', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { container } = renderWithReactFlow(
      <WorkflowNode
        id="node-1"
        data={{
          label: 'While Loop',
          elementType: 'while',
          nodeType: 'control',
          config: { values: { mode: 'watch', conditions: [] } },
        }}
      />,
    )

    expect(laneTestIds(container)).toEqual(['handle-output-body', 'handle-output-then'])
  })
})
