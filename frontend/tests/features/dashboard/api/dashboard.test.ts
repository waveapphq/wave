/**
 * Dashboard API Tests
 *
 * Tests for dashboard API fetch and transformation functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchDashboardApi,
  fetchDashboard,
  transformActivity,
  transformExecution,
  transformDashboardResponse,
  type ApiActivityItem,
  type ApiRecentExecution,
  type ApiDashboardResponse,
} from '@/features/dashboard/api/dashboard'
import { apiClient } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:8000' })),
  },
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
}))

describe('Dashboard API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Set a fixed "now" time for consistent time-based tests
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('transformActivity', () => {
    it('transforms test activity assigned to a single suite', () => {
      const item: ApiActivityItem = {
        id: 'test-1',
        type: 'test',
        name: 'Login Test',
        timestamp: '2025-01-15T11:30:00Z',
        suiteCount: 1,
      }

      const result = transformActivity(item)

      expect(result.id).toBe('test-1')
      expect(result.type).toBe('test')
      expect(result.name).toBe('Login Test')
      expect(result.context).toContain('Test')
      expect(result.context).toContain('1 suite')
      expect(result.context).not.toContain('1 suites')
      expect(result.context).toContain('Edited 30m ago')
    })

    it('transforms test activity assigned to multiple suites', () => {
      const item: ApiActivityItem = {
        id: 'test-1b',
        type: 'test',
        name: 'Shared Test',
        timestamp: '2025-01-15T11:30:00Z',
        suiteCount: 3,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('3 suites')
    })

    it('transforms test activity without any suite (unassigned)', () => {
      const item: ApiActivityItem = {
        id: 'test-2',
        type: 'test',
        name: 'Standalone Test',
        timestamp: '2025-01-15T11:00:00Z',
        suiteCount: 0,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Unassigned')
      expect(result.context).toContain('Edited 1h ago')
    })

    it('treats missing suiteCount as unassigned (defensive default)', () => {
      const item: ApiActivityItem = {
        id: 'test-2b',
        type: 'test',
        name: 'No Suite Field',
        timestamp: '2025-01-15T11:00:00Z',
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Unassigned')
    })

    it('transforms suite activity with test count', () => {
      const item: ApiActivityItem = {
        id: 'suite-1',
        type: 'suite',
        name: 'API Tests',
        timestamp: '2025-01-15T11:45:00Z',
        testCount: 15,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Suite')
      expect(result.context).toContain('15 tests')
      expect(result.context).toContain('Edited 15m ago')
    })

    it('transforms suite with single test (singular form)', () => {
      const item: ApiActivityItem = {
        id: 'suite-2',
        type: 'suite',
        name: 'Single Test Suite',
        timestamp: '2025-01-15T11:55:00Z',
        testCount: 1,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('1 test')
    })

    it('transforms regression activity', () => {
      const item: ApiActivityItem = {
        id: 'reg-1',
        type: 'regression',
        name: 'Full Regression',
        timestamp: '2025-01-14T12:00:00Z',
        testCount: 100,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Regression')
      expect(result.context).toContain('100 tests')
      expect(result.context).toContain('Edited 1d ago')
    })

    it('handles unknown entity type', () => {
      const item: ApiActivityItem = {
        id: 'unknown-1',
        type: 'workflow',
        name: 'Custom Workflow',
        timestamp: '2025-01-15T11:59:00Z',
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Workflow')
      expect(result.context).toContain('Edited 1m ago')
    })

    it('handles empty timestamp', () => {
      const item: ApiActivityItem = {
        id: 'test-3',
        type: 'test',
        name: 'No Timestamp Test',
        timestamp: '',
        suiteCount: 1,
      }

      const result = transformActivity(item)

      expect(result.context).toBe('Test · 1 suite')
    })

    it('handles "just now" for very recent edits', () => {
      const item: ApiActivityItem = {
        id: 'test-4',
        type: 'test',
        name: 'Recent Test',
        timestamp: '2025-01-15T11:59:45Z', // 15 seconds ago
        suiteCount: 2,
      }

      const result = transformActivity(item)

      expect(result.context).toContain('Edited just now')
    })

    it('handles missing testCount for suite', () => {
      const item: ApiActivityItem = {
        id: 'suite-3',
        type: 'suite',
        name: 'Empty Suite',
        timestamp: '2025-01-15T11:00:00Z',
      }

      const result = transformActivity(item)

      expect(result.context).toContain('0 tests')
    })

    it('handles empty entity type', () => {
      const item: ApiActivityItem = {
        id: 'empty-type',
        type: '',
        name: 'Empty Type',
        timestamp: '2025-01-15T11:00:00Z',
      }

      const result = transformActivity(item)

      // formatEntityType returns 'Test' for empty type
      expect(result.context).toContain('Test')
    })

    it('handles unknown type with no timestamp', () => {
      const item: ApiActivityItem = {
        id: 'unknown-2',
        type: 'custom',
        name: 'Custom Entity',
        timestamp: '',
      }

      const result = transformActivity(item)

      // Should just return the type display without edited time
      expect(result.context).toBe('Custom')
    })
  })

  describe('transformExecution', () => {
    it('transforms running execution for suite', () => {
      const item: ApiRecentExecution = {
        id: 'exec-1',
        environment: 'staging',
        entityName: 'API Tests',
        entityType: 'suite',
        progress: 67,
        startedAt: '2025-01-15T11:47:26Z', // ~12m 34s ago
        status: 'running',
        testsTotal: 150,
        testsDone: 150,
      }

      const result = transformExecution(item)

      expect(result.id).toBe('exec-1')
      expect(result.name).toBe('Suite > API Tests > Staging')
      expect(result.status).toBe('running')
      expect(result.statusInfo).toContain('Running')
      expect(result.statusInfo).toContain('67%')
      expect(result.statusInfo).toContain('150/150 tests done')
      expect(result.progress).toBe(67)
    })

    it('transforms passed execution for regression', () => {
      const item: ApiRecentExecution = {
        id: 'exec-2',
        environment: 'production',
        entityName: 'Full Regression',
        entityType: 'regression',
        progress: 100,
        startedAt: '2025-01-15T11:57:45Z', // 2m 15s ago
        status: 'passed',
        testsTotal: 15,
        testsDone: 15,
      }

      const result = transformExecution(item)

      expect(result.name).toBe('Regression > Full Regression > Production')
      expect(result.status).toBe('passed')
      expect(result.statusInfo).toContain('Passed')
      expect(result.statusInfo).toContain('15/15 tests done')
    })

    it('transforms failed execution', () => {
      const item: ApiRecentExecution = {
        id: 'exec-3',
        environment: 'dev',
        entityName: 'Login Flow',
        entityType: 'suite',
        progress: 50,
        startedAt: '2025-01-15T11:45:00Z', // 15m ago
        status: 'failed',
        testsTotal: 10,
        testsDone: 5,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('Failed')
      expect(result.statusInfo).toContain('15m ago')
      expect(result.statusInfo).toContain('5/10 tests done')
    })

    it('transforms single test execution (no tests done display)', () => {
      const item: ApiRecentExecution = {
        id: 'exec-4',
        environment: 'local',
        entityName: 'Unit Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T11:58:00Z',
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.name).toBe('Test > Unit Test > Local')
      expect(result.statusInfo).not.toContain('tests done')
    })

    it('handles running execution with elapsed hours (single-unit format drops minutes)', () => {
      const item: ApiRecentExecution = {
        id: 'exec-5',
        environment: 'staging',
        entityName: 'Long Running',
        entityType: 'suite',
        progress: 25,
        startedAt: '2025-01-15T10:55:00Z', // 1h 5m ago - shows as "1h"
        status: 'running',
        testsTotal: 1000,
        testsDone: 500,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('1h')
      expect(result.statusInfo).not.toContain('1h 5m')
    })

    it('handles running execution with elapsed days (single-unit format drops hours)', () => {
      const item: ApiRecentExecution = {
        id: 'exec-5d',
        environment: 'staging',
        entityName: 'Very Long',
        entityType: 'suite',
        progress: 10,
        startedAt: '2025-01-13T08:30:00Z', // ~2d 3h 30m ago - shows as "2d"
        status: 'running',
        testsTotal: 100,
        testsDone: 10,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('2d')
      expect(result.statusInfo).not.toContain('2d 3h')
    })

    it('stops counting seconds past 1 minute (running)', () => {
      const item: ApiRecentExecution = {
        id: 'exec-5min',
        environment: 'dev',
        entityName: 'Five Min',
        entityType: 'suite',
        progress: 30,
        startedAt: '2025-01-15T11:54:30Z', // 5m 30s ago - shows as "5m"
        status: 'running',
        testsTotal: 10,
        testsDone: 3,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('5m')
      expect(result.statusInfo).not.toContain('5m 30s')
    })

    it('handles execution started seconds ago', () => {
      const item: ApiRecentExecution = {
        id: 'exec-6',
        environment: 'dev',
        entityName: 'Quick Test',
        entityType: 'test',
        progress: 0,
        startedAt: '2025-01-15T11:59:45Z', // 15 seconds ago
        status: 'running',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('15s')
    })

    it('handles empty environment', () => {
      const item: ApiRecentExecution = {
        id: 'exec-7',
        environment: '',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T11:00:00Z',
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.name).toContain('Default')
    })

    it('handles missing testsTotal/testsDone', () => {
      const item: ApiRecentExecution = {
        id: 'exec-8',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'suite',
        progress: 100,
        startedAt: '2025-01-15T11:00:00Z',
        status: 'passed',
      } as ApiRecentExecution

      const result = transformExecution(item)

      expect(result.testsTotal).toBe(0)
      expect(result.testsDone).toBe(0)
    })

    it('handles empty startedAt for time ago', () => {
      const item: ApiRecentExecution = {
        id: 'exec-9',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '',
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toBe('Passed · ')
    })

    it('handles time ago with minutes and no remaining seconds', () => {
      const item: ApiRecentExecution = {
        id: 'exec-10',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T11:55:00Z', // Exactly 5m ago
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('5m ago')
    })

    it('handles time ago with seconds only', () => {
      const item: ApiRecentExecution = {
        id: 'exec-11',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T11:59:30Z', // 30 seconds ago
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('30s ago')
    })

    it('handles time ago with hours', () => {
      const item: ApiRecentExecution = {
        id: 'exec-12',
        environment: 'dev',
        entityName: 'Test',
        entityType: 'test',
        progress: 100,
        startedAt: '2025-01-15T10:00:00Z', // 2 hours ago
        status: 'passed',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.statusInfo).toContain('2h ago')
    })

    it('handles execution with empty startedAt timestamp', () => {
      const item: ApiRecentExecution = {
        id: 'exec-empty',
        environment: 'dev',
        entityName: 'Test Empty',
        entityType: 'test',
        progress: 50,
        startedAt: '', // Empty timestamp
        status: 'running',
        testsTotal: 1,
        testsDone: 1,
      }

      const result = transformExecution(item)

      expect(result.id).toBe('exec-empty')
      expect(result.statusInfo).toContain('Running')
    })
  })

  describe('transformDashboardResponse', () => {
    it('transforms complete API response', () => {
      const response: ApiDashboardResponse = {
        metrics: {
          tests: { count: 100 },
          suites: { count: 10 },
          regressions: { count: 5 },
          executions: { sinceDays: 7, count: 50, running: 2, passed: 45, failed: 3 },
        },
        recentActivity: [
          { id: 'test-1', type: 'test', name: 'Test 1', timestamp: '2025-01-15T11:00:00Z', suiteCount: 1 },
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

      const result = transformDashboardResponse(response)

      expect(result.metrics.tests.count).toBe(100)
      expect(result.metrics.suites.count).toBe(10)
      expect(result.metrics.regressions.count).toBe(5)
      expect(result.metrics.executions.count).toBe(50)
      expect(result.recentActivity).toHaveLength(1)
      expect(result.recentExecutions).toHaveLength(1)
    })

    it('handles null recentActivity', () => {
      const response: ApiDashboardResponse = {
        metrics: {
          tests: { count: 0 },
          suites: { count: 0 },
          regressions: null,
          executions: { sinceDays: 7, count: 0, running: 0, passed: 0, failed: 0 },
        },
        recentActivity: null,
        recentExecutions: null,
        meta: { timestamp: '2025-01-15T12:00:00Z', errors: [] },
      }

      const result = transformDashboardResponse(response)

      expect(result.recentActivity).toEqual([])
      expect(result.recentExecutions).toEqual([])
      expect(result.metrics.regressions.count).toBe(0)
    })
  })

  describe('fetchDashboardApi', () => {
    it('fetches dashboard data successfully', async () => {
      const mockResponse: ApiDashboardResponse = {
        metrics: {
          tests: { count: 10 },
          suites: { count: 2 },
          regressions: { count: 1 },
          executions: { sinceDays: 7, count: 5, running: 0, passed: 5, failed: 0 },
        },
        recentActivity: [],
        recentExecutions: [],
        meta: { timestamp: '2025-01-15T12:00:00Z', errors: [] },
      }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchDashboardApi()

      expect(apiClient.get).toHaveBeenCalledWith('/dashboard', {
        rawResponse: true,
      })
      expect(result).toEqual(mockResponse)
    })

    it('throws error on 503 response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), { type: 'server', status: 503, isRetryable: false })
      )

      await expect(fetchDashboardApi()).rejects.toThrow(
        'Dashboard service unavailable'
      )
    })

    it('throws error on other non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { type: 'server', status: 500, isRetryable: false })
      )

      await expect(fetchDashboardApi()).rejects.toThrow(
        'Failed to fetch dashboard: 500 Internal Server Error'
      )
    })

    it('reports a failure that never reached the server without a status', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Cannot reach the backend at http://192.0.2.20:8000'), {
          type: 'network',
          status: undefined,
          isRetryable: true,
        })
      )

      const error = (await fetchDashboardApi().catch((e: unknown) => e)) as Error

      expect(error.message).toBe(
        'Failed to fetch dashboard: Cannot reach the backend at http://192.0.2.20:8000'
      )
      expect(error.message).not.toContain('undefined')
    })

    it('rethrows a rejection that carries no status at all', async () => {
      vi.mocked(apiClient.get).mockRejectedValue('offline')

      await expect(fetchDashboardApi()).rejects.toBe('offline')
    })

    it('calls the correct API endpoint', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          metrics: {
            tests: { count: 0 },
            suites: { count: 0 },
            regressions: null,
            executions: { sinceDays: 7, count: 0, running: 0, passed: 0, failed: 0 },
          },
          recentActivity: null,
          recentExecutions: null,
          meta: { timestamp: '2025-01-15T12:00:00Z', errors: [] },
        },
        meta: { requestId: '' },
        status: 200,
      })

      await fetchDashboardApi()

      expect(apiClient.get).toHaveBeenCalledWith(
        '/dashboard',
        expect.any(Object)
      )
    })
  })

  describe('fetchDashboard', () => {
    it('fetches and transforms dashboard data', async () => {
      const mockResponse: ApiDashboardResponse = {
        metrics: {
          tests: { count: 10 },
          suites: { count: 2 },
          regressions: { count: 1 },
          executions: { sinceDays: 7, count: 5, running: 0, passed: 5, failed: 0 },
        },
        recentActivity: [
          { id: 'test-1', type: 'test', name: 'Test', timestamp: '2025-01-15T11:00:00Z', suiteCount: 1 },
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

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockResponse,
        meta: { requestId: '' },
        status: 200,
      })

      const result = await fetchDashboard()

      expect(result.metrics.tests.count).toBe(10)
      expect(result.recentActivity).toHaveLength(1)
      expect(result.recentActivity[0].name).toBe('Test')
      expect(result.recentExecutions).toHaveLength(1)
      expect(result.recentExecutions[0].name).toContain('Test')
    })
  })
})
