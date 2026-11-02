/**
 * SQL tools API client: the wire shapes of the check and catalog calls.
 *
 * REQ-3.4.1.6; SQL-10, SQL-12
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
  cancelCatalog,
  checkSql,
  getCatalog,
  startCatalog,
} from '@/features/workbench/api/sql-tools'
import type { SqlCatalogStartRequest } from '@/features/workbench/api/sql-tools'
import type { CatalogJobStatus, CatalogProfileBinding } from '@/features/workbench/lib/catalog-request'
import {
  CUSTOMERS,
  ORDERS,
  SAMPLE_CATALOG_REQUEST,
  SAMPLE_CONNECTION,
  SAMPLE_SCRIPT,
  SAMPLE_TABLES,
} from '../sql-fixtures'

const JOB_ID = '5f0c2a9e41d84b7c9a3e7d1b2c6f8a01'

const ORDERS_DB_BINDING: CatalogProfileBinding = {
  profileId: 'profile-orders-db',
  alias: 'orders_db',
  profileName: 'Orders DB',
  profileType: 'database',
}

/** As the check endpoint answers them: the line is 1-based. */
const CHECK_ISSUES = [
  { line: 2, col: 6, message: 'Invalid expression / Unexpected token. Line 2, Col: 6.' },
  { line: 4, col: 1, message: 'Expecting )' },
]

function clientError(message: string, status: number): Error {
  return Object.assign(new Error(message), {
    type: 'client',
    status,
    isRetryable: false,
  })
}

function networkError(): Error {
  return Object.assign(new Error('Network request failed'), {
    type: 'network',
    isRetryable: true,
  })
}

