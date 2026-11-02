/**
 * Dashboard API Client
 *
 * Provides typed fetch function and response transformation for the dashboard endpoint.
 * Types match backend response structure from GET /dashboard.
 */

import type { Activity, Execution } from './types'
import { apiClient } from '@/lib/api'

// ============================================================================
// API Response Types (match backend exactly)
// ============================================================================

/**
 * Entity count metric from backend
 */
export interface ApiEntityCount {
  count: number
}

/**
 * Execution statistics from backend
 */
export interface ApiExecutionStats {
  sinceDays: number
  count: number
  running: number
  passed: number
  failed: number
}

/**
 * Dashboard metrics from backend
 */
export interface ApiDashboardMetrics {
  tests: ApiEntityCount
  suites: ApiEntityCount
  regressions: ApiEntityCount | null
  executions: ApiExecutionStats
}

/**
 * Recent activity item from backend
 *
 * Backend returns raw data, frontend builds display strings:
 * - Tests: include suiteCount (how many suites this test belongs to; 0 = unassigned)
 * - Suites/Regressions: include testCount
 */
export interface ApiActivityItem {
  id: string
  type: string
  name: string
  timestamp: string
  /** For tests: number of suites this test belongs to (0 means unassigned). */
  suiteCount?: number
  /** For suites/regressions: number of tests */
  testCount?: number
}

/**
 * Recent execution item from backend
 */
export interface ApiRecentExecution {
  id: string
  environment: string
  entityName: string
  entityType: string
  progress: number
  startedAt: string
  status: string
  testsTotal: number
  testsDone: number
}

/**
 * Response metadata from backend
 */
export interface ApiDashboardMeta {
  timestamp: string
  errors: string[]
}

/**
 * Complete dashboard API response from backend
 */
export interface ApiDashboardResponse {
  metrics: ApiDashboardMetrics
  recentActivity: ApiActivityItem[] | null
  recentExecutions: ApiRecentExecution[] | null
  meta: ApiDashboardMeta
}

// ============================================================================
// Fetch Function
// ============================================================================

/**
 * Fetch dashboard data from the backend API
 *
 * @returns Promise resolving to the API response
 * @throws Error on network failure or non-OK response
 */
export async function fetchDashboardApi(options?: {
  timeout?: number
}): Promise<ApiDashboardResponse> {
  try {
    const response = await apiClient.get<ApiDashboardResponse>('/dashboard', {
      rawResponse: true,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
    })
    return response.data
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      const err = e as { status?: number; message: string }
      if (err.status === 503) throw new Error('Dashboard service unavailable', { cause: e })
      // A request that never reached the server carries no status to name.
      const reason = err.status === undefined ? err.message : `${err.status} ${err.message}`
      throw new Error(`Failed to fetch dashboard: ${reason}`, { cause: e })
    }
    throw e
  }
}



// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Format entity type for display (capitalize first letter)
 */
function formatEntityType(entityType: string): string {
  if (!entityType) return 'Test'
  return entityType.charAt(0).toUpperCase() + entityType.slice(1)
}

/**
 * Format "Edited x time ago" from timestamp
 */
function formatEditedTime(timestamp: string): string {
  if (!timestamp) return ''

  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'Edited just now'
  } else if (diffMinutes < 60) {
    return `Edited ${diffMinutes}m ago`
  } else if (diffHours < 24) {
    return `Edited ${diffHours}h ago`
  } else {
    return `Edited ${diffDays}d ago`
  }
}

/**
 * Build activity context string per wireframe format:
 * - Tests: "Test · <N suite(s) or 'Unassigned'> · Edited x time ago"
 * - Suites: "Suite · <test count> tests · Edited x time ago"
 * - Regressions: "Regression · <total test count> tests · Edited x time ago"
 */
function buildActivityContext(item: ApiActivityItem): string {
  const typeDisplay = formatEntityType(item.type)
  const editedTime = formatEditedTime(item.timestamp)

  if (item.type === 'test') {
    const suiteCount = item.suiteCount ?? 0
    let suiteText: string
    if (suiteCount === 0) suiteText = 'Unassigned'
    else if (suiteCount === 1) suiteText = '1 suite'
    else suiteText = `${suiteCount} suites`
    const parts = [typeDisplay, suiteText]
    if (editedTime) parts.push(editedTime)
    return parts.join(' · ')
  } else if (item.type === 'suite' || item.type === 'regression') {
    const count = item.testCount ?? 0
    const countText = count === 1 ? '1 test' : `${count} tests`
    const parts = [typeDisplay, countText]
    if (editedTime) parts.push(editedTime)
    return parts.join(' · ')
  } else {
    // Fallback for unknown types
    if (editedTime) {
      return `${typeDisplay} · ${editedTime}`
    }
    return typeDisplay
  }
}

