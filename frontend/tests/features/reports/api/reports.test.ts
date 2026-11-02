/**
 * Reports API Client Tests
 *
 * Covers the reports feature API surface:
 * - fetchReports: GET /reports URL building + envelope unwrapping
 * - startReportJob / getReportJobStatus: explicit format params, enveloped
 * - fetchReportJson: rawResponse artifact fetch
 * - ensureReport: POST -> poll(1500ms) -> single re-POST on 404 orchestration
 *   with classified errors ({ kind, message }; message is the raw backend text)
 *
 * Module: frontend/src/features/reports/api/reports.ts
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
  getApiBaseUrl: () => 'http://localhost:8000/api',
}))

import { apiClient } from '@/lib/api'
import {
  ensureReport,
  fetchReportJson,
  fetchReports,
  getReportJobStatus,
  startReportJob,
} from '@/features/reports/api/reports'

function jobView(overrides: Record<string, unknown> = {}) {
  return {
    execution_id: 'exec-1',
    format: 'json',
    status: 'pending',
    progress: { runs_processed: 0, runs_total: 3 },
    artifact_id: null,
    error: null,
    started_at: '2026-06-10T11:00:00+00:00',
    ended_at: null,
    ...overrides,
  }
}

function apiError(message: string, status: number) {
  return Object.assign(new Error(message), { status })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchReports', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [],
      pagination: { total: 0, page: 1, per_page: 20, total_pages: 0 },
    } as never)
  })

  it('calls GET /reports with no query string when no params are given', async () => {
    await fetchReports()

    expect(apiClient.get).toHaveBeenCalledWith('/reports')
  })

  it('builds pagination, search, and CSV filter params', async () => {
    await fetchReports({
      page: 2,
      per_page: 10,
      search: 'nightly',
      status: ['passed', 'failed'],
      type: ['suite'],
      triggered_by: ['alice', 'bob'],
    })

    const path = vi.mocked(apiClient.get).mock.calls[0][0] as string
    expect(path).toContain('/reports?')
    expect(path).toContain('page=2')
    expect(path).toContain('per_page=10')
    expect(path).toContain('search=nightly')
    expect(path).toContain('status=passed%2Cfailed')
    expect(path).toContain('type=suite')
    expect(path).toContain('triggered_by=alice%2Cbob')
  })

  it('omits empty filter arrays', async () => {
    await fetchReports({ status: [], type: [], triggered_by: [] })

    expect(apiClient.get).toHaveBeenCalledWith('/reports')
  })

  it('forwards date range and snake_cases the sort column', async () => {
    await fetchReports({
      from_date: '2026-06-01T00:00:00Z',
      to_date: '2026-06-10T00:00:00Z',
      sort_by: 'started_at',
      sort_order: 'desc',
    })

    const path = vi.mocked(apiClient.get).mock.calls[0][0] as string
    expect(path).toContain('from_date=2026-06-01T00%3A00%3A00Z')
    expect(path).toContain('to_date=2026-06-10T00%3A00%3A00Z')
    expect(path).toContain('sort=started_at')
    expect(path).toContain('order=desc')
  })

  it('returns rows and pagination from the envelope', async () => {
    const row = {
      execution: {
        id: 'exec-1',
        name: 'Nightly API Suite',
        entity_type: 'suite',
        entity_id: 'suite-1',
        status: 'failed',
        triggered_by: 'dev',
        started_at: '2026-06-10T11:06:52+00:00',
        ended_at: '2026-06-10T11:07:13+00:00',
        duration: 21,
      },
      reports: { json: null, html: null },
    }
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [row],
      pagination: { total: 1, page: 1, per_page: 20, total_pages: 1 },
    } as never)

    const result = await fetchReports()

    expect(result.data).toEqual([row])
    expect(result.pagination).toEqual({ total: 1, page: 1, per_page: 20, total_pages: 1 })
  })
})

describe('startReportJob', () => {
  it('POSTs with an explicit format param and returns the job view', async () => {
    const view = jobView({ status: 'completed', artifact_id: 'dir/report.v1.json' })
    vi.mocked(apiClient.post).mockResolvedValue({ data: view } as never)

    const result = await startReportJob('exec-1', 'json')

    expect(apiClient.post).toHaveBeenCalledWith('/executions/exec-1/report?format=json')
    expect(result).toEqual(view)
  })

  it('passes format=html explicitly for the export flow', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ format: 'html' }) } as never)

    await startReportJob('exec-1', 'html')

    expect(apiClient.post).toHaveBeenCalledWith('/executions/exec-1/report?format=html')
  })
})

describe('getReportJobStatus', () => {
  it('GETs the poll endpoint with an explicit format param and returns the job view', async () => {
    const view = jobView({ status: 'running' })
    vi.mocked(apiClient.get).mockResolvedValue({ data: view } as never)

    const result = await getReportJobStatus('exec-1', 'json')

    expect(apiClient.get).toHaveBeenCalledWith('/executions/exec-1/report?format=json')
    expect(result).toEqual(view)
  })
})

describe('fetchReportJson', () => {
  it('fetches the artifact inline with rawResponse so the JSON body is not unwrapped', async () => {
    const report = { schema_version: 1, execution: { id: 'exec-1' } }
    vi.mocked(apiClient.get).mockResolvedValue({ data: report } as never)

    const result = await fetchReportJson('dir/report.v1.json')

    expect(apiClient.get).toHaveBeenCalledWith(
      '/artifacts/content/dir/report.v1.json?disposition=inline',
      expect.objectContaining({ rawResponse: true }),
    )
    expect(result).toEqual(report)
  })
})

describe('ensureReport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when the POST returns a completed view (existing artifact)', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: jobView({ status: 'completed', artifact_id: 'dir/report.v1.json' }),
    } as never)

    const result = await ensureReport('exec-1', 'json')

    expect(result).toEqual({ artifactId: 'dir/report.v1.json' })
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('polls every 1500ms after a 202 and resolves when the job completes', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: jobView({ status: 'running', progress: { runs_processed: 1, runs_total: 3 } }),
      } as never)
      .mockResolvedValueOnce({
        data: jobView({
          status: 'completed',
          progress: { runs_processed: 3, runs_total: 3 },
          artifact_id: 'dir/report.v1.json',
        }),
      } as never)

    const promise = ensureReport('exec-1', 'json')

    await vi.advanceTimersByTimeAsync(1500)
    expect(apiClient.get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(promise).resolves.toEqual({ artifactId: 'dir/report.v1.json' })
  })

  it('reports poll progress through onProgress', async () => {
    const onProgress = vi.fn()
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: jobView({ status: 'running', progress: { runs_processed: 2, runs_total: 5 } }),
      } as never)
      .mockResolvedValueOnce({
        data: jobView({ status: 'completed', artifact_id: 'dir/report.v1.json' }),
      } as never)

    const promise = ensureReport('exec-1', 'json', { onProgress })

    await vi.advanceTimersByTimeAsync(1500)
    expect(onProgress).toHaveBeenCalledWith({ processed: 2, total: 5 })
    await vi.advanceTimersByTimeAsync(1500)
    await promise
  })

  it('rejects with kind job-failed carrying the job error message', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get).mockResolvedValue({
      data: jobView({ status: 'failed', error: 'model build exploded' }),
    } as never)

    const promise = ensureReport('exec-1', 'json')
    const assertion = expect(promise).rejects.toMatchObject({
      kind: 'job-failed',
      message: 'model build exploded',
    })
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })

  it('re-POSTs exactly once when the poll 404s (job lost on restart)', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: jobView({ status: 'pending' }) } as never)
      .mockResolvedValueOnce({
        data: jobView({ status: 'completed', artifact_id: 'dir/report.v2.json' }),
      } as never)
    vi.mocked(apiClient.get).mockRejectedValue(
      apiError("No report generation job for execution 'exec-1'", 404),
    )

    const promise = ensureReport('exec-1', 'json')

    await vi.advanceTimersByTimeAsync(1500)
    await expect(promise).resolves.toEqual({ artifactId: 'dir/report.v2.json' })
    expect(apiClient.post).toHaveBeenCalledTimes(2)
  })

  it('rejects with kind job-lost when the poll 404s again after the re-POST', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get).mockRejectedValue(
      apiError("No report generation job for execution 'exec-1'", 404),
    )

    const promise = ensureReport('exec-1', 'json')
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'job-lost' })
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
    expect(apiClient.post).toHaveBeenCalledTimes(2)
  })

  it('classifies a 409 still-running rejection as execution-running with the raw backend message', async () => {
    const message =
      "Cannot generate report for execution in 'running' state. Wait for the execution to finish."
    vi.mocked(apiClient.post).mockRejectedValue(apiError(message, 409))

    await expect(ensureReport('exec-1', 'json')).rejects.toMatchObject({
      kind: 'execution-running',
      message,
    })
  })

  it('classifies any other 409 as no-artifacts with the raw backend message', async () => {
    const message = "Execution 'exec-1' has no artifact directory"
    vi.mocked(apiClient.post).mockRejectedValue(apiError(message, 409))

    await expect(ensureReport('exec-1', 'json')).rejects.toMatchObject({
      kind: 'no-artifacts',
      message,
    })
  })

  it('classifies a non-409 POST failure as request-failed', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(apiError('Network unreachable', undefined as never))

    await expect(ensureReport('exec-1', 'json')).rejects.toMatchObject({
      kind: 'request-failed',
      message: 'Network unreachable',
    })
  })

  it('keeps the progress it has and tries again when one poll tick fails', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(apiError('Internal Server Error', 500))
      .mockResolvedValueOnce({
        data: jobView({ status: 'completed', artifact_id: 'dir/report.v1.json' }),
      } as never)

    const promise = ensureReport('exec-1', 'json')

    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(promise).resolves.toEqual({ artifactId: 'dir/report.v1.json' })
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })

  it('rejects with the poll reason once the poll keeps failing', async () => {
    // A poll that never recovers must say so, not spin with no report and no reason.
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get).mockRejectedValue(apiError('Internal Server Error', 500))

    const promise = ensureReport('exec-1', 'json')
    const assertion = expect(promise).rejects.toMatchObject({
      kind: 'request-failed',
      message: 'Could not read the report progress after 3 attempts. Internal Server Error',
    })
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })

  it('a good tick clears the run of failures', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(apiError('Internal Server Error', 500))
      .mockRejectedValueOnce(apiError('Internal Server Error', 500))
      .mockResolvedValueOnce({ data: jobView({ status: 'running' }) } as never)
      .mockRejectedValueOnce(apiError('Internal Server Error', 500))
      .mockRejectedValueOnce(apiError('Internal Server Error', 500))
      .mockResolvedValueOnce({
        data: jobView({ status: 'completed', artifact_id: 'dir/report.v1.json' }),
      } as never)

    const promise = ensureReport('exec-1', 'json')

    for (let tick = 0; tick < 6; tick += 1) {
      await vi.advanceTimersByTimeAsync(1500)
    }
    await expect(promise).resolves.toEqual({ artifactId: 'dir/report.v1.json' })
  })

  it('keeps polling when the re-POST after a lost job fails, then reports it lost', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: jobView({ status: 'pending' }) } as never)
      .mockRejectedValue(apiError('Service Unavailable', 503))
    vi.mocked(apiClient.get).mockRejectedValue(
      apiError("No report generation job for execution 'exec-1'", 404),
    )

    const promise = ensureReport('exec-1', 'json')
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'job-lost' })
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })

  it('rejects with kind canceled when isCanceled flips during polling', async () => {
    let canceled = false
    vi.mocked(apiClient.post).mockResolvedValue({ data: jobView({ status: 'pending' }) } as never)
    vi.mocked(apiClient.get).mockResolvedValue({ data: jobView({ status: 'running' }) } as never)

    const promise = ensureReport('exec-1', 'json', { isCanceled: () => canceled })
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'canceled' })

    await vi.advanceTimersByTimeAsync(1500)
    canceled = true
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })
})
