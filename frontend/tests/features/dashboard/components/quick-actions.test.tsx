/**
 * QuickActions Section Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard Quick Actions section
 *
 * Tests for QuickActions component per design decisions and wireframes:
 * - DASH-3: Quick Actions section with common workflows
 *
 * Section contains:
 * - "Quick Actions" header
 * - 3 action cards: New Test, Run Regression, View Reports
 *
 * Component: frontend/src/components/dashboard/quick-actions.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickActions } from '@/features/dashboard/components/quick-actions'

describe('QuickActions Section', () => {
  describe('Basic Rendering', () => {
    it('renders section container', () => {
      render(<QuickActions />)
      expect(screen.getByTestId('quick-actions-section')).toBeInTheDocument()
    })

    it('renders section header', () => {
      render(<QuickActions />)
      expect(screen.getByText('Quick Actions')).toBeInTheDocument()
    })

    it('header is an h2 element', () => {
      render(<QuickActions />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Quick Actions'
      )
    })
  })

  describe('Default Actions (Populated State)', () => {
    it('renders New Test action', () => {
      render(<QuickActions />)
      expect(screen.getByTestId('quick-action-new-test')).toBeInTheDocument()
    })

    it('New Test action has correct content', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-new-test')
      expect(action).toHaveTextContent(/New Test/i)
      expect(action).toHaveTextContent(/Create/i)
    })

    it('renders Run Regression action', () => {
      render(<QuickActions />)
      expect(
        screen.getByTestId('quick-action-run-regression')
      ).toBeInTheDocument()
    })

    it('Run Regression action has correct content', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-run-regression')
      expect(action).toHaveTextContent(/Run Regression/i)
      expect(action).toHaveTextContent(/Execute/i)
    })

    it('renders View Reports action', () => {
      render(<QuickActions />)
      expect(
        screen.getByTestId('quick-action-view-reports')
      ).toBeInTheDocument()
    })

    it('View Reports action has correct content', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-view-reports')
      expect(action).toHaveTextContent(/View Reports/i)
      expect(action).toHaveTextContent(/Analyze/i)
    })

    it('renders exactly 3 action cards in populated state', () => {
      render(<QuickActions />)
      const actions = screen.getAllByTestId(/^quick-action-/)
      expect(actions).toHaveLength(3)
    })

  })

  describe('Section Styling', () => {
    it('section has flex layout', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('flex-col')
    })

    it('card element has card styling', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('card')
    })

    it('card element has rounded corners', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('rounded-lg')
    })

    it('card element has border', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('border')
    })

    it('card element has card background', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('bg-card')
    })

    it('card element has no outer padding', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      const card = section.querySelector('.card')
      expect(card).toHaveClass('p-0')
    })
  })

  describe('Header Styling', () => {
    it('header is outside card as h2 element', () => {
      render(<QuickActions />)
      const header = screen.getByText('Quick Actions')
      expect(header.tagName).toBe('H2')
    })

    it('header has font-medium weight', () => {
      render(<QuickActions />)
      const header = screen.getByText('Quick Actions')
      expect(header).toHaveClass('font-medium')
    })

    it('header has base text size', () => {
      render(<QuickActions />)
      const header = screen.getByText('Quick Actions')
      expect(header).toHaveClass('text-base')
    })
  })

  describe('Grid Layout', () => {
    it('actions container has grid layout', () => {
      render(<QuickActions />)
      const container = screen
        .getByTestId('quick-actions-section')
        .querySelector('[data-actions-grid]')
      expect(container).toHaveClass('grid')
    })

    it('grid has responsive columns for 3 actions', () => {
      render(<QuickActions />)
      const container = screen
        .getByTestId('quick-actions-section')
        .querySelector('[data-actions-grid]')
      expect(container).toHaveClass('grid-cols-1')
      expect(container).toHaveClass('sm:grid-cols-3')
    })

    it('grid has gap between cards', () => {
      render(<QuickActions />)
      const container = screen
        .getByTestId('quick-actions-section')
        .querySelector('[data-actions-grid]')
      expect(container).toHaveClass('gap-4')
    })

    it('grid container has padding', () => {
      render(<QuickActions />)
      const container = screen
        .getByTestId('quick-actions-section')
        .querySelector('[data-actions-grid]')
      expect(container).toHaveClass('p-4')
    })
  })

  describe('Action Handlers', () => {
    it('calls onNewTest when New Test clicked', async () => {
      const user = userEvent.setup()
      const handleNewTest = vi.fn()

      render(<QuickActions onNewTest={handleNewTest} />)
      await user.click(screen.getByTestId('quick-action-new-test'))

      expect(handleNewTest).toHaveBeenCalledTimes(1)
    })

    it('calls onRunRegression when Run Regression clicked', async () => {
      const user = userEvent.setup()
      const handleRunRegression = vi.fn()

      render(<QuickActions onRunRegression={handleRunRegression} />)
      await user.click(screen.getByTestId('quick-action-run-regression'))

      expect(handleRunRegression).toHaveBeenCalledTimes(1)
    })

    it('calls onViewReports when View Reports clicked', async () => {
      const user = userEvent.setup()
      const handleViewReports = vi.fn()

      render(<QuickActions onViewReports={handleViewReports} />)
      await user.click(screen.getByTestId('quick-action-view-reports'))

      expect(handleViewReports).toHaveBeenCalledTimes(1)
    })

    it('handles click on New Test without callback (fallback)', async () => {
      const user = userEvent.setup()
      render(<QuickActions />)
      // Should not throw when clicking without a callback
      const button = screen.getByTestId('quick-action-new-test')
      await user.click(button)
      expect(button).toBeInTheDocument()
    })

    it('handles click on Run Regression without callback (fallback)', async () => {
      const user = userEvent.setup()
      render(<QuickActions />)
      const button = screen.getByTestId('quick-action-run-regression')
      await user.click(button)
      expect(button).toBeInTheDocument()
    })

    it('handles click on View Reports without callback (fallback)', async () => {
      const user = userEvent.setup()
      render(<QuickActions />)
      const button = screen.getByTestId('quick-action-view-reports')
      await user.click(button)
      expect(button).toBeInTheDocument()
    })

  })

  describe('Action Icons', () => {
    it('New Test has plus icon', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-new-test')
      const icon = action.querySelector('[data-action-icon]')
      expect(icon).toHaveAttribute('data-icon-name', 'plus')
    })

    it('Run Regression has play icon', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-run-regression')
      const icon = action.querySelector('[data-action-icon]')
      expect(icon).toHaveAttribute('data-icon-name', 'play')
    })

    it('View Reports has bar-chart icon', () => {
      render(<QuickActions />)
      const action = screen.getByTestId('quick-action-view-reports')
      const icon = action.querySelector('[data-action-icon]')
      expect(icon).toHaveAttribute('data-icon-name', 'bar-chart')
    })

  })

  describe('Action Order', () => {
    it('actions are in expected order: New Test, Run Regression, View Reports', () => {
      render(<QuickActions />)
      const actions = screen.getAllByTestId(/^quick-action-/)
      expect(actions[0]).toHaveAttribute('data-testid', 'quick-action-new-test')
      expect(actions[1]).toHaveAttribute(
        'data-testid',
        'quick-action-run-regression'
      )
      expect(actions[2]).toHaveAttribute(
        'data-testid',
        'quick-action-view-reports'
      )
    })

  })

  describe('Loading State', () => {
    it('renders skeletons when loading', () => {
      render(<QuickActions loading />)
      const skeletons = screen
        .getByTestId('quick-actions-section')
        .querySelectorAll('[data-skeleton]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('renders expected number of skeleton cards', () => {
      render(<QuickActions loading />)
      const skeletons = screen
        .getByTestId('quick-actions-section')
        .querySelectorAll('[data-skeleton-card]')
      expect(skeletons).toHaveLength(3)
    })

    it('hides action cards when loading', () => {
      render(<QuickActions loading />)
      expect(screen.queryAllByTestId(/^quick-action-/)).toHaveLength(0)
    })

    it('sets aria-busy on container when loading', () => {
      render(<QuickActions loading />)
      expect(screen.getByTestId('quick-actions-section')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<QuickActions className="custom-class" />)
      expect(screen.getByTestId('quick-actions-section')).toHaveClass(
        'custom-class'
      )
    })

    it('merges className with base classes', () => {
      render(<QuickActions className="custom-class" />)
      const section = screen.getByTestId('quick-actions-section')
      // Section has flex layout classes, card class is on internal div
      expect(section).toHaveClass('flex')
      expect(section).toHaveClass('custom-class')
      // Verify card class is on internal card element
      expect(section.querySelector('.card')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('section has region role', () => {
      render(<QuickActions />)
      expect(screen.getByRole('region')).toBeInTheDocument()
    })

    it('section has accessible name from header', () => {
      render(<QuickActions />)
      expect(
        screen.getByRole('region', { name: 'Quick Actions' })
      ).toBeInTheDocument()
    })

    it('all action cards are buttons', () => {
      render(<QuickActions />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(3)
    })

    it('action cards have accessible names', () => {
      render(<QuickActions />)
      expect(
        screen.getByRole('button', { name: /New Test/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Run Regression/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /View Reports/i })
      ).toBeInTheDocument()
    })
  })

  describe('Transitions', () => {
    it('applies transition for content changes', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      // Transition class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('transition-opacity')
    })

    it('respects reduced-motion preference', () => {
      render(<QuickActions />)
      const section = screen.getByTestId('quick-actions-section')
      // Motion-reduce class is on the card element inside the section
      const card = section.querySelector('.card')
      expect(card).toHaveClass('motion-reduce:transition-none')
    })
  })

  describe('Disabled Actions', () => {
    it('can disable specific actions', () => {
      render(<QuickActions disabledActions={['run-regression']} />)
      const action = screen.getByTestId('quick-action-run-regression')
      expect(action).toHaveAttribute('aria-disabled', 'true')
    })

    it('disabled actions have reduced opacity', () => {
      render(<QuickActions disabledActions={['run-regression']} />)
      const action = screen.getByTestId('quick-action-run-regression')
      expect(action).toHaveClass('opacity-50')
    })

    it('disabled actions are not clickable', async () => {
      const user = userEvent.setup()
      const handleRunRegression = vi.fn()

      render(
        <QuickActions
          onRunRegression={handleRunRegression}
          disabledActions={['run-regression']}
        />
      )
      await user.click(screen.getByTestId('quick-action-run-regression'))

      expect(handleRunRegression).not.toHaveBeenCalled()
    })

    it('multiple actions can be disabled', () => {
      render(
        <QuickActions disabledActions={['run-regression', 'view-reports']} />
      )
      expect(
        screen.getByTestId('quick-action-run-regression')
      ).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByTestId('quick-action-view-reports')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
  })
})
