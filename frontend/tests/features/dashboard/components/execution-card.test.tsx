/**
 * ExecutionCard Component Tests
 *
 * V-DASH-01: Dashboard Running Executions section
 *
 * Tests for ExecutionCard component per design decisions and wireframes:
 * - Status indicator (dot with color)
 * - Execution name (breadcrumb format: Type > Name > Environment)
 * - Status info line (Running/Passed/Failed · percentage/time · test counts)
 * - Progress bar (for running executions)
 *
 * Component: frontend/src/components/dashboard/execution-card.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExecutionCard } from '@/features/dashboard/components/execution-card'

describe('ExecutionCard Component', () => {
  const defaultProps = {
    id: 'exec-1',
    name: 'Regression > v2.1.0 Release > Production',
    status: 'running' as const,
    statusInfo: 'Running · 45% · 27 of 60 tests',
    progress: 45,
  }

  describe('Basic Rendering', () => {
    it('renders execution card element', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).toBeInTheDocument()
    })

    it('renders status indicator', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(
        screen.getByTestId('execution-status-indicator')
      ).toBeInTheDocument()
    })

    it('renders execution name', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-name')).toHaveTextContent(
        'Regression > v2.1.0 Release > Production'
      )
    })

    it('renders status info', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        'Running · 45% · 27 of 60 tests'
      )
    })

    it('renders progress bar for running executions', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-progress')).toBeInTheDocument()
    })
  })

  describe('Status Indicator', () => {
    it('applies blue color for running status', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('bg-info')
    })

    it('applies green color for passed status', () => {
      render(<ExecutionCard {...defaultProps} status="passed" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('bg-success')
    })

    it('applies red color for failed status', () => {
      render(<ExecutionCard {...defaultProps} status="failed" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('bg-error')
    })

    it('applies gray color for stopped status', () => {
      render(<ExecutionCard {...defaultProps} status="stopped" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('bg-muted')
    })

    it('applies amber color for paused status', () => {
      render(<ExecutionCard {...defaultProps} status="paused" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('bg-warning')
    })

    it('indicator is a small dot', () => {
      render(<ExecutionCard {...defaultProps} />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('w-2')
      expect(indicator).toHaveClass('h-2')
      expect(indicator).toHaveClass('rounded-full')
    })

    it('running indicator has pulse animation', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).toHaveClass('animate-pulse')
    })

    it('non-running indicators do not pulse', () => {
      render(<ExecutionCard {...defaultProps} status="passed" />)
      const indicator = screen.getByTestId('execution-status-indicator')
      expect(indicator).not.toHaveClass('animate-pulse')
    })
  })

  describe('Execution Name', () => {
    it('displays full breadcrumb format name', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-name')).toHaveTextContent(
        'Regression > v2.1.0 Release > Production'
      )
    })

    it('name has font-medium weight', () => {
      render(<ExecutionCard {...defaultProps} />)
      const name = screen.getByTestId('execution-name')
      expect(name).toHaveClass('font-medium')
    })

    it('name has sm text size', () => {
      render(<ExecutionCard {...defaultProps} />)
      const name = screen.getByTestId('execution-name')
      expect(name).toHaveClass('text-sm')
    })

    it('name truncates long text', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          name="Very Long Regression Name > Very Long Suite Name > Very Long Environment Name"
        />
      )
      const name = screen.getByTestId('execution-name')
      expect(name).toHaveClass('truncate')
    })
  })

  describe('Status Info', () => {
    it('displays running status info', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        'Running · 45% · 27 of 60 tests'
      )
    })

    it('displays passed status info', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          status="passed"
          statusInfo="Passed · 2m 34s · 60 of 60 tests"
        />
      )
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        'Passed · 2m 34s · 60 of 60 tests'
      )
    })

    it('displays failed status info', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          status="failed"
          statusInfo="Failed · 3m 12s · 55 passed, 5 failed"
        />
      )
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        'Failed · 3m 12s · 55 passed, 5 failed'
      )
    })

    it('status info has status-specific color for running', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      const statusInfo = screen.getByTestId('execution-status-info')
      expect(statusInfo).toHaveClass('text-info')
    })

    it('status info has status-specific color for passed', () => {
      render(<ExecutionCard {...defaultProps} status="passed" />)
      const statusInfo = screen.getByTestId('execution-status-info')
      expect(statusInfo).toHaveClass('text-success')
    })

    it('status info has status-specific color for failed', () => {
      render(<ExecutionCard {...defaultProps} status="failed" />)
      const statusInfo = screen.getByTestId('execution-status-info')
      expect(statusInfo).toHaveClass('text-error')
    })

    it('status info has xs text size', () => {
      render(<ExecutionCard {...defaultProps} />)
      const statusInfo = screen.getByTestId('execution-status-info')
      expect(statusInfo).toHaveClass('text-xs')
    })

    it('status info has left padding for alignment', () => {
      render(<ExecutionCard {...defaultProps} />)
      const statusInfo = screen.getByTestId('execution-status-info')
      expect(statusInfo).toHaveClass('pl-4')
    })
  })

  describe('Progress Bar', () => {
    it('renders progress bar for running status', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      expect(screen.getByTestId('execution-progress')).toBeInTheDocument()
    })

    it('renders progress bar for paused status', () => {
      render(<ExecutionCard {...defaultProps} status="paused" />)
      expect(screen.getByTestId('execution-progress')).toBeInTheDocument()
    })

    it('does not render progress bar for passed status', () => {
      render(<ExecutionCard {...defaultProps} status="passed" />)
      expect(screen.queryByTestId('execution-progress')).not.toBeInTheDocument()
    })

    it('does not render progress bar for failed status', () => {
      render(<ExecutionCard {...defaultProps} status="failed" />)
      expect(screen.queryByTestId('execution-progress')).not.toBeInTheDocument()
    })

    it('progress bar renders with value prop', () => {
      render(<ExecutionCard {...defaultProps} progress={45} />)
      // The Progress component from shadcn/radix handles aria attributes internally
      expect(screen.getByTestId('execution-progress')).toBeInTheDocument()
    })

    it('progress bar has progressbar role', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('progress bar has appropriate height', () => {
      render(<ExecutionCard {...defaultProps} />)
      const progress = screen.getByTestId('execution-progress')
      expect(progress).toHaveClass('h-1')
    })

    it('progress bar is indented to align with text', () => {
      render(<ExecutionCard {...defaultProps} />)
      const progressContainer = screen.getByTestId('execution-progress').parentElement
      expect(progressContainer).toHaveClass('pl-4')
    })
  })

  describe('Item Styling', () => {
    it('applies vertical padding', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).toHaveClass('py-3')
    })

    it('is a list item without card styling', () => {
      render(<ExecutionCard {...defaultProps} />)
      const card = screen.getByTestId('execution-card')
      // Should NOT have card-specific classes
      expect(card).not.toHaveClass('card')
      expect(card).not.toHaveClass('rounded-lg')
      expect(card).not.toHaveClass('border')
      expect(card).not.toHaveClass('bg-card')
    })
  })

  describe('Layout', () => {
    it('applies flex layout', () => {
      render(<ExecutionCard {...defaultProps} />)
      const card = screen.getByTestId('execution-card')
      expect(card).toHaveClass('flex')
    })

    it('applies flex-col for vertical stacking', () => {
      render(<ExecutionCard {...defaultProps} />)
      const card = screen.getByTestId('execution-card')
      expect(card).toHaveClass('flex-col')
    })

    it('has gap between elements', () => {
      render(<ExecutionCard {...defaultProps} />)
      const card = screen.getByTestId('execution-card')
      expect(card).toHaveClass('gap-1')
    })
  })

  describe('Interactive State', () => {
    it('supports onClick handler', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ExecutionCard {...defaultProps} onClick={handleClick} />)
      await user.click(screen.getByTestId('execution-card'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('passes execution id to onClick', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ExecutionCard {...defaultProps} onClick={handleClick} />)
      await user.click(screen.getByTestId('execution-card'))

      expect(handleClick).toHaveBeenCalledWith('exec-1')
    })

    it('applies cursor-pointer when interactive', () => {
      render(<ExecutionCard {...defaultProps} onClick={() => {}} />)
      expect(screen.getByTestId('execution-card')).toHaveClass('cursor-pointer')
    })

    it('applies hover styles when interactive', () => {
      render(<ExecutionCard {...defaultProps} onClick={() => {}} />)
      expect(screen.getByTestId('execution-card')).toHaveClass('hover:bg-subtle')
    })

    it('is focusable when interactive', () => {
      render(<ExecutionCard {...defaultProps} onClick={() => {}} />)
      expect(screen.getByTestId('execution-card')).toHaveAttribute(
        'tabindex',
        '0'
      )
    })

    it('can be activated with Enter key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ExecutionCard {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('execution-card').focus()
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('can be activated with Space key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<ExecutionCard {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('execution-card').focus()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not apply interactive styles when no onClick', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).not.toHaveClass(
        'cursor-pointer'
      )
    })
  })

  describe('Status Text Color', () => {
    it('applies blue text for running status info', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      expect(screen.getByTestId('execution-status-info')).toHaveClass('text-info')
    })

    it('applies green text for passed status info', () => {
      render(<ExecutionCard {...defaultProps} status="passed" />)
      expect(screen.getByTestId('execution-status-info')).toHaveClass('text-success')
    })

    it('applies red text for failed status info', () => {
      render(<ExecutionCard {...defaultProps} status="failed" />)
      expect(screen.getByTestId('execution-status-info')).toHaveClass('text-error')
    })

    it('applies muted text for stopped status info', () => {
      render(<ExecutionCard {...defaultProps} status="stopped" />)
      expect(screen.getByTestId('execution-status-info')).toHaveClass('text-muted')
    })

    it('applies amber text for paused status info', () => {
      render(<ExecutionCard {...defaultProps} status="paused" />)
      expect(screen.getByTestId('execution-status-info')).toHaveClass('text-warning')
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<ExecutionCard {...defaultProps} className="custom-class" />)
      expect(screen.getByTestId('execution-card')).toHaveClass('custom-class')
    })

    it('merges className with base classes', () => {
      render(<ExecutionCard {...defaultProps} className="custom-class" />)
      const card = screen.getByTestId('execution-card')
      expect(card).toHaveClass('flex')
      expect(card).toHaveClass('custom-class')
    })
  })

  describe('Accessibility', () => {
    it('card has article role', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByRole('article')).toBeInTheDocument()
    })

    it('has accessible label', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).toHaveAttribute(
        'aria-label',
        'Execution: Regression > v2.1.0 Release > Production'
      )
    })

    it('status is announced to screen readers', () => {
      render(<ExecutionCard {...defaultProps} status="running" />)
      expect(screen.getByTestId('execution-card')).toHaveAttribute(
        'aria-describedby'
      )
    })

    it('progress bar has accessible name', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-label',
        'Execution progress'
      )
    })

    it('interactive card has button role', () => {
      render(<ExecutionCard {...defaultProps} onClick={() => {}} />)
      expect(screen.getByTestId('execution-card')).toHaveAttribute(
        'role',
        'button'
      )
    })
  })

  describe('Transitions', () => {
    it('applies transition for state changes', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).toHaveClass('transition-colors')
    })

    it('respects reduced-motion preference', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-card')).toHaveClass(
        'motion-reduce:transition-none'
      )
    })
  })

  describe('Test Counts Display', () => {
    it('displays test count in status info', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          statusInfo="Running · 45% · 27 of 60 tests"
        />
      )
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        '27 of 60 tests'
      )
    })

    it('displays passed/failed count in status info for completed', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          status="failed"
          statusInfo="Failed · 3m 12s · 55 passed, 5 failed"
        />
      )
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        '55 passed, 5 failed'
      )
    })
  })

  describe('Elapsed Time Display', () => {
    it('displays elapsed time for completed executions', () => {
      render(
        <ExecutionCard
          {...defaultProps}
          status="passed"
          statusInfo="Passed · 2m 34s · All tests passed"
        />
      )
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        '2m 34s'
      )
    })

    it('displays percentage for running executions', () => {
      render(<ExecutionCard {...defaultProps} />)
      expect(screen.getByTestId('execution-status-info')).toHaveTextContent(
        '45%'
      )
    })
  })
})
