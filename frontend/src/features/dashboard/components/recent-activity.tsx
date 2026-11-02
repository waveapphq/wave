/**
 * RecentActivity Section Component
 *
 * V-DASH-01, V-DASH-02: Dashboard Recent Activity section
 *
 * Displays a list of recent activity items with header, empty state, and loading state.
 */

import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { ActivityItem } from './activity-item'
import type { Activity } from '@/features/dashboard/api/types'

export type { Activity } from '@/features/dashboard/api/types'

export interface RecentActivityProps extends HTMLAttributes<HTMLElement> {
  /** List of activities to display */
  activities: Activity[]
  /** Show loading skeleton state */
  loading?: boolean
  /** Maximum number of items to display */
  maxItems?: number
  /** Callback when "View All" is clicked */
  onViewAll?: () => void
}

export function RecentActivity({
  activities,
  loading = false,
  maxItems,
  onViewAll,
  className = '',
  ...props
}: Readonly<RecentActivityProps>) {
  const displayedActivities = maxItems ? activities.slice(0, maxItems) : activities
  const hasMore = maxItems !== undefined && activities.length > maxItems

  const sectionClasses = cn(
    'flex',
    'flex-col',
    'gap-2',
    'h-full', // Fill grid cell for equal heights
    'min-h-[263px]', // Minimum height for 5 rows
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
      data-testid="recent-activity-section"
      className={sectionClasses}
      aria-labelledby="recent-activity-header"
      {...loadingProps}
      {...props}
    >
      {/* Header - outside card per wireframe */}
      <h2
        id="recent-activity-header"
        className="text-base font-medium"
      >
        Recent Activity
      </h2>

      {/* Card with content */}
      <div className={cardClasses}>
        {(() => {
          if (loading) {
            return (
              <div className="p-4 space-y-3">
                {['sk-0', 'sk-1', 'sk-2'].map((skKey) => (
                  <div key={skKey} data-skeleton data-skeleton-item className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-subtle animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-subtle rounded w-3/4 animate-pulse" />
                      <div className="h-3 bg-subtle rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )
          }
          if (activities.length === 0) {
            return (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <output
                  data-testid="empty-state-title"
                  className="text-sm font-medium text-primary mb-1 block"
                >
                  No recent activity
                </output>
                <p
                  data-testid="empty-state-description"
                  className="text-xs text-muted"
                >
                  Create your first test to get started
                </p>
              </div>
            )
          }
          return (
            <>
              <ul
                data-testid="activity-list"
                aria-label="Recent activity items"
                className="divide-y flex-1 overflow-y-auto"
              >
                {displayedActivities.map((activity) => (
                  <li key={activity.id}>
                    <ActivityItem
                      type={activity.type}
                      name={activity.name}
                      context={activity.context}
                      status={activity.status}
                    />
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="px-4 py-3 border-t">
                  <button
                    type="button"
                    onClick={onViewAll}
                    className="text-sm text-primary hover:underline"
                  >
                    View All
                  </button>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </section>
  )
}
