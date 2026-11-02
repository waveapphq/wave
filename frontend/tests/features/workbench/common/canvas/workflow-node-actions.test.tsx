/**
 * WorkflowNode Action Dispatch Tests - Element Context Menu Wiring
 *
 * Tests that handleContextMenuAction in WorkflowNode wires each kebab/context menu
 * action to the correct store method.
 *
 * Does NOT test: CSS classes, theme styling, layout dimensions.
 *
 * Design Reference:
 * - CANVAS-39: Kebab mirrors right-click context menu
 * - CANVAS-40: Kebab groups: Run, Debug, Edit, Disable, Delete
 * - CANVAS-143: "Toggle Breakpoint" in Debug actions
 * - CANVAS-145: "Skip" separate from "Disable"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

// Mock workflow store with all methods needed by context menu wiring
const mockWorkflowStore = {
  selectedNodeIds: ['node-1'] as string[],
  skippedNodeIds: [] as string[],
  nodeIssues: new Map() as Map<string, unknown[]>,
  pulseValidationNodeIds: new Set() as Set<string>,
  nodes: [
    {
      id: 'node-1',
      type: 'workflow-node',
      position: { x: 100, y: 100 },
      data: { label: 'HTTP Client', elementType: 'http-client', version: '2.18' },
    },
  ],
  edges: [] as Array<{ id: string; source: string; target: string }>,
  selectNode: vi.fn(),
  deselectAll: vi.fn(),
  openConfigModal: vi.fn(),
  openPublishDialog: vi.fn(),
  openMakeLocalDialog: vi.fn(),
  hasBreakpoint: vi.fn().mockReturnValue(false),
  // Batch operations (operate on selectedNodeIds)
  deleteSelected: vi.fn(),
  requestDeleteSelected: vi.fn(),
  duplicate: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  // Targeted operations (operate on specific nodeId)
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
  // Pass-through (clean-sheet semantics) - the guard itself is store-tested.
  requestDrill: vi.fn((run: () => void) => run()),
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

// Mock execution store - per-node subscription for execution status
let mockBlockExecutionStatus: string | undefined = undefined

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useBlockExecutionStatus: () => mockBlockExecutionStatus,
  useBlockResultSkipped: () => false,
}))

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
)

describe('WorkflowNode Action Dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlockExecutionStatus = undefined
    mockWorkflowStore.selectedNodeIds = ['node-1']
    mockWorkflowStore.hasBreakpoint.mockReturnValue(false)
  })

  /**
   * Helper: render a selected node with action row visible, open kebab menu,
   * click an item, and return the mock store for assertions.
   */
  async function clickKebabAction(menuItemName: RegExp) {
    const user = userEvent.setup()
    const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

    render(
      <Wrapper>
        <WorkflowNode
          id="node-1"
          data={{
            label: 'HTTP Client',
            elementType: 'http-client',
            version: '2.18',
          }}
          selected={true}
          dragging={false}
        />
      </Wrapper>
    )

    // Open kebab menu
    await user.click(screen.getByLabelText(/more options/i))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    // Click the target action
    await user.click(screen.getByRole('menuitem', { name: menuItemName }))
  }

  describe('Clipboard Actions (batch - operate on selection)', () => {
    it('dispatches delete: selects node then calls requestDeleteSelected (dirty-sheet gate)', async () => {
      await clickKebabAction(/delete/i)

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1')
      expect(mockWorkflowStore.requestDeleteSelected).toHaveBeenCalledTimes(1)
    })

    it('dispatches duplicate: selects node then calls duplicate', async () => {
      await clickKebabAction(/duplicate/i)

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1')
      expect(mockWorkflowStore.duplicate).toHaveBeenCalledTimes(1)
    })

    it('dispatches copy: selects node then calls copy', async () => {
      await clickKebabAction(/^copy$/i)

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1')
      expect(mockWorkflowStore.copy).toHaveBeenCalledTimes(1)
    })

    it('dispatches cut: selects node then calls cut', async () => {
      await clickKebabAction(/^cut$/i)

      expect(mockWorkflowStore.selectNode).toHaveBeenCalledWith('node-1')
      expect(mockWorkflowStore.cut).toHaveBeenCalledTimes(1)
    })
  })

  describe('Targeted Actions (operate on specific nodeId)', () => {
    it('dispatches toggle-breakpoint with node ID', async () => {
      await clickKebabAction(/toggle breakpoint/i)

      expect(mockWorkflowStore.toggleBreakpoint).toHaveBeenCalledWith('node-1')
    })

    it('dispatches disable with node ID', async () => {
      await clickKebabAction(/disable/i)

      expect(mockWorkflowStore.toggleDisable).toHaveBeenCalledWith('node-1')
    })

    it('dispatches skip with node ID', async () => {
      await clickKebabAction(/skip/i)

      expect(mockWorkflowStore.toggleSkip).toHaveBeenCalledWith('node-1')
    })

    it('dispatches unlink with node ID', async () => {
      await clickKebabAction(/unlink/i)

      expect(mockWorkflowStore.unlinkNode).toHaveBeenCalledWith('node-1')
    })

    it('dispatches open: calls pushDrill with node ID for a local Function', async () => {
      // Switch the fixture's store node so useNodeActions's active-subtree
      // lookup returns a local Function with the right lifecycle.
      mockWorkflowStore.nodes = [
        {
          id: 'node-1',
          type: 'workflow-node',
          position: { x: 100, y: 100 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            functionLifecycle: 'local',
            localDefinition: {
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
            },
            version: '1.0',
          } as unknown as (typeof mockWorkflowStore.nodes)[number]['data'],
        },
      ]
      const user = userEvent.setup()
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'Function_1',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'local',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>,
      )
      await user.click(screen.getByLabelText(/more options/i))
      await user.click(screen.getByRole('menuitem', { name: /^open$/i }))
      expect(mockWorkflowStore.pushDrill).toHaveBeenCalledWith('node-1')
    })
  })

  describe('Deferred Actions (no-op)', () => {
    it('does not call any store method for run-from-here', async () => {
      await clickKebabAction(/run from here/i)

      // No batch or targeted store methods should be called
      expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
      expect(mockWorkflowStore.duplicate).not.toHaveBeenCalled()
      expect(mockWorkflowStore.copy).not.toHaveBeenCalled()
      expect(mockWorkflowStore.cut).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleBreakpoint).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleDisable).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleSkip).not.toHaveBeenCalled()
      expect(mockWorkflowStore.unlinkNode).not.toHaveBeenCalled()
    })

    it('does not call any store method for run-current', async () => {
      await clickKebabAction(/run current/i)

      expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleBreakpoint).not.toHaveBeenCalled()
    })

    it('does not call any store method for debug-current', async () => {
      await clickKebabAction(/debug current/i)

      expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleBreakpoint).not.toHaveBeenCalled()
    })

    it('does not call any store method for debug-from-here', async () => {
      await clickKebabAction(/debug from here/i)

      expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
      expect(mockWorkflowStore.toggleBreakpoint).not.toHaveBeenCalled()
    })

  })

  describe('Function lifecycle actions', () => {
    /** Render a Function node (elementType='function') with selection so the
     *  kebab + extra actions are available. */
    async function clickFunctionKebabAction(
      menuItemName: RegExp,
      functionLifecycle: 'local' | 'shared',
    ) {
      const user = userEvent.setup()
      const { WorkflowNode } = await import(
        '@/features/workbench/common/canvas/workflow-node'
      )
      // Seed the active subtree with the function node so menu-groups computes correctly.
      mockWorkflowStore.nodes = [
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'Fn',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
      ]
      mockWorkflowStore.selectedNodeIds = ['fn-1']

      render(
        <Wrapper>
          <WorkflowNode
            id="fn-1"
            data={{
              label: 'Fn',
              elementType: 'function',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...({ nodeType: 'function', functionLifecycle } as any),
              version: '1.0.0',
            }}
            selected={true}
            dragging={false}
          />
        </Wrapper>,
      )
      await user.click(screen.getByLabelText(/more options/i))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('menuitem', { name: menuItemName }))
    }

    it("'Publish to Library' on a local Function calls openPublishDialog", async () => {
      await clickFunctionKebabAction(/publish to library/i, 'local')
      expect(mockWorkflowStore.openPublishDialog).toHaveBeenCalledWith('fn-1')
      expect(mockWorkflowStore.openMakeLocalDialog).not.toHaveBeenCalled()
    })

    it("'Make Local' on a shared Function calls openMakeLocalDialog", async () => {
      await clickFunctionKebabAction(/^make local/i, 'shared')
      expect(mockWorkflowStore.openMakeLocalDialog).toHaveBeenCalledWith('fn-1')
      expect(mockWorkflowStore.openPublishDialog).not.toHaveBeenCalled()
    })
  })

  describe('Right-Click Context Menu (CANVAS-39)', () => {
    it('shows context menu on right-click', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      fireEvent.contextMenu(node, { clientX: 150, clientY: 200 })

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('right-click context menu contains all expected items', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      fireEvent.contextMenu(node, { clientX: 150, clientY: 200 })

      await waitFor(() => {
        // Same items as kebab menu (CANVAS-39: kebab mirrors right-click)
        expect(screen.getByRole('menuitem', { name: /run from here/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /run current/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /debug from here/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /debug current/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /toggle breakpoint/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /^copy$/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /^cut$/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /unlink/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /disable/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /skip/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })
    })

    it('right-click in a read-only Function body the page can run offers only the run and debug items', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      const { CanvasReadOnlyProvider } = await import('@/features/workbench/common/canvas/read-only-context')
      const { AdHocActionsProvider } = await import('@/features/workbench/common/canvas/adhoc-actions-context')

      render(
        <Wrapper>
          <AdHocActionsProvider dispatch={vi.fn()}>
            <CanvasReadOnlyProvider value={true}>
              <WorkflowNode
                id="node-1"
                data={{ label: 'HTTP Client', elementType: 'http-client', version: '2.18' }}
                selected={false}
                dragging={false}
              />
            </CanvasReadOnlyProvider>
          </AdHocActionsProvider>
        </Wrapper>
      )

      fireEvent.contextMenu(screen.getByTestId('workflow-node-node-1'), { clientX: 150, clientY: 200 })

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /run current/i })).toBeInTheDocument()
      })
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Run Current',
        'Run from Here',
        'Debug Current',
        'Debug from Here',
        'Toggle Breakpoint',
      ])
      expect(screen.queryByLabelText(/more options/i)).not.toBeInTheDocument()
    })

    it('right-click on a read-only canvas that offers no runs opens no menu', async () => {
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')
      const { CanvasReadOnlyProvider } = await import('@/features/workbench/common/canvas/read-only-context')

      render(
        <Wrapper>
          <CanvasReadOnlyProvider value={true}>
            <WorkflowNode
              id="node-1"
              data={{ label: 'HTTP Client', elementType: 'http-client', version: '2.18' }}
              selected={false}
              dragging={false}
            />
          </CanvasReadOnlyProvider>
        </Wrapper>
      )

      fireEvent.contextMenu(screen.getByTestId('workflow-node-node-1'), { clientX: 150, clientY: 200 })

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('right-click context menu dispatches actions to store', async () => {
      const user = userEvent.setup()
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      fireEvent.contextMenu(node, { clientX: 150, clientY: 200 })

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click toggle-breakpoint via right-click menu
      await user.click(screen.getByRole('menuitem', { name: /toggle breakpoint/i }))

      expect(mockWorkflowStore.toggleBreakpoint).toHaveBeenCalledWith('node-1')
    })
  })

  describe('Execution Guards', () => {
    it('blocks destructive actions via context menu during execution', async () => {
      const user = userEvent.setup()
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
              isExecuting: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      fireEvent.contextMenu(node, { clientX: 150, clientY: 200 })

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click delete (a blocked action) - should be no-op
      await user.click(screen.getByRole('menuitem', { name: /delete/i }))

      expect(mockWorkflowStore.deleteSelected).not.toHaveBeenCalled()
    })

    it('blocks skip on the currently running node', async () => {
      mockBlockExecutionStatus = 'running'
      const user = userEvent.setup()
      const { WorkflowNode } = await import('@/features/workbench/common/canvas/workflow-node')

      render(
        <Wrapper>
          <WorkflowNode
            id="node-1"
            data={{
              label: 'HTTP Client',
              elementType: 'http-client',
              version: '2.18',
              isExecuting: true,
            }}
            selected={false}
            dragging={false}
          />
        </Wrapper>
      )

      const node = screen.getByTestId('workflow-node-node-1')
      fireEvent.contextMenu(node, { clientX: 150, clientY: 200 })

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click skip on the running node - should be no-op
      await user.click(screen.getByRole('menuitem', { name: /skip/i }))

      expect(mockWorkflowStore.toggleSkip).not.toHaveBeenCalled()
    })
  })
})
