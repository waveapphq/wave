/**
 * Main Layout Component
 *
 * Layout with SidebarProvider, AppSidebar, breadcrumb, and content area.
 * Adapts behavior based on:
 * - Viewport size: Auto-collapse when sidebar would exceed 20% of viewport width
 * - Route type: Canvas routes have zero content padding and hide standard breadcrumb
 *
 * Sidebar Behavior:
 * - Normal viewport (sidebar <20% of width): Follows user preference (cookie)
 * - Small viewport (sidebar >=20% of width): Auto-collapses, but user CAN expand
 * - User override: Remembered until viewport goes large and back to small
 */

import React, { Suspense, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { RouteLoadingFallback, RouteErrorBoundary } from '../route-boundaries'
import { usePreloadRegistry } from '../preload-registry'
import { useNavigationPatterns } from '../navigation-patterns'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AdminDisconnectDialog } from '@/app/admin-disconnect-dialog'
import { AppSidebar } from '@/components/shared/app-sidebar'
import { PageBlockedCard } from '@/components/shared/page-blocked-card'
import { SheetLayer } from '@/components/shared/sheet-layer'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { prefersReducedMotion, isKnownRoute } from '@/lib/route-utils'
import { isCanvasRoute } from '@/features/workbench/hooks/use-canvas-route'
import { useSidebarStore } from '@/stores/sidebar-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { useDataEpoch } from '@/services/connection-monitor'

const SIDEBAR_EXPANDED_WIDTH = 240 // px - matches CSS --sidebar-width
const VIEWPORT_THRESHOLD = SIDEBAR_EXPANDED_WIDTH * 5 // 1200px - auto-collapse below this

/**
 * Check if current viewport is "small" (below 5x sidebar width threshold)
 */
function isSmallViewport(): boolean {
  return globalThis.window.innerWidth <= VIEWPORT_THRESHOLD
}

type BreadcrumbEntry = { label: string; href?: string }

/**
 * Build breadcrumb items for the `/<resource>/new` redirect transition.
 *
 * Suite, regression, and execution detail routes hide the main-layout
 * breadcrumb (DetailHeader handles their breadcrumb), so this helper only
 * renders during the brief render of the `/new` redirect target.
 */
function buildResourceBreadcrumb(
  pathname: string,
  basePath: string,
  label: string,
  newLabel: string,
): BreadcrumbEntry[] {
  const items: BreadcrumbEntry[] = [{ label, href: basePath }]
  if (pathname === `${basePath}/new`) {
    items.push({ label: newLabel })
  }
  return items
}

/**
 * Breadcrumb navigation based on current route
 */
