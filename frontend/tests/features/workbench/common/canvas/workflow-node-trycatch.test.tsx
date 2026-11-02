/**
 * WorkflowNode Try/Catch Handle Rendering Tests
 *
 * Tests the try/catch/finally control's scoped path handles:
 * - try (blue) + then (gray) always present
 * - catch (red) when enable_catch is true (default)
 * - finally (amber) when enable_finally is true
 *
 * Design Reference:
 * - REQ-3.2.2.6: Try-catch error handling per block
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

describe('WorkflowNode Try/Catch Handle Rendering (REQ-3.2.2.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.selectedNodeIds = []
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.edges = [
      { id: 'e-start-1', source: 'start-node', target: 'node-1' },
    ]
  })

  describe('Default handles (catch on, finally off) - 3 handles', () => {
    it('renders try, catch, and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-try')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-catch')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-finally')).not.toBeInTheDocument()
    })

    it('does not render the default single output handle', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
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
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      expect(screen.getByTestId('handle-input')).toBeInTheDocument()
    })

    it('try handle has blue background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      const tryHandle = screen.getByTestId('handle-output-try')
      expect(tryHandle.className).toContain('!bg-blue-500')
    })

    it('catch handle has red background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      const catchHandle = screen.getByTestId('handle-output-catch')
      expect(catchHandle.className).toContain('!bg-red-500')
    })

    it('then handle has gray background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      const thenHandle = screen.getByTestId('handle-output-then')
      expect(thenHandle.className).toContain('!bg-zinc-600')
    })
  })

  describe('All enabled (catch on, finally on) - 4 handles', () => {
    it('renders try, catch, finally, and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: { enable_catch: true, enable_finally: true } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-try')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-catch')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-finally')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
    })

    it('finally handle has amber background', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: { enable_catch: true, enable_finally: true } },
          }}
        />
      )

      const finallyHandle = screen.getByTestId('handle-output-finally')
      expect(finallyHandle.className).toContain('!bg-amber-500')
    })
  })

  describe('Catch off, finally off - 2 handles', () => {
    it('renders only try and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: { enable_catch: false, enable_finally: false } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-try')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-catch')).not.toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-finally')).not.toBeInTheDocument()
    })
  })

  describe('Catch off, finally on - 3 handles', () => {
    it('renders try, finally, and then handles', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: { enable_catch: false, enable_finally: true } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-try')).toBeInTheDocument()
      expect(screen.queryByTestId('handle-output-catch')).not.toBeInTheDocument()
      expect(screen.getByTestId('handle-output-finally')).toBeInTheDocument()
      expect(screen.getByTestId('handle-output-then')).toBeInTheDocument()
    })
  })

  describe('Handle positioning and dynamic classes', () => {
    it('applies left position style when multiple handles present', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      // Default config has try + catch + then = 3 handles, all should have left positioning
      const tryHandle = screen.getByTestId('handle-output-try')
      expect(tryHandle.style.left).toBe('48px')

      const catchHandle = screen.getByTestId('handle-output-catch')
      expect(catchHandle.style.left).toBe('112px')

      const thenHandle = screen.getByTestId('handle-output-then')
      expect(thenHandle.style.left).toBe('176px')
    })

    it('no longer applies a bottom offset (action row is inside the card, handles anchor to outer bottom)', async () => {
      mockWorkflowStore.selectedNodeIds = ['node-1']

      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          selected={true}
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
          }}
        />
      )

      const tryHandle = screen.getByTestId('handle-output-try')
      expect(tryHandle.className).not.toContain('!bottom-[-36px]')
    })

    it('applies proximity source ring when proximitySource is true', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: {} },
            proximitySource: true,
          }}
        />
      )

      const tryHandle = screen.getByTestId('handle-output-try')
      expect(tryHandle.className).toContain('!ring-2')
      expect(tryHandle.className).toContain('!ring-green-400')
      expect(tryHandle.className).toContain('animate-pulse')
    })
  })

  describe('Handle names', () => {
    it('each handle carries its role as an accessible name', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      renderWithReactFlow(
        <WorkflowNode
          id="node-1"
          data={{
            label: 'Try / Catch',
            elementType: 'try-catch-finally',
            nodeType: 'control',
            config: { values: { enable_catch: true, enable_finally: true } },
          }}
        />
      )

      expect(screen.getByTestId('handle-output-try')).toHaveAttribute('aria-label', 'try')
      expect(screen.getByTestId('handle-output-catch')).toHaveAttribute('aria-label', 'catch')
      expect(screen.getByTestId('handle-output-finally')).toHaveAttribute('aria-label', 'finally')
      expect(screen.getByTestId('handle-output-then')).toHaveAttribute('aria-label', 'then')
    })
  })
})
