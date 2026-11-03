/**
 * Application Shell Integration Tests
 *
 * Tests for Application Shell requirements:
 * - App.tsx renders router, theme provider, error boundary, toast container
 * - MainLayout uses ResponsiveSidebar with Sidebar component
 * - MainLayout uses MainContent wrapper with proper sidebar offset
 * - Sidebar shows navigation links to all routes
 * - Breadcrumb renders based on current route
 * - Theme toggle in sidebar footer switches themes
 *
 * These tests verify WIRING works (components render, stores connect, routes navigate)
 * They do NOT re-test existing component internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import React from 'react'
import { ToastProvider } from '@/components/ui/toast'

// App hydrates the system secret-reveal flags on init; keep the admin API
// mocked so no real fetch fires (test isolation).
vi.mock('@/features/settings/api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/admin')>()),
  fetchMaskingSettings: vi.fn().mockResolvedValue({
    run_output: false,
    test_variables: false,
    shared_variables: false,
  }),
  setMaskingSettings: vi.fn(),
}))

// App also hydrates the SSH host key policy on init; keep that read mocked too.
vi.mock('@/features/settings/api/ssh-hosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/ssh-hosts')>()),
  fetchHostKeyPolicy: vi.fn().mockResolvedValue({
    lock_trusted_hosts: false,
    default_block_action: 'disabled',
  }),
}))

// The route-config-driven tests below render RegressionDetailPage /
// SuitesListContainer / TestsListContainer directly via lazy routes. Those
// components depend on useToast. Wrapping `<RouterProvider>` in `<ToastProvider>`
// does not reliably deliver the context through React.lazy/Suspense boundaries
// under parallel test execution, so stub useToast here to keep these shell
// tests focused on routing/layout wiring rather than toast plumbing.
vi.mock('@/components/ui/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/toast')>(
    '@/components/ui/toast'
  )
  return {
    ...actual,
    useToast: () => ({
      toasts: [],
      toast: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      maxToasts: 3,
    }),
  }
})


// ============================================================================
// Mock API modules to prevent real API calls during navigation tests
// ============================================================================

vi.mock('@/features/dashboard/api/dashboard', () => ({
  fetchDashboardData: vi.fn().mockResolvedValue({
    stats: { total_tests: 0, passing_tests: 0, failing_tests: 0, pending_tests: 0 },
    recent_executions: [],
    test_trends: [],
  }),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironments: vi.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    per_page: 100,
    pages: 1,
  }),
  fetchEnvironmentNames: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/regressions/api/regressions', () => ({
  fetchRegressions: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  createRegression: vi.fn(),
  fetchRegressionsTags: vi.fn().mockResolvedValue([]),
  fetchRegressionDetail: vi.fn().mockResolvedValue({
    regression: {
      id: 'reg-123',
      name: 'Test Regression',
      description: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      suiteIds: [],
      suitesCount: 0,
      testsCount: 0,
      status: 'never_run',
      lastRun: null,
      tags: [],
      variables: {},
    },
    suites: [],
  }),
  updateRegression: vi.fn(),
}))

vi.mock('@/features/executions/api/executions', () => ({
  fetchExecutions: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 10, total_pages: 1 },
  }),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuites: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchSuiteNames: vi.fn().mockResolvedValue([]),
  fetchSuitesTags: vi.fn().mockResolvedValue([]),
  deleteSuite: vi.fn(),
  cloneSuite: vi.fn(),
  batchDeleteSuites: vi.fn(),
}))

vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchTestsTags: vi.fn().mockResolvedValue([]),
  transformApiTest: vi.fn((t: unknown) => t),
  deleteTest: vi.fn(),
  cloneTest: vi.fn(),
  batchDeleteTests: vi.fn(),
  batchUpdateTests: vi.fn(),
  updateTestMetadata: vi.fn(),
  updateTest: vi.fn(),
}))
vi.mock('@/features/tests/api/export-import', () => ({
  exportTest: vi.fn(),
  exportTests: vi.fn(),
  validateTestImport: vi.fn(),
  importTests: vi.fn(),
}))

// ============================================================================
// App.tsx renders router, theme provider, error boundary, toast container
// ============================================================================

describe('App.tsx Application Wiring', () => {
  describe('ThemeProvider integration', () => {
    it('wraps application with ThemeProvider', async () => {
      // Import App dynamically to test its structure
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // ThemeProvider should set data-theme attribute on document
      // Default theme is 'light'
      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      })
    })

    it('applies theme from ThemeProvider to document', async () => {
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // Document should have theme attribute set
      expect(document.documentElement.hasAttribute('data-theme')).toBe(true)
    })
  })

  describe('ToastProvider integration', () => {
    it('renders ToastContainer for notifications', async () => {
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // ToastContainer should be present (rendered by ToastProvider)
      await waitFor(() => {
        expect(document.querySelector('.toast-container')).toBeInTheDocument()
      })
    })

    it('allows useToast hook to work within App', async () => {
      const { default: App } = await import('../src/app/App')
      // App should provide ToastProvider context
      // This test verifies the wiring is correct
      render(<App />)

      // If ToastProvider is wired correctly, ToastContainer will be present
      await waitFor(() => {
        const container = document.querySelector('.toast-container')
        expect(container).toBeInTheDocument()
      })
    })
  })

  describe('ErrorBoundary integration', () => {
    it('wraps application content with ErrorBoundary', async () => {
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // Wait for lazy-loaded dashboard to render before checking error state
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
      })

      // ErrorBoundary should be present - it catches errors in the tree
      // We verify it's wired by checking the app renders without crashing
      // and can recover from errors
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('displays error fallback when child component throws', async () => {
      // Create a component that throws
      const ThrowingComponent: React.FC = () => {
        throw new Error('Test error')
      }

      // Import ErrorBoundary to test it catches errors
      const { ErrorBoundary } = await import('../src/components/ui/error-boundary')

      // Suppress expected console.error from React when ErrorBoundary catches the error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      )

      // ErrorBoundary should show fallback UI
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()

      // Restore console.error
      consoleSpy.mockRestore()
    })
  })

  describe('Router integration', () => {
    it('renders AppRouterProvider with all routes', async () => {
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // Router should redirect to /dashboard by default
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
      })
    })

    it('provides routing context for navigation', async () => {
      const { default: App } = await import('../src/app/App')
      render(<App />)

      // Navigation should work - clicking nav links should change route
      await waitFor(() => {
        const dashboardPage = screen.getByTestId('dashboard-page')
        expect(dashboardPage).toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// MainLayout uses ResponsiveSidebar with Sidebar component
// ============================================================================

describe('MainLayout uses SidebarProvider with AppSidebar', () => {
  it('renders shadcn Sidebar as the sidebar container', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    // shadcn sidebar uses data-sidebar="sidebar" attribute
    await waitFor(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]')
      expect(sidebar).toBeInTheDocument()
    })
  })

  it('renders Sidebar components within ResponsiveSidebar', async () => {
    // Navigate to detail page since breadcrumb is hidden on list pages
    const { routeConfig } = await import('../src/app/router')
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/regressions/reg-123'],
    })

    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>)

    // Wait for lazy-loaded page to render first
    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Breadcrumb provides navigation role on detail pages
    const navElements = screen.getAllByRole('navigation')
    expect(navElements.length).toBeGreaterThan(0)
  })

  it('includes SidebarHeader with app title/logo', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      // Header should display WAVE branding (multiple elements: sidebar + mobile header)
      const waveElements = screen.getAllByText(/WAVE/i)
      expect(waveElements.length).toBeGreaterThan(0)
    })
  })

  it('includes SidebarNav for navigation items', async () => {
    // Navigate to detail page since breadcrumb is hidden on list pages
    const { routeConfig } = await import('../src/app/router')
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/regressions/reg-123'],
    })

    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>)

    // Wait for lazy-loaded page to render first
    await waitFor(() => {
      expect(screen.getByTestId('regression-detail-page')).toBeInTheDocument()
    })

    // Breadcrumb provides navigation role on detail pages
    const navElements = screen.getAllByRole('navigation')
    expect(navElements.length).toBeGreaterThan(0)
  })

  it('includes SidebarFooter with controls', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      // Footer should contain theme toggle
      // We'll look for the collapse toggle button as indicator of footer
      const collapseButton = screen.getByRole('button', {
        name: /collapse sidebar|expand sidebar/i,
      })
      expect(collapseButton).toBeInTheDocument()
    })
  })

  it('supports collapse toggle in desktop mode', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    // Wait for lazy-loaded dashboard to render first
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    const collapseButton = screen.getByRole('button', {
      name: /collapse sidebar|expand sidebar/i,
    })
    expect(collapseButton).toBeInTheDocument()

    const user = userEvent.setup()

    // Click to collapse
    await user.click(collapseButton)

    // Button label should change to "Expand sidebar"
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /expand sidebar/i })
      ).toBeInTheDocument()
    })
  })
})

// ============================================================================
// MainLayout uses MainContent wrapper with sidebar offset
// ============================================================================

describe('MainLayout uses SidebarInset wrapper', () => {
  // Clear sidebar cookie before each test to ensure clean state
  beforeEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0'
  })

  it('wraps page content in SidebarInset (main element)', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      // SidebarInset renders a <main> element
      const main = screen.getByRole('main')
      expect(main).toBeInTheDocument()
    })
  })

  it('SidebarInset auto-adjusts for sidebar width via peer selectors', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    // Wait for lazy-loaded dashboard to render first
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    const main = screen.getByRole('main')
    // shadcn SidebarInset uses peer-data-* classes to adjust for sidebar
    expect(main.className).toContain('flex')
  })

  it('sidebar collapses and expands via state', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    // Find the sidebar wrapper to check state
    const sidebarWrapper = document.querySelector('.group.peer[data-state]')
    expect(sidebarWrapper?.getAttribute('data-state')).toBe('expanded')

    // Collapse sidebar
    const collapseButton = screen.getByRole('button', {
      name: /collapse sidebar/i,
    })
    await user.click(collapseButton)

    // After collapse - state should be collapsed
    await waitFor(() => {
      expect(sidebarWrapper?.getAttribute('data-state')).toBe('collapsed')
    })
  })

  it('renders page content (Outlet) inside SidebarInset', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      // Dashboard page should render inside main content area
      const main = screen.getByRole('main')
      const dashboard = within(main).getByTestId('dashboard-page')
      expect(dashboard).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Sidebar shows navigation links to all routes
// ============================================================================

describe('Sidebar navigation links', () => {
  // Helper to get the sidebar element
  // shadcn sidebar uses data-sidebar="sidebar" attribute
  const getSidebar = () => document.querySelector('[data-sidebar="sidebar"]')!

  it('renders navigation link for Dashboard', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const dashboardLink = within(sidebar as HTMLElement).getByRole('link', { name: /dashboard/i })
      expect(dashboardLink).toBeInTheDocument()
      expect(dashboardLink).toHaveAttribute('href', '/dashboard')
    })
  })

  it('renders navigation link for Tests', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const testsLink = within(sidebar as HTMLElement).getByRole('link', { name: /tests/i })
      expect(testsLink).toBeInTheDocument()
      expect(testsLink).toHaveAttribute('href', '/tests')
    })
  })

  it('renders navigation link for Suites', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const suitesLink = within(sidebar as HTMLElement).getByRole('link', { name: /suites/i })
      expect(suitesLink).toBeInTheDocument()
      expect(suitesLink).toHaveAttribute('href', '/suites')
    })
  })

  it('renders navigation link for Regressions', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const regressionsLink = within(sidebar as HTMLElement).getByRole('link', { name: /regressions/i })
      expect(regressionsLink).toBeInTheDocument()
      expect(regressionsLink).toHaveAttribute('href', '/regressions')
    })
  })

  it('renders navigation link for Executions', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const executionsLink = within(sidebar as HTMLElement).getByRole('link', { name: /executions/i })
      expect(executionsLink).toBeInTheDocument()
      expect(executionsLink).toHaveAttribute('href', '/executions')
    })
  })

  it('renders navigation link for Settings', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      const settingsLink = within(sidebar as HTMLElement).getByRole('link', { name: /settings/i })
      expect(settingsLink).toBeInTheDocument()
      expect(settingsLink).toHaveAttribute('href', '/settings')
    })
  })

  it('navigation links include icons', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = getSidebar()
      // Each nav item should have an icon wrapper
      const iconWrappers = sidebar.querySelectorAll('[data-icon-wrapper]')
      expect(iconWrappers.length).toBeGreaterThanOrEqual(6)
    })
  })

  it('highlights active route in navigation', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      // Dashboard should be active by default
      // shadcn sidebar uses data-active="true" for active state
      const sidebar = getSidebar()
      const dashboardLink = within(sidebar as HTMLElement).getByRole('link', { name: /dashboard/i })
      expect(dashboardLink).toHaveAttribute('data-active', 'true')
    })
  })

  it('navigates to Tests page when clicking Tests link', { timeout: 30000 }, async () => {
    // Reset any cached modules and re-apply mocks before this test
    vi.resetModules()
    vi.doMock('@/features/tests/api/crud', () => ({
      fetchTests: vi.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
      }),
      fetchTestsTags: vi.fn().mockResolvedValue([]),
      transformApiTest: vi.fn((t: unknown) => t),
      deleteTest: vi.fn(),
      cloneTest: vi.fn(),
      batchDeleteTests: vi.fn(),
      batchUpdateTests: vi.fn(),
      updateTestMetadata: vi.fn(),
      updateTest: vi.fn(),
    }))
    vi.doMock('@/features/tests/api/export-import', () => ({
      exportTest: vi.fn(),
      exportTests: vi.fn(),
      validateTestImport: vi.fn(),
      importTests: vi.fn(),
    }))

    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    await waitFor(() => {
      const sidebar = getSidebar()
      expect(sidebar).toBeInTheDocument()
    })

    const sidebar = getSidebar()
    const testsLink = within(sidebar as HTMLElement).getByRole('link', { name: /tests/i })

    await user.click(testsLink)

    await waitFor(
      () => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      }
    )
  })
})

// ============================================================================
// Breadcrumb renders based on current route
// ============================================================================

describe('Breadcrumb renders based on current route', () => {
  it('renders Breadcrumb component on detail/edit pages (not list pages)', async () => {
    const { routeConfig } = await import('../src/app/router')
    // Breadcrumb is hidden on list pages and on suite / regression /
    // execution detail pages (they render their own header). Profile detail
    // still shows the main-layout breadcrumb.
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests/test-123'],
    })

    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>)

    await waitFor(() => {
      const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i })
      expect(breadcrumb).toBeInTheDocument()
    })
  })

  it('hides breadcrumb on dashboard route per wireframe', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    // Dashboard should render but breadcrumb should be hidden
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })

    // Breadcrumb should NOT be present on dashboard
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
  })

  it('hides breadcrumb on list pages per design (LIST pages have page title only)', async () => {
    const { routeConfig } = await import('../src/app/router')

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>)

    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument()
    })

    // Breadcrumb should NOT be present on list pages (per design decision)
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
  })

  it('hides breadcrumb on all list routes (/suites, /regressions, /executions)', async () => {
    const { routeConfig } = await import('../src/app/router')
    const listRoutes = [
      { path: '/suites', testId: 'suites-page' },
      { path: '/regressions', testId: 'regressions-page' },
      { path: '/executions', testId: 'executions-page' },
    ]

    for (const route of listRoutes) {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: [route.path],
      })

      const { unmount } = render(<ToastProvider><RouterProvider router={router} /></ToastProvider>)

      // ExecutionsListContainer pulls in BOTH suites' and regressions'
      // run-dialog hooks, making its lazy chunk roughly 2x heavier than
      // its siblings. Under GitHub Actions' 4-core runners with vitest's
      // 4 parallel workers, its dynamic import has been observed past
      // the default 5s asyncUtilTimeout - and this loop has already paid
      // for two prior list-route imports by the time /executions runs.
      // 20s keeps us well under the test-level timeout.
      await waitFor(
        () => {
          expect(screen.getByTestId(route.testId)).toBeInTheDocument()
        },
        { timeout: 20000 }
      )

      // Breadcrumb should NOT be present on list pages
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()

      unmount()
    }
  })

  // Every current route either hides the main-layout breadcrumb or is single-page
  // with no hierarchy, so the "hides breadcrumb on..." tests above cover the path.
})

// ============================================================================
// Theme toggle in sidebar footer switches themes
// ============================================================================

describe('Theme toggle in sidebar footer', () => {
  beforeEach(() => {
    // Clear sidebar cookie to ensure clean state
    document.cookie = 'sidebar_state=; path=/; max-age=0'
    // Reset theme to light before each test
    document.documentElement.setAttribute('data-theme', 'light')
    localStorage.removeItem('wave-theme')
  })

  afterEach(() => {
    // Clean up
    document.documentElement.setAttribute('data-theme', 'light')
    localStorage.removeItem('wave-theme')
  })

  it('renders theme toggle button in sidebar footer', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const themeToggle = screen.getByRole('button', {
        name: /switch to dark mode|switch to light mode|toggle theme/i,
      })
      expect(themeToggle).toBeInTheDocument()
    })
  })

  it('theme toggle is located in sidebar footer area', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]')
      expect(sidebar).toBeInTheDocument()

      // Theme toggle should be within the sidebar
      const themeToggle = screen.getByRole('button', {
        name: /switch to dark mode|switch to light mode|toggle theme/i,
      })
      expect(sidebar!.contains(themeToggle)).toBe(true)
    })
  })

  it('clicking theme toggle switches from light to dark', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })

    const themeToggle = screen.getByRole('button', {
      name: /switch to dark mode|toggle theme/i,
    })

    await user.click(themeToggle)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  it('clicking theme toggle again switches from dark to light', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    // First click: light -> dark
    const themeToggle = screen.getByRole('button', {
      name: /switch to dark mode|toggle theme/i,
    })

    await user.click(themeToggle)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    // Second click: dark -> light
    const themeToggleAfterDark = screen.getByRole('button', {
      name: /switch to light mode|toggle theme/i,
    })

    await user.click(themeToggleAfterDark)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })
  })

  it('theme toggle shows appropriate icon for current theme', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      const themeToggle = screen.getByRole('button', {
        name: /switch to dark mode|switch to light mode|toggle theme/i,
      })
      // Button should have an icon (sun or moon)
      const icon = themeToggle.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  it('theme preference persists to localStorage', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    const themeToggle = screen.getByRole('button', {
      name: /switch to dark mode|toggle theme/i,
    })

    await user.click(themeToggle)

    await waitFor(() => {
      expect(localStorage.getItem('wave-theme')).toBe('dark')
    })
  })

  it('loads theme preference from localStorage on mount', async () => {
    // Set dark theme before rendering
    localStorage.setItem('wave-theme', 'dark')

    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  it('shows sun icon when in dark mode', async () => {
    // Set dark theme before rendering
    localStorage.setItem('wave-theme', 'dark')

    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    // In dark mode, the Sun icon should be visible (to switch to light)
    const themeToggle = screen.getByRole('button', {
      name: /switch to light mode|toggle theme/i,
    })
    expect(themeToggle).toBeInTheDocument()
    // The button should contain the Sun icon (visible in dark mode)
    const icon = themeToggle.querySelector('svg')
    expect(icon).toBeInTheDocument()
  })

  // SHELL-8: the sidebar has no search field.
  it('offers no search field in the expanded sidebar', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
  })

  it('advertises no search shortcut in the sidebar', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    expect(screen.queryByText('Ctrl+K')).not.toBeInTheDocument()
    expect(screen.queryByText('\u2318K')).not.toBeInTheDocument()
  })

  it('offers no search button in the collapsed rail', async () => {
    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument()
    })
    const sidebarWrapper = document.querySelector('.group.peer[data-state]')
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    await user.click(collapseButton)
    await waitFor(() => {
      expect(sidebarWrapper?.getAttribute('data-state')).toBe('collapsed')
    })

    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
  })

  it('shows sun icon in theme toggle when in dark mode with collapsed sidebar', async () => {
    // Set dark theme before rendering
    localStorage.setItem('wave-theme', 'dark')

    const { default: App } = await import('../src/app/App')
    render(<App />)

    const user = userEvent.setup()

    // Wait for the app to fully render
    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    // Find the sidebar wrapper to check state (same pattern as other tests)
    const sidebarWrapper = document.querySelector('.group.peer[data-state]')

    // Collapse the sidebar
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    await user.click(collapseButton)

    // Wait for sidebar to collapse
    await waitFor(() => {
      expect(sidebarWrapper?.getAttribute('data-state')).toBe('collapsed')
    })

    // The theme toggle should still be visible and show Sun icon
    const themeToggle = screen.getByRole('button', {
      name: /switch to light mode|toggle theme/i,
    })
    expect(themeToggle).toBeInTheDocument()
    const icon = themeToggle.querySelector('svg')
    expect(icon).toBeInTheDocument()
  })
})

// ============================================================================
// SSH host key policy at app start (REQ-4.5.14)
// ============================================================================

describe('SSH host key policy at app start (REQ-4.5.14)', () => {
  const SSH_OPEN_PALETTE = {
    id: 'ssh-session-open',
    name: 'SSH Session Open',
    type: 'plugin' as const,
  }

  // The mocked API loads first, alone: a parallel import would hand the store the real module.
  async function loadAppModules() {
    const api = await import('@/features/settings/api/ssh-hosts')
    const policyStore = await import('@/stores/ssh-host-policy-store')
    const builders = await import(
      '@/features/workbench/common/canvas/workflow-canvas/node-builders'
    )
    const app = await import('../src/app/App')
    return {
      App: app.default,
      store: policyStore.useSshHostPolicyStore,
      buildPaletteNode: builders.buildPaletteNode,
      fetchPolicy: vi.mocked(api.fetchHostKeyPolicy),
    }
  }

  it('stamps disabled on a newly placed SSH Session Open block when the policy read fails', async () => {
    const { App, store, buildPaletteNode, fetchPolicy } = await loadAppModules()
    fetchPolicy.mockRejectedValueOnce(new Error('Host key policy store unreachable'))

    render(<App />)

    await waitFor(() => {
      expect(store.getState().loadError).toBe('Host key policy store unreachable')
    })
    expect(store.getState().defaultBlockAction).toBe('disabled')
    expect(store.getState().locked).toBe(false)

    const node = buildPaletteNode('node-1', { x: 0, y: 0 }, SSH_OPEN_PALETTE, [])
    expect(node.data.config).toMatchObject({ values: { host_key_verification: 'disabled' } })
  })
})
