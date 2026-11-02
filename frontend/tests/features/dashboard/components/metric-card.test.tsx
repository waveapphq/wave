/**
 * MetricCard Component Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard metric cards
 *
 * Tests for MetricCard component per design decisions:
 * - DASH-1: Four summary cards: Tests, Suites, Regressions, Recent Executions
 *
 * MetricCard specifications (from wireframe analysis):
 * - Label: card title (e.g., "Tests", "Suites")
 * - Count: large numeric value
 * - Subtitle: contextual info (pass/fail, attention, etc.)
 * - data-testid attributes for Playwright testing
 *
 * Component: frontend/src/components/dashboard/metric-card.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetricCard } from '@/features/dashboard/components/metric-card'

describe('MetricCard Component', () => {
  describe('Basic Rendering', () => {
    it('renders metric card element', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="38 passing, 4 failing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toBeInTheDocument()
    })

    it('renders label text', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="38 passing, 4 failing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    it('renders count value', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="38 passing, 4 failing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-count')).toHaveTextContent('42')
    })

    it('renders subtitle text', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="38 passing, 4 failing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        '38 passing, 4 failing'
      )
    })
  })

  describe('Count Display', () => {
    it('displays zero count', () => {
      render(
        <MetricCard
          label="Tests"
          count={0}
          subtitle="No tests yet"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-count')).toHaveTextContent('0')
    })

    it('displays large count with number formatting', () => {
      render(
        <MetricCard
          label="Tests"
          count={1234}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      // Should format as "1,234" for readability
      expect(screen.getByTestId('metric-count')).toHaveTextContent('1,234')
    })

    it('displays very large count with appropriate formatting', () => {
      render(
        <MetricCard
          label="Executions"
          count={12345}
          subtitle="Running"
          testId="metric-card-executions"
        />
      )
      expect(screen.getByTestId('metric-count')).toHaveTextContent('12,345')
    })

    it('count has large text styling for emphasis', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const count = screen.getByTestId('metric-count')
      expect(count).toHaveClass('text-5xl')
    })

    it('count has font-semibold for emphasis', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const count = screen.getByTestId('metric-count')
      expect(count).toHaveClass('font-semibold')
    })
  })

  describe('Subtitle Variants', () => {
    it('displays pass/fail subtitle for tests', () => {
      render(
        <MetricCard
          label="Tests"
          count={330}
          subtitle="298 passing, 32 failing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        '298 passing, 32 failing'
      )
    })

    it('displays attention subtitle for suites', () => {
      render(
        <MetricCard
          label="Suites"
          count={12}
          subtitle="2 need attention"
          testId="metric-card-suites"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        '2 need attention'
      )
    })

    it('displays active version subtitle for regressions', () => {
      render(
        <MetricCard
          label="Regressions"
          count={87}
          subtitle="5 active versions"
          testId="metric-card-regressions"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        '5 active versions'
      )
    })

    it('displays running/completed subtitle for executions', () => {
      render(
        <MetricCard
          label="Executions (24h)"
          count={142}
          subtitle="3 running, 139 completed"
          testId="metric-card-executions"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        '3 running, 139 completed'
      )
    })

    it('displays empty state subtitle when count is zero', () => {
      render(
        <MetricCard
          label="Tests"
          count={0}
          subtitle="No tests yet"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-subtitle')).toHaveTextContent(
        'No tests yet'
      )
    })

    it('subtitle has muted text color', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-muted')
    })

    it('subtitle has smaller text size', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-sm')
    })
  })

  describe('Subtitle Color Variants', () => {
    it('applies success color variant to subtitle', () => {
      render(
        <MetricCard
          label="Tests"
          count={100}
          subtitle="All passing"
          subtitleVariant="success"
          testId="metric-card-tests"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-success')
    })

    it('applies error color variant to subtitle', () => {
      render(
        <MetricCard
          label="Tests"
          count={100}
          subtitle="5 failing"
          subtitleVariant="error"
          testId="metric-card-tests"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-error')
    })

    it('applies warning color variant to subtitle', () => {
      render(
        <MetricCard
          label="Suites"
          count={12}
          subtitle="2 need attention"
          subtitleVariant="warning"
          testId="metric-card-suites"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-warning')
    })

    it('applies default muted color when no variant specified', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="Some info"
          testId="metric-card-tests"
        />
      )
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(subtitle).toHaveClass('text-muted')
    })
  })

  describe('Card Styling', () => {
    it('applies card base class', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('card')
    })

    it('applies rounded corners', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('rounded-lg')
    })

    it('applies border styling', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('border')
    })

    it('applies card background', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('bg-card')
    })

    it('applies padding', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      // Compact padding for metric cards - horizontal and vertical
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('px-4')
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('py-3')
    })
  })

  describe('Label Styling', () => {
    it('label has base text size', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const label = screen.getByText('Tests')
      expect(label).toHaveClass('text-base')
    })

    it('label has secondary color', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const label = screen.getByText('Tests')
      expect(label).toHaveClass('text-secondary')
    })
  })

  describe('Visual Hierarchy', () => {
    it('renders elements in correct order: label, then count row with subtitle inline', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )

      // Label and count row are direct children
      expect(screen.getByText('Tests')).toBeInTheDocument()
      expect(screen.getByTestId('metric-count')).toBeInTheDocument()
      expect(screen.getByTestId('metric-subtitle')).toBeInTheDocument()

      // Subtitle should be inline with count (siblings in same flex container)
      const count = screen.getByTestId('metric-count')
      const subtitle = screen.getByTestId('metric-subtitle')
      expect(count.parentElement).toBe(subtitle.parentElement)
    })

    it('renders only label and count when no subtitle provided', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          testId="metric-card-tests"
        />
      )

      expect(screen.queryByTestId('metric-subtitle')).not.toBeInTheDocument()
      expect(screen.getByTestId('metric-count')).toBeInTheDocument()
      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    it('count is visually prominent (larger than other text)', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )

      const label = screen.getByText('Tests')
      const count = screen.getByTestId('metric-count')
      const subtitle = screen.getByTestId('metric-subtitle')

      // Visual hierarchy: count largest, label medium, subtitle smallest
      expect(count).toHaveClass('text-5xl')
      expect(label).toHaveClass('text-base')
      expect(subtitle).toHaveClass('text-sm')
    })
  })

  describe('Icon Support', () => {
    it('renders icon when provided', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          icon="flask"
          testId="metric-card-tests"
        />
      )
      const icon = screen.getByTestId('metric-card-tests').querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('does not render icon when not provided', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const icon = screen.getByTestId('metric-card-tests').querySelector('[data-metric-icon]')
      expect(icon).not.toBeInTheDocument()
    })

    it('icon has muted color', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          icon="flask"
          testId="metric-card-tests"
        />
      )
      const iconWrapper = screen
        .getByTestId('metric-card-tests')
        .querySelector('[data-metric-icon]')
      expect(iconWrapper).toHaveClass('text-muted')
    })
  })

  describe('Interactive State', () => {
    it('supports onClick handler', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={handleClick}
          testId="metric-card-tests"
        />
      )

      await user.click(screen.getByTestId('metric-card-tests'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('applies cursor-pointer when onClick provided', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={() => {}}
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('cursor-pointer')
    })

    it('does not apply cursor-pointer when no onClick', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).not.toHaveClass(
        'cursor-pointer'
      )
    })

    it('applies hover styles when interactive', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={() => {}}
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass(
        'hover:shadow-md'
      )
    })

    it('is focusable when interactive', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={() => {}}
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveAttribute(
        'tabindex',
        '0'
      )
    })

    it('can be activated with Enter key when interactive', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={handleClick}
          testId="metric-card-tests"
        />
      )

      screen.getByTestId('metric-card-tests').focus()
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('can be activated with Space key when interactive', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={handleClick}
          testId="metric-card-tests"
        />
      )

      screen.getByTestId('metric-card-tests').focus()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
    it('renders skeleton when loading', () => {
      render(
        <MetricCard
          label="Tests"
          count={0}
          subtitle=""
          loading
          testId="metric-card-tests"
        />
      )
      const skeleton = screen
        .getByTestId('metric-card-tests')
        .querySelector('[data-skeleton]')
      expect(skeleton).toBeInTheDocument()
    })

    it('hides count when loading', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          loading
          testId="metric-card-tests"
        />
      )
      expect(screen.queryByText('42')).not.toBeInTheDocument()
    })

    it('hides subtitle when loading', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          loading
          testId="metric-card-tests"
        />
      )
      expect(screen.queryByText('All passing')).not.toBeInTheDocument()
    })

    it('still shows label when loading', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          loading
          testId="metric-card-tests"
        />
      )
      expect(screen.getByText('Tests')).toBeInTheDocument()
    })

    it('sets aria-busy when loading', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          loading
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          className="custom-class"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('custom-class')
    })

    it('merges className with base classes', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          className="custom-class"
          testId="metric-card-tests"
        />
      )
      const card = screen.getByTestId('metric-card-tests')
      expect(card).toHaveClass('card')
      expect(card).toHaveClass('custom-class')
    })
  })

  describe('Accessibility', () => {
    it('has article role for semantic grouping', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByRole('article')).toBeInTheDocument()
    })

    it('has accessible label via aria-label', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveAttribute(
        'aria-label',
        'Tests: 42'
      )
    })

    it('count is not announced separately (part of card label)', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      const count = screen.getByTestId('metric-count')
      expect(count).toHaveAttribute('aria-hidden', 'true')
    })

    it('interactive card has button-like semantics', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          onClick={() => {}}
          testId="metric-card-tests"
        />
      )
      const card = screen.getByTestId('metric-card-tests')
      expect(card).toHaveAttribute('role', 'button')
    })
  })

  describe('Transitions', () => {
    it('applies transition for smooth state changes', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass('transition-shadow')
    })

    it('respects reduced-motion preference', () => {
      render(
        <MetricCard
          label="Tests"
          count={42}
          subtitle="All passing"
          testId="metric-card-tests"
        />
      )
      expect(screen.getByTestId('metric-card-tests')).toHaveClass(
        'motion-reduce:transition-none'
      )
    })
  })
})
