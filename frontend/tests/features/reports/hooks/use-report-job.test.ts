/**
 * useReportJob Tests
 *
 * Viewer-side state machine over the ensureReport orchestration:
 * ensuring -> (polling on first progress tick) -> fetching-artifact ->
 * ready | error. Classified ensureReport rejections surface as
 * { kind, message }; canceled rejections (unmount) are swallowed;
 * retry() resets the machine and re-runs the orchestration.
 *
 * Module: frontend/src/features/reports/hooks/use-report-job.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('@/features/reports/api/reports', () => ({
  ensureReport: vi.fn(),
  fetchReportJson: vi.fn(),
}))

import { ensureReport, fetchReportJson } from '@/features/reports/api/reports'
import { useReportJob } from '@/features/reports/hooks/use-report-job'

type EnsureOpts = {
  onProgress?: (progress: { processed: number; total: number }) => void
  isCanceled?: () => boolean
}

const REPORT = {
  schema_version: 1,
  generated_at: '2026-06-10T11:30:00+00:00',
  execution: { id: 'exec-1', name: 'Nightly API Suite' },
  summary: { status: 'failed', duration: 21, counts: {} },
  timeline: { runs: [], blocks: [] },
  errors: [],
  logs: [],
}

function classifiedError(kind: string, message: string) {
  return Object.assign(new Error(message), { kind })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useReportJob', () => {
  it('starts in the ensuring state with empty data', () => {
    vi.mocked(ensureReport).mockReturnValue(deferred<{ artifactId: string }>().promise as never)

    const { result } = renderHook(() => useReportJob('exec-1'))

    expect(result.current.status).toBe('ensuring')
    expect(result.current.report).toBeNull()
    expect(result.current.artifactId).toBeNull()
    expect(result.current.progress).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('requests the json format for the executionId', async () => {
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockResolvedValue(REPORT as never)

    renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalledWith('exec-1', 'json', expect.any(Object))
    })
  })

  it('fetches the artifact after ensure resolves and lands in ready with the parsed report', async () => {
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockResolvedValue(REPORT as never)

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(fetchReportJson).toHaveBeenCalledWith('dir/report.v1.json')
    expect(result.current.report).toEqual(REPORT)
    expect(result.current.artifactId).toBe('dir/report.v1.json')
    expect(result.current.error).toBeNull()
  })

  it('moves to fetching-artifact while the artifact request is in flight', async () => {
    const artifact = deferred<typeof REPORT>()
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockReturnValue(artifact.promise as never)

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(result.current.status).toBe('fetching-artifact')
    })

    await act(async () => {
      artifact.resolve(REPORT)
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
  })

  it('switches to polling and tracks progress when ensureReport reports ticks', async () => {
    const ensure = deferred<{ artifactId: string }>()
    let opts: EnsureOpts = {}
    vi.mocked(ensureReport).mockImplementation(((_id: string, _format: string, o: EnsureOpts) => {
      opts = o
      return ensure.promise
    }) as never)

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalled()
    })
    act(() => {
      opts.onProgress?.({ processed: 2, total: 5 })
    })

    expect(result.current.status).toBe('polling')
    expect(result.current.progress).toEqual({ processed: 2, total: 5 })
  })

  it('surfaces classified ensure rejections as the error state with the raw message', async () => {
    const message =
      "Cannot generate report for execution in 'running' state. Wait for the execution to finish."
    vi.mocked(ensureReport).mockRejectedValue(classifiedError('execution-running', message))

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.error).toEqual({ kind: 'execution-running', message })
    expect(fetchReportJson).not.toHaveBeenCalled()
  })

  it('maps an artifact fetch failure to the artifact-fetch-failed kind', async () => {
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockRejectedValue(new Error('Artifact dir/report.v1.json not found'))

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.error).toEqual({
      kind: 'artifact-fetch-failed',
      message: 'Artifact dir/report.v1.json not found',
    })
  })

  it('swallows canceled rejections instead of entering the error state', async () => {
    vi.mocked(ensureReport).mockRejectedValue(classifiedError('canceled', 'Canceled'))

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalled()
    })
    expect(result.current.status).not.toBe('error')
    expect(result.current.error).toBeNull()
  })

  it('reports cancellation through isCanceled after unmount', async () => {
    let opts: EnsureOpts = {}
    vi.mocked(ensureReport).mockImplementation(((_id: string, _format: string, o: EnsureOpts) => {
      opts = o
      return deferred<{ artifactId: string }>().promise
    }) as never)

    const { unmount } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalled()
    })
    expect(opts.isCanceled?.()).toBe(false)
    unmount()
    expect(opts.isCanceled?.()).toBe(true)
  })

  it('retry() resets the machine and re-runs the orchestration', async () => {
    vi.mocked(ensureReport).mockRejectedValueOnce(classifiedError('job-failed', 'boom'))
    vi.mocked(ensureReport).mockResolvedValueOnce({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockResolvedValue(REPORT as never)

    const { result } = renderHook(() => useReportJob('exec-1'))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(ensureReport).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
  })

  it('restarts the machine when the executionId changes', async () => {
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir/report.v1.json' } as never)
    vi.mocked(fetchReportJson).mockResolvedValue(REPORT as never)

    const { rerender } = renderHook(({ id }) => useReportJob(id), {
      initialProps: { id: 'exec-1' },
    })

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalledWith('exec-1', 'json', expect.any(Object))
    })

    rerender({ id: 'exec-2' })

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalledWith('exec-2', 'json', expect.any(Object))
    })
  })
})
