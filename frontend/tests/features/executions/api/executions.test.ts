/**
 * Executions API Client Tests
 *
 * REQ-5.2.1.40: Execution history screen (list executions, filter by status/date, compare runs, re-run)
 *
 * Tests for executions API fetch and transformation functions.
 * Backend API is fully implemented - this tests the frontend API client.
 *
 * API endpoints covered:
 * - GET /executions - List with pagination, filtering (status, type, entity_id, from_date, to_date), sorting
 * - GET /executions/{id} - Get execution details
 * - DELETE /executions/{id} - Cancel execution
 * - PUT /executions/{id}/stop - Stop execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { apiClient } from '@/lib/api'

import {
  fetchExecutions,
  fetchExecution,
  stopExecution,
  deleteExecution,
  transformApiExecution,
  startExecution,
} from '@/features/executions/api/executions'
import { formatDuration } from '@/lib/format-duration'
import type { ExecutionApiResponse } from '@/features/executions/api/types'

describe('Executions API', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('fetchExecutions', () => {
    it('fetches executions list successfully', async () => {
      const mockData = [
        {
          id: 'exec-1',
          name: 'Login Test',
          type: 'test',
          triggered_by: 'John Doe',
          started_at: '2025-01-15T10:30:00Z',
          completed_at: '2025-01-15T10:32:34Z',
          duration: 154,
          status: 'passed',
          entity_id: 'test-123',
        },
      ]

      const mockPagination = {
        total: 1,
        page: 1,
        per_page: 10,
        total_pages: 1,
      }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: 'test-req-id' },
        status: 200,
        pagination: mockPagination,
      })

      const result = await fetchExecutions()

      expect(apiClient.get).toHaveBeenCalledWith('/executions')
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Login Test')
      expect(result.pagination).toEqual(mockPagination)
    })

    it('includes page parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 2, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ page: 2 })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('page=2')
      )
    })

    it('includes per_page parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 25, total_pages: 0 },
      })

      await fetchExecutions({ per_page: 25 })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('per_page=25')
      )
    })

    it('includes search parameter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ search: 'Login' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=Login')
      )
    })

    it('includes status filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ status: ['running', 'passed'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('status=running%2Cpassed')
      )
    })

    it('includes type filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ type: ['test', 'suite'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('type=test%2Csuite')
      )
    })

    it('includes sort parameters when provided (uses sort/order params)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ sort_by: 'started_at', sort_order: 'desc' })

      // Executions endpoint uses 'sort' and 'order' params (not sort_by/sort_order)
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort=started_at')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('order=desc')
      )
    })

    it('includes sort without order', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ sort_by: 'name' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort=name')
      )
      expect(apiClient.get).not.toHaveBeenCalledWith(
        expect.stringContaining('order=')
      )
    })

    it('converts camelCase sort fields to snake_case (startedAt -> started_at)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ sort_by: 'startedAt', sort_order: 'desc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort=started_at')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('order=desc')
      )
    })

    it('includes triggered_by filter when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ triggered_by: ['alice', 'bob'] })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('triggered_by=alice%2Cbob')
      )
    })

    it('omits triggered_by filter when empty array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ triggered_by: [] })

      expect(apiClient.get).not.toHaveBeenCalledWith(
        expect.stringContaining('triggered_by=')
      )
    })

    it('converts camelCase sort fields to snake_case (triggeredBy -> triggered_by)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ sort_by: 'triggeredBy', sort_order: 'asc' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort=triggered_by')
      )
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('order=asc')
      )
    })

    it('converts camelCase sort fields to snake_case (completedAt -> completed_at)', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ sort_by: 'completedAt' })

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('sort=completed_at')
      )
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), {
          type: 'server',
          status: 500,
          isRetryable: true,
        })
      )

      await expect(fetchExecutions()).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('ignores empty status array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ status: [] })

      expect(apiClient.get).not.toHaveBeenCalledWith(
        expect.stringContaining('status=')
      )
    })

    it('ignores empty type array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({ type: [] })

      expect(apiClient.get).not.toHaveBeenCalledWith(
        expect.stringContaining('type=')
      )
    })

    it('passes from_date and to_date through to the query string', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        meta: { requestId: '' },
        status: 200,
        pagination: { total: 0, page: 1, per_page: 10, total_pages: 0 },
      })

      await fetchExecutions({
        from_date: '2026-04-01T00:00:00.000Z',
        to_date: '2026-04-20T23:59:59.999Z',
      })

      const call = vi.mocked(apiClient.get).mock.calls[0][0]
      expect(call).toContain('from_date=2026-04-01T00%3A00%3A00.000Z')
      expect(call).toContain('to_date=2026-04-20T23%3A59%3A59.999Z')
    })
  })

  describe('fetchExecution', () => {
    it('fetches single execution by ID', async () => {
      const mockData = {
        id: 'exec-123',
        name: 'Login Test',
        type: 'test',
        triggered_by: 'John Doe',
        started_at: '2025-01-15T10:30:00Z',
        completed_at: '2025-01-15T10:32:34Z',
        duration: 154,
        status: 'passed',
        entity_id: 'test-123',
      }

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockData,
        meta: { requestId: 'test-req-id' },
        status: 200,
      })

      const result = await fetchExecution('exec-123')

      expect(apiClient.get).toHaveBeenCalledWith('/executions/exec-123')
      expect(result.success).toBe(true)
      expect(result.data.id).toBe('exec-123')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(fetchExecution('invalid-id')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  describe('stopExecution', () => {
    it('stops execution successfully', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 200,
      })

      await stopExecution('exec-123')

      expect(apiClient.put).toHaveBeenCalledWith('/executions/exec-123/stop')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(
        Object.assign(new Error('Conflict'), {
          type: 'conflict',
          status: 409,
          isRetryable: false,
        })
      )

      await expect(stopExecution('exec-123')).rejects.toThrow(
        'Conflict'
      )
    })

    it('appends ?mode=finalize when mode is provided', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 200,
      })

      await stopExecution('exec-123', { mode: 'finalize' })

      expect(apiClient.put).toHaveBeenCalledWith('/executions/exec-123/stop?mode=finalize')
    })
  })

  describe('deleteExecution', () => {
    it('deletes execution successfully', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: null,
        meta: { requestId: '' },
        status: 204,
      })

      await deleteExecution('exec-123')

      expect(apiClient.delete).toHaveBeenCalledWith('/executions/exec-123')
    })

    it('throws error on non-OK response', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        Object.assign(new Error('Not Found'), {
          type: 'not_found',
          status: 404,
          isRetryable: false,
        })
      )

      await expect(deleteExecution('exec-123')).rejects.toThrow(
        'Not Found'
      )
    })
  })

  describe('transformApiExecution', () => {
    it('transforms API response to Execution type', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Login Test',
        type: 'test',
        triggered_by: 'John Doe',
        started_at: '2025-01-15T10:30:00Z',
        completed_at: '2025-01-15T10:32:34Z',
        duration: 154,
        status: 'passed',
        entity_id: 'test-123',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.id).toBe('exec-1')
      expect(result.name).toBe('Login Test')
      expect(result.type).toBe('test')
      expect(result.triggeredBy).toBe('John Doe')
      expect(result.startedAt).toBe('2025-01-15T10:30:00Z')
      expect(result.completedAt).toBe('2025-01-15T10:32:34Z')
      expect(result.duration).toBe(154)
      expect(result.status).toBe('passed')
      expect(result.entityId).toBe('test-123')
    })

    it('handles null completed_at (running execution)', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Running Test',
        type: 'test',
        triggered_by: 'Jane Doe',
        started_at: '2025-01-15T11:55:00Z',
        completed_at: null,
        duration: null,
        status: 'running',
        entity_id: 'test-456',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.completedAt).toBeNull()
      expect(result.duration).toBeNull()
      expect(result.status).toBe('running')
    })

    it('handles all status values', () => {
      const baseExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Test',
        type: 'test',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:05:00Z',
        duration: 300,
        status: 'passed',
        entity_id: 'test-1',
      }

      const passed = { ...baseExecution, status: 'passed' as const }
      const failed = { ...baseExecution, status: 'failed' as const }
      const running = { ...baseExecution, status: 'running' as const, completed_at: null, duration: null }
      const stopped = { ...baseExecution, status: 'stopped' as const }
      // A regression that halts with scope=regression writes status='skipped'
      // onto the execution record; the list must show it, never remap it to 'running'.
      const skipped = { ...baseExecution, status: 'skipped' as const }

      expect(transformApiExecution(passed).status).toBe('passed')
      expect(transformApiExecution(failed).status).toBe('failed')
      expect(transformApiExecution(running).status).toBe('running')
      expect(transformApiExecution(stopped).status).toBe('stopped')
      expect(transformApiExecution(skipped).status).toBe('skipped')
    })

    it('handles all type values', () => {
      const baseExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Test',
        type: 'test',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:05:00Z',
        duration: 300,
        status: 'passed',
        entity_id: 'entity-1',
      }

      const test = { ...baseExecution, type: 'test' as const }
      const suite = { ...baseExecution, type: 'suite' as const }
      const regression = { ...baseExecution, type: 'regression' as const }

      expect(transformApiExecution(test).type).toBe('test')
      expect(transformApiExecution(suite).type).toBe('suite')
      expect(transformApiExecution(regression).type).toBe('regression')
    })

    it('handles CI Pipeline as triggered_by', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'CI Test',
        type: 'regression',
        triggered_by: 'CI Pipeline',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T11:00:00Z',
        duration: 3600,
        status: 'passed',
        entity_id: 'reg-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.triggeredBy).toBe('CI Pipeline')
    })

    it('handles Scheduled as triggered_by', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Scheduled Test',
        type: 'suite',
        triggered_by: 'Scheduled',
        started_at: '2025-01-15T02:00:00Z',
        completed_at: '2025-01-15T02:30:00Z',
        duration: 1800,
        status: 'passed',
        entity_id: 'suite-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.triggeredBy).toBe('Scheduled')
    })

    it('handles zero duration', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Quick Test',
        type: 'test',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:00:00Z',
        duration: 0,
        status: 'passed',
        entity_id: 'test-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.duration).toBe(0)
    })

    it('passes through unknown status values verbatim (lowercased)', () => {
      // Unrecognized statuses pass through: the status cell falls back to the muted
      // default style and the label is the server's own word.
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Unknown Status Test',
        type: 'test',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: null,
        duration: null,
        status: 'unknown_status',
        entity_id: 'test-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.status).toBe('unknown_status')
    })

    it('handles unknown type value (defaults to test)', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Unknown Type Test',
        type: 'unknown_type',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:05:00Z',
        duration: 300,
        status: 'passed',
        entity_id: 'entity-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.type).toBe('test')
    })

    it('uses entity_type when type is undefined (backend field name)', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'Backend Entity Type Test',
        entity_type: 'suite',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:05:00Z',
        duration: 300,
        status: 'passed',
        entity_id: 'suite-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.type).toBe('suite')
    })

    it('defaults to test when both type and entity_type are undefined', () => {
      const apiExecution: ExecutionApiResponse = {
        id: 'exec-1',
        name: 'No Type Test',
        triggered_by: 'User',
        started_at: '2025-01-15T10:00:00Z',
        completed_at: '2025-01-15T10:05:00Z',
        duration: 300,
        status: 'passed',
        entity_id: 'entity-1',
      }

      const result = transformApiExecution(apiExecution)

      expect(result.type).toBe('test')
    })
  })

  describe('formatDuration', () => {
    it('returns "-" for null or undefined', () => {
      expect(formatDuration(null)).toBe('-')
      expect(formatDuration(undefined as unknown as number | null)).toBe('-')
    })

    it('formats seconds only', () => {
      expect(formatDuration(5)).toBe('5s')
    })

    it('formats minutes only when seconds are zero', () => {
      expect(formatDuration(120)).toBe('2m')
    })

    it('formats minutes with seconds', () => {
      expect(formatDuration(154)).toBe('2m 34s')
    })

    it('formats hours only when minutes are zero', () => {
      expect(formatDuration(3600)).toBe('1h')
    })

    it('formats hours with minutes', () => {
      expect(formatDuration(4320)).toBe('1h 12m')
    })
  })

  describe('startExecution', () => {
    it('calls POST /executions with correct body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-new-1', name: 'Login Test', status: 'running' },
        meta: { requestId: 'test-req-id' },
        status: 201,
      })

      const result = await startExecution({
        type: 'test',
        id: 'test-123',
        environmentId: 'env-1',
      })

      expect(apiClient.post).toHaveBeenCalledWith('/executions', {
        type: 'test',
        id: 'test-123',
        environment_id: 'env-1',
      })
      expect(result.id).toBe('exec-new-1')
    })

    it('returns execution data including id on success', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-new-2', name: 'Auth Suite', status: 'running' },
        meta: { requestId: 'test-req-id' },
        status: 201,
      })

      const result = await startExecution({
        type: 'suite',
        id: 'suite-456',
        environmentId: 'env-2',
      })

      expect(result).toEqual({ id: 'exec-new-2' })
    })

    it('throws on network error', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Network Error'), {
          type: 'network',
          status: 0,
          isRetryable: true,
        })
      )

      await expect(
        startExecution({ type: 'test', id: 'test-123', environmentId: 'env-1' })
      ).rejects.toThrow('Network Error')
    })

    it('sends environment_id in request body', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-new-3', name: 'Test', status: 'running' },
        meta: { requestId: '' },
        status: 201,
      })

      await startExecution({
        type: 'test',
        id: 'test-789',
        environmentId: 'env-special',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/executions',
        expect.objectContaining({ environment_id: 'env-special' })
      )
    })

    it('serializes selectedTests for a suite as a list of test IDs', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-suite-sel', name: 'Suite', status: 'running' },
        meta: { requestId: '' },
        status: 201,
      })

      await startExecution({
        type: 'suite',
        id: 'suite-abc',
        environmentId: 'env-1',
        selectedTests: ['test-1', 'test-2'],
      })

      expect(apiClient.post).toHaveBeenCalledWith('/executions', {
        type: 'suite',
        id: 'suite-abc',
        environment_id: 'env-1',
        selected_tests: ['test-1', 'test-2'],
      })
    })

    it('serializes selectedTests for a regression as suite_id/test_id pairs', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-reg-sel', name: 'Regression', status: 'running' },
        meta: { requestId: '' },
        status: 201,
      })

      await startExecution({
        type: 'regression',
        id: 'reg-abc',
        environmentId: 'env-1',
        selectedTests: [
          { suiteId: 's1', testId: 't1' },
          { suiteId: 's2', testId: 't2' },
        ],
      })

      expect(apiClient.post).toHaveBeenCalledWith('/executions', {
        type: 'regression',
        id: 'reg-abc',
        environment_id: 'env-1',
        selected_tests: [
          { suite_id: 's1', test_id: 't1' },
          { suite_id: 's2', test_id: 't2' },
        ],
      })
    })

    it('omits selected_tests from the body when the caller did not pass one', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'exec-no-sel', name: 'T', status: 'running' },
        meta: { requestId: '' },
        status: 201,
      })

      await startExecution({
        type: 'suite',
        id: 'suite-xyz',
        environmentId: 'env-1',
      })

      const body = vi.mocked(apiClient.post).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(body).not.toHaveProperty('selected_tests')
    })
  })
})
