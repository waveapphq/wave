/**
 * CollapsiblePanel Tests
 *
 * Tests for the collapsible side panel component used in canvas area.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsiblePanel } from '@/features/workbench/common/canvas/chrome/collapsible-panel'
import { Box } from 'lucide-react'

describe('CollapsiblePanel', () => {
  const defaultProps = {
    testId: 'test-panel',
    title: 'Test Panel',
    icon: <Box className="h-4 w-4" />,
    orientation: 'vertical' as const,
    position: 'left' as const,
  }

  describe('Basic rendering', () => {
    it('renders collapsed by default', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })

    it('renders expanded when defaultCollapsed is false', () => {
      render(<CollapsiblePanel {...defaultProps} defaultCollapsed={false} />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })

    it('renders toggle button with correct aria attributes', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      const button = screen.getByRole('button', { name: /expand test panel/i })
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('Toggle behavior', () => {
    it('toggles from collapsed to expanded on click', async () => {
      const user = userEvent.setup()
      render(<CollapsiblePanel {...defaultProps} />)

      const button = screen.getByRole('button', { name: /expand test panel/i })
      await user.click(button)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })

    it('toggles from expanded to collapsed on click', async () => {
      const user = userEvent.setup()
      render(<CollapsiblePanel {...defaultProps} defaultCollapsed={false} />)

      const button = screen.getByRole('button', { name: /collapse test panel/i })
      await user.click(button)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })

    it('calls onCollapsedChange when toggled', async () => {
      const user = userEvent.setup()
      const onCollapsedChange = vi.fn()
      render(
        <CollapsiblePanel {...defaultProps} onCollapsedChange={onCollapsedChange} />
      )

      const button = screen.getByRole('button', { name: /expand test panel/i })
      await user.click(button)

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
    })

    it('toggles without onCollapsedChange callback', async () => {
      const user = userEvent.setup()
      // Line 68-70: toggleCollapsed works even without onCollapsedChange
      render(<CollapsiblePanel {...defaultProps} />)

      const button = screen.getByRole('button', { name: /expand test panel/i })
      await user.click(button)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })
  })

  describe('Controlled state', () => {
    it('uses controlled collapsed state when provided', () => {
      render(<CollapsiblePanel {...defaultProps} collapsed={false} />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })

    it('controlled state overrides internal state', async () => {
      const user = userEvent.setup()
      render(<CollapsiblePanel {...defaultProps} collapsed={true} />)

      const button = screen.getByRole('button', { name: /expand test panel/i })
      await user.click(button)

      // Panel should still be collapsed due to controlled state
      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })
  })

  describe('Vertical panel (left position)', () => {
    it('shows chevron right when collapsed', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      expect(screen.getByRole('button')).toContainHTML('lucide-chevron-right')
    })

    it('shows chevron left when expanded', () => {
      render(<CollapsiblePanel {...defaultProps} defaultCollapsed={false} />)

      expect(screen.getByRole('button')).toContainHTML('lucide-chevron-left')
    })

    it('shows title in header when expanded (line 128)', () => {
      render(<CollapsiblePanel {...defaultProps} defaultCollapsed={false} />)

      // Title should be visible in header when vertical + expanded
      expect(screen.getByText('Test Panel')).toBeInTheDocument()
    })

    it('shows stacked letters when collapsed', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      // Should show individual letters - just check first letter to avoid multiple matches
      expect(screen.getByText('T')).toBeInTheDocument()
      // 'e' appears multiple times in 'Test Panel', so check using getAllByText
      const letterEs = screen.getAllByText('e')
      expect(letterEs.length).toBeGreaterThan(0)
    })
  })

  describe('Vertical panel (right position)', () => {
    it('shows panel-left-close icon when collapsed', () => {
      render(<CollapsiblePanel {...defaultProps} position="right" />)

      expect(screen.getByRole('button')).toContainHTML('lucide-panel-left-close')
    })

    it('shows panel-right-close icon when expanded', () => {
      render(
        <CollapsiblePanel {...defaultProps} position="right" defaultCollapsed={false} />
      )

      expect(screen.getByRole('button')).toContainHTML('lucide-panel-right-close')
    })
  })

  describe('Horizontal panel (bottom position)', () => {
    it('shows chevron up when collapsed', () => {
      render(
        <CollapsiblePanel {...defaultProps} orientation="horizontal" position="bottom" />
      )

      expect(screen.getByRole('button')).toContainHTML('lucide-chevron-up')
    })

    it('shows chevron down when expanded', () => {
      render(
        <CollapsiblePanel
          {...defaultProps}
          orientation="horizontal"
          position="bottom"
          defaultCollapsed={false}
        />
      )

      expect(screen.getByRole('button')).toContainHTML('lucide-chevron-down')
    })

    it('shows icon and title in header for horizontal panels', () => {
      render(
        <CollapsiblePanel {...defaultProps} orientation="horizontal" position="bottom" />
      )

      // Horizontal panels always show title in header
      expect(screen.getByText('Test Panel')).toBeInTheDocument()
    })
  })

  describe('Content area', () => {
    it('hides content when collapsed', () => {
      render(
        <CollapsiblePanel {...defaultProps}>
          <div data-testid="content">Panel Content</div>
        </CollapsiblePanel>
      )

      expect(screen.queryByTestId('content')).not.toBeInTheDocument()
    })

    it('shows content when expanded (lines 154-156)', () => {
      render(
        <CollapsiblePanel {...defaultProps} defaultCollapsed={false}>
          <div data-testid="content">Panel Content</div>
        </CollapsiblePanel>
      )

      expect(screen.getByTestId('content')).toBeInTheDocument()
      expect(screen.getByText('Panel Content')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('applies custom className', () => {
      render(<CollapsiblePanel {...defaultProps} className="custom-class" />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveClass('custom-class')
    })

    it('fills parent height via h-full', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveClass('h-full')
    })

    it('applies vertical border-r for left position', () => {
      render(<CollapsiblePanel {...defaultProps} />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveClass('border-r')
    })

    it('applies border-l-2 for right position', () => {
      render(<CollapsiblePanel {...defaultProps} position="right" />)

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveClass('border-l-2')
    })

    it('applies border-t for horizontal panels', () => {
      render(
        <CollapsiblePanel {...defaultProps} orientation="horizontal" position="bottom" />
      )

      const panel = screen.getByTestId('test-panel')
      expect(panel).toHaveClass('border-t')
    })
  })
})
