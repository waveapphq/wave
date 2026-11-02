/**
 * MainLayout Canvas Route Behavior Tests
 *
 * Tests for MainLayout's handling of canvas routes per V-CANVAS-01a.
 * Canvas routes affect:
 * - Sidebar state: auto-collapses per SHELL-6
 * - Content padding: px-0 for maximum workspace
 * - Breadcrumb visibility: hidden (canvas has its own breadcrumb bar)
 *
 * Per SHELL-6: "Canvas/Workbench wireframes show collapsed sidebar"
 * Sidebar also responds to viewport size in addition to route type.
 *
 * Visual Test: V-CANVAS-01a
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

// Global cleanup to ensure test isolation
afterEach(() => {
  // Clear sidebar localStorage between all tests to prevent pollution
  localStorage.removeItem('wave-sidebar-collapsed')
  localStorage.removeItem('wave-sidebar-sections')
  cleanup()
})
import { MainLayout } from '@/app/layouts/main-layout'
import { ThemeProvider } from '@/design-system/theme-provider'
import { useSidebar } from '@/components/ui/sidebar'
import { usePageBlockStore } from '@/stores/page-block-store'
import { DraggableSheet } from '@/components/shared/draggable-sheet'

// Test component to expose sidebar state for assertions
function SidebarStateInspector() {
  const { state, open } = useSidebar()
  return (
    <div data-testid="sidebar-inspector">
      <span data-testid="sidebar-state">{state}</span>
      <span data-testid="sidebar-open">{open.toString()}</span>
    </div>
  )
}

// Page components for different routes
function TestsListPage() {
  return (
    <div data-testid="tests-list-page">
      <SidebarStateInspector />
      Tests List
    </div>
  )
}

function WorkbenchPage() {
  return (
    <div data-testid="workbench-page">
      <SidebarStateInspector />
      Workbench Canvas
    </div>
  )
}

function DashboardPage() {
  return (
    <div data-testid="dashboard-page">
      <SidebarStateInspector />
      Dashboard
    </div>
  )
}

function FloatingSheetPage() {
  return (
    <div data-testid="floating-sheet-page">
      <DraggableSheet
        open
        onClose={() => {}}
        ariaLabel="Page Sheet"
        header={<span>Page Sheet</span>}
        data-testid="page-sheet"
      >
        <button data-testid="page-sheet-field">field</button>
      </DraggableSheet>
    </div>
  )
}

function TestDetailPage() {
  return (
    <div data-testid="test-detail-page">
      <SidebarStateInspector />
      Test Detail (read-only)
    </div>
  )
}

// Helper to render MainLayout with routes for testing
function renderMainLayout(initialPath: string = '/') {
  const routes = [
    {
      path: '/',
      element: (
        <ThemeProvider defaultTheme="light" storageKey="test-theme">
          <MainLayout />
        </ThemeProvider>
      ),
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'dashboard', element: <DashboardPage /> },
        { path: 'tests', element: <TestsListPage /> },
        { path: 'tests/:testId', element: <TestDetailPage /> },
        { path: 'workbench', element: <WorkbenchPage /> },
        { path: 'workbench/:blockId', element: <WorkbenchPage /> },
        { path: 'suites', element: <div>Suites</div> },
        { path: 'settings', element: <div>Settings</div> },
        { path: 'profiles', element: <FloatingSheetPage /> },
      ],
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  return {
    ...render(<RouterProvider router={router} />),
    router,
  }
}

describe('MainLayout canvas route content styling', () => {
  beforeEach(() => {
    // Clear sidebar localStorage before each test
    localStorage.removeItem('wave-sidebar-collapsed')
  })

  describe('content padding', () => {
    it('removes horizontal padding on /workbench canvas route', async () => {
      renderMainLayout('/workbench')

      await waitFor(() => {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      const contentWrapper = screen.getByTestId('workbench-page').parentElement
      expect(contentWrapper).toHaveClass('px-0')
    })

    it('removes horizontal padding on /workbench/:blockId canvas route', async () => {
      renderMainLayout('/workbench/block-456')

      await waitFor(() => {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      const contentWrapper = screen.getByTestId('workbench-page').parentElement
      expect(contentWrapper).toHaveClass('px-0')
    })

    it('applies standard padding on non-canvas routes', async () => {
      renderMainLayout('/tests')

      await waitFor(() => {
        expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
      })

      const contentWrapper = screen.getByTestId('tests-list-page').parentElement
      expect(contentWrapper).toHaveClass('px-4')
    })

    it('applies standard padding on detail page (read-only, not canvas)', async () => {
      renderMainLayout('/tests/test-123')

      await waitFor(() => {
        expect(screen.getByTestId('test-detail-page')).toBeInTheDocument()
      })

      const contentWrapper = screen.getByTestId('test-detail-page').parentElement
      expect(contentWrapper).toHaveClass('px-4')
    })

    it('applies standard padding on dashboard', async () => {
      renderMainLayout('/dashboard')

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
      })

      const contentWrapper = screen.getByTestId('dashboard-page').parentElement
      expect(contentWrapper).toHaveClass('px-4')
    })
  })

  describe('breadcrumb visibility', () => {
    it('hides standard breadcrumb on /workbench canvas route', async () => {
      renderMainLayout('/workbench')

      await waitFor(() => {
        expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
      })

      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })

    it('shows breadcrumb on non-canvas detail routes', async () => {
      renderMainLayout('/tests/test-123')

      await waitFor(() => {
        expect(screen.getByTestId('test-detail-page')).toBeInTheDocument()
      })

      // Should have breadcrumb on detail pages
      expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument()
    })

    it('hides breadcrumb on list routes (not because canvas, but by design)', async () => {
      renderMainLayout('/tests')

      await waitFor(() => {
        expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
      })

      // List pages hide breadcrumb per design
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument()
    })
  })
})

describe('MainLayout canvas route page rendering', () => {
  beforeEach(() => {
    localStorage.removeItem('wave-sidebar-collapsed')
  })

  it('renders workbench page content on /workbench', async () => {
    renderMainLayout('/workbench')

    await waitFor(() => {
      expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    })
    expect(screen.getByText('Workbench Canvas')).toBeInTheDocument()
  })

  it('renders workbench page content on /workbench/:blockId', async () => {
    renderMainLayout('/workbench/block-456')

    await waitFor(() => {
      expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    })
    expect(screen.getByText('Workbench Canvas')).toBeInTheDocument()
  })
})

describe('MainLayout canvas route navigation', () => {
  beforeEach(() => {
    localStorage.removeItem('wave-sidebar-collapsed')
  })

  it('maintains correct content styling when navigating between canvas and non-canvas routes', async () => {
    const { router } = renderMainLayout('/tests')

    // Start on non-canvas route - should have standard padding
    await waitFor(() => {
      expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
    })
    let contentWrapper = screen.getByTestId('tests-list-page').parentElement
    expect(contentWrapper).toHaveClass('px-4')

    // Navigate to canvas route
    await act(async () => {
      await router.navigate('/workbench')
    })

    await waitFor(() => {
      expect(screen.getByTestId('workbench-page')).toBeInTheDocument()
    })
    contentWrapper = screen.getByTestId('workbench-page').parentElement
    expect(contentWrapper).toHaveClass('px-0')

    // Navigate back to non-canvas
    await act(async () => {
      await router.navigate('/tests')
    })

    await waitFor(() => {
      expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
    })
    contentWrapper = screen.getByTestId('tests-list-page').parentElement
    expect(contentWrapper).toHaveClass('px-4')
  })

  it('handles rapid navigation between canvas and non-canvas routes', async () => {
    const { router } = renderMainLayout('/tests')

    // Rapid navigation
    await act(async () => {
      await router.navigate('/workbench')
      await router.navigate('/tests')
      await router.navigate('/workbench')
      await router.navigate('/dashboard')
    })

    // Final state should have standard padding (ended on non-canvas)
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
    const contentWrapper = screen.getByTestId('dashboard-page').parentElement
    expect(contentWrapper).toHaveClass('px-4')
  })
})

describe('MainLayout sidebar behavior (route-based for canvas, viewport-based otherwise)', () => {
  beforeEach(() => {
    localStorage.removeItem('wave-sidebar-collapsed')
  })

  it('respects user sidebar preference from localStorage on all routes', async () => {
    // Set localStorage to collapsed
    localStorage.setItem('wave-sidebar-collapsed', 'true')

    renderMainLayout('/workbench')

    // Should respect user preference from localStorage
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })

  it('maintains collapsed preference when navigating between routes', async () => {
    // Set localStorage to collapsed
    localStorage.setItem('wave-sidebar-collapsed', 'true')

    const { router } = renderMainLayout('/tests')

    // Start collapsed (from localStorage)
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })

    // Navigate to canvas route - should stay collapsed
    await act(async () => {
      await router.navigate('/workbench')
    })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })

    // Navigate to non-canvas - still collapsed
    await act(async () => {
      await router.navigate('/dashboard')
    })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })
})

describe('MainLayout viewport-based sidebar behavior', () => {
  // Store original innerWidth to restore
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    localStorage.removeItem('wave-sidebar-collapsed')
    // Start with large viewport (above 1200px threshold)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1400,
    })
  })

  afterEach(() => {
    // Restore original innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
  })

  it('respects localStorage collapsed state on initial load', async () => {
    // Set localStorage to collapsed before render
    localStorage.setItem('wave-sidebar-collapsed', 'true')

    renderMainLayout('/tests')

    // Should start collapsed from localStorage
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })

  it('user toggle persists to localStorage', async () => {
    // Start with large viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })

    renderMainLayout('/tests')

    // Start expanded on large viewport
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })

    // User collapses sidebar
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    await act(async () => {
      collapseButton.click()
    })

    // Sidebar should collapse and persist to localStorage
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
    expect(localStorage.getItem('wave-sidebar-collapsed')).toBe('true')
  })

  it('allows user to toggle sidebar and persists to localStorage', async () => {
    renderMainLayout('/tests')

    // Start expanded
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })

    // User collapses sidebar
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    await act(async () => {
      collapseButton.click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })

    // User expands sidebar (finding the expand button)
    const expandButton = screen.getByRole('button', { name: /expand sidebar/i })
    await act(async () => {
      expandButton.click()
    })

    // Sidebar should expand
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })
  })

  it('auto-collapses sidebar on initial load when viewport is below threshold', async () => {
    // Set small viewport (below 1200px threshold)
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })

    renderMainLayout('/tests')

    // Should auto-collapse on small viewport
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })

  it('auto-collapses sidebar when viewport shrinks below threshold', async () => {
    // Start with large viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })

    renderMainLayout('/tests')

    // Start expanded
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })

    // Shrink viewport below threshold
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    // Should auto-collapse
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })

  it('auto-expands sidebar when viewport grows above threshold (if user has not toggled)', async () => {
    // Start with small viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })

    renderMainLayout('/tests')

    // Should start collapsed
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })

    // Grow viewport above threshold
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    // Should auto-expand (user hasn't manually toggled)
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })
  })

  it('does not auto-expand when user has manually toggled sidebar', async () => {
    // Start with large viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })

    renderMainLayout('/tests')

    // Start expanded
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded')
    })

    // User manually collapses
    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    await act(async () => {
      collapseButton.click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })

    // Shrink then grow viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    // Should stay collapsed because user manually toggled
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('collapsed')
    })
  })
})

/**
 * A failed load step kills the route content and nothing else. The region goes
 * genuinely inert rather than covered, so deleting the card would not bring the
 * page back, and the sidebar stays fully usable because that is the way out.
 */