/**
 * Transform API activity item to component Activity type
 */
export function transformActivity(item: ApiActivityItem): Activity {
  return {
    id: item.id,
    type: item.type as Activity['type'],
    name: item.name,
    context: buildActivityContext(item),
    status: undefined,
  }
}

/**
 * Format a duration (in ms) at a single coarsest unit: s, m, h, or d.
 * Past 1 minute we stop showing seconds; past 1 hour we stop showing
 * minutes; past 1 day we stop showing hours. Keeping a single unit avoids
 * ticking-noise for glance views (e.g. "1m" doesn't turn into "1m 7s"
 * → "1m 8s" every second).
 */
function formatDuration(diffMs: number): string {
  const seconds = Math.max(0, Math.floor(diffMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/**
 * Format elapsed time from a timestamp (for running executions).
 * Returns a single coarsest unit, e.g. "42s" / "5m" / "2h" / "3d".
 */
function formatElapsedTime(timestamp: string): string {
  if (!timestamp) return ''
  const startedAt = new Date(timestamp)
  return formatDuration(Date.now() - startedAt.getTime())
}

/**
 * Format a relative "N ago" string from a timestamp (for completed executions).
 * Returns e.g. "42s ago" / "5m ago" / "2h ago" / "3d ago".
 */
function formatTimeAgo(timestamp: string): string {
  if (!timestamp) return ''
  const startedAt = new Date(timestamp)
  return `${formatDuration(Date.now() - startedAt.getTime())} ago`
}

/**
 * Transform API recent execution to component Execution type
 *
 * StatusInfo formats (for suite/regression):
 * - Running: "Running · 67% · 5m · 50/150 tests done"
 * - Passed:  "Passed · 2m ago · 150/150 tests done"
 * - Failed:  "Failed · 15m ago · 5/10 tests done"
 *
 * For single test executions (no "tests done" fragment):
 * - Running: "Running · 67% · 5m"
 * - Passed:  "Passed · 2m ago"
 * - Failed:  "Failed · 15m ago"
 */
export function transformExecution(item: ApiRecentExecution): Execution {
  // Build breadcrumb name: Type > Name > Environment
  const entityType = formatEntityType(item.entityType)
  const environment = item.environment
    ? item.environment.charAt(0).toUpperCase() + item.environment.slice(1)
    : 'Default'
  const name = `${entityType} > ${item.entityName} > ${environment}`

  const testsTotal = item.testsTotal ?? 0
  const testsDone = item.testsDone ?? 0

  // Only show "tests done" for suites and regressions, not single tests
  const isMultiTest = item.entityType === 'suite' || item.entityType === 'regression'
  const testsDisplay = isMultiTest ? `${testsDone}/${testsTotal} tests done` : ''

  // Build statusInfo based on execution status
  let statusInfo: string

  if (item.status === 'running') {
    const percentage = `${item.progress}%`
    const elapsed = formatElapsedTime(item.startedAt)
    const parts = ['Running', percentage, elapsed]
    if (testsDisplay) parts.push(testsDisplay)
    statusInfo = parts.join(' · ')
  } else {
    const statusDisplay = item.status.charAt(0).toUpperCase() + item.status.slice(1)
    const timeAgo = formatTimeAgo(item.startedAt)
    const parts = [statusDisplay, timeAgo]
    if (testsDisplay) parts.push(testsDisplay)
    statusInfo = parts.join(' · ')
  }

  return {
    id: item.id,
    name,
    status: item.status as Execution['status'],
    statusInfo,
    progress: item.progress,
    testsTotal,
    testsDone,
  }
}

/**
 * Transform complete API response to component-compatible format
 */
export function transformDashboardResponse(response: ApiDashboardResponse): {
  metrics: {
    tests: { count: number }
    suites: { count: number }
    regressions: { count: number }
    executions: { sinceDays: number; count: number; running: number; passed: number; failed: number }
  }
  recentActivity: Activity[]
  recentExecutions: Execution[]
} {
  return {
    metrics: {
      tests: response.metrics.tests,
      suites: response.metrics.suites,
      regressions: response.metrics.regressions ?? { count: 0 },
      executions: response.metrics.executions,
    },
    recentActivity: (response.recentActivity ?? []).map(transformActivity),
    recentExecutions: (response.recentExecutions ?? []).map(transformExecution),
  }
}

// ============================================================================
// High-Level Fetch with Transformation
// ============================================================================

/**
 * Fetch and transform dashboard data for component consumption
 *
 * @returns Promise resolving to transformed dashboard data
 */
export async function fetchDashboard(options?: { timeout?: number }) {
  const response = await fetchDashboardApi(options)
  return transformDashboardResponse(response)
}
