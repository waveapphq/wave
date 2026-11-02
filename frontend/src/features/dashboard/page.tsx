/**
 * DashboardPage Component
 *
 * V-DASH-01, V-DASH-02: Dashboard page integration
 * DASH-1: Four summary cards: Tests, Suites, Regressions, Recent Executions
 * DASH-2: Empty state: zero counts
 * DASH-3: Quick Actions section with common workflows
 *
 * Main dashboard page combining all dashboard components.
 */

import { type HTMLAttributes, type ReactNode } from 'react'
/* v8 ignore next - COV-V8-001 */
import { cn } from '@/lib/utils'
import { MetricCard } from '@/features/dashboard/components/metric-card'
import { RecentActivity, type Activity } from '@/features/dashboard/components/recent-activity'
import { RecentExecutions, type Execution } from '@/features/dashboard/components/recent-executions'
import { QuickActions } from '@/features/dashboard/components/quick-actions'
import {
  LastUpdatedIndicator,
  type LiveStatus,
} from '@/features/dashboard/components/last-updated-indicator'

export interface DashboardMetrics {
  tests: { count: number }
  suites: { count: number }
  regressions: { count: number }
  executions: { sinceDays: number; count: number; running: number; passed: number; failed: number }
}

export interface DashboardData {
  metrics: DashboardMetrics
  recentActivity: Activity[]
  recentExecutions: Execution[]
}

export interface DashboardPageProps extends Omit<HTMLAttributes<HTMLElement>, 'data'> {
  /** Dashboard data */
  data?: DashboardData
  /** Show loading state */
  loading?: boolean
  /** Error message */
  error?: string
  /** Retry callback on error */
  onRetry?: () => void
  /** Navigation callback */
  onNavigate?: (path: string) => void
  /** Current auto-refresh health, threaded into the header indicator */
  liveStatus?: LiveStatus
}

function getExecutionsSubtitle(metrics: DashboardMetrics['executions']): ReactNode {
  if (metrics.count === 0) return undefined
  return (
    <>
      <span className="text-info">{metrics.running} running</span>
      {', '}
      <span className="text-success">{metrics.passed} passed</span>
      {', '}
      <span className="text-error">{metrics.failed} failed</span>
    </>
  )
}

function DashboardErrorState({
  baseClasses, error, onRetry, ...props
}: Readonly<{ baseClasses: string; error: string; onRetry?: () => void } & HTMLAttributes<HTMLElement>>) {
  return (
    <div data-testid="dashboard-page" className={baseClasses} {...props}>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <p className="text-error mb-4">{error}</p>
        <button type="button" onClick={onRetry} className="btn btn-primary">
          Retry
        </button>
      </div>
    </div>
  )
}

function DashboardLoadingState({
  baseClasses, ...props
}: Readonly<{ baseClasses: string } & HTMLAttributes<HTMLElement>>) {
  return (
    <div data-testid="dashboard-page" className={baseClasses} aria-busy="true" {...props}>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div
        data-testid="dashboard-metrics-row"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {['sk-0', 'sk-1', 'sk-2', 'sk-3'].map((skKey) => (
          <div key={skKey} data-skeleton className="card rounded-lg border bg-card p-4 animate-pulse">
            <div className="h-3 bg-subtle rounded w-16 mb-2" />
            <div className="h-8 bg-subtle rounded w-12 mb-1" />
            <div className="h-3 bg-subtle rounded w-24" />
          </div>
        ))}
      </div>
      <div
        data-testid="dashboard-middle-row"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <div data-skeleton className="card rounded-lg border bg-card p-0 h-64 animate-pulse" />
        <div data-skeleton className="card rounded-lg border bg-card p-0 h-64 animate-pulse" />
      </div>
      <div data-skeleton className="card rounded-lg border bg-card p-0 h-32 animate-pulse" />
    </div>
  )
}

function buildNavigateHandler(
  onNavigate: ((path: string) => void) | undefined,
  path: string,
): (() => void) | undefined {
  return onNavigate ? () => onNavigate(path) : undefined
}

function DashboardMetricsRow({
  metrics,
  onNavigate,
}: Readonly<{
  metrics: DashboardMetrics
  onNavigate?: (path: string) => void
}>) {
  return (
    <div
      data-testid="dashboard-metrics-row"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <MetricCard
        label="Tests"
        count={metrics.tests.count}
        onClick={buildNavigateHandler(onNavigate, '/tests')}
        testId="metric-card-tests"
      />
      <MetricCard
        label="Suites"
        count={metrics.suites.count}
        onClick={buildNavigateHandler(onNavigate, '/suites')}
        testId="metric-card-suites"
      />
      <MetricCard
        label="Regressions"
        count={metrics.regressions.count}
        onClick={buildNavigateHandler(onNavigate, '/regressions')}
        testId="metric-card-regressions"
      />
      <MetricCard
        label="Executions (24h)"
        count={metrics.executions.count}
        subtitle={getExecutionsSubtitle(metrics.executions)}
        onClick={buildNavigateHandler(onNavigate, '/executions')}
        testId="metric-card-executions"
      />
    </div>
  )
}

function DashboardMiddleRow({
  recentActivity,
  recentExecutions,
  onNavigate,
}: Readonly<{
  recentActivity: Activity[]
  recentExecutions: Execution[]
  onNavigate?: (path: string) => void
}>) {
  return (
    <div
      data-testid="dashboard-middle-row"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[263px] auto-rows-fr"
    >
      <RecentActivity activities={recentActivity} />
      <RecentExecutions
        executions={recentExecutions}
        onExecutionClick={(id) => {
          onNavigate?.(`/executions/${id}`)
        }}
      />
    </div>
  )
}

export function DashboardPage({
  data,
  loading = false,
  error,
  onRetry,
  onNavigate,
  liveStatus,
  className = '',
  ...props
}: Readonly<DashboardPageProps>) {
  const baseClasses = cn(
    'flex',
    'flex-col',
    'gap-6',
    'px-6',
    'pt-6',
    'pb-4', // Smaller bottom padding so Quick Actions anchors closer to bottom
    'h-full', // Fill container exactly, no page scroll
    'overflow-hidden', // Prevent page scroll, cards scroll internally
    className
  )

  if (error) {
    return <DashboardErrorState baseClasses={baseClasses} error={error} onRetry={onRetry} {...props} />
  }

  if (loading) {
    return <DashboardLoadingState baseClasses={baseClasses} {...props} />
  }

  if (!data) {
    return null
  }

  const { metrics, recentActivity, recentExecutions } = data

  return (
    <div
      data-testid="dashboard-page"
      className={baseClasses}
      {...props}
    >
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {liveStatus && <LastUpdatedIndicator status={liveStatus} />}
      </div>

      <DashboardMetricsRow metrics={metrics} onNavigate={onNavigate} />
      <DashboardMiddleRow
        recentActivity={recentActivity}
        recentExecutions={recentExecutions}
        onNavigate={onNavigate}
      />

      {/* Quick Actions */}
      <QuickActions
        onNewTest={buildNavigateHandler(onNavigate, '/tests/new')}
        onRunRegression={buildNavigateHandler(onNavigate, '/regressions')}
        onViewReports={buildNavigateHandler(onNavigate, '/reports')}
      />
    </div>
  )
}
