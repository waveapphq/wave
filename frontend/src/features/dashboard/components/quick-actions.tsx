/**
 * QuickActions Section Component
 *
 * V-DASH-01, V-DASH-02: Dashboard Quick Actions section
 * DASH-3: Quick Actions section with common workflows
 *
 * Displays a grid of quick action cards.
 */

import { type HTMLAttributes } from 'react'
/* v8 ignore next - COV-V8-001 */
import { cn } from '@/lib/utils'
import { QuickActionCard } from './quick-action-card'

export type DisabledAction = 'new-test' | 'run-regression' | 'view-reports'

export interface QuickActionsProps extends HTMLAttributes<HTMLElement> {
  /** Show loading skeleton state */
  loading?: boolean
  /** Callback when New Test is clicked */
  onNewTest?: () => void
  /** Callback when Run Regression is clicked */
  onRunRegression?: () => void
  /** Callback when View Reports is clicked */
  onViewReports?: () => void
  /** List of disabled actions */
  disabledActions?: DisabledAction[]
}

export function QuickActions({
  loading = false,
  onNewTest,
  onRunRegression,
  onViewReports,
  disabledActions = [],
  className = '',
  ...props
}: Readonly<QuickActionsProps>) {
  const isDisabled = (action: DisabledAction) => disabledActions.includes(action)

  const sectionClasses = cn(
    'flex',
    'flex-col',
    'gap-2',
    'flex-shrink-0', // Prevent Quick Actions from being squeezed out
    className
  )

  const cardClasses = cn(
    'card',
    'rounded-lg',
    'border',
    'bg-card',
    'p-0',
    'transition-opacity',
    'motion-reduce:transition-none'
  )

  const gridClasses = cn(
    'grid',
    'gap-4',
    'p-4',
    'grid-cols-1',
    'sm:grid-cols-3'
  )

  const loadingProps = loading ? { 'aria-busy': 'true' as const } : {}

  return (
    <section
      data-testid="quick-actions-section"
      className={sectionClasses}
      aria-labelledby="quick-actions-header"
      {...loadingProps}
      {...props}
    >
      {/* Header - outside card per wireframe */}
      <h2
        id="quick-actions-header"
        className="text-base font-medium"
      >
        Quick Actions
      </h2>

      {/* Card with content */}
      <div className={cardClasses}>
        {loading ? (
          <div className={gridClasses}>
          {['sk-0', 'sk-1', 'sk-2'].map((skKey) => (
            <div
              key={skKey}
              data-skeleton
              data-skeleton-card
              className="p-4 border rounded-lg bg-subtle animate-pulse flex flex-col items-center gap-2"
            >
              <div className="w-6 h-6 rounded bg-muted" />
              <div className="h-4 bg-muted rounded w-20" />
              <div className="h-3 bg-muted rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <div data-actions-grid className={gridClasses}>
          <QuickActionCard
            icon="plus"
            title="New Test"
            description="Create a new test from scratch"
            testId="quick-action-new-test"
            onClick={onNewTest || (() => {})}
            disabled={isDisabled('new-test')}
          />
          <QuickActionCard
            icon="play"
            title="Run Regression"
            description="Execute a regression test suite"
            testId="quick-action-run-regression"
            onClick={onRunRegression || (() => {})}
            disabled={isDisabled('run-regression')}
          />
          <QuickActionCard
            icon="bar-chart"
            title="View Reports"
            description="Analyze test results and trends"
            testId="quick-action-view-reports"
            onClick={onViewReports || (() => {})}
            disabled={isDisabled('view-reports')}
          />
        </div>
      )}
      </div>
    </section>
  )
}
