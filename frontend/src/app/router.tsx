/* @refresh reset */
/**
 * Router Configuration - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Main router configuration with route definitions, lazy loading,
 * authentication guards, and error handling.
 *
 * Note: @refresh reset directive above tells Vite to do full page reloads
 * instead of Fast Refresh, since this file exports both components and
 * non-component functions (routeConfig, createAppRouter).
 */

import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { NotFoundPage } from './not-found'

// Layout components (loaded eagerly - needed for shell)
import { MainLayout } from './layouts/main-layout'
import { ProtectedRoute } from './layouts/protected-route'

// ============================================================================
// Lazy-loaded containers (code-split into separate chunks)
// ============================================================================

/* v8 ignore next 3 - COV-BRANCH-157 */
const LoginContainer = lazy(() =>
  import('@/features/auth/container/login-container').then((m) => ({ default: m.LoginContainer }))
)
const DashboardContainer = lazy(() =>
  import('@/features/dashboard/container/container').then((m) => ({ default: m.DashboardContainer }))
)
const TestsListContainer = lazy(() =>
  import('@/features/tests/container').then((m) => ({ default: m.TestsListContainer }))
)
const SuitesListContainer = lazy(() =>
  import('@/features/suites/container/container').then((m) => ({ default: m.SuitesListContainer }))
)
const RegressionsListContainer = lazy(() =>
  import('@/features/regressions/container/container').then((m) => ({
    default: m.RegressionsListContainer,
  }))
)
const ExecutionsListContainer = lazy(() =>
  import('@/features/executions/container/container').then((m) => ({
    default: m.ExecutionsListContainer,
  }))
)
/* v8 ignore next 4 - COV-V8-004 */
const ProfilesListContainer = lazy(() =>
  import('@/features/profiles/container').then((m) => ({
    default: m.ProfilesListContainer,
  }))
)
const SettingsContainer = lazy(() =>
  import('@/features/settings/container').then((m) => ({ default: m.SettingsContainer }))
)

// WorkbenchPage is in its own file for better code-splitting (it's a large component)
const WorkbenchPage = lazy(() =>
  import('@/features/workbench/live').then((m) => ({ default: m.WorkbenchContainer }))
)

// Helper to create lazy placeholder components
function lazyPlaceholder(componentName: string) {
  return lazy(() =>
    import('./placeholder-pages').then((m) => ({
      default: m[componentName as keyof typeof m] as React.ComponentType,
    }))
  )
}

const SuiteDetailPage = lazy(() =>
  import('@/features/suites/container/suite-detail-page').then((m) => ({ default: m.SuiteDetailPage }))
)
const RegressionDetailPage = lazy(() =>
  import('@/features/regressions/container/regression-detail-page').then((m) => ({ default: m.RegressionDetailPage }))
)
const RegressionEditPage = lazy(() =>
  import('@/features/regressions/container/regression-detail-page').then((m) => ({ default: m.RegressionDetailPage }))
)
const ExecutionDetailPage = lazy(() =>
  import('@/features/executions/detail/execution-detail-page').then((m) => ({
    default: m.ExecutionDetailPage,
  }))
)
const ExecutionTestCanvasPage = lazy(() =>
  import('@/features/workbench/history/container').then((m) => ({
    default: m.ExecutionTestCanvasPage,
  }))
)
const UserPage = lazyPlaceholder('UserPage')
const FunctionsListContainer = lazy(() =>
  import('@/features/functions/container').then((m) => ({ default: m.FunctionsListContainer }))
)
const FunctionDetailPage = lazy(() =>
  import('@/features/functions/container/function-detail-page').then((m) => ({
    default: m.FunctionDetailPage,
  }))
)
const ProfileDetailPage = lazyPlaceholder('ProfileDetailPage')
const ProfileCreatePage = lazyPlaceholder('ProfileCreatePage')
const ProfileEditPage = lazyPlaceholder('ProfileEditPage')
const ReportsListContainer = lazy(() =>
  import('@/features/reports/container/container').then((m) => ({
    default: m.ReportsListContainer,
  }))
)
const ReportViewerPage = lazy(() =>
  import('@/features/reports/detail/report-viewer-page').then((m) => ({
    default: m.ReportViewerPage,
  }))
)
const ArtifactsListContainer = lazy(() =>
  import('@/features/artifacts/container/container').then((m) => ({
    default: m.ArtifactsListContainer,
  }))
)
const ArtifactDrillPage = lazy(() =>
  import('@/features/artifacts/detail/artifact-drill-page').then((m) => ({
    default: m.ArtifactDrillPage,
  }))
)

// ============================================================================
// Loading fallback
// ============================================================================

function PageLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-muted-foreground">Loading…</div>
    </div>
  )
}

