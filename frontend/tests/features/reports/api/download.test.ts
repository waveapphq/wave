/**
 * downloadReportArtifact Tests
 *
 * Blob download client for report artifacts: plain fetch of
 * GET /artifacts/content/{artifact_id} (attachment disposition by
 * default), filename from Content-Disposition with a caller-provided
 * fallback, handed to the shared lib/download-blob helper.
 *
 * Module: frontend/src/features/reports/api/download.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

import { downloadBlob } from '@/lib/download-blob'
import { downloadReportArtifact } from '@/features/reports/api/download'

// Real getApiBaseUrl returns ${origin}/api in dev; jsdom origin is localhost:3000
const API_BASE = `${globalThis.location.origin}/api`

function mockResponse({
  body,
  filename,
  status = 200,
  contentType = 'application/json',
}: {
  body: string
  filename?: string
  status?: number
  contentType?: string
}) {
  const headers = new Headers({ 'content-type': contentType })
  if (filename) {
    headers.set('content-disposition', `attachment; filename="${filename}"`)
  }
  return new Response(body, { status, headers })
}

describe('downloadReportArtifact', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(downloadBlob).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the artifact content endpoint without an inline disposition', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ body: '{}', filename: 'report.v1.json' }),
    )

    await downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json')

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toBe(`${API_BASE}/artifacts/content/dir-1/report.v1.json`)
  })

  it('passes the blob and the Content-Disposition filename to downloadBlob', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ body: '{"a":1}', filename: 'report.v1.json' }),
    )

    await downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json')

    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('report.v1.json')
  })

  it('falls back to the provided filename when Content-Disposition is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ body: '{}' }))

    await downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json')

    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('report-exec-1.json')
  })

  it('falls back to the provided filename when Content-Disposition has no filename', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-disposition': 'attachment' },
      }),
    )

    await downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json')

    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('report-exec-1.json')
  })

  it('throws the backend error message on a structured non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact dir-1/report.v1.json not found' },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json'),
    ).rejects.toThrow('Artifact dir-1/report.v1.json not found')
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('throws a status-based error when the failure body is not structured', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    )

    await expect(
      downloadReportArtifact('dir-1/report.v1.json', 'report-exec-1.json'),
    ).rejects.toThrow('Request failed with status 500')
  })
})
