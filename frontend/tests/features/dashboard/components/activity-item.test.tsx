/**
 * ActivityItem Component Tests
 *
 * V-DASH-01: Dashboard Recent Activity section
 *
 * Tests for ActivityItem component per design decisions and wireframes:
 * - Type icon (test-tube for test, folder-kanban for suite, git-branch for regression)
 * - Name text
 * - Context text (type · suite · timestamp)
 *
 * Component: frontend/src/components/dashboard/activity-item.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityItem } from '@/features/dashboard/components/activity-item'

describe('ActivityItem Component', () => {
  const defaultProps = {
    type: 'test' as const,
    name: 'Login Flow Test',
    context: 'Test · Auth Suite · 2 hours ago',
  }

  describe('Basic Rendering', () => {
    it('renders activity item element', () => {
      render(<ActivityItem {...defaultProps} />)
      expect(screen.getByTestId('activity-item')).toBeInTheDocument()
    })

    it('renders type icon', () => {
      render(<ActivityItem {...defaultProps} />)
      expect(screen.getByTestId('activity-icon')).toBeInTheDocument()
    })

    it('renders activity name', () => {
      render(<ActivityItem {...defaultProps} />)
      expect(screen.getByTestId('activity-name')).toHaveTextContent(
        'Login Flow Test'
      )
    })

    it('renders activity context', () => {
      render(<ActivityItem {...defaultProps} />)
      expect(screen.getByTestId('activity-context')).toHaveTextContent(
        'Test · Auth Suite · 2 hours ago'
      )
    })
  })

  describe('Type Icons', () => {
    it.each([
      ['renders test-tube icon for test type', 'test', 'test-tube-2'],
      ['renders folder-kanban icon for suite type', 'suite', 'folder-kanban'],
      ['renders git-branch icon for regression type', 'regression', 'git-branch'],
      ['renders play icon for execution type', 'execution', 'play'],
    ] as const)('%s', (_title, type, iconName) => {
      render(<ActivityItem {...defaultProps} type={type} />)
      const icon = screen.getByTestId('activity-icon')
      expect(icon).toHaveAttribute('data-icon-name', iconName)
    })

    it('icon has appropriate size', () => {
      render(<ActivityItem {...defaultProps} />)
      const icon = screen.getByTestId('activity-icon')
      expect(icon).toHaveClass('icon-md')
    })

    it('icon has type-specific color matching navigation', () => {
      render(<ActivityItem {...defaultProps} type="test" />)
      const icon = screen.getByTestId('activity-icon')
      // Test icon uses green (#4ADE80) matching navigation sidebar
      expect(icon).toHaveAttribute('data-icon-color', '#4ADE80')
      expect(icon).toHaveStyle({ color: '#4ADE80' })
    })

    it.each([
      ['suite icon has amber color matching navigation', 'suite', '#F59E0B'],
      ['regression icon has purple color matching navigation', 'regression', '#A78BFA'],
      ['execution icon has blue color matching navigation', 'execution', '#60A5FA'],
    ] as const)('%s', (_title, type, color) => {
      render(<ActivityItem {...defaultProps} type={type} />)
      const icon = screen.getByTestId('activity-icon')
      expect(icon).toHaveAttribute('data-icon-color', color)
    })
  })

  describe('Status Indicator', () => {
    it('renders status indicator when status provided', () => {
      render(<ActivityItem {...defaultProps} status="passed" />)
      const indicator = screen.getByTestId('activity-status-indicator')
      expect(indicator).toBeInTheDocument()
    })

    it('does not render status indicator when status not provided', () => {
      render(<ActivityItem {...defaultProps} />)
      expect(
        screen.queryByTestId('activity-status-indicator')
      ).not.toBeInTheDocument()
    })

    it.each([
      ['applies green color for passed status', 'passed', 'bg-success'],
      ['applies red color for failed status', 'failed', 'bg-error'],
      ['applies blue color for running status', 'running', 'bg-info'],
      ['applies gray color for idle status', 'idle', 'bg-muted'],
    ] as const)('%s', (_title, status, className) => {
      render(<ActivityItem {...defaultProps} status={status} />)
      const indicator = screen.getByTestId('activity-status-indicator')
      expect(indicator).toHaveClass(className)
    })

    it('status indicator is a small dot', () => {
      render(<ActivityItem {...defaultProps} status="passed" />)
      const indicator = screen.getByTestId('activity-status-indicator')
      expect(indicator).toHaveClass('w-2')
      expect(indicator).toHaveClass('h-2')
      expect(indicator).toHaveClass('rounded-full')
    })
  })

  describe('Name Styling', () => {
    it.each([
      // Uses text-card-title class: dark in light theme, light in dark theme
      ['name has theme-aware card title color', 'text-card-title'],
      ['name has medium font weight', 'font-medium'],
      ['name has base text size', 'text-sm'],
    ])('%s', (_title, className) => {
      render(<ActivityItem {...defaultProps} />)
      const name = screen.getByTestId('activity-name')
      expect(name).toHaveClass(className)
    })

    it('name truncates long text', () => {
      render(
        <ActivityItem
          {...defaultProps}
          name="This is a very long test name that should be truncated to prevent layout issues"
        />
      )
      const name = screen.getByTestId('activity-name')
      expect(name).toHaveClass('truncate')
    })
  })

  describe('Context Styling', () => {
    it('context has muted text color', () => {
      render(<ActivityItem {...defaultProps} />)
      const context = screen.getByTestId('activity-context')
      expect(context).toHaveClass('text-muted')
    })

    it('context has smaller text size', () => {
      render(<ActivityItem {...defaultProps} />)
      const context = screen.getByTestId('activity-context')
      expect(context).toHaveClass('text-xs')
    })

    it('context truncates long text', () => {
      render(
        <ActivityItem
          {...defaultProps}
          context="This is a very long context string with suite name and timestamp that should be truncated"
        />
      )
      const context = screen.getByTestId('activity-context')
      expect(context).toHaveClass('truncate')
    })
  })

  describe('Layout', () => {
    it.each([
      ['applies flex layout for horizontal arrangement', 'flex'],
      ['aligns items to center', 'items-center'],
      ['has gap between icon and text', 'gap-3'],
      ['has vertical padding', 'py-2'],
      ['has horizontal padding', 'px-3'],
    ])('%s', (_title, className) => {
      render(<ActivityItem {...defaultProps} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass(className)
    })
  })

  describe('Interactive State', () => {
    it('supports onClick handler', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ActivityItem {...defaultProps} onClick={handleClick} />)
      await user.click(screen.getByTestId('activity-item'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('applies hover styles when interactive', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass('hover:bg-subtle')
    })

    it('applies cursor-pointer when interactive', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass('cursor-pointer')
    })

    it('is focusable when interactive', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveAttribute('tabindex', '0')
    })

    it('can be activated with Enter key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ActivityItem {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('activity-item').focus()
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('can be activated with Space key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ActivityItem {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('activity-item').focus()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not apply hover styles when not interactive', () => {
      render(<ActivityItem {...defaultProps} />)
      const item = screen.getByTestId('activity-item')
      expect(item).not.toHaveClass('hover:bg-subtle')
    })

    it('does not apply cursor-pointer when not interactive', () => {
      render(<ActivityItem {...defaultProps} />)
      const item = screen.getByTestId('activity-item')
      expect(item).not.toHaveClass('cursor-pointer')
    })
  })

  describe('Timestamp Formatting', () => {
    it('displays relative timestamp in context', () => {
      render(
        <ActivityItem
          {...defaultProps}
          context="Test · Auth Suite · 5 minutes ago"
        />
      )
      expect(screen.getByTestId('activity-context')).toHaveTextContent(
        '5 minutes ago'
      )
    })

    it('displays hour-based timestamp', () => {
      render(
        <ActivityItem
          {...defaultProps}
          context="Test · Auth Suite · 3 hours ago"
        />
      )
      expect(screen.getByTestId('activity-context')).toHaveTextContent(
        '3 hours ago'
      )
    })

    it('displays day-based timestamp', () => {
      render(
        <ActivityItem
          {...defaultProps}
          context="Test · Auth Suite · 2 days ago"
        />
      )
      expect(screen.getByTestId('activity-context')).toHaveTextContent(
        '2 days ago'
      )
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<ActivityItem {...defaultProps} className="custom-class" />)
      expect(screen.getByTestId('activity-item')).toHaveClass('custom-class')
    })

    it('merges className with base classes', () => {
      render(<ActivityItem {...defaultProps} className="custom-class" />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass('flex')
      expect(item).toHaveClass('custom-class')
    })
  })

  describe('Accessibility', () => {
    it('icon is decorative (aria-hidden)', () => {
      render(<ActivityItem {...defaultProps} />)
      const iconWrapper = screen.getByTestId('activity-icon')
      expect(iconWrapper).toHaveAttribute('aria-hidden', 'true')
    })

    it('interactive item has proper role', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveAttribute('role', 'button')
    })

    it('non-interactive item has listitem role', () => {
      render(<ActivityItem {...defaultProps} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveAttribute('role', 'listitem')
    })

    it('has accessible description', () => {
      render(<ActivityItem {...defaultProps} />)
      const item = screen.getByTestId('activity-item')
      // Screen readers should announce: "Login Flow Test, Test · Auth Suite · 2 hours ago"
      expect(item).toHaveAttribute(
        'aria-label',
        'Login Flow Test, Test · Auth Suite · 2 hours ago'
      )
    })
  })

  describe('Transitions', () => {
    it('applies transition for hover state', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass('transition-colors')
    })

    it('respects reduced-motion preference', () => {
      render(<ActivityItem {...defaultProps} onClick={() => {}} />)
      const item = screen.getByTestId('activity-item')
      expect(item).toHaveClass('motion-reduce:transition-none')
    })
  })
})
