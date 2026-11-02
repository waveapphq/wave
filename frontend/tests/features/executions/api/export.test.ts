/**
 * Execution Export API Client Tests
 *
 * Contract for the executions export client:
 * - downloadExecutionExport(executionId, options) builds the single-export
 *   GET URL (test_ids CSV, format; no secrets choice) and routes the download
 *   through the shared lib/download-file downloadFromUrl helper with an
 *   execution-derived fallback filename.
 * - exportExecutions(executionIds, format) POSTs the bulk export request and
 *   returns the response Blob (single file or ZIP; the caller downloads it).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/download-file', () => ({
  downloadFromUrl: vi.fn(),
}))

import { downloadFromUrl } from '@/lib/download-file'

// jsdom's Blob lacks .text(); read through FileReader instead
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

// Real getApiBaseUrl returns ${origin}/api in dev; jsdom origin is localhost:3000
const API_BASE = `${globalThis.location.origin}/api`

describe('downloadExecutionExport', () => {
  beforeEach(() => {
    vi.mocked(downloadFromUrl).mockReset()
    vi.mocked(downloadFromUrl).mockResolvedValue(undefined)
  })

  function calledUrl(): string {
    return vi.mocked(downloadFromUrl).mock.calls[0][0]
  }

  function calledFallback(): string {
    return vi.mocked(downloadFromUrl).mock.calls[0][1]
  }

  it('routes the download through downloadFromUrl with the export URL', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1')

    expect(downloadFromUrl).toHaveBeenCalledTimes(1)
    expect(calledUrl()).toBe(`${API_BASE}/executions/exec-1/export`)
  })

  it('uses an execution-derived json fallback filename by default', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1')

    expect(calledFallback()).toBe('execution-exec-1.json')
  })

  it('includes test_ids CSV for per-test export', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { testIds: ['t1'] })

    expect(calledUrl()).toContain('test_ids=t1')
  })

  it('joins multiple test_ids with commas for mass export', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { testIds: ['t1', 't2', 't3'] })

    expect(calledUrl()).toContain('test_ids=t1%2Ct2%2Ct3')
  })

  it('omits test_ids param when testIds array is empty', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { testIds: [] })

    expect(calledUrl()).not.toContain('test_ids')
  })

  it('forwards format=yaml and uses a yaml fallback filename', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { format: 'yaml' })

    expect(calledUrl()).toContain('format=yaml')
    expect(calledFallback()).toBe('execution-exec-1.yaml')
  })

  it('omits the format param for the backend default (json)', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { format: 'json' })

    expect(calledUrl()).not.toContain('format=json')
    expect(calledFallback()).toBe('execution-exec-1.json')
  })

  it('never sends a secrets/mask_secrets param (executions have no secrets choice)', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')

    await downloadExecutionExport('exec-1', { format: 'json' })

    expect(calledUrl()).not.toContain('mask_secrets')
    expect(calledUrl()).not.toContain('secrets')
  })

  it('propagates download errors to the caller', async () => {
    const { downloadExecutionExport } = await import('@/features/executions/api/export')
    vi.mocked(downloadFromUrl).mockRejectedValue(new Error('Execution not found: exec-1'))

    await expect(downloadExecutionExport('exec-1')).rejects.toThrow(
      'Execution not found: exec-1',
    )
  })
})

describe('exportExecutions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the execution ids and format to the bulk export endpoint', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('zip-bytes', {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }),
    )

    await exportExecutions(['exec-1', 'exec-2'], 'json')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_BASE}/executions/export`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      execution_ids: ['exec-1', 'exec-2'],
      format: 'json',
    })
  })

  it('sends the chosen yaml format in the body', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('zip-bytes', {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }),
    )

    await exportExecutions(['exec-1', 'exec-2'], 'yaml')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(init?.body as string).format).toBe('yaml')
  })

  it('returns the response payload as a Blob', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('zip-bytes', {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }),
    )

    const blob = await exportExecutions(['exec-1', 'exec-2'], 'json')

    expect(blob).toBeInstanceOf(Blob)
    expect(await readBlob(blob)).toBe('zip-bytes')
  })

  it('throws the backend error message on 404', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Execution not found: exec-9' },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(exportExecutions(['exec-9'], 'json')).rejects.toThrow(
      'Execution not found: exec-9',
    )
  })

  it('throws the backend error message on 400', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'execution_ids must be a non-empty list',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(exportExecutions([], 'json')).rejects.toThrow(
      'execution_ids must be a non-empty list',
    )
  })

  it('throws a status fallback when the error body is not JSON', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('gateway exploded', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await expect(exportExecutions(['exec-1'], 'json')).rejects.toThrow(
      'Request failed with status 502',
    )
  })

  it('throws a status fallback when the error JSON has no message', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(exportExecutions(['exec-1'], 'json')).rejects.toThrow(
      'Request failed with status 500',
    )
  })

  it('defaults the blob type to application/zip when content-type is absent', async () => {
    const { exportExecutions } = await import('@/features/executions/api/export')
    const response = new Response(new Uint8Array([80, 75]), { status: 200 })
    response.headers.delete('content-type')
    vi.mocked(fetch).mockResolvedValueOnce(response)

    const blob = await exportExecutions(['exec-1', 'exec-2'], 'json')

    expect(blob.type).toBe('application/zip')
  })
})
