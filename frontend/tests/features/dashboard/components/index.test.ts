/**
 * Dashboard Components Public API Tests
 *
 * V-DASH-01, V-DASH-02: the dashboard components barrel exposes each component
 * exactly as its own module defines it.
 *
 * Module: frontend/src/features/dashboard/components/index.ts
 */

import { describe, it, expect } from 'vitest'
import * as dashboardComponents from '@/features/dashboard/components/index'
import { MetricCard } from '@/features/dashboard/components/metric-card'
import { ActivityItem } from '@/features/dashboard/components/activity-item'
import { RecentActivity } from '@/features/dashboard/components/recent-activity'
import { ExecutionCard } from '@/features/dashboard/components/execution-card'
import { RecentExecutions } from '@/features/dashboard/components/recent-executions'
import { QuickActionCard } from '@/features/dashboard/components/quick-action-card'
import { QuickActions } from '@/features/dashboard/components/quick-actions'

describe('dashboard components barrel', () => {
  it('re-exports every component from its own module', () => {
    expect(dashboardComponents.MetricCard).toBe(MetricCard)
    expect(dashboardComponents.ActivityItem).toBe(ActivityItem)
    expect(dashboardComponents.RecentActivity).toBe(RecentActivity)
    expect(dashboardComponents.ExecutionCard).toBe(ExecutionCard)
    expect(dashboardComponents.RecentExecutions).toBe(RecentExecutions)
    expect(dashboardComponents.QuickActionCard).toBe(QuickActionCard)
    expect(dashboardComponents.QuickActions).toBe(QuickActions)
  })

  it('exposes nothing beyond those components', () => {
    expect(new Set(Object.keys(dashboardComponents))).toEqual(new Set([
      'ActivityItem',
      'ExecutionCard',
      'MetricCard',
      'QuickActionCard',
      'QuickActions',
      'RecentActivity',
      'RecentExecutions',
    ]))
  })
})