// ============================================================================
// Suspense wrapper for lazy components
// ============================================================================

function SuspenseWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <Suspense fallback={<PageLoadingFallback />}>{children}</Suspense>
}

// Helper to wrap a lazy component with Suspense and ProtectedRoute
function protectedLazy(LazyComponent: React.LazyExoticComponent<React.ComponentType>) {
  return (
    <ProtectedRoute>
      <SuspenseWrapper>
        <LazyComponent />
      </SuspenseWrapper>
    </ProtectedRoute>
  )
}

// Helper for public lazy routes
function publicLazy(LazyComponent: React.LazyExoticComponent<React.ComponentType>) {
  return (
    <SuspenseWrapper>
      <LazyComponent />
    </SuspenseWrapper>
  )
}

/**
 * Route configuration array
 */
export const routeConfig: RouteObject[] = [
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'login',
        element: publicLazy(LoginContainer),
      },
      {
        path: 'dashboard',
        element: protectedLazy(DashboardContainer),
      },
      {
        path: 'tests',
        element: protectedLazy(TestsListContainer),
      },
      {
        // Legacy /tests/new URL: redirect to a blank workbench. The
        // `newTest=true` query param asks the lifecycle hook to reset
        // the workflow store and clear any persisted draft so the user
        // lands on a genuinely blank canvas; the hook strips the param
        // after consuming it.
        path: 'tests/new',
        element: <Navigate to="/workbench?newTest=true" replace />,
      },
      {
        path: 'suites',
        element: protectedLazy(SuitesListContainer),
      },
      {
        path: 'suites/new',
        element: <Navigate to="/suites" replace />,
      },
      {
        path: 'suites/:suiteId',
        element: protectedLazy(SuiteDetailPage),
      },
      {
        path: 'suites/:suiteId/edit',
        element: protectedLazy(SuiteDetailPage),
      },
      {
        path: 'regressions',
        element: protectedLazy(RegressionsListContainer),
      },
      {
        path: 'regressions/new',
        element: <Navigate to="/regressions" replace />,
      },
      {
        path: 'regressions/:regressionId',
        element: protectedLazy(RegressionDetailPage),
      },
      {
        path: 'regressions/:regressionId/edit',
        element: protectedLazy(RegressionEditPage),
      },
      {
        path: 'executions',
        element: protectedLazy(ExecutionsListContainer),
      },
      {
        path: 'executions/:executionId',
        element: protectedLazy(ExecutionDetailPage),
      },
      {
        path: 'executions/history/:runId',
        element: protectedLazy(ExecutionTestCanvasPage),
      },
      {
        path: 'settings',
        element: protectedLazy(SettingsContainer),
      },
      {
        path: 'settings/:section',
        element: protectedLazy(SettingsContainer),
      },
      {
        path: 'settings/network/:page',
        element: protectedLazy(SettingsContainer),
      },
      {
        path: 'settings/network/proxy/:subpage',
        element: protectedLazy(SettingsContainer),
      },
      {
        path: 'user',
        element: protectedLazy(UserPage),
      },
      {
        path: 'workbench',
        element: protectedLazy(WorkbenchPage),
      },
      {
        path: 'workbench/:blockId',
        element: protectedLazy(WorkbenchPage),
      },
      {
        path: 'functions',
        element: protectedLazy(FunctionsListContainer),
      },
      {
        path: 'functions/:functionId',
        element: protectedLazy(FunctionDetailPage),
      },
      {
        path: 'profiles',
        element: protectedLazy(ProfilesListContainer),
      },
      {
        path: 'profiles/new',
        element: protectedLazy(ProfileCreatePage),
      },
      {
        path: 'profiles/:profileId',
        element: protectedLazy(ProfileDetailPage),
      },
      {
        path: 'profiles/:profileId/edit',
        element: protectedLazy(ProfileEditPage),
      },
      {
        path: 'reports',
        element: protectedLazy(ReportsListContainer),
      },
      {
        path: 'reports/:executionId',
        element: protectedLazy(ReportViewerPage),
      },
      {
        path: 'artifacts',
        element: protectedLazy(ArtifactsListContainer),
      },
      {
        path: 'artifacts/:executionId',
        element: protectedLazy(ArtifactDrillPage),
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]

/**
 * Create the application router
 */
export function createAppRouter() {
  return createBrowserRouter(routeConfig)
}

// Singleton router instance for AppRouterProvider
let appRouterInstance: ReturnType<typeof createBrowserRouter> | null = null

/**
 * Get the singleton router instance
 */
function getAppRouter() {
  appRouterInstance ??= createBrowserRouter(routeConfig)
  return appRouterInstance
}

/**
 * Router provider component
 */
export function AppRouterProvider(): ReactNode {
  const router = getAppRouter()
  return <RouterProvider router={router} />
}
