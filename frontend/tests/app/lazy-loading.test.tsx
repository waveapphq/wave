/**
 * Route-Based Lazy Loading Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests route-based code splitting and lazy loading functionality, ensuring
 * route components are loaded on demand with proper loading states and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { routeConfig } from '../../src/app/router'
import { RouteLoadingFallback, RouteErrorBoundary } from '../../src/app/route-boundaries'
import { preloadMockSpies, navigationPatternSpies } from '../setup'

// Lazy-loaded route containers depend on useToast. These tests render routes
// via RouterProvider directly, bypassing the App-level ToastProvider wiring.
// Stub useToast so the tests stay focused on routing/lazy-loading, not toast.
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

// Mock all API modules to prevent real backend calls
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
}))

vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchTestsTags: vi.fn().mockResolvedValue([]),
  fetchTest: vi.fn().mockResolvedValue({ id: 'test-123', name: 'Test', variables: {}, metadata: {} }),
  fetchTestWorkflow: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
}))
vi.mock('@/features/tests/api/export-import', () => ({
  exportTest: vi.fn().mockResolvedValue(new Blob()),
  exportTests: vi.fn().mockResolvedValue(new Blob()),
  validateTestImport: vi.fn().mockResolvedValue({ tests: [], total: 0, importable: 0, blocked: 0 }),
  importTests: vi.fn().mockResolvedValue({ imported: [], skipped: [], fixes_applied: [], total_imported: 0, total_skipped: 0 }),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuitesList: vi.fn().mockResolvedValue({
    success: true,
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchSuiteNames: vi.fn().mockResolvedValue([]),
  fetchSuitesTags: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/executions/api/executions', () => ({
  fetchExecutions: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
}))

describe('Route-Based Lazy Loading', () => {
  // Use fake timers to prevent memory accumulation from setTimeout
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    // Only run pending timers if we're using fake timers
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    }
  })
  describe('Lazy Route Components', () => {
    it('shows loading fallback while route loads', async () => {
      // Create a slow-loading mock component
      const SlowComponent = lazy(
        () =>
          new Promise<{ default: React.ComponentType }>((resolve) =>
            setTimeout(() => resolve({ default: () => <div>Loaded Content</div> }), 100)
          )
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <Suspense fallback={<RouteLoadingFallback />}>
              <SlowComponent />
            </Suspense>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Should show loading fallback initially
      expect(screen.getByTestId('route-loading')).toBeInTheDocument()

      // Advance timers to resolve the lazy component
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      // Then show loaded content
      expect(screen.getByText('Loaded Content')).toBeInTheDocument()
    })

    it('renders loaded component after lazy load completes', async () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => <div>Lazy Content</div> })
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <Suspense fallback={<RouteLoadingFallback />}>
              <LazyComponent />
            </Suspense>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByText('Lazy Content')).toBeInTheDocument()
    })

    it('caches lazy loaded components for subsequent visits', async () => {
      let loadCount = 0
      const TrackedLazyComponent = lazy(() => {
        loadCount++
        return Promise.resolve({ default: () => <div>Tracked Component</div> })
      })

      const testRoutes = [
        {
          path: '/',
          element: <div>Home</div>,
        },
        {
          path: '/lazy',
          element: (
            <Suspense fallback={<RouteLoadingFallback />}>
              <TrackedLazyComponent />
            </Suspense>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // First navigation
      await act(async () => {
        router.navigate('/lazy')
        await Promise.resolve()
      })
      expect(screen.getByText('Tracked Component')).toBeInTheDocument()
      expect(loadCount).toBe(1)

      // Navigate away
      await act(async () => {
        router.navigate('/')
        await Promise.resolve()
      })
      expect(screen.getByText('Home')).toBeInTheDocument()

      // Navigate back - should use cached component
      await act(async () => {
        router.navigate('/lazy')
        await Promise.resolve()
      })
      expect(screen.getByText('Tracked Component')).toBeInTheDocument()
      // Load count should still be 1 (component was cached)
      expect(loadCount).toBe(1)
    })
  })

  describe('RouteLoadingFallback Component', () => {
    it('renders loading indicator', () => {
      render(<RouteLoadingFallback />)

      expect(screen.getByTestId('route-loading')).toBeInTheDocument()
    })

    it('displays loading message', () => {
      render(<RouteLoadingFallback />)

      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('applies correct styling for visual feedback', () => {
      render(<RouteLoadingFallback />)

      const loadingElement = screen.getByTestId('route-loading')
      expect(loadingElement).toHaveClass('route-loading')
    })

    it('includes animated spinner', () => {
      render(<RouteLoadingFallback />)

      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    })

    it('spinner uses 1000ms rotation duration per design system', () => {
      render(<RouteLoadingFallback />)

      const spinner = screen.getByTestId('loading-spinner')
      const computedStyle = window.getComputedStyle(spinner)

      // Design system specifies 1000ms for spinner rotation
      expect(computedStyle.animationDuration).toBe('1000ms')
    })

    it('spinner uses linear timing function for continuous rotation', () => {
      render(<RouteLoadingFallback />)

      const spinner = screen.getByTestId('loading-spinner')
      const computedStyle = window.getComputedStyle(spinner)

      // Continuous rotation should use linear timing
      expect(computedStyle.animationTimingFunction).toBe('linear')
    })

    it('spinner animation iterates infinitely', () => {
      render(<RouteLoadingFallback />)

      const spinner = screen.getByTestId('loading-spinner')
      const computedStyle = window.getComputedStyle(spinner)

      expect(computedStyle.animationIterationCount).toBe('infinite')
    })

    it('spinner uses rotate animation', () => {
      render(<RouteLoadingFallback />)

      const spinner = screen.getByTestId('loading-spinner')
      const computedStyle = window.getComputedStyle(spinner)

      // Should use a spin/rotate animation
      expect(computedStyle.animationName).toMatch(/spin|rotate/)
    })

    it('loading container is centered', () => {
      render(<RouteLoadingFallback />)

      const container = screen.getByTestId('route-loading')
      const computedStyle = window.getComputedStyle(container)

      // Should use flexbox centering
      expect(computedStyle.display).toBe('flex')
      expect(computedStyle.justifyContent).toBe('center')
      expect(computedStyle.alignItems).toBe('center')
    })

    it('applies fade-in animation for smooth appearance', () => {
      render(<RouteLoadingFallback />)

      const container = screen.getByTestId('route-loading')
      const computedStyle = window.getComputedStyle(container)

      // Should have opacity transition or fade animation
      expect(
        computedStyle.animation.includes('fade') ||
          computedStyle.transitionProperty.includes('opacity')
      ).toBe(true)
    })

    it('handles missing matchMedia gracefully', () => {
      // Store original matchMedia
      const originalMatchMedia = window.matchMedia

      // Make matchMedia not a function (simulates older browsers)
      Object.defineProperty(window, 'matchMedia', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      // Should render without errors
      render(<RouteLoadingFallback />)
      expect(screen.getByTestId('route-loading')).toBeInTheDocument()

      // Restore original matchMedia
      Object.defineProperty(window, 'matchMedia', {
        value: originalMatchMedia,
        writable: true,
        configurable: true,
      })
    })

    it('handles SSR mode gracefully', async () => {
      // Reset modules and mock SSR to return true
      vi.resetModules()
      vi.doMock('../../src/lib/ssr', () => ({
        isSSR: () => true,
        getWindowLocationHash: () => '',
      }))

      // Dynamically import after mock is set up
      const { RouteLoadingFallback: SSRLoadingFallback } = await import(
        '../../src/app/route-boundaries'
      )

      // Should render without errors even in "SSR mode"
      // The component will use reduced motion (isSSR returns true -> prefersReducedMotion returns false)
      render(<SSRLoadingFallback />)
      expect(screen.getByTestId('route-loading')).toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('../../src/lib/ssr')
    })
  })

  describe('RouteErrorBoundary Component', () => {
    // Suppress console.error for error boundary tests
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('renders children when no error', () => {
      render(
        <RouteErrorBoundary>
          <div>Normal Content</div>
        </RouteErrorBoundary>
      )

      expect(screen.getByText('Normal Content')).toBeInTheDocument()
    })

    it('catches and displays route loading errors', async () => {
      const FailingComponent = lazy(() =>
        Promise.reject(new Error('Failed to load module'))
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingComponent />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises to trigger error
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('provides retry functionality on error', async () => {
      // Use real timers for userEvent
      vi.useRealTimers()
      const user = userEvent.setup()
      let shouldFail = true
      const ConditionalComponent = lazy(() => {
        if (shouldFail) {
          shouldFail = false
          return Promise.reject(new Error('Temporary failure'))
        }
        return Promise.resolve({ default: () => <div>Success</div> })
      })

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ConditionalComponent />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      })

      // Click retry
      await user.click(screen.getByRole('button', { name: /retry/i }))

      // Should now show success
      await waitFor(() => {
        expect(screen.getByText('Success')).toBeInTheDocument()
      })
    })

    it('clears a caught error when the route path changes', async () => {
      function Boom(): never {
        throw new Error('Name "m1" already exists in this scope')
      }

      function Harness({ pathname }: Readonly<{ pathname: string }>) {
        return (
          <RouteErrorBoundary pathname={pathname}>
            {pathname === '/workbench' ? <Boom /> : <div>Dashboard Content</div>}
          </RouteErrorBoundary>
        )
      }

      const { rerender } = render(<Harness pathname="/workbench" />)

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Navigating away is the escape hatch: the boundary must stop showing a
      // previous route's error instead of stranding the user on the fallback.
      rerender(<Harness pathname="/dashboard" />)

      await waitFor(() => {
        expect(screen.getByText('Dashboard Content')).toBeInTheDocument()
      })
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    })

    it('keeps the error visible while the route path is unchanged', () => {
      function Boom(): never {
        throw new Error('boom')
      }

      const { rerender } = render(
        <RouteErrorBoundary pathname="/workbench">
          <Boom />
        </RouteErrorBoundary>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      rerender(
        <RouteErrorBoundary pathname="/workbench">
          <Boom />
        </RouteErrorBoundary>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('handles retry gracefully with non-element children', async () => {
      // Use real timers for userEvent
      vi.useRealTimers()
      const user = userEvent.setup()
      const FailingComponent = lazy(() =>
        Promise.reject(new Error('Always fails'))
      )

      // This route has mixed children: text nodes, nulls, and elements
      // When retry is clicked, resetLazyComponentCache is called with children
      // that include non-React-elements (strings, nulls, numbers)
      // This tests the !React.isValidElement early return branch
      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              {/* Text node - not a React element */}
              Some text before
              {/* Null child */}
              {null}
              {/* Number child */}
              {42}
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingComponent />
              </Suspense>
              {/* Another text node */}
              Some text after
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      })

      // Click retry - this triggers resetLazyComponentCache which receives
      // the mixed children array. React.isValidElement(array) returns false,
      // triggering the early return on line 152
      // The retry button should be clickable without errors
      await user.click(screen.getByRole('button', { name: /retry/i }))

      // After retry attempt, error state may be shown again (since component always fails)
      // The important thing is that no exception was thrown during retry
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })
    })

    it('shows helpful error message', async () => {
      const FailingComponent = lazy(() =>
        Promise.reject(new Error('Network error'))
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingComponent />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises to trigger error
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })

    it('provides link to go back to dashboard', async () => {
      const FailingComponent = lazy(() =>
        Promise.reject(new Error('Failed to load'))
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingComponent />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises to trigger error
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    })
  })

  describe('Preloading Route Components', () => {
    it('preloads route on link hover', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const preloadFn = vi.fn()

      const PreloadableLink = ({
        to,
        children,
        preload,
      }: {
        to: string
        children: React.ReactNode
        preload: () => void
      }) => (
        <a
          href={to}
          onMouseEnter={preload}
          onFocus={preload}
          onClick={(e) => e.preventDefault()}
        >
          {children}
        </a>
      )

      render(
        <PreloadableLink to="/tests" preload={preloadFn}>
          View Tests
        </PreloadableLink>
      )

      await user.hover(screen.getByRole('link'))

      expect(preloadFn).toHaveBeenCalled()
    })

    it('preloads route on link focus', () => {
      const preloadFn = vi.fn()

      const PreloadableLink = ({
        to,
        children,
        preload,
      }: {
        to: string
        children: React.ReactNode
        preload: () => void
      }) => (
        <a
          href={to}
          onMouseEnter={preload}
          onFocus={preload}
          onClick={(e) => e.preventDefault()}
        >
          {children}
        </a>
      )

      render(
        <PreloadableLink to="/tests" preload={preloadFn}>
          View Tests
        </PreloadableLink>
      )

      screen.getByRole('link').focus()

      expect(preloadFn).toHaveBeenCalled()
    })
  })

  describe('Predictive Preloading', () => {
    it('preloads detail page when on list page', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      // When on list page, detail page component should be preloaded
      expect(preloadMockSpies.preloadDetailPage).toHaveBeenCalledWith('test-detail')
    })

    it('preloads edit page when viewing detail page', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-123'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      // When on detail page, edit page component should be preloaded
      expect(preloadMockSpies.preloadEditPage).toHaveBeenCalledWith('test-edit')
    })

    it('preloads likely next routes based on navigation patterns', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Navigate to record pattern
      await act(async () => {
        router.navigate('/tests')
        await Promise.resolve()
      })

      expect(navigationPatternSpies.registerPattern).toHaveBeenCalledWith('/dashboard', '/tests')

      // Should suggest preloading based on learned patterns
      expect(navigationPatternSpies.getPreloadSuggestions).toHaveBeenCalledWith('/tests')
    })

    it('preloads execution live view when viewing execution detail', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions/exec-123'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      // Live view is commonly accessed from detail page
      expect(preloadMockSpies.preloadLivePage).toHaveBeenCalledWith('execution-live')
    })

    it('does not preload unrelated routes', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      // Settings page shouldn't trigger preloading of test/suite pages
      expect(preloadMockSpies.preloadRoute).not.toHaveBeenCalledWith(expect.stringMatching(/tests|suites/))
    })

    it('respects preload priority based on likelihood', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises
      await act(async () => {
        await Promise.resolve()
      })

      // High priority for detail pages when on list
      expect(preloadMockSpies.preloadWithPriority).toHaveBeenCalledWith('test-detail', 'high')
      // Lower priority for less likely routes
      expect(preloadMockSpies.preloadWithPriority).toHaveBeenCalledWith('test-create', 'low')
    })
  })

  describe('Code Splitting Verification', () => {
    it('tests page is a separate chunk', async () => {
      // Use real timers for lazy loading with waitFor
      vi.useRealTimers()
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests'],
      })

      render(<RouterProvider router={router} />)

      // Wait for lazy-loaded component to render (longer timeout for CI containers)
      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('suites page is a separate chunk', async () => {
      // Use real timers for lazy loading with waitFor
      vi.useRealTimers()
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites'],
      })

      render(<RouterProvider router={router} />)

      // Wait for lazy-loaded component to render (longer timeout for CI containers)
      await waitFor(() => {
        expect(screen.getByTestId('suites-page')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('executions page is a separate chunk', async () => {
      // Use real timers for lazy loading with waitFor
      vi.useRealTimers()
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions'],
      })

      render(<RouterProvider router={router} />)

      // ExecutionsListContainer pulls in BOTH suites' and regressions'
      // run-dialog hooks, making its lazy chunk roughly 2x heavier than
      // any other list route. Under GitHub Actions' 4-core runners with
      // vitest's 4 parallel workers the dynamic import has been observed
      // past the default 5s asyncUtilTimeout. 20s keeps us well under
      // the 30s test timeout while absorbing CI CPU contention.
      await waitFor(
        () => {
          expect(screen.getByTestId('executions-page')).toBeInTheDocument()
        },
        { timeout: 20000 }
      )
    })

    // Settings page chunk test removed - lazy loading causes test pollution.
    // SettingsContainer is fully tested in its own test file.
  })

  describe('Loading States During Navigation', () => {
    it('shows loading indicator during route transition', async () => {
      const SlowTestsPage = lazy(
        () =>
          new Promise<{ default: React.ComponentType }>((resolve) =>
            setTimeout(
              () => resolve({ default: () => <div>Tests Page</div> }),
              50
            )
          )
      )

      const testRoutes = [
        {
          path: '/',
          element: <Outlet />,
          children: [
            { path: 'dashboard', element: <div>Dashboard</div> },
            {
              path: 'tests',
              element: (
                <Suspense fallback={<RouteLoadingFallback />}>
                  <SlowTestsPage />
                </Suspense>
              ),
            },
          ],
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // On dashboard initially
      expect(screen.getByText('Dashboard')).toBeInTheDocument()

      // Navigate to tests
      act(() => {
        router.navigate('/tests')
      })

      // Should show loading
      expect(screen.getByTestId('route-loading')).toBeInTheDocument()

      // Advance timers to resolve the lazy component
      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      // Then show tests page
      expect(screen.getByText('Tests Page')).toBeInTheDocument()
    })

    it('maintains layout during route loading', async () => {
      const SlowPage = lazy(
        () =>
          new Promise<{ default: React.ComponentType }>((resolve) =>
            setTimeout(
              () => resolve({ default: () => <div>Slow Content</div> }),
              50
            )
          )
      )

      const Layout = ({ children }: { children: React.ReactNode }) => (
        <div>
          <nav data-testid="layout-nav">Navigation</nav>
          <main data-testid="layout-main">{children}</main>
        </div>
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <Layout>
              <Outlet />
            </Layout>
          ),
          children: [
            { path: 'dashboard', element: <div>Dashboard</div> },
            {
              path: 'slow',
              element: (
                <Suspense fallback={<RouteLoadingFallback />}>
                  <SlowPage />
                </Suspense>
              ),
            },
          ],
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Navigate to slow page
      act(() => {
        router.navigate('/slow')
      })

      // Layout should remain visible during loading
      expect(screen.getByTestId('layout-nav')).toBeInTheDocument()
      expect(screen.getByTestId('layout-main')).toBeInTheDocument()

      // Advance timers to complete the lazy load (prevents act warning)
      await act(async () => {
        vi.advanceTimersByTime(50)
      })
    })
  })

  describe('Network Error Recovery', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('handles chunk load failure gracefully', async () => {
      const FailingChunk = lazy(() =>
        Promise.reject(new Error('ChunkLoadError: Loading chunk failed'))
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingChunk />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises to trigger error
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })

    it('suggests page refresh on persistent load failure', async () => {
      const FailingChunk = lazy(() =>
        Promise.reject(new Error('Network error'))
      )

      const testRoutes = [
        {
          path: '/',
          element: (
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <FailingChunk />
              </Suspense>
            </RouteErrorBoundary>
          ),
        },
      ]

      const router = createMemoryRouter(testRoutes, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      // Flush promises to trigger error
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText(/try refreshing/i)).toBeInTheDocument()
    })
  })
})
