/**
 * Canvas (non-node) right-click context menu - debug entries.
 *
 * REQ-3.2.1.5: the canvas (empty area) right-click menu
 * gains three items appended to the existing canvas-context-menu:
 *
 *   - Clear Breakpoints (action item)
 *   - Pause on Error (toggle, mirrors ``debugOptions.pauseOnErrors``)
 *   - Pause on First Block (toggle, mirrors ``debugOptions.pauseOnFirstBlock``)
 *
 * Behavior under test:
 *
 *   1. The three items render alongside the existing canvas-menu items.
 *   2. Clear Breakpoints is disabled when ``breakpoints`` set is empty.
 *   3. Toggle items show check-state bound to ``debugOptions``.
 *   4. Toggle clicks invoke ``setDebugOptions`` with a partial update -
 *      flipping one flag does not reset the other.
 *   5. Clear Breakpoints click invokes ``clearBreakpoints``.
 *   6. When a debug session is live (status running/paused), Clear
 *      Breakpoints additionally PATCHes the live session's breakpoint set
 *      to empty via ``workbenchApi.updateWorkbenchBreakpoints``.
 *   7. When a debug session is live, toggle clicks additionally PATCH
 *      ``workbenchApi.updateDebugOptions`` (or equivalent) so the running
 *      engine picks up the change.
 *   8. A push that fails is reported, naming what the run actually does,
 *      because the canvas keeps the choice the user made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockWorkflowStore = {
  paste: vi.fn(),
  selectAll: vi.fn(),
  requestFitView: vi.fn(),
  unskipAll: vi.fn(),
  enableAll: vi.fn(),
  clearBreakpoints: vi.fn(),
  setDebugOptions: vi.fn(),
  clipboard: null as { nodes: unknown[]; edges: unknown[] } | null,
  skippedNodeIds: [] as string[],
  nodes: [] as Array<{ id: string; data: { disabled?: boolean } }>,
  breakpoints: new Set<string>(),
  debugOptions: { pauseOnFirstBlock: false, pauseOnErrors: false } as {
    pauseOnFirstBlock: boolean
    pauseOnErrors: boolean
  },
  selectNodesInRect: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (state: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

vi.mock('@/lib/platform', () => ({
  isMac: vi.fn(() => false),
  getModifierLabel: vi.fn(() => 'Ctrl'),
  getModifierKey: vi.fn(() => 'Control'),
  formatShortcut: vi.fn((key: string) => `Ctrl+${key}`),
}))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    updateWorkbenchBreakpoints: vi.fn().mockResolvedValue({}),
    updateDebugOptions: vi.fn().mockResolvedValue({}),
  },
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

import { workbenchApi } from '@/features/workbench/api/workbench'

describe('CanvasContextMenu - ad-hoc debug entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore.clipboard = null
    mockWorkflowStore.skippedNodeIds = []
    mockWorkflowStore.nodes = []
    mockWorkflowStore.breakpoints = new Set()
    mockWorkflowStore.debugOptions = {
      pauseOnFirstBlock: false,
      pauseOnErrors: false,
    }
  })

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders Clear Breakpoints item', async () => {
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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })
    })

    it('renders Pause on Error toggle item', async () => {
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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })
    })

    it('renders Pause on First Block toggle item', async () => {
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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
        ).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Clear Breakpoints
  // -------------------------------------------------------------------------

  describe('Clear Breakpoints', () => {
    it('is aria-disabled when breakpoints set is empty', async () => {
      mockWorkflowStore.breakpoints = new Set()

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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitem', { name: /clear breakpoints/i })
      expect(item).toHaveAttribute('aria-disabled', 'true')
    })

    it('is enabled when breakpoints set is non-empty', async () => {
      mockWorkflowStore.breakpoints = new Set(['node-a'])

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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitem', { name: /clear breakpoints/i })
      expect(item).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('calls clearBreakpoints when clicked with non-empty set', async () => {
      mockWorkflowStore.breakpoints = new Set(['node-a'])
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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /clear breakpoints/i }))

      expect(mockWorkflowStore.clearBreakpoints).toHaveBeenCalledTimes(1)
    })

    it('does not call clearBreakpoints when set is empty', async () => {
      mockWorkflowStore.breakpoints = new Set()
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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /clear breakpoints/i }))

      expect(mockWorkflowStore.clearBreakpoints).not.toHaveBeenCalled()
    })

    it('also PATCHes empty breakpoints to live session when sessionId provided', async () => {
      mockWorkflowStore.breakpoints = new Set(['node-a'])
      const user = userEvent.setup()

      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          sessionId="session-1"
        />
      )

      await waitFor(() => {
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /clear breakpoints/i }))

      await waitFor(() => {
        expect(workbenchApi.updateWorkbenchBreakpoints).toHaveBeenCalledWith('session-1', [])
      })
    })

    it('does not PATCH live session when no sessionId provided', async () => {
      mockWorkflowStore.breakpoints = new Set(['node-a'])
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
        expect(
          screen.getByRole('menuitem', { name: /clear breakpoints/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitem', { name: /clear breakpoints/i }))

      expect(workbenchApi.updateWorkbenchBreakpoints).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Pause on Error toggle
  // -------------------------------------------------------------------------

  describe('Pause on Error toggle', () => {
    it('shows checked state when debugOptions.pauseOnErrors is true', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: true,
      }

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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
      expect(item).toHaveAttribute('aria-checked', 'true')
    })

    it('shows unchecked state when debugOptions.pauseOnErrors is false', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
      }

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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
      expect(item).toHaveAttribute('aria-checked', 'false')
    })

    it('flipping the toggle calls setDebugOptions with the OTHER flag preserved', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: true,
        pauseOnErrors: false,
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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on error/i }))

      expect(mockWorkflowStore.setDebugOptions).toHaveBeenCalledWith({
        pauseOnFirstBlock: true,
        pauseOnErrors: true,
      })
    })
  })

  // -------------------------------------------------------------------------
  // Pause on First Block toggle
  // -------------------------------------------------------------------------

  describe('Pause on First Block toggle', () => {
    it('shows checked state when debugOptions.pauseOnFirstBlock is true', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: true,
        pauseOnErrors: false,
      }

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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
        ).toBeInTheDocument()
      })

      const item = screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
      expect(item).toHaveAttribute('aria-checked', 'true')
    })

    it('flipping the toggle calls setDebugOptions with pauseOnErrors preserved', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: true,
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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
        ).toBeInTheDocument()
      })

      await user.click(
        screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
      )

      expect(mockWorkflowStore.setDebugOptions).toHaveBeenCalledWith({
        pauseOnFirstBlock: true,
        pauseOnErrors: true,
      })
    })
  })

  // -------------------------------------------------------------------------
  // Live-session PATCH path for toggles
  // -------------------------------------------------------------------------

  describe('Live-session PATCH for toggles', () => {
    it('PATCHes debug options to live session when sessionId provided and toggle clicked', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
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
          sessionId="session-1"
        />
      )

      await waitFor(() => {
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on error/i }))

      await waitFor(() => {
        expect(workbenchApi.updateDebugOptions).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({ pause_on_errors: true })
        )
      })
    })

    it('PATCHes debug options on Pause on First Block toggle when sessionId provided', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
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
          sessionId="session-2"
        />
      )

      await waitFor(() => {
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
        ).toBeInTheDocument()
      })

      await user.click(
        screen.getByRole('menuitemcheckbox', { name: /pause on first block/i })
      )

      await waitFor(() => {
        expect(workbenchApi.updateDebugOptions).toHaveBeenCalledWith(
          'session-2',
          expect.objectContaining({ pause_on_first_block: true })
        )
      })
    })

    it('does not PATCH debug options when no sessionId provided', async () => {
      mockWorkflowStore.debugOptions = {
        pauseOnFirstBlock: false,
        pauseOnErrors: false,
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
        expect(
          screen.getByRole('menuitemcheckbox', { name: /pause on error/i })
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on error/i }))

      expect(workbenchApi.updateDebugOptions).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // A push that never reached the engine
  // -------------------------------------------------------------------------

  describe('Reporting a debug push that failed', () => {
    async function openMenu(sessionId: string) {
      const { CanvasContextMenu } = await import(
        '@/features/workbench/common/canvas/menus/canvas-context-menu'
      )
      render(
        <CanvasContextMenu
          open={true}
          position={{ x: 200, y: 300 }}
          onClose={vi.fn()}
          sessionId={sessionId}
        />
      )
    }

    it('says the run still stops at breakpoints the canvas no longer shows', async () => {
      mockWorkflowStore.breakpoints = new Set(['node-a'])
      vi.mocked(workbenchApi.updateWorkbenchBreakpoints).mockRejectedValueOnce(
        new Error('Session is gone')
      )
      const user = userEvent.setup()
      await openMenu('session-1')

      await user.click(screen.getByRole('menuitem', { name: /clear breakpoints/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          'The run still stops at the breakpoints you cleared: Session is gone',
          'Clear Breakpoints Failed'
        )
      })
      expect(mockWorkflowStore.clearBreakpoints).toHaveBeenCalledTimes(1)
    })

    it('says the run keeps the previous setting when Pause on Error does not reach the engine', async () => {
      mockWorkflowStore.debugOptions = { pauseOnFirstBlock: false, pauseOnErrors: false }
      vi.mocked(workbenchApi.updateDebugOptions).mockRejectedValueOnce(new Error('Bad Gateway'))
      const user = userEvent.setup()
      await openMenu('session-1')

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on error/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          'The run keeps the previous setting: Bad Gateway',
          'Pause on Error Not Applied'
        )
      })
    })

    it('says the run keeps the previous setting when Pause on First Block does not reach the engine', async () => {
      mockWorkflowStore.debugOptions = { pauseOnFirstBlock: false, pauseOnErrors: false }
      vi.mocked(workbenchApi.updateDebugOptions).mockRejectedValueOnce(new Error('Bad Gateway'))
      const user = userEvent.setup()
      await openMenu('session-2')

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on first block/i }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          'The run keeps the previous setting: Bad Gateway',
          'Pause on First Block Not Applied'
        )
      })
    })

    it('says nothing when the push lands', async () => {
      mockWorkflowStore.debugOptions = { pauseOnFirstBlock: false, pauseOnErrors: false }
      const user = userEvent.setup()
      await openMenu('session-1')

      await user.click(screen.getByRole('menuitemcheckbox', { name: /pause on error/i }))

      await waitFor(() => {
        expect(workbenchApi.updateDebugOptions).toHaveBeenCalled()
      })
      expect(mockToastError).not.toHaveBeenCalled()
    })
  })
})