function RouteBreadcrumb(): ReactNode {
  const location = useLocation()
  const params = useParams()
  const pathname = location.pathname

  // Build breadcrumb items based on current path
  const getBreadcrumbItems = (): BreadcrumbEntry[] => {
    // Dashboard
    /* v8 ignore next 2 - COV-UNREACH-001 */
    if (pathname === '/dashboard') return [{ label: 'Dashboard' }]

    // Tests - only detail pages show breadcrumb.
    // /tests/new redirects to /workbench so never reaches this breadcrumb code.
    if (pathname.startsWith('/tests') && params.testId && !pathname.endsWith('/edit')) {
      return [{ label: 'Tests', href: '/tests' }, { label: params.testId }]
    }

    // Suites - reachable only on the brief /suites/new redirect transition
    if (pathname.startsWith('/suites')) {
      return buildResourceBreadcrumb(pathname, '/suites', 'Suites', 'New Suite')
    }

    // Regressions - reachable only on the brief /regressions/new redirect transition
    if (pathname.startsWith('/regressions')) {
      return buildResourceBreadcrumb(pathname, '/regressions', 'Regressions', 'New Regression')
    }

    // Note: /workbench and /executions detail routes hide this breadcrumb
    // (DetailHeader handles their breadcrumb).

    // User
    if (pathname === '/user') return [{ label: 'User' }]

    // Default
    return [{ label: 'Dashboard' }]
  }

  const breadcrumbItems = getBreadcrumbItems()

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbItems.map((item, index) => (
          <React.Fragment key={item.label + index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {item.href ? (
                <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}


/**
 * Main layout with SidebarProvider, AppSidebar, and SidebarInset
 */
export function MainLayout(): ReactNode {
  const reducedMotion = prefersReducedMotion()
  const location = useLocation()
  const pathname = location.pathname
  // Remount route content when the connection monitor recovers so all
  // mounted-driven data fetches re-run without a full page reload.
  const dataEpoch = useDataEpoch()
  const blocked = usePageBlockStore((state) => state.block !== null)

  // Check if current route is a canvas route (for styling, not sidebar behavior)
  const isCanvas = isCanvasRoute(pathname)

  // Use sidebar store for localStorage persistence
  const sidebarStore = useSidebarStore()
  const { isCollapsed, setCollapsed, initializeFromStorage } = sidebarStore

  // Initialize from localStorage on mount
  useEffect(() => {
    initializeFromStorage()
  }, [initializeFromStorage])

  // Convert collapsed state to open state for SidebarProvider
  const sidebarOpen = !isCollapsed

  // Track previous viewport state for transition detection
  const wasSmallViewport = useRef(isSmallViewport())

  // Track if user has manually toggled (to not override their preference on resize)
  const userHasToggled = useRef(false)

  // Handle viewport resize - auto-collapse/expand based on 5x threshold (1200px)
  useEffect(() => {
    const handleResize = () => {
      const currentlySmall = isSmallViewport()
      const previouslySmall = wasSmallViewport.current

      // Only auto-change if viewport crossed the threshold
      if (currentlySmall !== previouslySmall) {
        if (currentlySmall && !previouslySmall) {
          // Viewport shrunk below threshold - auto-collapse
          setCollapsed(true)
        } else if (!currentlySmall && previouslySmall && !userHasToggled.current) {
          // Viewport grew above threshold AND user hasn't manually toggled - auto-expand
          setCollapsed(false)
        }
        wasSmallViewport.current = currentlySmall
      }
    }

    // Initial check
    if (isSmallViewport() && !isCollapsed) {
      setCollapsed(true)
    }

    globalThis.window.addEventListener('resize', handleResize)
    return () => globalThis.window.removeEventListener('resize', handleResize)
  }, [isCollapsed, setCollapsed])

  // Handle sidebar state changes from user interaction
  // User's manual toggle is always persisted to localStorage
  const handleSidebarChange = useCallback(
    (open: boolean) => {
      userHasToggled.current = true
      setCollapsed(!open)
    },
    [setCollapsed]
  )

  // Get preload registry functions for predictive loading
  const { preloadDetailPage, preloadEditPage, preloadLivePage, preloadWithPriority } =
    usePreloadRegistry()

  // Get navigation pattern functions for learning user navigation
  const { registerPattern, getPreloadSuggestions } = useNavigationPatterns()

  // Track previous path for navigation pattern learning
  const previousPathRef = useRef<string | null>(null)

  // Predictive preloading based on current location
  useEffect(() => {
    const pathname = location.pathname

    // Register navigation pattern when path changes
    if (previousPathRef.current && previousPathRef.current !== pathname) {
      registerPattern(previousPathRef.current, pathname)
    }
    previousPathRef.current = pathname

    // On list pages, preload detail pages with high priority
    if (pathname === '/tests') {
      preloadDetailPage('test-detail')
      preloadWithPriority('test-detail', 'high')
      preloadWithPriority('test-create', 'low')
    } else if (pathname === '/suites') {
      preloadDetailPage('suite-detail')
      preloadWithPriority('suite-detail', 'high')
      preloadWithPriority('suite-create', 'low')
    } else if (pathname === '/executions') {
      preloadDetailPage('execution-detail')
    }

    // On detail pages, preload related pages
    if (/^\/tests\/[^/]+$/.exec(pathname) && !pathname.endsWith('/edit') && !pathname.endsWith('/new')) {
      preloadEditPage('test-edit')
    } else if (/^\/executions\/[^/]+$/.exec(pathname) && !pathname.endsWith('/live')) {
      preloadLivePage('execution-live')
    }

    // Get preload suggestions based on navigation patterns
    getPreloadSuggestions(pathname)
  }, [location.pathname, preloadDetailPage, preloadEditPage, preloadLivePage, preloadWithPriority, registerPattern, getPreloadSuggestions])

  // Check if we're on a 404 page (unknown route)
  const isNotFoundPage = !isKnownRoute(location.pathname)

  // Don't render sidebar on 404 pages
  if (isNotFoundPage) {
    return (
      <main className="min-h-screen">
        <RouteErrorBoundary key={dataEpoch} pathname={location.pathname}>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
    )
  }

  // Determine if breadcrumb should be shown
  // Hide on: list pages, settings, AND canvas routes (canvas has its own breadcrumb)
  const isListPage = ['/dashboard', '/tests', '/suites', '/regressions', '/executions', '/profiles', '/functions', '/reports', '/artifacts'].includes(pathname)
  const isSettingsPage = pathname.startsWith('/settings')
  const isSuiteDetail = pathname.startsWith('/suites/') && pathname !== '/suites/new'
  const isRegressionDetail = pathname.startsWith('/regressions/') && pathname !== '/regressions/new'
  const isExecutionDetail = pathname.startsWith('/executions/')
  const isFunctionDetail = pathname.startsWith('/functions/')
  const isReportDetail = pathname.startsWith('/reports/')
  const isArtifactDetail = pathname.startsWith('/artifacts/')
  const showBreadcrumb = !isListPage && !isSettingsPage && !isCanvas && !isSuiteDetail && !isRegressionDetail && !isExecutionDetail && !isFunctionDetail && !isReportDetail && !isArtifactDetail

  // Content padding: canvas routes and entity detail pages have zero padding (they manage their own layout)
  const contentPadding = isCanvas || isSuiteDetail || isRegressionDetail || isExecutionDetail || isFunctionDetail || isReportDetail || isArtifactDetail ? 'px-0' : 'px-4'

  /* v8 ignore next - COV-BRANCH-130 */
  const motionClass = reducedMotion ? '' : 'transition-opacity duration-300'

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarChange}>
      <AdminDisconnectDialog />
      <AppSidebar />
      <SidebarInset>
        {/* Mobile header with hamburger menu - only visible on mobile */}
        <header className="flex h-14 items-center gap-2 border-b border-default px-4 md:hidden">
          <SidebarTrigger>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle sidebar</span>
            </Button>
          </SidebarTrigger>
          <span className="text-lg font-semibold">WAVE</span>
        </header>
        {/* Breadcrumb - hidden on list pages, settings, and canvas routes */}
        {showBreadcrumb && (
          <div className="p-4">
            <RouteBreadcrumb />
          </div>
        )}
        {/* Blur is presentation; `inert` is what makes the region dead. */}
        <div className="relative h-0 flex-grow overflow-hidden">
          <div
            data-testid="route-content"
            inert={blocked}
            className={`h-full ${blocked ? 'blur-[4px]' : ''} ${motionClass}`}
          >
            {/* Floating sheets belong to the page: they block with it. */}
            <SheetLayer>
              <RouteErrorBoundary key={dataEpoch} pathname={location.pathname} className={`h-full ${contentPadding}`}>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Outlet />
                </Suspense>
              </RouteErrorBoundary>
            </SheetLayer>
          </div>
          <PageBlockedCard />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