describe('MainLayout blocked route region', () => {
  beforeEach(() => {
    localStorage.removeItem('wave-sidebar-collapsed')
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1400 })
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  afterEach(() => {
    // The layout is still mounted here, so clearing the block re-renders it.
    act(() => {
      usePageBlockStore.setState({ block: null, retrying: false })
    })
  })

  function blockThePage() {
    act(() => {
      usePageBlockStore.setState({
        block: {
          title: 'Could not load environments',
          detail: { message: 'Internal Server Error' },
          retry: vi.fn().mockResolvedValue(undefined),
        },
      })
    })
  }

  async function renderBlocked() {
    renderMainLayout('/tests')
    await waitFor(() => {
      expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
    })
    blockThePage()
    await waitFor(() => {
      expect(screen.getByTestId('page-blocked-card')).toBeInTheDocument()
    })
    return screen.getByTestId('route-content')
  }

  it('leaves the route content live and unblurred when nothing is blocked', async () => {
    renderMainLayout('/tests')
    await waitFor(() => {
      expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
    })

    const routeContent = screen.getByTestId('route-content')
    expect(routeContent).not.toHaveAttribute('inert')
    expect(routeContent.className).not.toContain('blur-')
    expect(screen.queryByTestId('page-blocked-card')).not.toBeInTheDocument()
  })

  it('makes the route content inert and blurs it when a load step fails', async () => {
    const routeContent = await renderBlocked()

    expect(routeContent).toHaveAttribute('inert')
    expect(routeContent.className).toContain('blur-[4px]')
  })

  it('keeps every route element inside the inert region', async () => {
    const routeContent = await renderBlocked()

    expect(routeContent.contains(screen.getByTestId('tests-list-page'))).toBe(true)
  })

  it('keeps a floating sheet open on the page inside the inert region', async () => {
    renderMainLayout('/profiles')
    await waitFor(() => {
      expect(screen.getByTestId('page-sheet')).toBeInTheDocument()
    })
    blockThePage()

    const routeContent = screen.getByTestId('route-content')
    const sheet = screen.getByTestId('page-sheet')
    expect(routeContent).toHaveAttribute('inert')
    expect(routeContent).toContainElement(sheet)
    expect(screen.getByTestId('floating-sheet-page')).not.toContainElement(sheet)
  })

  it('keeps the card outside the inert region so it stays usable', async () => {
    const routeContent = await renderBlocked()

    const card = screen.getByTestId('page-blocked-card')
    expect(routeContent.contains(card)).toBe(false)
    expect(routeContent.parentElement?.contains(card)).toBe(true)
    expect(screen.getByTestId('page-blocked-retry')).toBeEnabled()
  })

  it('blocks with inert alone, not aria-hidden and not pointer events', async () => {
    const routeContent = await renderBlocked()

    expect(routeContent).not.toHaveAttribute('aria-hidden')
    expect(routeContent.className).not.toContain('pointer-events-none')
  })

  it('lets nothing catch clicks on the content behind the card', async () => {
    const routeContent = await renderBlocked()

    // The content and the card's wash. The wash is decoration and passes input through.
    const siblings = Array.from(routeContent.parentElement?.children ?? [])
    expect(siblings).toHaveLength(2)
    const wash = screen.getByTestId('page-blocked-wash')
    expect(siblings[1]).toBe(wash)
    expect(wash).toHaveClass('pointer-events-none')
    expect(document.querySelector('.fixed.inset-0')).toBeNull()
  })

  it('never makes the application sidebar inert or unusable', async () => {
    const routeContent = await renderBlocked()

    const collapseButton = screen.getByRole('button', { name: /collapse sidebar/i })
    expect(routeContent.contains(collapseButton)).toBe(false)
    expect(collapseButton).toBeEnabled()

    const sidebar = document.querySelector('[data-sidebar="sidebar"]')
    expect(sidebar).not.toBeNull()
    expect(sidebar).not.toHaveAttribute('inert')
    expect(routeContent.contains(sidebar)).toBe(false)
  })

  it('lets the sidebar still navigate away while the page is blocked', async () => {
    renderMainLayout('/tests')
    await waitFor(() => {
      expect(screen.getByTestId('tests-list-page')).toBeInTheDocument()
    })
    blockThePage()

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    expect(screen.getByTestId('route-content').contains(dashboardLink)).toBe(false)
    await act(async () => {
      dashboardLink.click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    })
  })

  it('brings the route content back the moment the block clears', async () => {
    await renderBlocked()

    act(() => {
      usePageBlockStore.getState().clearBlock()
    })

    const routeContent = screen.getByTestId('route-content')
    expect(routeContent).not.toHaveAttribute('inert')
    expect(routeContent.className).not.toContain('blur-')
    expect(screen.queryByTestId('page-blocked-card')).not.toBeInTheDocument()
  })
})
