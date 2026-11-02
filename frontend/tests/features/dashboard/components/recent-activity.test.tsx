/**
 * RecentActivity Section Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard Recent Activity section
 *
 * Tests for RecentActivity component per design decisions and wireframes:
 * - Section header: "Recent Activity"
 * - List of activity items with type icon, name, context, timestamp
 * - Empty state: "No recent activity" / "Create your first test to get started"
 *
 * Component: frontend/src/components/dashboard/recent-activity.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentActivity } from '@/features/dashboard/components/recent-activity'

describe('RecentActivity Section', () => {
  const mockActivities = [
    {
      id: '1',
      type: 'test' as const,
      name: 'Login Flow Test',
      context: 'Test · Auth Suite · 2 hours ago',
      status: 'passed' as const,
    },
    {
      id: '2',
      type: 'suite' as const,
      name: 'Auth Suite',
      context: 'Suite · 5 tests · 3 hours ago',
      status: 'failed' as const,
    },
    {
      id: '3',
      type: 'regression' as const,
      name: 'v2.1.0 Release',
      context: 'Regression · 12 suites · 1 day ago',
      status: 'passed' as const,
    },
  ]

  describe('Basic Rendering', () => {
    it('renders section container', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByTestId('recent-activity-section')).toBeInTheDocument()
    })

    it('renders section header', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    })

    it('header is an h2 element', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Recent Activity'
      )
    })
  })

  describe('Activity List', () => {
    it('renders all activity items', () => {
      render(<RecentActivity activities={mockActivities} />)
      const items = screen.getAllByTestId('activity-item')
      expect(items).toHaveLength(3)
    })

    it('renders activity names', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByText('Login Flow Test')).toBeInTheDocument()
      expect(screen.getByText('Auth Suite')).toBeInTheDocument()
      expect(screen.getByText('v2.1.0 Release')).toBeInTheDocument()
    })

    it('renders activity context', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(
        screen.getByText('Test · Auth Suite · 2 hours ago')
      ).toBeInTheDocument()
    })

    it('renders activity icons based on type', () => {
      render(<RecentActivity activities={mockActivities} />)
      const icons = screen.getAllByTestId('activity-icon')
      expect(icons[0]).toHaveAttribute('data-icon-name', 'test-tube-2')
      expect(icons[1]).toHaveAttribute('data-icon-name', 'folder-kanban')
      expect(icons[2]).toHaveAttribute('data-icon-name', 'git-branch')
    })

    it('renders activities in provided order', () => {
      render(<RecentActivity activities={mockActivities} />)
      const items = screen.getAllByTestId('activity-item')
      expect(within(items[0]).getByText('Login Flow Test')).toBeInTheDocument()
      expect(within(items[1]).getByText('Auth Suite')).toBeInTheDocument()
      expect(within(items[2]).getByText('v2.1.0 Release')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('renders empty state when no activities', () => {
      render(<RecentActivity activities={[]} />)
      expect(screen.getByTestId('empty-state-title')).toBeInTheDocument()
    })

    it('displays "No recent activity" title', () => {
      render(<RecentActivity activities={[]} />)
      expect(screen.getByTestId('empty-state-title')).toHaveTextContent(
        'No recent activity'
      )
    })

    it('displays helpful description', () => {
      render(<RecentActivity activities={[]} />)
      expect(screen.getByTestId('empty-state-description')).toHaveTextContent(
        'Create your first test to get started'
      )
    })

    it('does not render activity items in empty state', () => {
      render(<RecentActivity activities={[]} />)
      expect(screen.queryAllByTestId('activity-item')).toHaveLength(0)
    })

    it('still renders section header in empty state', () => {
      render(<RecentActivity activities={[]} />)
      expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('renders skeletons when loading', () => {
      render(<RecentActivity activities={[]} loading />)
      const skeletons = screen
        .getByTestId('recent-activity-section')
        .querySelectorAll('[data-skeleton]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('renders expected number of skeleton items', () => {
      render(<RecentActivity activities={[]} loading />)
      const skeletons = screen
        .getByTestId('recent-activity-section')
        .querySelectorAll('[data-skeleton-item]')
      // Should show 3-5 skeleton items
      expect(skeletons.length).toBeGreaterThanOrEqual(3)
      expect(skeletons.length).toBeLessThanOrEqual(5)
    })

    it('hides activity items when loading', () => {
      render(<RecentActivity activities={mockActivities} loading />)
      expect(screen.queryAllByTestId('activity-item')).toHaveLength(0)
    })

    it('hides empty state when loading', () => {
      render(<RecentActivity activities={[]} loading />)
      expect(screen.queryByTestId('empty-state-title')).not.toBeInTheDocument()
    })

    it('sets aria-busy on container when loading', () => {
      render(<RecentActivity activities={[]} loading />)
      expect(screen.getByTestId('recent-activity-section')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Section Styling', () => {
    it('section has flex layout', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('flex-col')
    })

    it('card element has card styling', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('card')
    })

    it('card element has rounded corners', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('rounded-lg')
    })

    it('card element has border', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('border')
    })

    it('card element has card background', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('bg-card')
    })

    it('card element has no padding (items handle their own)', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('p-0')
    })
  })

  describe('Header Styling', () => {
    it('header is outside card as h2 element', () => {
      render(<RecentActivity activities={mockActivities} />)
      const header = screen.getByText('Recent Activity')
      expect(header.tagName).toBe('H2')
    })

    it('header has font-medium weight', () => {
      render(<RecentActivity activities={mockActivities} />)
      const header = screen.getByText('Recent Activity')
      expect(header).toHaveClass('font-medium')
    })

    it('header has base text size', () => {
      render(<RecentActivity activities={mockActivities} />)
      const header = screen.getByText('Recent Activity')
      expect(header).toHaveClass('text-base')
    })
  })

  describe('List Styling', () => {
    it('list has role="list"', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByRole('list')).toBeInTheDocument()
    })

    it('list items have dividers between them', () => {
      render(<RecentActivity activities={mockActivities} />)
      const list = screen.getByRole('list')
      expect(list).toHaveClass('divide-y')
    })

    it('list expands to fill available space', () => {
      render(<RecentActivity activities={mockActivities} />)
      const list = screen.getByRole('list')
      expect(list).toHaveClass('flex-1')
    })

    it('list has overflow-y-auto for scrolling', () => {
      render(<RecentActivity activities={mockActivities} />)
      const list = screen.getByRole('list')
      expect(list).toHaveClass('overflow-y-auto')
    })
  })

  describe('Item Interaction', () => {
    it('items are never interactive (display-only feed)', () => {
      render(<RecentActivity activities={mockActivities} />)
      const items = screen.getAllByTestId('activity-item')
      items.forEach((item) => {
        expect(item).not.toHaveClass('cursor-pointer')
        expect(item).not.toHaveAttribute('role', 'button')
        expect(item).not.toHaveAttribute('tabindex')
      })
    })

    it('clicking a row does not invoke any parent callback', async () => {
      const user = userEvent.setup()
      render(<RecentActivity activities={mockActivities} />)

      // No prop exists to receive the click; the behavior under test is that
      // user interaction yields no side effect, not even a silent handler.
      await user.click(screen.getAllByTestId('activity-item')[0])
      // Nothing to assert beyond "render did not throw"; the real coverage is
      // the absence of `role=button` / `cursor-pointer` / tabindex above.
      expect(screen.getAllByTestId('activity-item')).toHaveLength(3)
    })

    it('items keep a listitem role for accessibility', () => {
      render(<RecentActivity activities={mockActivities} />)
      const items = screen.getAllByTestId('activity-item')
      items.forEach((item) => {
        expect(item).toHaveAttribute('role', 'listitem')
      })
    })
  })

  describe('Max Items', () => {
    it('limits displayed items to maxItems prop', () => {
      const manyActivities = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        type: 'test' as const,
        name: `Test ${i}`,
        context: 'Test context',
      }))

      render(<RecentActivity activities={manyActivities} maxItems={5} />)
      expect(screen.getAllByTestId('activity-item')).toHaveLength(5)
    })

    it('displays all items when fewer than maxItems', () => {
      render(<RecentActivity activities={mockActivities} maxItems={10} />)
      expect(screen.getAllByTestId('activity-item')).toHaveLength(3)
    })

    it('shows "View All" link when items truncated', () => {
      const manyActivities = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        type: 'test' as const,
        name: `Test ${i}`,
        context: 'Test context',
      }))

      render(<RecentActivity activities={manyActivities} maxItems={5} />)
      expect(screen.getByText('View All')).toBeInTheDocument()
    })

    it('does not show "View All" when all items displayed', () => {
      render(<RecentActivity activities={mockActivities} maxItems={10} />)
      expect(screen.queryByText('View All')).not.toBeInTheDocument()
    })

    it('calls onViewAll when View All clicked', async () => {
      const user = userEvent.setup()
      const handleViewAll = vi.fn()
      const manyActivities = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        type: 'test' as const,
        name: `Test ${i}`,
        context: 'Test context',
      }))

      render(
        <RecentActivity
          activities={manyActivities}
          maxItems={5}
          onViewAll={handleViewAll}
        />
      )

      await user.click(screen.getByText('View All'))
      expect(handleViewAll).toHaveBeenCalledTimes(1)
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(
        <RecentActivity activities={mockActivities} className="custom-class" />
      )
      expect(screen.getByTestId('recent-activity-section')).toHaveClass(
        'custom-class'
      )
    })

    it('merges className with base classes', () => {
      render(
        <RecentActivity activities={mockActivities} className="custom-class" />
      )
      const section = screen.getByTestId('recent-activity-section')
      // Section has flex layout classes, card class is on internal div
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('custom-class')
      // Verify card class is on internal card element
      expect(section.querySelector('.card')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('section has region role', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(screen.getByRole('region')).toBeInTheDocument()
    })

    it('section has accessible name from header', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(
        screen.getByRole('region', { name: 'Recent Activity' })
      ).toBeInTheDocument()
    })

    it('empty state is announced to screen readers', () => {
      render(<RecentActivity activities={[]} />)
      const emptyState = screen.getByTestId('empty-state-title')
      expect(emptyState.tagName.toLowerCase()).toBe('output')
    })

    it('list has accessible name', () => {
      render(<RecentActivity activities={mockActivities} />)
      expect(
        screen.getByRole('list', { name: 'Recent activity items' })
      ).toBeInTheDocument()
    })
  })

  describe('Transitions', () => {
    it('applies transition for content changes', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      // Transition class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('transition-opacity')
    })

    it('respects reduced-motion preference', () => {
      render(<RecentActivity activities={mockActivities} />)
      const section = screen.getByTestId('recent-activity-section')
      // Motion-reduce class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('motion-reduce:transition-none')
    })
  })
})
