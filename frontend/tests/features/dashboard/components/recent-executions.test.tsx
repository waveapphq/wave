/**
 * RecentExecutions Section Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard Recent Executions section
 *
 * Tests for RecentExecutions component per design decisions and wireframes:
 * - Section header: "Recent Executions"
 * - Execution cards with status indicator, name, progress bar, test counts
 * - Empty state: "No recent executions" / "Run a test or regression to see progress"
 *
 * Component: frontend/src/components/dashboard/recent-executions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentExecutions } from '@/features/dashboard/components/recent-executions'

describe('RecentExecutions Section', () => {
  const mockExecutions = [
    {
      id: 'exec-1',
      name: 'Regression > v2.1.0 Release > Production',
      status: 'running' as const,
      statusInfo: 'Running · 45% · 27 of 60 tests',
      progress: 45,
      testsTotal: 60,
      testsDone: 60,
    },
    {
      id: 'exec-2',
      name: 'Test > Login Flow > Staging',
      status: 'running' as const,
      statusInfo: 'Running · 80% · 8 of 10 tests',
      progress: 80,
      testsTotal: 10,
      testsDone: 10,
    },
    {
      id: 'exec-3',
      name: 'Suite > Auth Suite > Development',
      status: 'paused' as const,
      statusInfo: 'Paused · 30% · 6 of 20 tests',
      progress: 30,
      testsTotal: 20,
      testsDone: 20,
    },
  ]

  describe('Basic Rendering', () => {
    it('renders section container', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(
        screen.getByTestId('recent-executions-section')
      ).toBeInTheDocument()
    })

    it('renders section header', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(screen.getByText('Recent Executions')).toBeInTheDocument()
    })

    it('header is an h2 element', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Recent Executions'
      )
    })
  })

  describe('Execution List', () => {
    it('renders all execution cards', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const cards = screen.getAllByTestId('execution-card')
      expect(cards).toHaveLength(3)
    })

    it('renders execution names', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(
        screen.getByText('Regression > v2.1.0 Release > Production')
      ).toBeInTheDocument()
      expect(screen.getByText('Test > Login Flow > Staging')).toBeInTheDocument()
      expect(
        screen.getByText('Suite > Auth Suite > Development')
      ).toBeInTheDocument()
    })

    it('renders status indicators', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const indicators = screen.getAllByTestId('execution-status-indicator')
      expect(indicators).toHaveLength(3)
    })

    it('renders progress bars for running executions', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const progressBars = screen.getAllByTestId('execution-progress')
      expect(progressBars).toHaveLength(3)
    })

    it('renders executions in provided order', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const cards = screen.getAllByTestId('execution-card')
      expect(
        within(cards[0]).getByText('Regression > v2.1.0 Release > Production')
      ).toBeInTheDocument()
      expect(
        within(cards[1]).getByText('Test > Login Flow > Staging')
      ).toBeInTheDocument()
      expect(
        within(cards[2]).getByText('Suite > Auth Suite > Development')
      ).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('renders empty state when no executions', () => {
      render(<RecentExecutions executions={[]} />)
      expect(screen.getByTestId('empty-state-title')).toBeInTheDocument()
    })

    it('displays "No recent executions" title', () => {
      render(<RecentExecutions executions={[]} />)
      expect(screen.getByTestId('empty-state-title')).toHaveTextContent(
        'No recent executions'
      )
    })

    it('displays helpful description', () => {
      render(<RecentExecutions executions={[]} />)
      expect(screen.getByTestId('empty-state-description')).toHaveTextContent(
        'Run a test or regression to see progress'
      )
    })

    it('does not render execution cards in empty state', () => {
      render(<RecentExecutions executions={[]} />)
      expect(screen.queryAllByTestId('execution-card')).toHaveLength(0)
    })

    it('still renders section header in empty state', () => {
      render(<RecentExecutions executions={[]} />)
      expect(screen.getByText('Recent Executions')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('renders skeletons when loading', () => {
      render(<RecentExecutions executions={[]} loading />)
      const skeletons = screen
        .getByTestId('recent-executions-section')
        .querySelectorAll('[data-skeleton]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('renders expected number of skeleton items', () => {
      render(<RecentExecutions executions={[]} loading />)
      const skeletons = screen
        .getByTestId('recent-executions-section')
        .querySelectorAll('[data-skeleton-item]')
      // Should show 3 skeleton items
      expect(skeletons.length).toBe(3)
    })

    it('hides execution cards when loading', () => {
      render(<RecentExecutions executions={mockExecutions} loading />)
      expect(screen.queryAllByTestId('execution-card')).toHaveLength(0)
    })

    it('hides empty state when loading', () => {
      render(<RecentExecutions executions={[]} loading />)
      expect(screen.queryByTestId('empty-state-title')).not.toBeInTheDocument()
    })

    it('sets aria-busy on container when loading', () => {
      render(<RecentExecutions executions={[]} loading />)
      expect(screen.getByTestId('recent-executions-section')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Section Styling', () => {
    it('section has flex layout', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('flex-col')
    })

    it('card element has card styling', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('card')
    })

    it('card element has rounded corners', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('rounded-lg')
    })

    it('card element has border', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('border')
    })

    it('card element has card background', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('bg-card')
    })

    it('card element has no outer padding (content handles it)', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('p-0')
    })
  })

  describe('Header Styling', () => {
    it('header is outside card as h2 element', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const header = screen.getByText('Recent Executions')
      expect(header.tagName).toBe('H2')
    })

    it('header has font-medium weight', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const header = screen.getByText('Recent Executions')
      expect(header).toHaveClass('font-medium')
    })

    it('header has base text size', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const header = screen.getByText('Recent Executions')
      expect(header).toHaveClass('text-base')
    })
  })

  describe('List Layout', () => {
    it('executions container has list layout', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const container = screen
        .getByTestId('recent-executions-section')
        .querySelector('[data-executions-list]')
      expect(container).toBeInTheDocument()
    })

    it('list has dividers between items', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const container = screen
        .getByTestId('recent-executions-section')
        .querySelector('[data-executions-list]')
      expect(container).toHaveClass('divide-y')
    })

    it('list container has horizontal padding', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const container = screen
        .getByTestId('recent-executions-section')
        .querySelector('[data-executions-list]')
      expect(container).toHaveClass('px-4')
    })

    it('list container allows vertical scroll', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const container = screen
        .getByTestId('recent-executions-section')
        .querySelector('[data-executions-list]')
      expect(container).toHaveClass('overflow-y-auto')
    })
  })

  describe('Card Interaction', () => {
    it('calls onExecutionClick when card clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <RecentExecutions
          executions={mockExecutions}
          onExecutionClick={handleClick}
        />
      )

      await user.click(screen.getAllByTestId('execution-card')[0])
      expect(handleClick).toHaveBeenCalledWith('exec-1')
    })

    it('passes correct execution id to onExecutionClick', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <RecentExecutions
          executions={mockExecutions}
          onExecutionClick={handleClick}
        />
      )

      await user.click(screen.getAllByTestId('execution-card')[1])
      expect(handleClick).toHaveBeenCalledWith('exec-2')
    })

    it('cards are interactive when onExecutionClick provided', () => {
      render(
        <RecentExecutions
          executions={mockExecutions}
          onExecutionClick={() => {}}
        />
      )
      const cards = screen.getAllByTestId('execution-card')
      cards.forEach((card) => {
        expect(card).toHaveClass('cursor-pointer')
      })
    })

    it('cards are not interactive when no onExecutionClick', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const cards = screen.getAllByTestId('execution-card')
      cards.forEach((card) => {
        expect(card).not.toHaveClass('cursor-pointer')
      })
    })
  })

  describe('Max Executions', () => {
    it('limits displayed executions to maxExecutions prop', () => {
      const manyExecutions = Array.from({ length: 10 }, (_, i) => ({
        id: `exec-${i}`,
        name: `Execution ${i}`,
        status: 'running' as const,
        statusInfo: `Running · ${i * 10}%`,
        progress: i * 10,
        testsTotal: 10,
        testsDone: 10,
      }))

      render(<RecentExecutions executions={manyExecutions} maxExecutions={3} />)
      expect(screen.getAllByTestId('execution-card')).toHaveLength(3)
    })

    it('displays all executions when fewer than maxExecutions', () => {
      render(
        <RecentExecutions executions={mockExecutions} maxExecutions={10} />
      )
      expect(screen.getAllByTestId('execution-card')).toHaveLength(3)
    })

    it('shows "View All" link when executions truncated', () => {
      const manyExecutions = Array.from({ length: 10 }, (_, i) => ({
        id: `exec-${i}`,
        name: `Execution ${i}`,
        status: 'running' as const,
        statusInfo: `Running · ${i * 10}%`,
        progress: i * 10,
        testsTotal: 10,
        testsDone: 10,
      }))

      render(<RecentExecutions executions={manyExecutions} maxExecutions={3} />)
      expect(screen.getByText('View All')).toBeInTheDocument()
    })

    it('does not show "View All" when all executions displayed', () => {
      render(
        <RecentExecutions executions={mockExecutions} maxExecutions={10} />
      )
      expect(screen.queryByText('View All')).not.toBeInTheDocument()
    })

    it('calls onViewAll when View All clicked', async () => {
      const user = userEvent.setup()
      const handleViewAll = vi.fn()
      const manyExecutions = Array.from({ length: 10 }, (_, i) => ({
        id: `exec-${i}`,
        name: `Execution ${i}`,
        status: 'running' as const,
        statusInfo: `Running · ${i * 10}%`,
        progress: i * 10,
        testsTotal: 10,
        testsDone: 10,
      }))

      render(
        <RecentExecutions
          executions={manyExecutions}
          maxExecutions={3}
          onViewAll={handleViewAll}
        />
      )

      await user.click(screen.getByText('View All'))
      expect(handleViewAll).toHaveBeenCalledTimes(1)
    })

    it('View All shows remaining count', () => {
      const manyExecutions = Array.from({ length: 10 }, (_, i) => ({
        id: `exec-${i}`,
        name: `Execution ${i}`,
        status: 'running' as const,
        statusInfo: `Running · ${i * 10}%`,
        progress: i * 10,
        testsTotal: 10,
        testsDone: 10,
      }))

      render(<RecentExecutions executions={manyExecutions} maxExecutions={3} />)
      // View All button exists
      expect(screen.getByText('View All')).toBeInTheDocument()
      // Remaining count is displayed as sibling text
      expect(screen.getByText(/\(7 more\)/)).toBeInTheDocument()
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(
        <RecentExecutions
          executions={mockExecutions}
          className="custom-class"
        />
      )
      expect(screen.getByTestId('recent-executions-section')).toHaveClass(
        'custom-class'
      )
    })

    it('merges className with base classes', () => {
      render(
        <RecentExecutions
          executions={mockExecutions}
          className="custom-class"
        />
      )
      const section = screen.getByTestId('recent-executions-section')
      // Section has flex layout classes, card class is on internal div
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('custom-class')
      // Verify card class is on internal card element
      expect(section.querySelector('.card')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('section has region role', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(screen.getByRole('region')).toBeInTheDocument()
    })

    it('section has accessible name from header', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      expect(
        screen.getByRole('region', { name: 'Recent Executions' })
      ).toBeInTheDocument()
    })

    it('empty state is announced to screen readers', () => {
      render(<RecentExecutions executions={[]} />)
      const emptyState = screen.getByTestId('empty-state-title')
      expect(emptyState.tagName.toLowerCase()).toBe('output')
    })

    it('list has accessible name', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const list = screen
        .getByTestId('recent-executions-section')
        .querySelector('[data-executions-list]')
      expect(list).toHaveAttribute('aria-label', 'Recent execution list')
    })
  })

  describe('Transitions', () => {
    it('applies transition for content changes', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      // Transition class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('transition-opacity')
    })

    it('respects reduced-motion preference', () => {
      render(<RecentExecutions executions={mockExecutions} />)
      const section = screen.getByTestId('recent-executions-section')
      // Motion-reduce class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('motion-reduce:transition-none')
    })
  })

  describe('Status Filtering', () => {
    it('can filter to show only running executions', () => {
      const mixedExecutions = [
        ...mockExecutions,
        {
          id: 'exec-4',
          name: 'Completed Test',
          status: 'passed' as const,
          statusInfo: 'Passed · 2m 34s',
          progress: 100,
          testsTotal: 15,
          testsDone: 15,
        },
      ]

      render(
        <RecentExecutions
          executions={mixedExecutions}
          filterStatus={['running', 'paused']}
        />
      )

      // Should show only running and paused executions (3 from mockExecutions)
      expect(screen.getAllByTestId('execution-card')).toHaveLength(3)
    })

    it('shows all executions when no filter provided', () => {
      const mixedExecutions = [
        ...mockExecutions,
        {
          id: 'exec-4',
          name: 'Completed Test',
          status: 'passed' as const,
          statusInfo: 'Passed · 2m 34s',
          progress: 100,
          testsTotal: 15,
          testsDone: 15,
        },
      ]

      render(<RecentExecutions executions={mixedExecutions} />)
      expect(screen.getAllByTestId('execution-card')).toHaveLength(4)
    })
  })
})
