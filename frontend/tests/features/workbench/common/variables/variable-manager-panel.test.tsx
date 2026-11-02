/**
 * Variable Manager Panel Tests
 *
 * TDD tests for the Variable Manager panel wrapper component.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VariableManagerPanel } from '@/features/workbench/common/variables/variable-manager-panel'

// ===========================================================================
// Test Suite
// ===========================================================================

describe('VariableManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  // =========================================================================
  // Basic Rendering (existing tests already cover this)
  // =========================================================================

  describe('Basic Rendering', () => {
    it('renders with testId "variable-manager"', () => {
      render(<VariableManagerPanel />)

      expect(screen.getByTestId('variable-manager')).toBeInTheDocument()
    })

    it('renders collapsed by default', () => {
      render(<VariableManagerPanel />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })

    it('renders expanded when defaultCollapsed is false', () => {
      render(<VariableManagerPanel defaultCollapsed={false} />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })

    it('shows Variable Manager title', () => {
      render(<VariableManagerPanel defaultCollapsed={false} />)

      expect(screen.getByText('Variable Manager')).toBeInTheDocument()
    })

    it('shows Variable icon', () => {
      render(<VariableManagerPanel />)

      // The Variable icon should be in the collapsed state
      expect(screen.getByTestId('variable-manager').querySelector('svg')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Collapse/Expand Behavior
  // =========================================================================

  describe('Collapse/Expand Behavior', () => {
    it('expands on button click', async () => {
      const user = userEvent.setup()
      render(<VariableManagerPanel />)

      const button = screen.getByRole('button', { name: /expand variable manager/i })
      await user.click(button)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'expanded')
    })

    it('collapses on button click when expanded', async () => {
      const user = userEvent.setup()
      render(<VariableManagerPanel defaultCollapsed={false} />)

      const button = screen.getByRole('button', { name: /collapse variable manager/i })
      await user.click(button)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })

    it('calls onCollapsedChange callback', async () => {
      const user = userEvent.setup()
      const onCollapsedChange = vi.fn()

      render(<VariableManagerPanel onCollapsedChange={onCollapsedChange} />)

      const button = screen.getByRole('button', { name: /expand variable manager/i })
      await user.click(button)

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
    })

    it('supports controlled collapsed state', () => {
      render(<VariableManagerPanel collapsed={true} />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })

    it('controlled state overrides internal state', async () => {
      const user = userEvent.setup()
      render(<VariableManagerPanel collapsed={true} />)

      const button = screen.getByRole('button', { name: /expand variable manager/i })
      await user.click(button)

      // Should still be collapsed due to controlled state
      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
    })
  })

  // =========================================================================
  // Sizing - dimensions controlled by parent ResizablePanel
  // =========================================================================

  describe('Sizing', () => {
    it('fills parent height via h-full', () => {
      render(<VariableManagerPanel />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveClass('h-full')
    })
  })

  // =========================================================================
  // Children Content
  // =========================================================================

  describe('Children Content', () => {
    it('renders children when expanded', () => {
      render(
        <VariableManagerPanel defaultCollapsed={false}>
          <div data-testid="panel-content">Variable Content</div>
        </VariableManagerPanel>
      )

      expect(screen.getByTestId('panel-content')).toBeInTheDocument()
    })

    it('hides children when collapsed', () => {
      render(
        <VariableManagerPanel>
          <div data-testid="panel-content">Variable Content</div>
        </VariableManagerPanel>
      )

      expect(screen.queryByTestId('panel-content')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // Custom Class Names
  // =========================================================================

  describe('Custom Class Names', () => {
    it('applies custom className', () => {
      render(<VariableManagerPanel className="custom-panel-class" />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveClass('custom-panel-class')
    })
  })

  // =========================================================================
  // Right Position
  // =========================================================================

  describe('Position', () => {
    it('positioned on right side (border-l-2)', () => {
      render(<VariableManagerPanel />)

      const panel = screen.getByTestId('variable-manager')
      expect(panel).toHaveClass('border-l-2')
    })

    it('shows panel-left-close icon when collapsed (pointing toward expand)', () => {
      render(<VariableManagerPanel />)

      const button = screen.getByRole('button')
      expect(button).toContainHTML('lucide-panel-left-close')
    })

    it('shows panel-right-close icon when expanded (pointing toward collapse)', () => {
      render(<VariableManagerPanel defaultCollapsed={false} />)

      const button = screen.getByRole('button')
      expect(button).toContainHTML('lucide-panel-right-close')
    })
  })

  // =========================================================================
  // Collapsed State Display
  // =========================================================================

  describe('Collapsed State Display', () => {
    it('shows vertical stacked letters when collapsed', () => {
      render(<VariableManagerPanel />)

      // Should show 'V', 'a', 'r', etc. as stacked letters
      expect(screen.getByText('V')).toBeInTheDocument()
      expect(screen.getByText('M')).toBeInTheDocument()
    })

    it('shows Variable icon when collapsed', () => {
      render(<VariableManagerPanel />)

      const panel = screen.getByTestId('variable-manager')
      // Variable icon from lucide-react
      expect(panel.querySelector('svg')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Accessibility
  // =========================================================================

  describe('Accessibility', () => {
    it('expand button has proper aria-expanded', () => {
      render(<VariableManagerPanel />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })

    it('collapse button has proper aria-expanded', () => {
      render(<VariableManagerPanel defaultCollapsed={false} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })

    it('button has proper aria-label for expand', () => {
      render(<VariableManagerPanel />)

      expect(
        screen.getByRole('button', { name: /expand variable manager/i })
      ).toBeInTheDocument()
    })

    it('button has proper aria-label for collapse', () => {
      render(<VariableManagerPanel defaultCollapsed={false} />)

      expect(
        screen.getByRole('button', { name: /collapse variable manager/i })
      ).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Integration with VariableManagerContent (placeholder tests)
