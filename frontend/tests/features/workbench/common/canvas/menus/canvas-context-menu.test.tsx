/**
 * CanvasContextMenu Component Tests - Element Context Menu Wiring
 *
 * Tests for the positioned context menu shown on right-clicking the canvas pane.
 * Items: Paste, Select All, Fit View.
 *
 * Does NOT test: CSS styling, exact positioning pixels, animation details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock workflow store
const mockWorkflowStore = {
  paste: vi.fn(),
  selectAll: vi.fn(),
  requestFitView: vi.fn(),
  unskipAll: vi.fn(),
  enableAll: vi.fn(),
  clipboard: null as { nodes: unknown[]; edges: unknown[] } | null,
  skippedNodeIds: [] as string[],
  nodes: [] as Array<{ id: string; data: { disabled?: boolean } }>,
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

// Mock platform detection - non-Mac by default (Ctrl shortcuts)
vi.mock('@/lib/platform', () => ({
  isMac: vi.fn(() => false),
  getModifierLabel: vi.fn(() => 'Ctrl'),
  getModifierKey: vi.fn(() => 'Control'),
  formatShortcut: vi.fn((key: string) => `Ctrl+${key}`),
}))

describe('CanvasContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.clipboard = null
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.nodes = []
  })

  describe('Visibility', () => {
    it('renders menu items when open is true', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /select all/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /fit view/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /unskip all/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /enable all/i })).toBeInTheDocument()
      })
    })

    it('does not render when open is false', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={false}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('menuitem', { name: /paste/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /select all/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /fit view/i })).not.toBeInTheDocument()
    })
  })

  describe('Actions', () => {
    it('calls paste with position offset when Paste clicked', async () => {
      mockWorkflowStore.clipboard = { nodes: [{ id: 'n1' }], edges: [] }
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /paste/i }))

      expect(mockWorkflowStore.paste).toHaveBeenCalledTimes(1)
    })

    it('calls selectAll when Select All clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /select all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /select all/i }))

      expect(mockWorkflowStore.selectAll).toHaveBeenCalledTimes(1)
    })

    it('calls requestFitView when Fit View clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /fit view/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /fit view/i }))

      expect(mockWorkflowStore.requestFitView).toHaveBeenCalledTimes(1)
    })
  })

  describe('Close Behavior', () => {
    it('calls onClose when clicking outside the menu', async () => {
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })

      // Click outside the menu (on document body)
      fireEvent.mouseDown(document.body)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when clicking inside the menu', async () => {
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
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

    it('calls onClose after clicking an action', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /select all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /select all/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Paste State', () => {
    it('does not call paste when clipboard is empty and Paste is clicked', async () => {
      mockWorkflowStore.clipboard = null
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /paste/i }))

      expect(mockWorkflowStore.paste).not.toHaveBeenCalled()
    })

    it('calls paste when clipboard has content and Paste is clicked', async () => {
      mockWorkflowStore.clipboard = {
        nodes: [{ id: 'n1' }],
        edges: [],
      }
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /paste/i }))

      expect(mockWorkflowStore.paste).toHaveBeenCalledTimes(1)
    })

    it('shows paste as aria-disabled when clipboard is empty', async () => {
      mockWorkflowStore.clipboard = null

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      const pasteItem = screen.getByRole('menuitem', { name: /paste/i })
      expect(pasteItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows paste as not aria-disabled when clipboard has content', async () => {
      mockWorkflowStore.clipboard = { nodes: [{ id: 'n1' }], edges: [] }

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      const pasteItem = screen.getByRole('menuitem', { name: /paste/i })
      expect(pasteItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('calls paste with offset centering nodes at flowPosition', async () => {
      // Clipboard nodes at (100, 200) and (300, 200) - center is (200, 200)
      mockWorkflowStore.clipboard = {
        nodes: [
          { id: 'n1', position: { x: 100, y: 200 } },
          { id: 'n2', position: { x: 300, y: 200 } },
        ],
        edges: [],
      }
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          flowPosition={{ x: 500, y: 400 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /paste/i }))

      // offset = flowPosition - clipboardCenter = (500-200, 400-200) = (300, 200)
      expect(mockWorkflowStore.paste).toHaveBeenCalledWith({ x: 300, y: 200 })
    })
  })

  describe('Unskip All', () => {
    it('calls unskipAll when clicked and nodes are skipped', async () => {
      mockWorkflowStore.skippedNodeIds = ['n1']
      mockWorkflowStore.nodes = [
        { id: 'n1', data: {} },
        { id: 'n2', data: {} },
      ]
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /unskip all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /unskip all/i }))

      expect(mockWorkflowStore.unskipAll).toHaveBeenCalledTimes(1)
    })

    it('shows Unskip All as aria-disabled when no nodes are skipped', async () => {
      mockWorkflowStore.skippedNodeIds = []
      mockWorkflowStore.nodes = [
        { id: 'n1', data: {} },
        { id: 'n2', data: {} },
      ]

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /unskip all/i })).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitem', { name: /unskip all/i })
      expect(item).toHaveAttribute('aria-disabled', 'true')
    })

    it('does not call unskipAll when no nodes are skipped', async () => {
      mockWorkflowStore.skippedNodeIds = []
      mockWorkflowStore.nodes = [{ id: 'n1', data: {} }]
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /unskip all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /unskip all/i }))

      expect(mockWorkflowStore.unskipAll).not.toHaveBeenCalled()
    })
  })

  describe('Enable All', () => {
    it('calls enableAll when clicked and nodes have disabled=true', async () => {
      mockWorkflowStore.nodes = [
        { id: 'n1', data: { disabled: true } },
        { id: 'n2', data: {} },
      ]
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /enable all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /enable all/i }))

      expect(mockWorkflowStore.enableAll).toHaveBeenCalledTimes(1)
    })

    it('shows Enable All as aria-disabled when no nodes are disabled', async () => {
      mockWorkflowStore.nodes = [
        { id: 'n1', data: {} },
        { id: 'n2', data: { disabled: false } },
      ]

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /enable all/i })).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitem', { name: /enable all/i })
      expect(item).toHaveAttribute('aria-disabled', 'true')
    })

    it('does not call enableAll when no nodes are disabled', async () => {
      mockWorkflowStore.nodes = [{ id: 'n1', data: {} }]
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /enable all/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /enable all/i }))

      expect(mockWorkflowStore.enableAll).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Canvas Context Menu Reset (REQ-3.1.1.2)
  // ===========================================================================
  describe('Reset', () => {
    it('renders Reset menu item when menu is open', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="passed"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })
    })

    it('shows Reset as aria-disabled when executionStatus is idle', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="idle"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows Reset as aria-disabled when executionStatus is running', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="running"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows Reset as aria-disabled when executionStatus is paused', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="paused"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows Reset as enabled when executionStatus is passed', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="passed"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('shows Reset as enabled when executionStatus is failed', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="failed"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('shows Reset as enabled when executionStatus is stopped', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="stopped"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('calls onReset when Reset clicked and enabled', async () => {
      const user = userEvent.setup()
      const onReset = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="passed"
          onReset={onReset}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /reset/i }))

      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('does not call onReset when Reset clicked and disabled', async () => {
      const user = userEvent.setup()
      const onReset = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="idle"
          onReset={onReset}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /reset/i }))

      expect(onReset).not.toHaveBeenCalled()
    })

    it('calls onClose after clicking enabled Reset', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={onClose}
          executionStatus="passed"
          onReset={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /reset/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows Reset as aria-disabled when executionStatus is undefined', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /reset/i })).toBeInTheDocument()
      })

      const resetItem = screen.getByRole('menuitem', { name: /reset/i })
      expect(resetItem).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Execution Guards', () => {
    it('does not call paste when executing even with clipboard content', async () => {
      mockWorkflowStore.clipboard = { nodes: [{ id: 'n1', position: { x: 0, y: 0 } }], edges: [] }

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          executionStatus="running"
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      // Use fireEvent to bypass pointer-events-none CSS (jsdom doesn't enforce it)
      fireEvent.click(screen.getByRole('menuitem', { name: /paste/i }))

      expect(mockWorkflowStore.paste).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Shortcut Labels on Context Menu Items (REQ-4.2.5)
  // ===========================================================================
  describe('Shortcut Labels', () => {
    it('displays Ctrl+V shortcut label on Paste item', async () => {
      mockWorkflowStore.clipboard = { nodes: [{ id: 'n1' }], edges: [] }

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /paste/i })).toBeInTheDocument()
      })

      const pasteItem = screen.getByRole('menuitem', { name: /paste/i })
      expect(pasteItem.textContent).toContain('Ctrl+V')
    })

    it('displays Ctrl+A shortcut label on Select All item', async () => {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /select all/i })).toBeInTheDocument()
      })

      const selectAllItem = screen.getByRole('menuitem', { name: /select all/i })
      expect(selectAllItem.textContent).toContain('Ctrl+A')
    })
  })
})
