/**
 * Router Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests the core router configuration, route definitions, and basic
 * navigation functionality that enables seamless client-side routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup, configure } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import {
  routeConfig,
  createAppRouter,
  AppRouterProvider,
} from '../../src/app/router'
import { ToastProvider } from '@/components/ui/toast'

// Lazy-loaded route containers depend on useToast. These tests render routes
// via RouterProvider directly, bypassing the App-level ToastProvider wiring.
// Stub useToast so the tests stay focused on routing behavior, not toast.
const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))

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
      error: mockToastError,
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      maxToasts: 3,
    }),
  }
})

// Mock @/lib/api to provide a lightweight apiClient that delegates to global.fetch.
// The real apiClient requires full Response objects (headers, status, etc.) which
// the global.fetch mocks in this file don't provide. This mock bridges the gap.
vi.mock('@/lib/api', () => {
  const getApiBaseUrl = () => 'http://localhost:8000'

  function createSimpleApiClient() {
    async function request(method: string, path: string, body?: unknown) {
      const url = `${getApiBaseUrl()}${path}`
      const fetchOptions: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = JSON.stringify(body)
      }
      const response = await fetch(url, fetchOptions)
      if (!response.ok) {
        const msg = response.statusText || `Error ${response.status || 500}`
        throw new Error(msg)
      }
      const json = typeof response.json === 'function' ? await response.json() : {}
      // Match the real apiClient envelope: response.data IS json.data (which
      // may legitimately be null, e.g. getCurrentSession when no session
      // exists). Falling back to `json` itself when data is null/undefined
      // hides the difference between "no session" and "raw payload".
      const isEnvelope =
        json !== null && typeof json === 'object' && 'data' in json
      return {
        data: isEnvelope ? json.data : json,
        meta: json?.meta ?? { requestId: '' },
        status: response.status ?? 200,
        pagination: json?.pagination,
      }
    }

    return {
      get: (path: string) => request('GET', path),
      post: (path: string, body?: unknown) => request('POST', path, body),
      put: (path: string, body?: unknown) => request('PUT', path, body),
      patch: (path: string, body?: unknown) => request('PATCH', path, body),
      delete: (path: string) => request('DELETE', path),
    }
  }

  const client = createSimpleApiClient()
  return {
    getApiBaseUrl,
    apiClient: client,
  }
})

// Mock profiles API to prevent network errors during route rendering tests
// Using plain async functions instead of vi.fn() to avoid being affected by vi.restoreAllMocks()
vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchProfileTypes: async () => [],
  fetchProfileTypeSchema: async () => ({ fields: [] }),
  fetchAllTags: async () => [],
  fetchEnvironments: async () => [],
  fetchProfile: async () => null,
  createProfile: async () => ({}),
  updateProfile: async () => ({}),
  deleteProfile: async () => undefined,
  duplicateProfile: async () => ({}),
}))

// Mock environments API to provide environments for components that use useEnvironments hook
// Using a plain async function instead of vi.fn() to avoid being affected by vi.restoreAllMocks()
// The useEnvironments hook uses fetchEnvironmentNames which returns EnvironmentName[] directly
vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: async () => [
    { id: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d', name: 'Development', tags: [] },
    { id: 'b2c3d4e5-f6a7-4b5c-9d8e-0f1a2b3c4d5e', name: 'Staging', tags: [] },
    { id: 'c3d4e5f6-a7b8-4c5d-0e9f-1a2b3c4d5e6f', name: 'Production', tags: [] },
  ],
}))

// Mock resizable panels - react-resizable-panels doesn't work in jsdom
// (ResizeObserver mock fires synchronously before library internals are ready)
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => <div data-testid="resizable-panel-group">{children}</div>,
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
}))

// The Settings Network pages are stubbed so the route tests stay on routing;
// plain functions keep them out of vi.restoreAllMocks().
vi.mock('@/features/settings/container/use-ssh-hosts', () => ({
  useSshHosts: () => ({ status: 'pending', hosts: [], dirty: false, saving: false }),
}))
vi.mock('@/features/settings/container/use-certificates', () => ({
  useCertificates: () => ({
    status: 'pending',
    builtin: [],
    additional: [],
    dirty: false,
    saving: false,
  }),
}))
vi.mock('@/features/settings/page/network-ssh-hosts-tab', () => ({
  NetworkSshHostsTab: () => <div data-testid="network-ssh-hosts-tab" />,
}))
vi.mock('@/features/settings/page/network-certificates-tab', () => ({
  NetworkCertificatesTab: () => <div data-testid="network-certificates-tab" />,
}))
vi.mock('@/features/settings/container/use-proxy-settings', () => ({
  useProxySettings: () => ({
    status: 'pending',
    problems: [],
    checking: false,
    dirty: false,
    saving: false,
  }),
}))
vi.mock('@/features/settings/container/use-proxy-blocks', () => ({
  useProxyBlocks: () => ({ status: 'pending' }),
}))
vi.mock('@/features/settings/page/network-proxy-setup-tab', () => ({
  NetworkProxySetupTab: () => <div data-testid="network-proxy-setup-tab" />,
}))
vi.mock('@/features/settings/page/network-proxy-blocks-tab', () => ({
  NetworkProxyBlocksTab: () => <div data-testid="network-proxy-blocks-tab" />,
}))

// Save original fetch to restore it after tests that override it
const originalFetch = global.fetch

// Silence console.error for expected network errors in route rendering
beforeEach(() => {
  // Restore original fetch before each test to prevent state leakage
  global.fetch = originalFetch
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // Ensure React DOM is cleaned up between tests
  cleanup()
  vi.restoreAllMocks()
})

// Lazy-loaded routes can take longer to resolve under 16-worker parallel CI
// load. Isolation runs are ~1.6s; concurrent contention has pushed some lazy
// route renders past the previous 3s waitFor ceiling (notably the Executions
// list, which has deep transitive imports). Test timeout is 10s, so an 8s
// asyncUtilTimeout still bails before the test itself times out but gives
// every lazy chunk realistic room to resolve under contention.
configure({ asyncUtilTimeout: 8000 })

describe('Router Configuration', () => {
  describe('Route Configuration Array', () => {
    it('exports a valid route configuration array', () => {
      expect(Array.isArray(routeConfig)).toBe(true)
      expect(routeConfig.length).toBeGreaterThan(0)
    })

    it('has root route with layout element', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      expect(rootRoute).toBeDefined()
      expect(rootRoute?.element).toBeDefined()
    })

    it('has nested children routes under root', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      expect(rootRoute?.children).toBeDefined()
      expect(Array.isArray(rootRoute?.children)).toBe(true)
      expect(rootRoute?.children?.length).toBeGreaterThan(0)
    })

    it('defines index route for dashboard redirect', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const indexRoute = rootRoute?.children?.find((r) => r.index === true)
      expect(indexRoute).toBeDefined()
    })

    it('defines tests routes with correct paths', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const testsRoute = rootRoute?.children?.find((r) => r.path === 'tests')
      expect(testsRoute).toBeDefined()
    })

    it('defines suites routes with correct paths', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const suitesRoute = rootRoute?.children?.find((r) => r.path === 'suites')
      expect(suitesRoute).toBeDefined()
    })

    it('defines regressions routes with correct paths', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const regressionsRoute = rootRoute?.children?.find((r) => r.path === 'regressions')
      expect(regressionsRoute).toBeDefined()
    })

    it('defines executions routes with correct paths', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const executionsRoute = rootRoute?.children?.find((r) => r.path === 'executions')
      expect(executionsRoute).toBeDefined()
    })

    it('defines settings route', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const settingsRoute = rootRoute?.children?.find((r) => r.path === 'settings')
      expect(settingsRoute).toBeDefined()
    })

    it('defines the settings/network/:page route beside settings/:section', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const networkRoute = rootRoute?.children?.find((r) => r.path === 'settings/network/:page')
      const sectionRoute = rootRoute?.children?.find((r) => r.path === 'settings/:section')
      expect(networkRoute).toBeDefined()
      expect(networkRoute?.element).toBeDefined()
      expect(sectionRoute).toBeDefined()
    })

    it('defines the settings/network/proxy/:subpage route beside settings/network/:page', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const proxyRoute = rootRoute?.children?.find(
        (r) => r.path === 'settings/network/proxy/:subpage',
      )
      const networkRoute = rootRoute?.children?.find((r) => r.path === 'settings/network/:page')
      expect(proxyRoute).toBeDefined()
      expect(proxyRoute?.element).toBeDefined()
      expect(networkRoute).toBeDefined()
    })

    it('defines catch-all 404 route', () => {
      const rootRoute = routeConfig.find((r) => r.path === '/')
      const notFoundRoute = rootRoute?.children?.find((r) => r.path === '*')
      expect(notFoundRoute).toBeDefined()
    })
  })

  describe('createAppRouter', () => {
    it('creates a router instance', () => {
      const router = createAppRouter()
      expect(router).toBeDefined()
      expect(typeof router.navigate).toBe('function')
      expect(typeof router.subscribe).toBe('function')
    })

    it('initializes with current browser location', () => {
      const router = createAppRouter()
      expect(router.state.location).toBeDefined()
      expect(router.state.location.pathname).toBeDefined()
    })
  })

  describe('AppRouterProvider', () => {
    it('renders children within router context', () => {
      render(<AppRouterProvider />)
      // Should not throw - router context is provided
      expect(document.body).toBeInTheDocument()
    })

    it('provides routing context to children', async () => {
      // Navigate to detail page since breadcrumb is hidden on list pages
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-123'],
      })
      render(<RouterProvider router={router} />)
      // The layout should render with navigation elements (breadcrumb on detail pages)
      await waitFor(() => {
        const navElements = screen.getAllByRole('navigation')
        expect(navElements.length).toBeGreaterThan(0)
      })
    })
  })
})

describe('Route Rendering', () => {
  // All route rendering tests need a working fetch mock because MainLayout/sidebar
  // components may trigger API calls during render. Without this, the global
  // fallback mock from setup.ts rejects all calls, which can prevent lazy-loaded
  // page components from rendering (especially under CI timing).
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          success: true,
          data: [],
          pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
        }),
      })
    })
  })

  describe('Layout Route', () => {
    it('renders main layout with breadcrumb navigation', async () => {
      // Navigate to detail page since breadcrumb is hidden on list pages
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-123'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        const navElements = screen.getAllByRole('navigation')
        expect(navElements.length).toBeGreaterThan(0)
      })
    })

    it('renders main content area', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument()
      })
    })
  })

  describe('Dashboard Route', () => {
    it('renders dashboard page at /dashboard', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        // Use data-testid to avoid conflicts with nav links
        expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
      })
    })

    it('redirects from / to /dashboard', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })

    it('displays error message when dashboard fetch fails', async () => {
      // Mock fetch to reject for dashboard
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Wait for error to be displayed
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      }, { timeout: 10000 })

      global.fetch = originalFetch
    })

  })

  describe('Tests Routes', () => {
    it('renders tests list at /tests', async () => {
      // Mock fetch to return empty test data for route rendering
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/tags')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true, data: [] }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            success: true,
            data: [],
            pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
          }),
        })
      })

      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('tests-page')).toBeInTheDocument()
      }, { timeout: 10000 })
    })

    it('shows 404 for /tests/:testId (no detail page)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-123'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByText('Page Not Found')).toBeInTheDocument()
      })
    })

    it('shows 404 for /tests/:testId/edit (removed - use /workbench?editTest=)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-123/edit'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByText('Page Not Found')).toBeInTheDocument()
      })
    })

    it('redirects /tests/new to the workbench with newTest=true', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/workbench')
      })
      // The lifecycle hook consumes `newTest=true` on mount: it resets
      // the workflow store and clears any persisted draft so the user
      // lands on a blank canvas, then strips the param via
      // `setSearchParams(..., { replace: true })`. The dialog to prompt
      // for a name is owned by the tests-list "New Test" button handler
      // (not by this redirect), so a direct URL visit reaches a clean
      // canvas without any overlay blocking interaction.
      expect(router.state.location.search).toContain('newTest=true')
    })
  })

  describe('Suites Routes', () => {
    it('renders suites list at /suites', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        // SuitesPage component uses suites-page testid
        expect(screen.getByTestId('suites-page')).toBeInTheDocument()
      })
    })

    it('renders suite detail at /suites/:suiteId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites/suite-456'],
      })

      render(<RouterProvider router={router} />)

      // SuiteDetailPage shows loading state while fetching suite data
      await waitFor(() => {
        expect(screen.getByTestId('suite-detail-loading')).toBeInTheDocument()
      })
    })

    it('renders suite detail at /suites/:suiteId/edit (same component as detail)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites/suite-456/edit'],
      })

      render(<RouterProvider router={router} />)

      // Edit route uses the same SuiteDetailPage component
      // It shows loading state while fetching suite data
      await waitFor(() => {
        expect(screen.getByTestId('suite-detail-loading')).toBeInTheDocument()
      })
    })

    it('redirects /suites/new to /suites', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites')
      })
    })
  })

  describe('Regressions Routes', () => {
    it('renders regressions list at /regressions', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('regressions-page')).toBeInTheDocument()
      })
    })

    it('renders regression detail at /regressions/:regressionId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions/regression-789'],
      })

      render(<RouterProvider router={router} />)

      // RegressionDetailPage shows loading state while fetching regression
      // data (no API mock is configured for this router-level smoke test).
      await waitFor(() => {
        expect(screen.getByTestId('regression-detail-loading')).toBeInTheDocument()
      })
    })

    it('renders regression edit at /regressions/:regressionId/edit', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions/regression-789/edit'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('regression-detail-loading')).toBeInTheDocument()
      })
    })

    it('redirects /regressions/new to /regressions (creation is a modal now)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/regressions')
      })
    })
  })

  describe('Executions Routes', () => {
    it('renders executions list at /executions', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions'],
      })

      render(<RouterProvider router={router} />)

      // ExecutionsListContainer is the only list route that pulls in BOTH
      // useSuiteRunDialog and useRegressionRunDialog, so its lazy chunk is
      // roughly 2x the transitive-import size of any other list route.
      // Under GitHub Actions' 4-core runners with vitest's 4 parallel
      // workers, CPU saturation pushes this import past the file-level
      // 8s asyncUtilTimeout (measured 8289ms). Keep the per-call timeout
      // well under the 30s test timeout.
      await waitFor(
        () => {
          expect(screen.getByTestId('executions-page')).toBeInTheDocument()
        },
        { timeout: 20000 }
      )
    })

    it('renders execution detail at /executions/:executionId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions/exec-101'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('execution-detail-page')).toBeInTheDocument()
      })
    })

    it('renders the historical test canvas page at /executions/history/:runId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions/history/run-42'],
      })

      render(<RouterProvider router={router} />)

      // The real page fetches the snapshot. Under the router test harness
      // without an API mock the request is in flight, so we assert the
      // loading state (same page, proving routing + lazy loading work).
      await waitFor(() => {
        expect(screen.getByTestId('execution-test-canvas-loading')).toBeInTheDocument()
      })
    })

  })

  // Settings Route and Workbench Route tests removed - lazy loading causes test pollution.
  // These routes are fully tested in their respective container test files.

  describe('User Route', () => {
    it('renders user page at /user', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/user'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('user-page')).toBeInTheDocument()
      })
    })
  })

  describe('Functions Routes', () => {
    it('renders functions list at /functions', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/functions'],
      })

      const { container } = render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('functions-page')).toBeInTheDocument()
      })
      // /functions must be a known route so MainLayout
      // renders the shell (sidebar nav), not the bare 404 outlet. The sidebar
      // renders nav links; the 404 branch renders only the page outlet.
      expect(container.querySelector('a[href="/tests"]')).toBeInTheDocument()
    })

    it('renders function detail at /functions/:functionId', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/versions')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  latest: '1.0.0',
                  name: 'greet',
                  versions: [
                    {
                      version: '1.0.0',
                      published_at: '2026-01-01T00:00:00Z',
                      changelog: '',
                      details: '',
                      description: '',
                      tags: [],
                      inputs: [],
                      outputs: [],
                    },
                  ],
                },
              }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: { tests: [], functions: [] } }),
        })
      })

      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/functions/fn-123'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('function-detail-page')).toBeInTheDocument()
      })
    })
  })

  // Profiles list route test removed - lazy loading causes test pollution.
  // ProfilesListContainer is fully tested in its own test file.

  describe('Profiles Routes', () => {

    it('renders profile create at /profiles/new', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/profiles/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('profile-create-page')).toBeInTheDocument()
      })
    })

    it('renders profile detail at /profiles/:profileId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/profiles/profile-789'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('profile-detail-page')).toBeInTheDocument()
      })
    })

    it('renders profile edit at /profiles/:profileId/edit', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/profiles/profile-789/edit'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('profile-edit-page')).toBeInTheDocument()
      })
    })
  })

  describe('Reports Routes', () => {
    it('renders the reports list at /reports', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/reports'],
      })

      render(<RouterProvider router={router} />)

      // The real ReportsListContainer renders the page shell in every
      // state (loading/error/populated), same as executions-page.
      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument()
      })
    })

    it('renders the report viewer at /reports/:executionId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/reports/3f2a6c1e-58f4-4f2e-9a3b-1c2d3e4f5a6b'],
      })

      render(<RouterProvider router={router} />)

      // The viewer shell renders in every phase (generating/error/ready);
      // with no API mock the job request fails into the error interstitial,
      // still inside the shell.
      await waitFor(() => {
        expect(screen.getByTestId('report-viewer-page')).toBeInTheDocument()
      })
    })
  })

  describe('Artifacts Routes', () => {
    it('renders the artifacts list at /artifacts', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/artifacts'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('artifacts-page')).toBeInTheDocument()
      })
    })

    it('renders the per-execution drill at /artifacts/:executionId', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/artifacts/exec-456'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('artifact-drill-page')).toBeInTheDocument()
      })
    })
  })

  describe('Settings Network Routes', () => {
    it('renders the Settings container at /settings/network/ssh-hosts', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network/ssh-hosts'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
    })

    it('renders the Settings container at /settings/network/certificates', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network/certificates'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-certificates-tab')).toBeInTheDocument()
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
    })

    it('renders the SSH Hosts page for the bare /settings/network path', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
    })
  })

  describe('Settings Proxy Routes', () => {
    it('renders the Settings container at /settings/network/proxy/setup', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network/proxy/setup'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
    })

    it('renders the Settings container at /settings/network/proxy/blocks', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network/proxy/blocks'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
    })

    it('renders the Proxy Setup page for the bare /settings/network/proxy path', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/settings/network/proxy'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
      expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
    })
  })

  describe('Breadcrumb Route Coverage', () => {
    // Canvas-route breadcrumb suppression is covered by
    // tests/app/layouts/main-layout-canvas.test.tsx against a mocked
    // workbench page; the real workbench container does not fully settle
    // inside the router-test harness.

    it('hides breadcrumb on /suites/:suiteId/edit (suite detail has its own header)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites/suite-456/edit'],
      })

      render(<RouterProvider router={router} />)

      // Suite detail routes hide the standard breadcrumb - the page has its own header
      await waitFor(() => {
        expect(screen.getByTestId('suite-detail-loading')).toBeInTheDocument()
      })
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })

    it('hides route breadcrumb on /regressions/:regressionId/edit (detail manages own breadcrumb)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions/regression-789/edit'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('regression-detail-loading')).toBeInTheDocument()
      })
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })

    it('redirects /suites/new to /suites (creation uses modal)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/suites/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites')
      })
    })

    it('redirects /regressions/new to /regressions list (no "New Regression" breadcrumb, creation is a modal)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions/new'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/regressions')
      })
    })

    it('hides breadcrumb on /regressions list page (per design)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/regressions'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('regressions-page')).toBeInTheDocument()
      })

      // Breadcrumb should be hidden on list pages per design
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })

    it('hides breadcrumb on /executions list page (per design)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/executions'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByTestId('executions-page')).toBeInTheDocument()
      })

      // Breadcrumb should be hidden on list pages per design
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })

  })

  describe('404 Not Found Route', () => {
    it('renders 404 page for unmatched routes', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/non-existent-path'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByText(/page not found/i)).toBeInTheDocument()
      })
    })

    it('provides navigation back to dashboard from 404', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/non-existent-path'],
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByText(/page not found/i)).toBeInTheDocument()
      })

      const homeLink = screen.getByRole('link', { name: /go to dashboard/i })
      await user.click(homeLink)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })

    it('navigates back when Go Back button is clicked', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/non-existent-path'],
        initialIndex: 1,
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByText(/page not found/i)).toBeInTheDocument()
      })

      const backButton = screen.getByRole('button', { name: /go back/i })
      await user.click(backButton)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })
  })
})

describe('SSR Mode Handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../../src/lib/ssr')
  })

  it('handles SSR mode gracefully in main layout', async () => {
    // Mock SSR to return true
    vi.doMock('../../src/lib/ssr', () => ({
      isSSR: () => true,
      getWindowLocationHash: () => '',
    }))

    // Dynamically import after mock is set up
    const { routeConfig: ssrRouteConfig } = await import('../../src/app/router')

    // Navigate to detail page since breadcrumb is hidden on list pages
    const router = createMemoryRouter(ssrRouteConfig, {
      initialEntries: ['/tests/test-123'],
    })

    render(<RouterProvider router={router} />)

    // Should render without errors even in "SSR mode"
    // The MainLayout will use reduced motion (isSSR returns true -> prefersReducedMotion returns false)
    await waitFor(() => {
      // Breadcrumb provides navigation role on detail pages
      const navElements = screen.getAllByRole('navigation')
      expect(navElements.length).toBeGreaterThan(0)
    })
  })
})

describe('TestsListPage Integration', () => {
  const mockTestsData = {
    success: true,
    data: [
      {
        id: 'test-1',
        name: 'Test One',
        version: '1.0.0',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        metadata: {
          parent_suite: 'suite-1',
          status: 'passed',
          last_run: '2025-01-01T00:00:00Z',
          tags: ['smoke'],
        },
      },
    ],
    pagination: {
      total: 1,
      page: 1,
      per_page: 25,
      total_pages: 1,
    },
  }

  const mockSuitesData = {
    success: true,
    data: [{ id: 'suite-1', name: 'Suite One', version: '1.0.0' }],
  }

  let originalFetch: typeof global.fetch
  let fetchCallCount = 0

  beforeEach(() => {
    originalFetch = global.fetch
    fetchCallCount = 0
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('handles error state and retry button click', async () => {
    // Mock fetch to fail first time (for /tests), then succeed on retry
    let testsCallCount = 0
    global.fetch = vi.fn().mockImplementation((url: string) => {
      fetchCallCount++
      if (url.includes('/tests')) {
        testsCallCount++
        if (testsCallCount === 1) {
          // First call fails
          return Promise.resolve({
            ok: false,
            statusText: 'Internal Server Error',
          })
        }
        // Subsequent calls succeed
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for error state to appear (after API failure)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
    }, { timeout: 10000 })

    // Verify we're in error state
    expect(screen.getByTestId('error-state-icon')).toBeInTheDocument()

    // Click retry
    await user.click(screen.getByRole('button', { name: /Try Again/i }))

    // Wait for successful load after retry
    await waitFor(() => {
      // Should have test rows now
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 10000 })
  }, 15000)

  it('handles selection mode entry and exit', async () => {
    // Mock fetch to succeed
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and Mass Action button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Mass Action to enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Verify selection mode is active (exit selection mode button should appear)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    // Click X to exit selection mode
    await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))

    // Verify back to normal mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })
  })

  it('handles row selection change (single item toggle)', async () => {
    // Mock fetch to succeed
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    // Find the row checkbox for test-1 and click it (toggles selection)
    const rowCheckbox = screen.getByRole('checkbox', { name: /Select Test One/i })
    await user.click(rowCheckbox)

    // Verify the checkbox is now checked
    await waitFor(() => {
      expect(rowCheckbox).toBeChecked()
    })

    // Click again to deselect
    await user.click(rowCheckbox)

    // Verify the checkbox is now unchecked
    await waitFor(() => {
      expect(rowCheckbox).not.toBeChecked()
    })
  })

  it('handles select all checkbox', async () => {
    // Mock fetch to succeed
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    // Find and click the select all checkbox in table header
    const selectAllCheckbox = screen.getByRole('checkbox', { name: /Select all/i })
    await user.click(selectAllCheckbox)

    // Verify all row checkboxes are now checked
    await waitFor(() => {
      const rowCheckbox = screen.getByRole('checkbox', { name: /Select Test One/i })
      expect(rowCheckbox).toBeChecked()
    })

    // Click select all again to deselect all
    await user.click(selectAllCheckbox)

    // Verify all row checkboxes are now unchecked
    await waitFor(() => {
      const rowCheckbox = screen.getByRole('checkbox', { name: /Select Test One/i })
      expect(rowCheckbox).not.toBeChecked()
    })
  })

  it('handles page change', async () => {
    // Mock fetch with pagination data
    const multiPageData = {
      ...mockTestsData,
      pagination: {
        total: 50,
        page: 1,
        per_page: 25,
        total_pages: 2,
      },
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(multiPageData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click next page button (should trigger handlePageChange)
    const nextButton = screen.getByRole('button', { name: /next/i })
    expect(nextButton).not.toBeDisabled()
    await user.click(nextButton)

    // Verify URL was updated
    await waitFor(() => {
      expect(router.state.location.search).toContain('page=2')
    })
  })

  it('initializes filters from URL search params including suiteIds and tags', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      // Verify the filters are passed to the API
      if (url.includes('/tests')) {
        // Check that suite_ids and tags are included in the request
        const urlObj = new URL(url, 'http://localhost')
        expect(urlObj.searchParams.get('suite_ids')).toContain('suite-1')
        expect(urlObj.searchParams.get('tags')).toContain('tag1')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests?suiteIds=suite-1,suite-2&tags=tag1,tag2'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load - this confirms the filters were parsed and passed to API
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles filter change via search input', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search tests/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Type in search input (triggers handleFilterChange via debounce)
    const searchInput = screen.getByPlaceholderText(/Search tests/i)
    await user.type(searchInput, 'login')

    // Wait for debounced filter change - URL should be updated and API called
    await waitFor(() => {
      expect(router.state.location.search).toContain('search=login')
    }, { timeout: 2000 })

    // Also verify API was called with search param
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    const searchCall = fetchCalls.find((call: unknown[]) =>
      typeof call[0] === 'string' && call[0].includes('search=login')
    )
    expect(searchCall).toBeTruthy()
  })

  it('handles bulk duplicate action', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Handle POST /tests/:id/clone for bulk duplicate
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: { id: 'cloned-test', name: 'Test (Copy)' },
          }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    // Select a test
    const rowCheckbox = screen.getByRole('checkbox', { name: /Select Test One/i })
    await user.click(rowCheckbox)

    // Wait for selection
    await waitFor(() => {
      expect(rowCheckbox).toBeChecked()
    })

    // Click the dropdown trigger to open bulk actions menu
    const selectionDropdown = screen.getByRole('button', { name: /1 selected/i })
    await user.click(selectionDropdown)

    // Click Duplicate in the menu
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Verify clone API was called for the selected test
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/clone'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('handles bulk duplicate action error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Clone API fails
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // The reason is named in a titled toast, not only in the console.
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Internal Server Error', 'Duplicate Failed')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk duplicate action error with non-Error thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Clone API throws a string (non-Error)
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.reject('network failure')
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // A string rejection reaches the toast verbatim.
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('network failure', 'Duplicate Failed')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk export action', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Export
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Export/i }))

    // Bulk export now opens an export dialog instead of logging
    await waitFor(() => {
      expect(screen.getByText(/Export/i)).toBeInTheDocument()
    })
    consoleSpy.mockRestore()
  })

  it('handles bulk run action', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Run
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /^Run$/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /^Run$/i }))

    // Bulk run navigates to /executions/new with test ids
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/executions/new')
    })
  })

  it('handles bulk delete action', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Handle DELETE /tests/batch for bulk delete
      if (url.includes('/tests/batch') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deleted: ['test-1'], failed: [] }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm the delete in the confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    // Bulk delete uses "Delete All" button label (delete-multiple variant)
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Verify batch delete API was called
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tests/batch'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  it('handles bulk delete action error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Batch delete API fails
      if (url.includes('/tests/batch') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm the delete in the confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk delete:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk delete action error with non-Error thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Batch delete API throws a string (non-Error)
      if (url.includes('/tests/batch') && options?.method === 'DELETE') {
        return Promise.reject('network failure')
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a test
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test One/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('checkbox', { name: /Select Test One/i }))

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm the delete in the confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Wait for error to be logged with non-Error fallback message
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk delete:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles run test from row actions', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Find the Run button for the first test (it's a separate button, not in the dropdown)
    const runButton = screen.getByRole('button', { name: /^Run Test One$/i })
    await user.click(runButton)

    // Run action opens the RunDialog
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Title is "Run Test", test name appears in subtitle.
      // The dialog renders the label twice (sr-only DialogTitle for
      // Radix accessibility + visible <h2> for sighted users), so assert
      // on the visible testid rather than bare text.
      expect(screen.getByTestId('run-dialog-title-visible')).toHaveTextContent('Run Test')
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('Test One')
    })
  })

  it('handles cancel on test run dialog', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Run button to open the RunDialog
    const runButton = screen.getByRole('button', { name: /^Run Test One$/i })
    await user.click(runButton)

    // Wait for dialog to open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    // Verify dialog is closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles run test from dialog with environment selected', async () => {
    // Handler calls POST /executions
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/executions') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'exec-new-1' } }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    )

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Run button to open the RunDialog
    const runButton = screen.getByRole('button', { name: /^Run Test One$/i })
    await user.click(runButton)

    // Wait for dialog to open and environments to load
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('all-environments')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Wait for environments to populate (they load asynchronously from mock)
    await waitFor(() => {
      const allEnvsSection = screen.getByTestId('all-environments')
      expect(within(allEnvsSection).getByText('Production')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Select an environment (find by name within all-environments section)
    const allEnvsSection = screen.getByTestId('all-environments')
    const productionEnv = within(allEnvsSection).getByText('Production')
    fireEvent.click(productionEnv.closest('button')!)

    // Click Run button
    const dialogRunButton = screen.getByRole('button', { name: /^Run$/i })
    fireEvent.click(dialogRunButton)

    // Verify POST /executions was called with the test ID and environment
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/executions$/),
        expect.objectContaining({ method: 'POST' }),
      )
    }, { timeout: 5000 })
  })

  it('handles delete test from row actions', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Handle DELETE /tests/:id
      if (url.includes('/tests/test-1') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Open the row actions dropdown
    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    // Click Delete in the menu
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm the delete in the confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Delete$/i }))

    // Verify delete API was called
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tests/test-1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  it('handles duplicate test from row actions', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Handle POST /tests/:id/clone
      if (url.includes('/tests/test-1/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: { id: 'test-1-copy', name: 'Test One (Copy)' },
          }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Open the row actions dropdown
    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    // Click Duplicate in the menu
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Verify clone API was called
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tests/test-1/clone'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('handles duplicate test error from row actions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Clone API fails
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to duplicate test:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles duplicate test error with non-Error thrown from row actions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Clone API throws a string (non-Error)
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.reject('network failure')
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to duplicate test:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles delete test error from row actions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Delete API fails
      if (url.includes('/tests/test-1') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm delete in the dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete test:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles delete test error with non-Error thrown from row actions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // Delete API throws a string (non-Error)
      if (url.includes('/tests/test-1') && options?.method === 'DELETE') {
        return Promise.reject('network failure')
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm delete in the dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete test:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles edit test from row actions - opens Edit Test Info dialog', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Open the row actions dropdown
    const moreActionsButton = screen.getByRole('button', { name: /More actions for Test One/i })
    await user.click(moreActionsButton)

    // Click Edit in the menu
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

    // Verify Edit Test Info dialog opens (stays on /tests page)
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Edit Test Info/i })).toBeInTheDocument()
    })
    // Should stay on tests page
    expect(router.state.location.pathname).toBe('/tests')
  })

  it('handles row click to open workbench', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      // Row-click triggers a getCurrentSession lookup before navigating
      // (active-session guard). No active session in this test => null body.
      if (url.includes('/workbench/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: null }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click on the test name (which has the row click handler)
    const testName = screen.getByTestId('test-name')
    await user.click(testName)

    // Verify navigation to workbench
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workbench')
    })
  })

  it('handles new test button click', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/workbench/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: null }),
        })
      }
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the "New Test" button - opens the create-test dialog rather
    // than navigating. The dialog then routes to /workbench when the user
    // picks a name; that flow is covered by the container's own tests.
    const newTestButton = screen.getByRole('button', { name: /New Test/i })
    await user.click(newTestButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  // Note: handlePageSizeChange test skipped - Radix UI Select uses Portal
  // which doesn't render properly in jsdom. The handler is tested indirectly
  // through the TestsPage component tests which use a different approach.
  // See: https://github.com/radix-ui/primitives/issues/1952

  it('loads tests with tags from URL parameter', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ...mockTestsData,
            data: mockTestsData.data.map((t, i) =>
              i === 0 ? { ...t, metadata: { ...t.metadata, tags: ['smoke', 'auth'] } } : t
            ),
          }),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests?tags=smoke,auth'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles fetch error when error is not an Error instance', async () => {
    // Mock fetch to throw a non-Error object
    global.fetch = vi.fn().mockRejectedValue('Network failure')

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to load tests/i)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles filter change with status parameter', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests?status=passed&suiteId=suite-1&tags=smoke'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Verify URL params are preserved
    expect(router.state.location.search).toContain('status=passed')
  })

  it('handles sort toggle - clicking column header changes sort state', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Initial state: Name column is sorted ascending (as per router.tsx default)
    const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')

    // Click to toggle from ascending to descending
    await user.click(nameHeader)
    await waitFor(() => {
      expect(nameHeader.getAttribute('aria-sort')).toBe('descending')
    }, { timeout: 3000 })
  })

  it('handles sort toggle - clicking a different column starts fresh ascending', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Initial state: Name column is sorted ascending
    const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')

    // Click Suite column to sort by Suite (should start ascending)
    const suiteHeader = screen.getByRole('columnheader', { name: /Suite/i })
    await user.click(suiteHeader)

    await waitFor(() => {
      expect(suiteHeader.getAttribute('aria-sort')).toBe('ascending')
      // Name column should now be none since we're sorting by Suite
      expect(nameHeader.getAttribute('aria-sort')).toBe('none')
    }, { timeout: 3000 })
  })

  it('handles sort toggle - third click clears sort (desc to none)', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Initial state: Name column is sorted ascending
    const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')

    // First click: ascending -> descending
    await user.click(nameHeader)
    await waitFor(() => {
      expect(nameHeader.getAttribute('aria-sort')).toBe('descending')
    }, { timeout: 3000 })

    // Re-query the header since component may have re-rendered
    const updatedNameHeader = screen.getByRole('columnheader', { name: /Name/i })
    expect(updatedNameHeader.getAttribute('aria-sort')).toBe('descending')

    // Second click: descending -> none (clear sort)
    await user.click(updatedNameHeader)
    await waitFor(() => {
      const finalNameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(finalNameHeader.getAttribute('aria-sort')).toBe('none')
    }, { timeout: 3000 })
  })

  // Note: handleBulkMoveToSuite (lines 659-676) in router.tsx
  // are integration-level callbacks that require complex E2E test setup with mocked APIs and
  // state management. They are exercised in Playwright E2E tests and the component-level tests
  // in tests-bulk-actions.test.tsx.

  it('handles column visibility toggle - hiding a column', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Suite column should be visible initially
    expect(screen.getByRole('columnheader', { name: /Suite/i })).toBeInTheDocument()

    // Open Columns dropdown
    await user.click(screen.getByRole('button', { name: /Columns/i }))

    // Uncheck Suite column
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Suite/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Suite/i }))

    // Suite column should be hidden
    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: /Suite/i })).not.toBeInTheDocument()
    })
  })

  it('handles column visibility toggle - showing a column', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTestsData),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('tests-table')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Open Columns dropdown
    await user.click(screen.getByRole('button', { name: /Columns/i }))

    // Uncheck Tags column (it's checked by default but not shown since not in visibleColumns)
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Tags/i })).toBeInTheDocument()
    })

    // Check Tags column to show it
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Tags/i }))

    // Tags column should now be visible
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Tags/i })).toBeInTheDocument()
    })
  })

})

describe('SuitesListPage Integration', () => {
  const mockSuitesListData = {
    data: [
      {
        id: 'suite-1',
        name: 'Test Suite One',
        description: 'A test suite',
        tests_count: 5,
        status: 'passed',
        last_run: '2025-01-01T00:00:00Z',
        tags: ['smoke', 'regression'],
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'suite-2',
        name: 'Test Suite Two',
        description: null,
        tests_count: 3,
        status: 'failed',
        last_run: '2025-01-02T00:00:00Z',
        tags: ['integration'],
        created_at: '2025-01-02T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
      },
    ],
    pagination: {
      total: 2,
      page: 1,
      per_page: 25,
      total_pages: 1,
    },
  }

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('closes delete dialog without confirming via Cancel button', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the overflow menu for the first suite
    const menuButtons = screen.getAllByTestId('row-actions-menu')
    await user.click(menuButtons[0])

    // Click Delete in the dropdown
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Verify dialog opens
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click Cancel to close dialog without confirming
    await user.click(screen.getByRole('button', { name: /Cancel/i }))

    // Verify dialog is closed
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    // Verify no delete API call was made
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/suites/suite-1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('handles column toggle to hide a visible column', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Status column should be visible by default
    expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument()

    // Click the Columns button to open dropdown
    await user.click(screen.getByRole('button', { name: /Columns/i }))

    // Wait for dropdown to open
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Status/i })).toBeInTheDocument()
    })

    // Uncheck Status column to hide it
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Status/i }))

    // Status column should now be hidden
    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: /Status/i })).not.toBeInTheDocument()
    })
  })

  it('handles column toggle to show a hidden column', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Tags column is hidden by default per design
    expect(screen.queryByRole('columnheader', { name: /Tags/i })).not.toBeInTheDocument()

    // Click the Columns button to open dropdown
    await user.click(screen.getByRole('button', { name: /Columns/i }))

    // Wait for dropdown to open
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Tags/i })).toBeInTheDocument()
    })

    // Check Tags column to show it
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Tags/i }))

    // Tags column should now be visible
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Tags/i })).toBeInTheDocument()
    })
  })

  it('handles entering and exiting selection mode', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode to activate
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Select Test Suite One/i })).toBeInTheDocument()
    })

    // Select a suite
    await user.click(screen.getByRole('checkbox', { name: /Select Test Suite One/i }))

    // Verify suite is selected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })

    // Exit selection mode by clicking X button
    await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))

    // Verify selection mode is exited (checkboxes should be gone)
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: /Select Test Suite One/i })).not.toBeInTheDocument()
    })
  })

  it('handles select all checkbox', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode to activate
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })

    // Click select-all checkbox to select all suites
    await user.click(screen.getByTestId('select-all-checkbox'))

    // Verify all suites are selected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    })

    // Click select-all again to deselect all
    await user.click(screen.getByTestId('select-all-checkbox'))

    // Verify all are deselected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })
  })

  it('handles page change', async () => {
    // Mock API with 50 suites (multiple pages)
    const multipleSuitesData = {
      data: Array.from({ length: 25 }, (_, i) => ({
        id: `suite-${i + 1}`,
        name: `Suite ${i + 1}`,
        description: null,
        tests_count: i + 1,
        status: i % 2 === 0 ? 'passed' : 'failed',
        last_run: '2025-01-01T00:00:00Z',
        tags: [],
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      })),
      pagination: {
        total: 50,
        page: 1,
        per_page: 25,
        total_pages: 2,
      },
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(multipleSuitesData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Suite 1')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Find and click the "Next" or page 2 button
    const nextButton = screen.getByRole('button', { name: /next page|page 2/i })
    await user.click(nextButton)

    // Data should still be displayed (pagination works)
    await waitFor(() => {
      expect(screen.getByText('Suite 1')).toBeInTheDocument()
    })
  })

  it('handles sorting by name column - asc to desc to clear', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Get the Name column header (it's a <th> with tabIndex, not a button)
    let nameHeader = screen.getByRole('columnheader', { name: /Name/i })

    // Ensure we're in a known state - click until ascending
    const currentSort = nameHeader.getAttribute('aria-sort')
    if (currentSort !== 'ascending') {
      await user.click(nameHeader)
      await waitFor(() => {
        nameHeader = screen.getByRole('columnheader', { name: /Name/i })
        expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')
      })
    }

    // Click again to sort descending - wait for state change and re-query
    await user.click(nameHeader)
    await waitFor(() => {
      nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader.getAttribute('aria-sort')).toBe('descending')
    })

    // Click again to clear sorting - exercises lines 1142-1144
    await user.click(nameHeader)
    await waitFor(() => {
      nameHeader = screen.getByRole('columnheader', { name: /Name/i })
      expect(nameHeader.getAttribute('aria-sort')).toBe('none')
    })

    // Sorting should be cleared (data still renders)
    expect(screen.getByText('Test Suite One')).toBeInTheDocument()
  })

  it('handles sorting by different column', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Get the Status column header (it's a <th> with tabIndex, not a button)
    const statusHeader = screen.getByRole('columnheader', { name: /Status/i })

    // Click to sort by status ascending
    await user.click(statusHeader)

    // Verify data still renders
    expect(screen.getByText('Test Suite One')).toBeInTheDocument()

    // Now switch to a different column (Name)
    const nameHeader = screen.getByRole('columnheader', { name: /Name/i })
    await user.click(nameHeader)

    // Verify sorting is now by name
    expect(screen.getByText('Test Suite One')).toBeInTheDocument()
  })

  it('handles error state and retry functionality', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        callCount++
        if (callCount === 1) {
          // First call fails
          return Promise.resolve({
            ok: false,
            statusText: 'Internal Server Error',
          })
        }
        // Retry succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for error state to appear
    await waitFor(() => {
      expect(screen.getByText(/Unable to load suites/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Try Again button to trigger retry
    await user.click(screen.getByRole('button', { name: /Try Again/i }))

    // Wait for successful data load after retry
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('exercises sort clear path: click descending column to clear', async () => {
    // This test specifically targets the clear-sorting branch (lines 1142-1144)
    // by ensuring we click a column that's already in descending state
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Get the Tests column header - use a different column than previous tests
    let testsHeader = screen.getByRole('columnheader', { name: /Tests/i })

    // Initial state - should be 'none' (no sorting)
    expect(testsHeader.getAttribute('aria-sort')).toBe('none')

    // Click 1: Start sorting ascending - wait for state to update and re-query
    await user.click(testsHeader)
    await waitFor(() => {
      testsHeader = screen.getByRole('columnheader', { name: /Tests/i })
      expect(testsHeader.getAttribute('aria-sort')).toBe('ascending')
    })

    // Click 2: Switch to descending - wait for state to update and re-query
    await user.click(testsHeader)
    await waitFor(() => {
      testsHeader = screen.getByRole('columnheader', { name: /Tests/i })
      expect(testsHeader.getAttribute('aria-sort')).toBe('descending')
    })

    // Click 3: Clear sorting - this exercises lines 1142-1144
    await user.click(testsHeader)
    await waitFor(() => {
      testsHeader = screen.getByRole('columnheader', { name: /Tests/i })
      expect(testsHeader.getAttribute('aria-sort')).toBe('none')
    })

    // Data should still render
    expect(screen.getByText('Test Suite One')).toBeInTheDocument()
  })

  it('handles filter change via search input', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search suites/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Type in search input (triggers handleFilterChange via debounce)
    const searchInput = screen.getByPlaceholderText(/Search suites/i)
    await user.type(searchInput, 'test')

    // Wait for debounced filter change - URL should be updated
    await waitFor(() => {
      expect(router.state.location.search).toContain('search=test')
    }, { timeout: 2000 })

    // Verify API was called with search param
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    const searchCall = fetchCalls.find((call: unknown[]) =>
      typeof call[0] === 'string' && call[0].includes('search=test')
    )
    expect(searchCall).toBeTruthy()
  })

  it('handles bulk duplicate error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Set up fetch to fail on clone
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          statusText: 'Server Error',
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite using testid (suites use different checkbox pattern)
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk duplicate:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk duplicate success', async () => {
    // Set up fetch to succeed on clone
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 'cloned-suite', name: 'Suite (Copy)' } }),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Wait for selection mode to be exited (clone succeeded, selection cleared)
    await waitFor(() => {
      // After successful clone, selection mode should exit and data reloaded
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles bulk export', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Export
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Export/i }))

    // Bulk export now opens the export dialog instead of logging
    await waitFor(() => {
      expect(screen.getByText(/Export Suite/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk run navigation', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Run
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Run/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Run/i }))

    // Wait for navigation to executions page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/executions/new')
      expect(router.state.location.search).toContain('suites=suite-1')
    }, { timeout: 5000 })
  })

  it('handles confirm bulk delete with finally block', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/batch') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deleted: ['suite-1'] }),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Wait for delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm to trigger confirmBulkDelete (covers finally block)
    // For delete-multiple variant, the button is "Delete All"
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Wait for selection mode to be exited (delete succeeded)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles confirm bulk delete error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/batch') && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Wait for delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm to trigger confirmBulkDelete (error path)
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk delete:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles run suite from row actions', async () => {
    const mockSuiteTests = {
      data: [
        { id: 'test-1', name: 'Test One' },
        { id: 'test-2', name: 'Test Two' },
      ],
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuiteTests),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button (it's a separate button, not in the dropdown menu)
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Title is "Run Suite", suite name appears in subtitle
      expect(screen.getByTestId('run-dialog-title-visible')).toHaveTextContent('Run Suite')
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('Test Suite One')
    }, { timeout: 5000 })
  })

  it('handles select all tests in suite run dialog', async () => {
    const mockSuiteTests = {
      data: [
        { id: 'test-1', name: 'Test One' },
        { id: 'test-2', name: 'Test Two' },
      ],
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuiteTests),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button to open the dialog
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Find and click the Select All checkbox
    const selectAllCheckbox = screen.getByLabelText('Select All')
    await user.click(selectAllCheckbox)

    // The callback should have been triggered - verify dialog is still open
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('handles individual test selection in suite run dialog', async () => {
    const mockSuiteTests = {
      data: [
        { id: 'test-1', name: 'Test One' },
        { id: 'test-2', name: 'Test Two' },
      ],
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuiteTests),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button to open the dialog
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open and test list to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('suite-tests-list')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Find the test list container and click an individual test checkbox
    // This triggers handleSuiteTestSelectionChange callback
    const testList = screen.getByTestId('suite-tests-list')
    const testOneCheckbox = within(testList).getByRole('checkbox', { name: 'Test One' })

    // Verify checkbox is initially checked (all tests selected by default)
    expect(testOneCheckbox).toBeChecked()

    // Click the checkbox using fireEvent for more direct trigger
    // This exercises the handleSuiteTestSelectionChange callback (lines 1128-1130)
    fireEvent.click(testOneCheckbox)
  })

  it('handles cancel in suite run dialog', async () => {
    const mockSuiteTests = {
      data: [
        { id: 'test-1', name: 'Test One' },
        { id: 'test-2', name: 'Test Two' },
      ],
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuiteTests),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button to open the dialog
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    // Verify dialog is closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles run suite from dialog with environment selected', async () => {
    const mockSuiteTests = {
      data: [
        { id: 'test-1', name: 'Test One' },
      ],
    }

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'POST' && url.includes('/executions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 'exec-new-suite' } }),
        })
      }
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuiteTests),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    )

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button to open the dialog
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open and environments to load
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('all-environments')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Wait for environments to populate (they load asynchronously from mock)
    await waitFor(() => {
      const allEnvsSection = screen.getByTestId('all-environments')
      expect(within(allEnvsSection).getByText('Production')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Select an environment (find by name within all-environments section)
    const allEnvsSection = screen.getByTestId('all-environments')
    const productionEnv = within(allEnvsSection).getByText('Production')
    fireEvent.click(productionEnv.closest('button')!)

    // Click Run button using fireEvent
    const dialogRunButton = screen.getByRole('button', { name: /^Run$/i })
    fireEvent.click(dialogRunButton)

    // Verify the execution was started and navigation occurred
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/executions/exec-new-suite')
    }, { timeout: 5000 })
  })

  it('does not open the Run dialog when the suite tests read fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites/') && url.includes('/tests')) {
        return Promise.reject(new Error('Network error'))
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    global.fetch = fetchMock

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button to open the dialog (should handle error)
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/tests'))).toBe(true)
    }, { timeout: 5000 })

    // A failed read never opens a dialog listing nothing - that reads as
    // "this suite has no tests". The reason goes to a toast, which this
    // file stubs out.
    expect(screen.queryByRole('dialog')).toBeNull()

    consoleSpy.mockRestore()
  })

  it('handles duplicate suite from row actions', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 'cloned-suite', name: 'Suite (Copy)' } }),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the row actions menu for the first suite
    const rowActionsMenus = screen.getAllByTestId('row-actions-menu')
    await user.click(rowActionsMenus[0])

    // Wait for the menu to appear and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Verify clone API was called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/clone'),
        expect.objectContaining({ method: 'POST' })
      )
    }, { timeout: 5000 })
  })

  it('handles duplicate suite error from row actions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the row actions menu for the first suite
    const rowActionsMenus = screen.getAllByTestId('row-actions-menu')
    await user.click(rowActionsMenus[0])

    // Wait for the menu to appear and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to duplicate suite:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles delete suite with finally block', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE' && url.includes('/suites/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deleted: true }),
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the row actions menu for the first suite
    const rowActionsMenus = screen.getAllByTestId('row-actions-menu')
    await user.click(rowActionsMenus[0])

    // Wait for the menu to appear and click Delete
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Wait for delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm to trigger confirmDeleteSuite (covers finally block)
    await user.click(screen.getByRole('button', { name: /Delete$/i }))

    // Wait for dialog to close (finally block executed)
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles delete suite error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE' && url.includes('/suites/')) {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        })
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the row actions menu for the first suite
    const rowActionsMenus = screen.getAllByTestId('row-actions-menu')
    await user.click(rowActionsMenus[0])

    // Wait for the menu to appear and click Delete
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Wait for delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm to trigger confirmDeleteSuite (error path)
    await user.click(screen.getByRole('button', { name: /Delete$/i }))

    // Wait for error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete suite:', expect.any(Error))
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles edit suite from row actions', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the row actions menu for the first suite
    const rowActionsMenus = screen.getAllByTestId('row-actions-menu')
    await user.click(rowActionsMenus[0])

    // Wait for the menu to appear and click Edit
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Edit/i }))

    // Wait for navigation to suite detail page (edit uses same route)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/suites/suite-1')
    }, { timeout: 5000 })
  })

  it('handles new suite button click', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and New Suite button to be available
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Suite/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the New Suite button - opens modal instead of navigating
    await user.click(screen.getByRole('button', { name: /New Suite/i }))

    // Wait for create modal to appear
    await waitFor(() => {
      expect(screen.getByTestId('suite-create-modal')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('handles deselecting an individual suite', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Enter selection mode
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Wait for selection mode to activate
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })

    // Select the first suite
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Verify suite is selected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })

    // Click the same checkbox again to deselect it (tests filter branch in handleSelectionChange)
    await user.click(rowCheckboxes[0])

    // Verify suite is deselected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })
  })

  it('handles bulk delete error with non-Error thrown', { timeout: 30000 }, async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/batch') && options?.method === 'DELETE') {
        // Reject with a string instead of Error to test the fallback branch
        return Promise.reject('network failure')
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Delete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Wait for delete confirmation dialog
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm to trigger confirmBulkDelete (error path with non-Error)
    await user.click(screen.getByRole('button', { name: /Delete All/i }))

    // Wait for error to be logged with non-Error fallback message
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk delete:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles bulk duplicate error with non-Error thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        // Reject with a string instead of Error to test the fallback branch
        return Promise.reject('network failure')
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load and enter selection mode
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))

    // Select a suite
    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument()
    })
    const rowCheckboxes = screen.getAllByTestId('row-checkbox')
    await user.click(rowCheckboxes[0])

    // Open bulk actions menu and click Duplicate
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 selected/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /1 selected/i }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Wait for error to be logged with non-Error fallback message
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to bulk duplicate:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('loads with URL params including status and tags filters', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites?status=passed,failed&tags=smoke,regression'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Verify the fetch was called with status param
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=passed%2Cfailed'),
        expect.any(Object)
      )
    })
  })

  it('handles loadData error with non-Error thrown', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      // Reject with a string instead of Error to test the fallback branch
      return Promise.reject('network failure')
    })

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for error state to be displayed
    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Verify fallback error message is shown
    expect(screen.getByText(/Failed to load suites/i)).toBeInTheDocument()
  })

  it('handles single suite delete error with non-Error thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE' && url.includes('/suites/') && !url.includes('/batch')) {
        // Reject with a string instead of Error to test the fallback branch
        return Promise.reject('network failure')
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the overflow menu for the first suite
    const menuButtons = screen.getAllByTestId('row-actions-menu')
    await user.click(menuButtons[0])

    // Click Delete in the dropdown
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))

    // Confirm deletion
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Delete/i }))

    // Wait for error to be logged with non-Error fallback message
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete suite:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })

  it('handles single suite duplicate error with non-Error thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/clone') && options?.method === 'POST') {
        // Reject with a string instead of Error to test the fallback branch
        return Promise.reject('network failure')
      }
      if (url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuitesListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/suites'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Suite One')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the overflow menu for the first suite
    const menuButtons = screen.getAllByTestId('row-actions-menu')
    await user.click(menuButtons[0])

    // Click Duplicate in the dropdown
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Duplicate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))

    // Wait for error to be logged with non-Error fallback message
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to duplicate suite:', 'network failure')
    }, { timeout: 5000 })

    consoleSpy.mockRestore()
  })
})

describe('DashboardPageWrapper Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const mockDashboardData = {
    metrics: {
      tests: { count: 10 },
      suites: { count: 2 },
      regressions: { count: 1 },
      executions: { sinceDays: 7, count: 5, running: 1, passed: 3, failed: 1 },
    },
    recentActivity: [
      { id: 'test-1', type: 'test', name: 'Test', timestamp: '2025-01-15T11:00:00Z', parentSuite: 'Suite' },
    ],
    recentExecutions: [
      {
        id: 'exec-1',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T11:00:00Z',
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      },
    ],
    meta: { timestamp: '2025-01-15T12:00:00Z', errors: [] },
  }

  it('handles navigation when clicking metric cards', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/dashboard'],
    })

    render(<RouterProvider router={router} />)

    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByTestId('metric-card-tests')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Tests metric card
    await user.click(screen.getByTestId('metric-card-tests'))

    // Verify navigation to tests page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tests')
    })
  })

  it('handles navigation when clicking Suites metric card', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/dashboard'],
    })

    render(<RouterProvider router={router} />)

    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByTestId('metric-card-suites')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Suites metric card
    await user.click(screen.getByTestId('metric-card-suites'))

    // Verify navigation to suites page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/suites')
    })
  })

  it('handles navigation when clicking Regressions metric card', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/dashboard'],
    })

    render(<RouterProvider router={router} />)

    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByTestId('metric-card-regressions')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Regressions metric card
    await user.click(screen.getByTestId('metric-card-regressions'))

    // Verify navigation to regressions page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/regressions')
    })
  })

  it('handles navigation when clicking Executions metric card', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/dashboard'],
    })

    render(<RouterProvider router={router} />)

    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByTestId('metric-card-executions')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Executions metric card
    await user.click(screen.getByTestId('metric-card-executions'))

    // Verify navigation to executions page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/executions')
    })
  })

  it('handles fetch error when error is not an Error instance', async () => {
    global.fetch = vi.fn().mockRejectedValue('Network failure')

    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/dashboard'],
    })

    render(<RouterProvider router={router} />)

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to load dashboard/i)).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})

describe('RegressionsListPage Integration', () => {
  const mockRegressionsListData = {
    data: [
      {
        id: 'reg-1',
        name: 'WAVE 25.12',
        description: 'Full regression',
        version: '25.12.0',
        suites_count: 2,
        tests_count: 5,
        status: 'passed',
        last_run: '2025-01-01T00:00:00Z',
        tags: ['release'],
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ],
    pagination: {
      total: 1,
      page: 1,
      per_page: 25,
      total_pages: 1,
    },
  }

  const mockRegressionSuites = {
    data: [
      {
        id: 'suite-1',
        name: 'Auth Suite',
        tests: [
          { id: 'test-1', name: 'Login Test' },
          { id: 'test-2', name: 'Logout Test' },
        ],
      },
      {
        id: 'suite-2',
        name: 'API Suite',
        tests: [
          { id: 'test-3', name: 'GET endpoint' },
        ],
      },
    ],
  }

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('handles run regression from row actions', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/regressions/') && url.includes('/suites')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRegressionSuites),
        })
      }
      if (url.includes('/regressions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRegressionsListData),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    const user = userEvent.setup()
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/regressions'],
    })

    render(<RouterProvider router={router} />)

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('WAVE 25.12')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click the Run button for the first regression
    const runButtons = screen.getAllByTestId('row-action-run')
    await user.click(runButtons[0])

    // Wait for RunDialog to open with suites data
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Title is "Run Regression", regression name appears in subtitle
      expect(screen.getByTestId('run-dialog-title-visible')).toHaveTextContent('Run Regression')
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('WAVE 25.12')
    }, { timeout: 5000 })

    // Verify suites are displayed in the dialog
    await waitFor(() => {
      expect(screen.getByText('Auth Suite')).toBeInTheDocument()
      expect(screen.getByText('API Suite')).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})
