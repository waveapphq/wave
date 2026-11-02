/**
 * Artifact browser API client (coverage for api/artifacts.ts).
 *
 * URL building for the execution-summary landing list and per-execution
 * artifact listing (with the include-removed toggle), plus the single +
 * whole-execution soft-delete calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: () => 'http://localhost:8000/api',
}))

import { apiClient } from '@/lib/api'
import {
  deleteArtifact,
  deleteExecutionArtifacts,
  fetchArtifactJson,
  fetchDrillExecution,
  fetchExecutionArtifactSummaries,
  fetchExecutionArtifacts,
} from '@/features/artifacts/api/artifacts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchExecutionArtifactSummaries', () => {
  it('requests the bare endpoint with no params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, per_page: 50, total_pages: 1 },
    } as never)

    const result = await fetchExecutionArtifactSummaries()

    expect(vi.mocked(apiClient.get).mock.calls[0][0]).toBe('/artifacts/executions')
    expect(result.pagination.total).toBe(0)
  })

  it('builds query params and comma-joins type/status arrays', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [{ execution_id: 'e1' }],
      pagination: { total: 1, page: 2, per_page: 10, total_pages: 1 },
    } as never)

    const result = await fetchExecutionArtifactSummaries({
      page: 2,
      per_page: 10,
      search: 'nightly',
      type: ['suite', 'test'],
      status: ['failed'],
    })

    const path = vi.mocked(apiClient.get).mock.calls[0][0] as string
    expect(path).toContain('page=2')
    expect(path).toContain('per_page=10')
    expect(path).toContain('search=nightly')
    expect(path).toContain('type=suite%2Ctest')
    expect(path).toContain('status=failed')
    expect(result.data).toHaveLength(1)
  })

  it('omits empty type/status arrays', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, per_page: 50, total_pages: 1 },
    } as never)

    await fetchExecutionArtifactSummaries({ type: [], status: [] })

    expect(vi.mocked(apiClient.get).mock.calls[0][0]).toBe('/artifacts/executions')
  })
})

describe('fetchExecutionArtifacts', () => {
  it('lists by execution_id without removed by default', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: 'd/e' }] } as never)

    const data = await fetchExecutionArtifacts('exec-1')

    const path = vi.mocked(apiClient.get).mock.calls[0][0] as string
    expect(path).toContain('/artifacts?')
    expect(path).toContain('execution_id=exec-1')
    expect(path).toContain('per_page=100')
    expect(path).not.toContain('include_removed')
    expect(data).toHaveLength(1)
  })

  it('adds include_removed=true when requested', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as never)

    await fetchExecutionArtifacts('exec-1', true)

    expect(vi.mocked(apiClient.get).mock.calls[0][0]).toContain('include_removed=true')
  })
})

describe('artifact soft-deletes', () => {
  it('deletes a single artifact by its path-shaped id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: null } as never)

    await deleteArtifact('dir-1/logs/login.log')

    expect(vi.mocked(apiClient.delete).mock.calls[0][0]).toBe('/artifacts/dir-1/logs/login.log')
  })

  it('deletes every artifact of an execution', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: null } as never)

    await deleteExecutionArtifacts('exec-1')

    expect(vi.mocked(apiClient.delete).mock.calls[0][0]).toBe('/artifacts/executions/exec-1')
  })
})

describe('fetchArtifactJson', () => {
  it('fetches and parses the raw artifact content (bypassing the envelope)', async () => {
    const payload = { execution_id: 'exec-1', failures: [{ scope_path: 'smoke/login' }] }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchArtifactJson('dir-1/error.json')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8000/api/artifacts/content/dir-1/error.json?disposition=inline',
    )
    expect(result).toEqual(payload)
    vi.unstubAllGlobals()
  })

  it('throws when the content response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(fetchArtifactJson('missing')).rejects.toThrow('Failed to load artifact missing: 404')
    vi.unstubAllGlobals()
  })
})

describe('fetchDrillExecution', () => {
  it('maps the execution detail to drill header metadata', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { name: 'Nightly Suite', entity_type: 'suite', status: 'failed' },
    } as never)

    const meta = await fetchDrillExecution('exec-1')

    expect(vi.mocked(apiClient.get).mock.calls[0][0]).toBe('/executions/exec-1')
    expect(meta).toEqual({ name: 'Nightly Suite', entityType: 'suite', status: 'failed' })
  })

  it('falls back to type when entity_type is absent', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { name: 'API Test', type: 'test', status: 'passed' },
    } as never)

    const meta = await fetchDrillExecution('exec-2')

    expect(meta.entityType).toBe('test')
  })

  it('maps ended_at to the finished timestamp', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { name: 'N', entity_type: 'suite', status: 'failed', ended_at: '2026-06-12T14:25:00Z' },
    } as never)

    const meta = await fetchDrillExecution('exec-1')

    expect(meta.finishedAt).toBe('2026-06-12T14:25:00Z')
  })

  it('falls back to completed_at when ended_at is absent', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { name: 'N', entity_type: 'suite', status: 'passed', completed_at: '2026-06-12T15:00:00Z' },
    } as never)

    const meta = await fetchDrillExecution('exec-3')

    expect(meta.finishedAt).toBe('2026-06-12T15:00:00Z')
  })
})
