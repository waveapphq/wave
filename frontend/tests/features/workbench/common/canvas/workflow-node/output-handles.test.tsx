/**
 * WorkflowNode Remote Execution Handle Rendering Tests (REQ-3.4.1.3).
 *
 * Remote Execution is a container node rendered like the For Loop: an input
 * handle, a cyan `body` handle whose sub-flow runs on the Execution Host, and a
 * zinc `then` handle for the continuation (REMEX-1). It reuses the
 * generic node + the scoped-handles logic in output-handles.tsx - no bespoke
 * node component - so the branch mirrors the For Loop's body/then handles.
 *
 * Rendered through the full WorkflowNode (as the Try/Catch handle tests do) so
 * the assertion holds regardless of how node.tsx drives the scoped-handles
 * branch (a boolean prop vs. an elementType check inside output-handles.tsx).
 *
 * Design Reference:
 *   REMEX-1 (For-Loop-style container), cyan body branch
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

const REMOTE_NODE_DATA = {
  label: 'Remote Execution',
  elementType: 'remote-execution',
  nodeType: 'control',
  config: { values: { session_id: 'sess-1' } },
} as const

describe('WorkflowNode Remote Execution Handle Rendering (REQ-3.4.1.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [{ id: 'e-start-1', source: 'start-node', target: 'node-1' }]
  })

  it('renders a cyan body handle and a zinc then handle', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ ...REMOTE_NODE_DATA }} />)

    expect(screen.getByTestId('handle-output-body')).toBeInTheDocument()
    expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
  })

  it('paints the body handle cyan (runs on the Execution Host)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ ...REMOTE_NODE_DATA }} />)

    expect(screen.getByTestId('handle-output-body').className).toContain('!bg-cyan-500')
  })

  it('paints the then handle zinc (the continuation)', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ ...REMOTE_NODE_DATA }} />)

    expect(screen.getByTestId('handle-output-then').className).toContain('!bg-zinc-600')
  })

  it('does not render the default single output handle', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ ...REMOTE_NODE_DATA }} />)

    expect(screen.queryByTestId('handle-output')).not.toBeInTheDocument()
  })

  it('still renders the input handle', async () => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    renderWithReactFlow(<WorkflowNode id="node-1" data={{ ...REMOTE_NODE_DATA }} />)

    expect(screen.getByTestId('handle-input')).toBeInTheDocument()
  })
})


// Auto-wiring (drop below, quick-add) picks lanes from getNodeOutputHandles; a lane it
// does not know lands with no lane, drawn on the first lane and run as the exit.
describe('WorkflowNode lanes match the lanes auto-wiring picks from', () => {
  type Values = Record<string, unknown>
  const CASES: Array<[string, string, 'plugin' | 'control', Values]> = [
    ['a plugin block', 'log', 'plugin', {}],
    ['Assert in split mode', 'assert', 'control', { mode: 'split' }],
    ['Assert in single mode', 'assert', 'control', { mode: 'single' }],
    ['If/Else with three branches', 'if-else', 'control', {
      branches: [
        { id: 'b-if', type: 'if' },
        { id: 'b-elif', type: 'else_if' },
        { id: 'b-else', type: 'else' },
      ],
    }],
    ['If/Else with no branches', 'if-else', 'control', { branches: [] }],
    ['Try/Catch with catch', 'try-catch-finally', 'control', { enable_catch: true, enable_finally: false }],
    ['Try/Catch with catch and finally', 'try-catch-finally', 'control', { enable_catch: true, enable_finally: true }],
    ['Try/Catch with finally only', 'try-catch-finally', 'control', { enable_catch: false, enable_finally: true }],
    ['For', 'for', 'control', {}],
    ['For Each', 'for-each', 'control', {}],
    ['While', 'while', 'control', {}],
    ['Remote Execution', 'remote-execution', 'control', { session_id: 'sess-1' }],
    ['Switch/Case', 'switch-case', 'control', {
      branches: [
        { id: 'case-1', type: 'case' },
        { id: 'case-default', type: 'default' },
      ],
    }],
    ['Parallel', 'parallel', 'control', { branches: [{ id: 'branch_1', name: 'a' }, { id: 'branch_2', name: 'b' }] }],
    ['Wait Until in Retry mode', 'wait-until', 'control', { mode: 'retry' }],
    ['Wait Until in Watch mode', 'wait-until', 'control', { mode: 'watch' }],
    ['Halt', 'halt', 'control', {}],
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [{ id: 'e-start-1', source: 'start-node', target: 'node-1' }]
  })

  it.each(CASES)('%s', async (_name, elementType, nodeType, values) => {
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
    const { getNodeOutputHandles } = await import(
      '@/features/workbench/common/canvas/workflow-canvas/node-builders'
    )
    const data = { label: elementType, elementType, nodeType, config: { values } }
    const { container } = renderWithReactFlow(<WorkflowNode id="node-1" data={data} />)

    const drawn = [...container.querySelectorAll('[data-testid^="handle-output"]')].map((handle) =>
      (handle.getAttribute('data-testid') ?? '').replace(/^handle-output-?/, ''),
    )
    const lanes = getNodeOutputHandles({ id: 'node-1', data })
    expect(drawn).toEqual(lanes ?? [''])
  })
})
