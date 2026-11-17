/**
 * QuickActionCard Component Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard Quick Actions section
 *
 * Tests for QuickActionCard component per design decisions and wireframes:
 * - DASH-2: Empty state
 * - DASH-3: Quick Actions section with common workflows
 *
 * Each action card contains:
 * - Icon
 * - Title
 * - Description
 * - Click handler
 * - Variant (default, primary)
 *
 * Component: frontend/src/components/dashboard/quick-action-card.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickActionCard } from '@/features/dashboard/components/quick-action-card'

describe('QuickActionCard Component', () => {
  const defaultProps = {
    icon: 'plus' as const,
    title: 'New Test',
    description: 'Create a new test from scratch',
    testId: 'quick-action-new-test',
    onClick: vi.fn(),
  }

  describe('Basic Rendering', () => {
    it('renders quick action card element', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toBeInTheDocument()
    })

    it('renders icon', () => {
      render(<QuickActionCard {...defaultProps} />)
      const icon = screen
        .getByTestId('quick-action-new-test')
        .querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('renders title text', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByText('New Test')).toBeInTheDocument()
    })

    it('renders description text', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(
        screen.getByText('Create a new test from scratch')
      ).toBeInTheDocument()
    })
  })

  describe('Icon Rendering', () => {
    it.each([
      { icon: 'plus' as const },
      { icon: 'play' as const },
      { icon: 'bar-chart' as const },
      { icon: 'compass' as const },
    ])('renders $icon icon', ({ icon }) => {
      render(<QuickActionCard {...defaultProps} icon={icon} />)
      const iconWrapper = screen
        .getByTestId('quick-action-new-test')
        .querySelector('[data-action-icon]')
      expect(iconWrapper).toHaveAttribute('data-icon-name', icon)
    })

    it('icon has appropriate size', () => {
      render(<QuickActionCard {...defaultProps} />)
      const iconWrapper = screen
        .getByTestId('quick-action-new-test')
        .querySelector('[data-action-icon]')
      expect(iconWrapper).toHaveClass('icon-lg')
    })
  })

  describe('Title Styling', () => {
    it.each([
      { trait: 'font-medium weight', className: 'font-medium' },
      { trait: 'base text size', className: 'text-sm' },
      { trait: 'primary text color by default', className: 'text-primary' },
    ])('title has $trait', ({ className }) => {
      render(<QuickActionCard {...defaultProps} />)
      const title = screen.getByText('New Test')
      expect(title).toHaveClass(className)
    })

    it('title has white color for primary variant', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      const title = screen.getByText('New Test')
      expect(title).toHaveClass('text-white')
    })
  })

  describe('Description Styling', () => {
    it('description has muted text color by default', () => {
      render(<QuickActionCard {...defaultProps} />)
      const description = screen.getByText('Create a new test from scratch')
      expect(description).toHaveClass('text-muted')
    })

    it('description has smaller text size', () => {
      render(<QuickActionCard {...defaultProps} />)
      const description = screen.getByText('Create a new test from scratch')
      expect(description).toHaveClass('text-xs')
    })

    it('description has lighter color for primary variant', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      const description = screen.getByText('Create a new test from scratch')
      expect(description).toHaveClass('text-white/80')
    })
  })

  describe('Default Variant Styling', () => {
    it.each([
      { name: 'card base class', className: 'card' },
      { name: 'card background', className: 'bg-card' },
      { name: 'border', className: 'border' },
      { name: 'rounded corners', className: 'rounded-lg' },
    ])('applies $name', ({ className }) => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(className)
    })

    it('icon has muted color for default variant', () => {
      render(<QuickActionCard {...defaultProps} />)
      const iconWrapper = screen
        .getByTestId('quick-action-new-test')
        .querySelector('[data-action-icon]')
      expect(iconWrapper).toHaveClass('text-muted')
    })
  })

  describe('Primary Variant Styling', () => {
    it('applies primary background color per DASH-2', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'bg-primary'
      )
    })

    it('does not apply border for primary variant', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      expect(screen.getByTestId('quick-action-new-test')).not.toHaveClass(
        'border'
      )
    })

    it('icon has white color for primary variant', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      const iconWrapper = screen
        .getByTestId('quick-action-new-test')
        .querySelector('[data-action-icon]')
      expect(iconWrapper).toHaveClass('text-white')
    })

    it('has distinct hover state for primary variant', () => {
      render(<QuickActionCard {...defaultProps} variant="primary" />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'hover:bg-primary-dark'
      )
    })
  })

  describe('Card Layout', () => {
    it.each([
      { name: 'applies flex layout', className: 'flex' },
      { name: 'applies column direction', className: 'flex-col' },
      { name: 'has gap between elements', className: 'gap-2' },
      { name: 'has padding', className: 'p-4' },
      { name: 'centers content', className: 'items-center' },
      { name: 'centers text', className: 'text-center' },
    ])('$name', ({ className }) => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(className)
    })
  })

  describe('Interactive State', () => {
    it('calls onClick when clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<QuickActionCard {...defaultProps} onClick={handleClick} />)
      await user.click(screen.getByTestId('quick-action-new-test'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it.each([
      { name: 'cursor-pointer', className: 'cursor-pointer' },
      { name: 'hover shadow for default variant', className: 'hover:shadow-md' },
      { name: 'hover lift effect', className: 'hover:-translate-y-0.5' },
    ])('applies $name', ({ className }) => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(className)
    })

    it('is focusable', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveAttribute(
        'tabindex',
        '0'
      )
    })

    it('can be activated with Enter key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<QuickActionCard {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('quick-action-new-test').focus()
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('can be activated with Space key', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<QuickActionCard {...defaultProps} onClick={handleClick} />)
      screen.getByTestId('quick-action-new-test').focus()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('has focus ring', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'focus:outline-none'
      )
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'focus:ring-2'
      )
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'focus:ring-primary'
      )
    })
  })

  describe('Action Types', () => {
    it('renders New Test action correctly', () => {
      render(
        <QuickActionCard
          icon="plus"
          title="New Test"
          description="Create a new test from scratch"
          testId="quick-action-new-test"
          onClick={() => {}}
        />
      )
      expect(screen.getByText('New Test')).toBeInTheDocument()
      expect(screen.getByText(/Create/i)).toBeInTheDocument()
    })

    it('renders Run Regression action correctly', () => {
      render(
        <QuickActionCard
          icon="play"
          title="Run Regression"
          description="Execute a regression test suite"
          testId="quick-action-run-regression"
          onClick={() => {}}
        />
      )
      expect(screen.getByText('Run Regression')).toBeInTheDocument()
      expect(screen.getByText(/Execute/i)).toBeInTheDocument()
    })

    it('renders View Reports action correctly', () => {
      render(
        <QuickActionCard
          icon="bar-chart"
          title="View Reports"
          description="Analyze test results and trends"
          testId="quick-action-view-reports"
          onClick={() => {}}
        />
      )
      expect(screen.getByText('View Reports')).toBeInTheDocument()
      expect(screen.getByText(/Analyze/i)).toBeInTheDocument()
    })

  })

  describe('Disabled State', () => {
    it('supports disabled state', () => {
      render(<QuickActionCard {...defaultProps} disabled />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    it('does not call onClick when disabled', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <QuickActionCard {...defaultProps} onClick={handleClick} disabled />
      )
      await user.click(screen.getByTestId('quick-action-new-test'))

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('applies reduced opacity when disabled', () => {
      render(<QuickActionCard {...defaultProps} disabled />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'opacity-50'
      )
    })

    it('removes cursor-pointer when disabled', () => {
      render(<QuickActionCard {...defaultProps} disabled />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'cursor-not-allowed'
      )
    })

    it('is not focusable when disabled', () => {
      render(<QuickActionCard {...defaultProps} disabled />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveAttribute(
        'tabindex',
        '-1'
      )
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<QuickActionCard {...defaultProps} className="custom-class" />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(
        'custom-class'
      )
    })

    it('merges className with base classes', () => {
      render(<QuickActionCard {...defaultProps} className="custom-class" />)
      const card = screen.getByTestId('quick-action-new-test')
      expect(card).toHaveClass('card')
      expect(card).toHaveClass('custom-class')
    })
  })

  describe('Accessibility', () => {
    it('has button role', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('has accessible name from title', () => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'New Test' })).toBeInTheDocument()
    })

    it('icon is decorative (aria-hidden)', () => {
      render(<QuickActionCard {...defaultProps} />)
      const iconWrapper = screen
        .getByTestId('quick-action-new-test')
        .querySelector('[data-action-icon]')
      expect(iconWrapper).toHaveAttribute('aria-hidden', 'true')
    })

    it('description is associated with button', () => {
      render(<QuickActionCard {...defaultProps} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-describedby')
    })

    it('disabled state is announced', () => {
      render(<QuickActionCard {...defaultProps} disabled />)
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
  })

  describe('Transitions', () => {
    it.each([
      {
        name: 'applies hover/focus transition',
        className: 'transition-[transform,box-shadow,background-color]',
      },
      { name: 'has appropriate transition duration', className: 'duration-200' },
      { name: 'respects reduced-motion preference', className: 'motion-reduce:transition-none' },
    ])('$name', ({ className }) => {
      render(<QuickActionCard {...defaultProps} />)
      expect(screen.getByTestId('quick-action-new-test')).toHaveClass(className)
    })
  })
})
