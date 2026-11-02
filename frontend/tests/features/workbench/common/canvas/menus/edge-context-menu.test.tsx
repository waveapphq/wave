/**
 * EdgeContextMenu Component Tests - Element Context Menu Wiring
 *
 * Tests for the positioned context menu shown on right-clicking an edge (connection).
 * Includes edge type selection (Bezier, Smoothstep, Step, Straight) and Delete.
 *
 * Does NOT test: CSS styling, exact positioning pixels, animation details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock workflow store
const mockWorkflowStore = {
  removeEdge: vi.fn(),
  updateEdgeType: vi.fn(),
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

// Mock platform detection - non-Mac by default (Ctrl shortcuts)
vi.mock('@/lib/platform', () => ({
  isMac: vi.fn(() => false),
  getModifierLabel: vi.fn(() => 'Ctrl'),
  getModifierKey: vi.fn(() => 'Control'),
  formatShortcut: vi.fn((key: string) => `Ctrl+${key}`),
}))

describe('EdgeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Visibility', () => {
    it('renders menu items when open is true', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })
    })

    it('does not render when open is false', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={false}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument()
    })

    it('shows 4 edge type items plus Delete (5 total menu items)', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })

      const items = screen.getAllByRole('menuitem')
      expect(items).toHaveLength(5)
    })

    it('renders all 4 edge type labels', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /bezier/i })).toBeInTheDocument()
      })
      expect(screen.getByRole('menuitem', { name: /smoothstep/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /straight/i })).toBeInTheDocument()
      // "Step" also matches "Smoothstep", so find by exact text
      const items = screen.getAllByRole('menuitem')
      const stepItem = items.find((item) => item.textContent?.trim() === 'Step')
      expect(stepItem).toBeDefined()
    })

    it('renders a separator between type items and Delete', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      const { container } = render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Separator is a div with h-px class (1px height divider)
      const separator = container.querySelector('.h-px.bg-border')
      expect(separator).toBeInTheDocument()
    })
  })

  describe('Active Type Indicator', () => {
    it('shows check icon on Bezier when edgeType is empty', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /bezier/i })).toBeInTheDocument()
      })

      // Bezier item should have the check icon (svg element)
      const bezierItem = screen.getByRole('menuitem', { name: /bezier/i })
      expect(bezierItem.querySelector('svg')).not.toBeNull()

      // Other items should not have check icon
      const smoothstepItem = screen.getByRole('menuitem', { name: /smoothstep/i })
      expect(smoothstepItem.querySelector('svg')).toBeNull()
    })

    it('shows check icon on Bezier when edgeType is "default"', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType="default"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /bezier/i })).toBeInTheDocument()
      })

      const bezierItem = screen.getByRole('menuitem', { name: /bezier/i })
      expect(bezierItem.querySelector('svg')).not.toBeNull()
    })

    it('shows check icon on Smoothstep when edgeType is "smoothstep"', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType="smoothstep"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /smoothstep/i })).toBeInTheDocument()
      })

      const smoothstepItem = screen.getByRole('menuitem', { name: /smoothstep/i })
      expect(smoothstepItem.querySelector('svg')).not.toBeNull()

      // Bezier should NOT have check
      const bezierItem = screen.getByRole('menuitem', { name: /bezier/i })
      expect(bezierItem.querySelector('svg')).toBeNull()
    })

    it('shows check icon on Step when edgeType is "step"', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType="step"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Step item (exact match) - get all items and find the one with text "Step" only
      const items = screen.getAllByRole('menuitem')
      const stepItem = items.find((item) => item.textContent?.trim() === 'Step')
      expect(stepItem).toBeDefined()
      expect(stepItem!.querySelector('svg')).not.toBeNull()

      // Smoothstep should NOT have check icon
      const smoothstepItem = screen.getByRole('menuitem', { name: /smoothstep/i })
      expect(smoothstepItem.querySelector('svg')).toBeNull()
    })

    it('shows check icon on Straight when edgeType is "straight"', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType="straight"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /straight/i })).toBeInTheDocument()
      })

      const straightItem = screen.getByRole('menuitem', { name: /straight/i })
      expect(straightItem.querySelector('svg')).not.toBeNull()
    })
  })

  describe('Actions', () => {
    it('calls removeEdge with the correct edge ID when Delete clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-42"
          edgeType=""
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /delete/i }))

      expect(mockWorkflowStore.removeEdge).toHaveBeenCalledWith('edge-42')
    })

    it('calls updateEdgeType when a type item is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-7"
          edgeType=""
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /smoothstep/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /smoothstep/i }))

      expect(mockWorkflowStore.updateEdgeType).toHaveBeenCalledWith('edge-7', 'smoothstep')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls updateEdgeType with "straight" when Straight clicked', async () => {
      const user = userEvent.setup()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-9"
          edgeType="default"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /straight/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /straight/i }))

      expect(mockWorkflowStore.updateEdgeType).toHaveBeenCalledWith('edge-9', 'straight')
    })

    it('calls updateEdgeType with "default" when Bezier clicked', async () => {
      const user = userEvent.setup()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-10"
          edgeType="step"
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /bezier/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /bezier/i }))

      expect(mockWorkflowStore.updateEdgeType).toHaveBeenCalledWith('edge-10', 'default')
    })
  })

  describe('Close Behavior', () => {
    it('calls onClose when clicking outside the menu', async () => {
      const onClose = vi.fn()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click outside the menu
      fireEvent.mouseDown(document.body)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when clicking inside the menu', async () => {
      const onClose = vi.fn()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click inside the menu
      fireEvent.mouseDown(screen.getByRole('menu'))

      expect(onClose).not.toHaveBeenCalled()
    })

    it('calls onClose after Delete is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /delete/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // Shortcut Labels on Context Menu Items (REQ-4.2.5)
  // ===========================================================================
  describe('Shortcut Labels', () => {
    it('displays Del shortcut label on Delete item', async () => {
      const { EdgeContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/edge-context-menu'
      )
      render(
        <EdgeContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          edgeId="edge-1"
          edgeType=""
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
      })

      const deleteItem = screen.getByRole('menuitem', { name: /delete/i })
      expect(deleteItem.textContent).toContain('Del')
    })
  })
})