describe('sql-tools API client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('checkSql', () => {
    it('POSTs the database type and the script to the check endpoint with the abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: [] },
        meta: { requestId: 'req-check' },
        status: 200,
      })

      const controller = new AbortController()
      await checkSql({ database_type: 'postgresql', script: SAMPLE_SCRIPT }, controller.signal)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      const [path, body, config] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/sql-tools/check')
      expect(body).toEqual({ database_type: 'postgresql', script: SAMPLE_SCRIPT })
      expect(config?.signal).toBe(controller.signal)
    })

    it('sends the chosen database type unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: [] },
        meta: { requestId: 'req-check-mssql' },
        status: 200,
      })

      await checkSql({ database_type: 'mssql', script: 'SELECT 1\nGO\nSELECT 2' })

      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/sql-tools/check')
      expect(body).toEqual({ database_type: 'mssql', script: 'SELECT 1\nGO\nSELECT 2' })
    })

    it('returns the issues in the server shape, unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: CHECK_ISSUES },
        meta: { requestId: 'req-check-issues' },
        status: 200,
      })

      const result = await checkSql({ database_type: 'postgresql', script: SAMPLE_SCRIPT })

      expect(result).toEqual({ issues: CHECK_ISSUES })
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort()).toEqual(['col', 'line', 'message'])
      }
    })

    it('resolves to no issues when the request fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(networkError())

      await expect(
        checkSql({ database_type: 'postgresql', script: SAMPLE_SCRIPT })
      ).resolves.toEqual({ issues: [] })
    })

    it('resolves to no issues when the server refuses the request', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(clientError('Unknown database type', 400))

      await expect(
        checkSql({ database_type: 'postgresql', script: SAMPLE_SCRIPT })
      ).resolves.toEqual({ issues: [] })
    })

    it('resolves to no issues when the request is aborted by the next keystroke', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Request aborted'), { name: 'AbortError' })
      )

      const controller = new AbortController()
      controller.abort()

      await expect(
        checkSql({ database_type: 'postgresql', script: SAMPLE_SCRIPT }, controller.signal)
      ).resolves.toEqual({ issues: [] })
    })
  })

  describe('startCatalog', () => {
    it('POSTs the whole catalog request to the catalog endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { job_id: JOB_ID, cached: false },
        meta: { requestId: 'req-catalog' },
        status: 200,
      })

      await startCatalog(SAMPLE_CATALOG_REQUEST)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/sql-tools/catalog')
      expect(body).toEqual(SAMPLE_CATALOG_REQUEST)
    })

    it('carries rows as they sit on the block, with the expression, template and profile context', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { job_id: JOB_ID, cached: false },
        meta: { requestId: 'req-catalog-rows' },
        status: 200,
      })

      const request: SqlCatalogStartRequest = {
        connection: {
          ...SAMPLE_CONNECTION,
          host: '{{ db_host }}',
          password: 'wave:enc:v1:c2VhbGVkLXBhc3N3b3Jk',
          database: 'shop_{{ env_suffix }}',
        },
        expression_fields: ['host'],
        template_fields: ['database'],
        element_types: { driver_options: { timeout: 'integer' } },
        profile_bindings: [ORDERS_DB_BINDING],
        environment_id: 'env-staging',
        test_id: 'test-orders',
      }

      await startCatalog(request)

      const [, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(body).toEqual(request)
    })

    it('sends refresh when the author asks for a new pull', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { job_id: JOB_ID, cached: false },
        meta: { requestId: 'req-catalog-refresh' },
        status: 200,
      })

      await startCatalog({ ...SAMPLE_CATALOG_REQUEST, refresh: true })

      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/sql-tools/catalog')
      expect(body).toEqual({ ...SAMPLE_CATALOG_REQUEST, refresh: true })
    })

    it('returns a new job unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { job_id: JOB_ID, cached: false },
        meta: { requestId: 'req-catalog-job' },
        status: 200,
      })

      await expect(startCatalog(SAMPLE_CATALOG_REQUEST)).resolves.toEqual({
        job_id: JOB_ID,
        cached: false,
      })
    })

    it('returns a cached answer with its tables unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { job_id: JOB_ID, cached: true, tables: [...SAMPLE_TABLES] },
        meta: { requestId: 'req-catalog-cached' },
        status: 200,
      })

      await expect(startCatalog(SAMPLE_CATALOG_REQUEST)).resolves.toEqual({
        job_id: JOB_ID,
        cached: true,
        tables: [...SAMPLE_TABLES],
      })
    })

    it('rejects with the client error when the server refuses the request', async () => {
      const error = clientError('Host is required', 422)
      vi.mocked(apiClient.post).mockRejectedValue(error)

      await expect(startCatalog(SAMPLE_CATALOG_REQUEST)).rejects.toBe(error)
    })

    it('rejects with the client error when the request fails', async () => {
      const error = networkError()
      vi.mocked(apiClient.post).mockRejectedValue(error)

      await expect(startCatalog(SAMPLE_CATALOG_REQUEST)).rejects.toBe(error)
    })
  })

  describe('getCatalog', () => {
    it('GETs the job by its id', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { status: 'connecting' },
        meta: { requestId: 'req-poll' },
        status: 200,
      })

      await getCatalog(JOB_ID)

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      const [path] = vi.mocked(apiClient.get).mock.calls[0]
      expect(path).toBe(`/sql-tools/catalog/${JOB_ID}`)
    })

    it.each<[{ status: CatalogJobStatus; tables?: unknown[]; error?: string }]>([
      [{ status: 'connecting' }],
      [{ status: 'reading' }],
      [{ status: 'done', tables: [ORDERS, CUSTOMERS] }],
      [{ status: 'failed', error: 'password authentication failed for user "wave"' }],
      [{ status: 'canceled' }],
    ])('returns the job %j unchanged', async (job) => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: job,
        meta: { requestId: 'req-poll-status' },
        status: 200,
      })

      await expect(getCatalog(JOB_ID)).resolves.toEqual(job)
    })

    it('rejects with the client error when the job is unknown', async () => {
      const error = clientError('Catalog job not found', 404)
      vi.mocked(apiClient.get).mockRejectedValue(error)

      await expect(getCatalog(JOB_ID)).rejects.toBe(error)
    })

    it('rejects with the client error when the request fails', async () => {
      const error = networkError()
      vi.mocked(apiClient.get).mockRejectedValue(error)

      await expect(getCatalog(JOB_ID)).rejects.toBe(error)
    })
  })

  describe('cancelCatalog', () => {
    it('sends DELETE for the job by its id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { status: 'canceled' },
        meta: { requestId: 'req-cancel' },
        status: 200,
      })

      await cancelCatalog(JOB_ID)

      expect(apiClient.delete).toHaveBeenCalledTimes(1)
      const [path] = vi.mocked(apiClient.delete).mock.calls[0]
      expect(path).toBe(`/sql-tools/catalog/${JOB_ID}`)
    })

    it('returns the canceled status', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { status: 'canceled' },
        meta: { requestId: 'req-cancel-status' },
        status: 200,
      })

      await expect(cancelCatalog(JOB_ID)).resolves.toEqual({ status: 'canceled' })
    })

    it('rejects with the client error when the job is unknown', async () => {
      const error = clientError('Catalog job not found', 404)
      vi.mocked(apiClient.delete).mockRejectedValue(error)

      await expect(cancelCatalog(JOB_ID)).rejects.toBe(error)
    })
  })
})
