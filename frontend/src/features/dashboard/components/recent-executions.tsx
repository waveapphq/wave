/**
 * RecentExecutions Section Component
 *
 * V-DASH-01, V-DASH-02: Dashboard Recent Executions section
 *
 * Displays a grid of recent execution cards with header, empty state, and loading state.
 * Shows all executions within the last 24 hours, not just running ones.
 */

import { type HTMLAttributes } from 'react'
/* v8 ignore next - COV-V8-001 */
import { cn } from '@/lib/utils'
import { ExecutionCard } from './execution-card'
import type { Execution, ExecutionStatus } from '@/features/dashboard/api/types'

export type { Execution } from '@/features/dashboard/api/types'

export interface RecentExecutionsProps extends HTMLAttributes<HTMLElement> {
  /** List of executions to display */
  executions: Execution[]
  /** Show loading skeleton state */
  loading?: boolean
  /** Maximum number of executions to display */
  maxExecutions?: number
  /** Callback when an execution card is clicked */
  onExecutionClick?: (id: string) => void
  /** Callback when "View All" is clicked */
  onViewAll?: () => void
  /** Filter to show only specific statuses */
  filterStatus?: ExecutionStatus[]
}

export function RecentExecutions({
  executions,
  loading = false,
  maxExecutions,
  onExecutionClick,
  onViewAll,
  filterStatus,
  className = '',
  ...props
}: Readonly<RecentExecutionsProps>) {
  // Apply status filter if provided
  const filteredExecutions = filterStatus
    ? executions.filter((exec) => filterStatus.includes(exec.status))
    : executions

  // Apply max limit
  const displayedExecutions = maxExecutions
    ? filteredExecutions.slice(0, maxExecutions)
    : filteredExecutions

  const hasMore = maxExecutions !== undefined && filteredExecutions.length > maxExecutions
  const remainingCount = hasMore ? filteredExecutions.length - maxExecutions : 0

  const sectionClasses = cn(
    'flex',
    'flex-col',
    'gap-2',
    'h-full', // Fill grid cell for equal heights
    'min-h-[263px]', // Minimum height for 5 rows (matches Recent Activity)
    className
  )

  const cardClasses = cn(
    'card',
    'rounded-lg',
    'border',
    'bg-card',
    'p-0',
    'flex',
    'flex-col',
    'h-0', // Force to take exactly allocated space
    'flex-grow', // Grow to fill section
    'overflow-hidden',
    'transition-opacity',
    'motion-reduce:transition-none'
  )

  const loadingProps = loading ? { 'aria-busy': 'true' as const } : {}

  return (
    <section
      data-testid="recent-executions-section"
      className={sectionClasses}
      aria-labelledby="recent-executions-header"
      {...loadingProps}
      {...props}
    >
      {/* Header - outside card per wireframe */}
      <h2
        id="recent-executions-header"
        className="text-base font-medium"
      >
        Recent Executions
      </h2>

      {/* Card with content */}
      <div className={cardClasses}>
        {(() => {
          if (loading) {
            return (
              <div className="divide-y px-4">
                {['sk-0', 'sk-1', 'sk-2'].map((skKey) => (
                  <div
                    key={skKey}
                    data-skeleton
                    data-skeleton-item
                    className="py-3 animate-pulse"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-muted" />
                      <div className="h-4 bg-muted rounded w-3/4" />
                    </div>
                    <div className="h-3 bg-muted rounded w-1/2 ml-4 mb-1" />
                    <div className="h-1 bg-muted rounded-full w-full ml-4 mt-1" style={{ width: 'calc(100% - 16px)' }} />
                  </div>
                ))}
              </div>
            )
          }
          if (executions.length === 0) {
            return (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <output
                  data-testid="empty-state-title"
                  className="text-sm font-medium text-primary mb-1 block"
                >
                  No recent executions
                </output>
                <p
                  data-testid="empty-state-description"
                  className="text-xs text-muted"
                >
                  Run a test or regression to see progress
                </p>
              </div>
            )
          }
          return (
            <>
              <div
                data-executions-list
                aria-label="Recent execution list"
                className="divide-y px-4 flex-1 overflow-y-auto"
              >
                {displayedExecutions.map((execution) => (
                  <ExecutionCard
                    key={execution.id}
                    id={execution.id}
                    name={execution.name}
                    status={execution.status}
                    statusInfo={execution.statusInfo}
                    progress={execution.progress}
                    onClick={onExecutionClick}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="px-4 py-3 border-t flex items-center gap-1">
                  <button
                    type="button"
                    onClick={onViewAll}
                    className="text-sm text-primary hover:underline"
                  >
                    View All
                  </button>
                  <span className="text-sm text-muted">{` (${remainingCount} more)`}</span>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </section>
  )
}
