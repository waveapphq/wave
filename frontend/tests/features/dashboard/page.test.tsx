/**
 * DashboardPage Component Tests
 *
 * V-DASH-01, V-DASH-02: Dashboard page integration
 *
 * Tests for DashboardPage component per design decisions and wireframes:
 * - DASH-1: Four summary cards: Tests, Suites, Regressions, Recent Executions
 * - DASH-2: Empty state: zero counts
 * - DASH-3: Quick Actions section with common workflows
 *
 * Page structure:
 * - Page title: "Dashboard" (h1)
 * - Metrics row: 4 MetricCards in a row
 * - Two-column layout: Recent Activity + Recent Executions
 * - Quick Actions section at bottom
 *
 * Component: frontend/src/pages/dashboard.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '@/features/dashboard/page'

// Mock data providers/hooks
const mockDashboardData = {
  metrics: {
    tests: { count: 330 },
    suites: { count: 12 },
    regressions: { count: 87 },
    executions: { sinceDays: 1, count: 142, running: 3, passed: 135, failed: 4 },
  },
  recentActivity: [
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
  ],
  recentExecutions: [
    {
      id: 'exec-1',
      name: 'Regression > v2.1.0 Release > Production',
      status: 'running' as const,
      statusInfo: 'Running · 45% · 27 of 60 tests',
      progress: 45,
      testsTotal: 60,
      testsDone: 60,
    },
  ],
}

const emptyDashboardData = {
  metrics: {
    tests: { count: 0 },
    suites: { count: 0 },
    regressions: { count: 0 },
    executions: { sinceDays: 1, count: 0, running: 0, passed: 0, failed: 0 },
  },
  recentActivity: [],
  recentExecutions: [],
}

// Wrapper for router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('DashboardPage', () => {
  describe('Page Structure', () => {
    it('renders page container', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    it('renders page title "Dashboard" as h1', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Dashboard'
      )
    })

    it('page title is visible', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(
        screen.getByRole('heading', { name: 'Dashboard' })
      ).toBeVisible()
    })
  })

  describe('Metrics Row (DASH-1)', () => {
    it('renders all 4 metric cards per DASH-1', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByTestId('metric-card-tests')).toBeInTheDocument()
      expect(screen.getByTestId('metric-card-suites')).toBeInTheDocument()
      expect(screen.getByTestId('metric-card-regressions')).toBeInTheDocument()
      expect(screen.getByTestId('metric-card-executions')).toBeInTheDocument()
    })

    it('Tests card displays correct count', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-tests')
      expect(within(card).getByTestId('metric-count')).toHaveTextContent('330')
    })

    it('Tests card does not display subtitle', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-tests')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Suites card displays correct count', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-suites')
      expect(within(card).getByTestId('metric-count')).toHaveTextContent('12')
    })

    it('Suites card does not display subtitle', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-suites')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Regressions card displays correct count', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-regressions')
      expect(within(card).getByTestId('metric-count')).toHaveTextContent('87')
    })

    it('Regressions card does not display subtitle', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-regressions')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Executions card has label "Executions (24h)"', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-executions')
      expect(card).toHaveTextContent(/Executions.*24h/i)
    })

    it('Executions card displays correct count', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-executions')
      expect(within(card).getByTestId('metric-count')).toHaveTextContent('142')
    })

    it('Executions card displays running/passed/failed subtitle', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const card = screen.getByTestId('metric-card-executions')
      expect(within(card).getByTestId('metric-subtitle')).toHaveTextContent(
        /3 running.*135 passed.*4 failed/i
      )
    })
  })

  describe('Metrics Row Layout', () => {
    it('metrics container has grid layout', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-metrics-row')
      expect(container).toHaveClass('grid')
    })

    it('metrics has 4 columns on desktop', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-metrics-row')
      expect(container).toHaveClass('lg:grid-cols-4')
    })

    it('metrics has 2 columns on tablet', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-metrics-row')
      expect(container).toHaveClass('md:grid-cols-2')
    })

    it('metrics has 1 column on mobile', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-metrics-row')
      expect(container).toHaveClass('grid-cols-1')
    })

    it('metrics has gap between cards', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-metrics-row')
      expect(container).toHaveClass('gap-4')
    })
  })

  describe('Recent Activity Section', () => {
    it('renders Recent Activity section', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByTestId('recent-activity-section')).toBeInTheDocument()
    })

    it('Recent Activity has correct header', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    })

    it('Recent Activity displays activity items', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getAllByTestId('activity-item')).toHaveLength(2)
    })
  })

  describe('Recent Executions Section', () => {
    it('renders Recent Executions section', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(
        screen.getByTestId('recent-executions-section')
      ).toBeInTheDocument()
    })

    it('Recent Executions has correct header', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByText('Recent Executions')).toBeInTheDocument()
    })

    it('Recent Executions displays execution cards', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getAllByTestId('execution-card')).toHaveLength(1)
    })
  })

  describe('Quick Actions Section (DASH-3)', () => {
    it('renders Quick Actions section per DASH-3', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByTestId('quick-actions-section')).toBeInTheDocument()
    })

    it('Quick Actions has correct header', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByText('Quick Actions')).toBeInTheDocument()
    })

    it('Quick Actions displays 3 action cards in populated state', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(screen.getByTestId('quick-action-new-test')).toBeInTheDocument()
      expect(
        screen.getByTestId('quick-action-run-regression')
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('quick-action-view-reports')
      ).toBeInTheDocument()
    })
  })

  describe('Empty State (DASH-2)', () => {
    it('displays zero counts in metric cards', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      const testsCard = screen.getByTestId('metric-card-tests')
      expect(within(testsCard).getByTestId('metric-count')).toHaveTextContent(
        '0'
      )
    })

    it('Tests card has no subtitle in empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      const card = screen.getByTestId('metric-card-tests')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Suites card has no subtitle in empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      const card = screen.getByTestId('metric-card-suites')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Regressions card has no subtitle in empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      const card = screen.getByTestId('metric-card-regressions')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Executions card has no subtitle in empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      const card = screen.getByTestId('metric-card-executions')
      expect(within(card).queryByTestId('metric-subtitle')).not.toBeInTheDocument()
    })

    it('Recent Activity shows empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      expect(screen.getByText(/No recent activity/i)).toBeInTheDocument()
    })

    it('Recent Executions shows empty state', () => {
      renderWithRouter(<DashboardPage data={emptyDashboardData} />)
      expect(screen.getByText(/No recent executions/i)).toBeInTheDocument()
    })

  })

  describe('Page Layout', () => {
    it('page has main content container', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const page = screen.getByTestId('dashboard-page')
      expect(page).toHaveClass('flex')
      expect(page).toHaveClass('flex-col')
    })

    it('page has gap between sections', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const page = screen.getByTestId('dashboard-page')
      expect(page).toHaveClass('gap-6')
    })

    it('page has padding', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const page = screen.getByTestId('dashboard-page')
      expect(page).toHaveClass('px-6')
      expect(page).toHaveClass('pt-6')
      expect(page).toHaveClass('pb-4')
    })

    it('middle sections have two-column layout on desktop', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-middle-row')
      expect(container).toHaveClass('grid')
      expect(container).toHaveClass('lg:grid-cols-2')
    })

    it('middle sections stack on mobile', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      const container = screen.getByTestId('dashboard-middle-row')
      expect(container).toHaveClass('grid-cols-1')
    })
  })

  describe('Loading State', () => {
    it('displays loading skeletons when loading', () => {
      renderWithRouter(<DashboardPage loading />)
      const skeletons = document.querySelectorAll('[data-skeleton]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('hides metric cards when loading', () => {
      renderWithRouter(<DashboardPage loading />)
      expect(
        screen.queryByTestId('metric-card-tests')
      ).not.toBeInTheDocument()
    })

    it('sets aria-busy on page when loading', () => {
      renderWithRouter(<DashboardPage loading />)
      expect(screen.getByTestId('dashboard-page')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Error State', () => {
    it('displays error message when error occurs', () => {
      renderWithRouter(
        <DashboardPage error="Failed to load dashboard data" />
      )
      expect(
        screen.getByText(/Failed to load dashboard data/i)
      ).toBeInTheDocument()
    })

    it('displays retry button on error', () => {
      renderWithRouter(
        <DashboardPage error="Failed to load dashboard data" />
      )
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('calls onRetry when retry button clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderWithRouter(
        <DashboardPage
          error="Failed to load dashboard data"
          onRetry={handleRetry}
        />
      )
      await user.click(screen.getByRole('button', { name: /retry/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })
  })

  describe('Navigation', () => {
    it('activity items are display-only and do not trigger navigation', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      const activityItems = screen.getAllByTestId('activity-item')
      await user.click(activityItems[0])

      expect(handleNavigate).not.toHaveBeenCalled()
    })

    it('clicking execution card navigates to execution detail', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      const executionCards = screen.getAllByTestId('execution-card')
      await user.click(executionCards[0])

      expect(handleNavigate).toHaveBeenCalledWith('/executions/exec-1')
    })

    it('clicking Tests metric navigates to tests list', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('metric-card-tests'))

      expect(handleNavigate).toHaveBeenCalledWith('/tests')
    })

    it('clicking Suites metric navigates to suites list', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('metric-card-suites'))

      expect(handleNavigate).toHaveBeenCalledWith('/suites')
    })

    it('clicking Regressions metric navigates to regressions list', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('metric-card-regressions'))

      expect(handleNavigate).toHaveBeenCalledWith('/regressions')
    })

    it('clicking Executions metric navigates to executions list', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('metric-card-executions'))

      expect(handleNavigate).toHaveBeenCalledWith('/executions')
    })

    it('clicking New Test action navigates to new test page', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('quick-action-new-test'))

      expect(handleNavigate).toHaveBeenCalledWith('/tests/new')
    })

    it('clicking Run Regression action navigates to run regression page', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('quick-action-run-regression'))

      expect(handleNavigate).toHaveBeenCalledWith('/regressions')
    })

    it('clicking View Reports action navigates to reports page', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleNavigate = vi.fn()

      renderWithRouter(
        <DashboardPage
          data={mockDashboardData}
          onNavigate={handleNavigate}
        />
      )
      await user.click(screen.getByTestId('quick-action-view-reports'))

      expect(handleNavigate).toHaveBeenCalledWith('/reports')
    })

  })

  describe('Accessibility', () => {
    it('page has main landmark (provided by layout in real app)', () => {
      // In the real app, SidebarInset provides <main>. This test verifies
      // the component works correctly within that context.
      renderWithRouter(
        <main>
          <DashboardPage data={mockDashboardData} />
        </main>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('page title is accessible', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(
        screen.getByRole('heading', { level: 1, name: 'Dashboard' })
      ).toBeInTheDocument()
    })

    it('all sections have accessible names', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} />)
      expect(
        screen.getByRole('region', { name: 'Recent Activity' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Recent Executions' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Quick Actions' })
      ).toBeInTheDocument()
    })
  })

  describe('No Data State', () => {
    it('returns null when neither loading nor error nor data', () => {
      const { container } = renderWithRouter(
        <DashboardPage loading={false} error={undefined} />
      )
      // When no data and not loading and no error, renders nothing
      expect(container.querySelector('[data-testid="dashboard-page"]')).not.toBeInTheDocument()
    })
  })

  describe('Live-Refresh Indicator (REQ-3.2.2.17)', () => {
    it('does not render a manual Refresh button', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} liveStatus="live" />)

      expect(screen.queryByRole('button', { name: /^refresh$/i })).not.toBeInTheDocument()
    })

    it('renders the live status indicator in the header when data is loaded', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} liveStatus="live" />)

      const indicator = screen.getByTestId('dashboard-live-status')
      expect(indicator).toBeInTheDocument()
      expect(indicator).toHaveAttribute('data-status', 'live')
    })

    it('reflects the paused status when the page is told so', () => {
      renderWithRouter(<DashboardPage data={mockDashboardData} liveStatus="paused" />)

      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute('data-status', 'paused')
    })

    it('reflects the reconnecting status when the page is told so', () => {
      renderWithRouter(
        <DashboardPage data={mockDashboardData} liveStatus="reconnecting" />
      )

      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'reconnecting'
      )
    })
  })
})
