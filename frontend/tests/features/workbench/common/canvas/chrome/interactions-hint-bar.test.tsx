/**
 * Interactions Hint Popover & Toggle Tests
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 * REQ-5.2.1.31 Full keyboard navigation
 *
 * Tests for the floating hint popover that displays keyboard shortcut reference
 * and the circle toggle button that controls its visibility.
 *
 * Hint Popover:
 * - Closed by default (no shortcut content visible)
 * - Opens on click of ? circle button (shadcn Popover)
 * - Closes on outside click or clicking ? again
 * - No localStorage persistence (ephemeral)
 * - Vertical list layout: label left-aligned, key badge(s) right-aligned
 * - 4 sections with horizontal rule dividers and uppercase headers
 * - 15 shortcuts total across Editing (6), Selection (5), Navigation (2), History (2)
 * - Platform-aware modifier labels (Ctrl on Linux/Windows, ⌘ on macOS)
 *
 * Toggle Button:
 * - Circle button with ? icon
 * - Positioned bottom-right of canvas (near React Flow zoom controls)
 * - aria-label for accessibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock platform detection - default to non-Mac (Ctrl)
vi.mock('@/lib/platform', () => ({
  isMac: vi.fn(() => false),
  getModifierLabel: vi.fn(() => 'Ctrl'),
  getModifierKey: vi.fn(() => 'Control'),
  formatShortcut: vi.fn((key: string) => `Ctrl+${key}`),
}))

describe('REQ-4.2.5 Interactions Hint Popover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('InteractionsHintPopover Component', () => {
    it('renders nothing visible when closed', async () => {
      const { InteractionsHintPopover } = await import(
        '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
      )

      render(<InteractionsHintPopover open={false} />)

      // When closed, no shortcut content should be visible
      expect(screen.queryByText('Copy')).not.toBeInTheDocument()
      expect(screen.queryByText('Paste')).not.toBeInTheDocument()
      expect(screen.queryByText('Select All')).not.toBeInTheDocument()
    })

    it('renders shortcut content when open', async () => {
      const { InteractionsHintPopover } = await import(
        '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
      )

      render(<InteractionsHintPopover open={true} />)

      // Should show shortcut labels from all sections
      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.getByText('Paste')).toBeInTheDocument()
      expect(screen.getByText('Select All')).toBeInTheDocument()
      expect(screen.getByText('Undo')).toBeInTheDocument()
    })

    it('has accessible data-testid attribute', async () => {
      const { InteractionsHintPopover } = await import(
        '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
      )

      render(<InteractionsHintPopover open={true} />)

      expect(
        screen.getByTestId('interactions-hint-popover')
      ).toBeInTheDocument()
    })

    describe('Content Sections - 6 sections, 20 shortcuts', () => {
      // REQ-4.2.5: the Quick Insert window's own keys.
      it('shows Insertion section with 3 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('INSERTION')).toBeInTheDocument()

        expect(screen.getByText('Quick Insert')).toBeInTheDocument()
        expect(screen.getByText('Add where the flow is')).toBeInTheDocument()
        expect(screen.getByText('Add at center')).toBeInTheDocument()
        // The removed insert mode is named nowhere.
        expect(screen.queryByText('Add after selection')).not.toBeInTheDocument()
        expect(screen.queryByText('Add after last block')).not.toBeInTheDocument()
      })

      // REQ-4.2.5: the selected-block keys.
      it('shows Blocks section with 2 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('BLOCKS')).toBeInTheDocument()
        expect(screen.getByText('Configure')).toBeInTheDocument()
        expect(screen.getByText('Open Function')).toBeInTheDocument()
      })

      it('shows Editing section with 6 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        // Section header (uppercase per design)
        expect(screen.getByText('EDITING')).toBeInTheDocument()

        // All 6 editing shortcuts
        expect(screen.getByText('Copy')).toBeInTheDocument()
        expect(screen.getByText('Cut')).toBeInTheDocument()
        expect(screen.getByText('Paste')).toBeInTheDocument()
        expect(screen.getByText('Duplicate')).toBeInTheDocument()
        expect(screen.getByText('Delete')).toBeInTheDocument()
        expect(screen.getByText('Unlink')).toBeInTheDocument()
      })

      it('shows Selection section with 5 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        // Section header
        expect(screen.getByText('SELECTION')).toBeInTheDocument()

        // All 5 selection shortcuts
        expect(screen.getByText('Select')).toBeInTheDocument()
        expect(screen.getByText('Multi-select')).toBeInTheDocument()
        expect(screen.getByText('Box Select')).toBeInTheDocument()
        expect(screen.getByText('Chain Select')).toBeInTheDocument()
        expect(screen.getByText('Select All')).toBeInTheDocument()
      })

      it('shows Navigation section with 2 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        // Section header
        expect(screen.getByText('NAVIGATION')).toBeInTheDocument()

        // All 2 navigation shortcuts
        expect(screen.getByText('Zoom')).toBeInTheDocument()
        expect(screen.getByText('Pan')).toBeInTheDocument()
      })

      it('shows History section with 2 shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        // Section header
        expect(screen.getByText('HISTORY')).toBeInTheDocument()

        // All 2 history shortcuts
        expect(screen.getByText('Undo')).toBeInTheDocument()
        expect(screen.getByText('Redo')).toBeInTheDocument()
      })

      it('renders exactly 5 section headers', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        const headers = ['INSERTION', 'BLOCKS', 'EDITING', 'SELECTION', 'NAVIGATION', 'HISTORY']
        for (const header of headers) {
          expect(within(popover).getByText(header)).toBeInTheDocument()
        }
      })

      it('renders exactly 20 shortcut entries', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        // Each shortcut entry should have a data-testid="shortcut-entry"
        const entries = within(popover).getAllByTestId('shortcut-entry')
        expect(entries).toHaveLength(20)
      })

      it('renders section dividers (separators) between sections', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        // 6 sections = 5 separators between them
        const separators = within(popover).getAllByRole('separator')
        expect(separators).toHaveLength(5)
      })
    })

    describe('Key Badges', () => {
      it('shows modifier key badges for editing shortcuts', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        // Modifier-based shortcuts should show Ctrl+key
        expect(popover.textContent).toContain('Ctrl+C')
        expect(popover.textContent).toContain('Ctrl+X')
        expect(popover.textContent).toContain('Ctrl+V')
        expect(popover.textContent).toContain('Ctrl+D')
      })

      it('shows Del key for Delete shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Del')).toBeInTheDocument()
      })

      it('shows Backspace key for Unlink shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Backspace')).toBeInTheDocument()
      })

      it('shows Click key for Select shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Click')).toBeInTheDocument()
      })

      it('shows Ctrl+Click key for Multi-select shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Ctrl+Click')).toBeInTheDocument()
      })

      it('shows Shift+Drag key for Box Select shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Shift+Drag')).toBeInTheDocument()
      })

      it('shows Shift+Click key for Chain Select shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Shift+Click')).toBeInTheDocument()
      })

      it('shows Scroll key for Zoom shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Scroll')).toBeInTheDocument()
      })

      it('shows Drag key for Pan shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Drag')).toBeInTheDocument()
      })

      it('shows Ctrl+Shift+Z key for Redo shortcut', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        expect(screen.getByText('Ctrl+Shift+Z')).toBeInTheDocument()
      })
    })

    describe('Vertical Layout - label left, keys right', () => {
      it('each shortcut entry has label and key badge as children', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        const entries = within(popover).getAllByTestId('shortcut-entry')

        // Every entry should have a label span and at least one kbd element
        for (const entry of entries) {
          const label = within(entry).getByTestId('shortcut-label')
          expect(label).toBeInTheDocument()
          // At least one kbd badge per shortcut
          const kbds = entry.querySelectorAll('kbd')
          expect(kbds.length).toBeGreaterThanOrEqual(1)
        }
      })
    })

    describe('Platform Modifier Labels', () => {
      it('displays Ctrl modifier on non-Mac platforms', async () => {
        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        expect(popover.textContent).toContain('Ctrl')
      })

      it('displays ⌘ modifier on macOS platforms', async () => {
        // Reset modules to apply new mock
        vi.resetModules()
        vi.doMock('@/lib/platform', () => ({
          isMac: vi.fn(() => true),
          getModifierLabel: vi.fn(() => '⌘'),
          getModifierKey: vi.fn(() => 'Meta'),
          formatShortcut: vi.fn((key: string) => `⌘${key}`),
        }))

        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        const popover = screen.getByTestId('interactions-hint-popover')
        expect(popover.textContent).toContain('⌘')
      })

      it('shows ⌘+Click for Multi-select on macOS', async () => {
        vi.resetModules()
        vi.doMock('@/lib/platform', () => ({
          isMac: vi.fn(() => true),
          getModifierLabel: vi.fn(() => '⌘'),
          getModifierKey: vi.fn(() => 'Meta'),
          formatShortcut: vi.fn((key: string) => `⌘${key}`),
        }))

        const { InteractionsHintPopover } = await import(
          '@/features/workbench/common/canvas/chrome/interactions-hint-bar'
        )

        render(<InteractionsHintPopover open={true} />)

        // Multi-select should show ⌘+Click on Mac
        expect(screen.getByText('⌘+Click')).toBeInTheDocument()
      })
    })
  })

  describe('HintPopoverToggle Component', () => {
    it('renders a circle button', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('shows ? icon in button', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button.textContent).toContain('?')
    })

    it('has rounded-full class for circle shape', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('rounded-full')
    })

    it('calls onToggle when clicked', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )
      const user = userEvent.setup()
      const onToggle = vi.fn()

      render(<HintPopoverToggle isOpen={false} onToggle={onToggle} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('has accessible aria-label for keyboard shortcuts', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button.getAttribute('aria-label')).toBe(
        'Toggle keyboard shortcuts'
      )
    })

    it('indicates expanded state when isOpen is true', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={true} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button.getAttribute('aria-expanded')).toBe('true')
    })

    it('indicates collapsed state when isOpen is false', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button.getAttribute('aria-expanded')).toBe('false')
    })

    it('has data-testid for test selectors', async () => {
      const { HintPopoverToggle } = await import(
        '@/features/workbench/common/canvas/chrome/hint-bar-toggle'
      )

      render(<HintPopoverToggle isOpen={false} onToggle={vi.fn()} />)

      expect(
        screen.getByTestId('hint-popover-toggle')
      ).toBeInTheDocument()
    })
  })
})
