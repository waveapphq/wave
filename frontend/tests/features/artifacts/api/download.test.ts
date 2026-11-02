/**
 * Artifact download client (coverage for api/download.ts).
 *
 * Plain-fetch blob downloads for a single artifact file and an execution's
 * (or subtree's) .zip, with the filename taken from Content-Disposition and a
 * caller fallback, handed to the shared lib/download-blob helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

import { downloadBlob } from '@/lib/download-blob'
import { downloadArtifactFile, downloadExecutionZip } from '@/features/artifacts/api/download'

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

describe('downloadArtifactFile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(downloadBlob).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the content endpoint and uses the Content-Disposition filename', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ body: '{}', filename: 'login.log' }))

    await downloadArtifactFile('dir-1/logs/login.log', 'fallback.log')

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${API_BASE}/artifacts/content/dir-1/logs/login.log`)
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('login.log')
  })

  it('falls back to the provided filename when Content-Disposition is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ body: '{}' }))

    await downloadArtifactFile('dir-1/x.log', 'fallback.log')

    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('fallback.log')
  })

  it('falls back when Content-Disposition has no filename', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-disposition': 'attachment' },
      }),
    )

    await downloadArtifactFile('dir-1/x.log', 'fallback.log')

    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('fallback.log')
  })

  it('throws the backend error message on a structured failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Artifact dir-1/x.log not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(downloadArtifactFile('dir-1/x.log', 'fallback.log')).rejects.toThrow(
      'Artifact dir-1/x.log not found',
    )
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('throws a status-based error when the failure body is not structured', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('oops', { status: 500 }))

    await expect(downloadArtifactFile('dir-1/x.log', 'fallback.log')).rejects.toThrow(
      'Request failed with status 500',
    )
  })
})

describe('downloadExecutionZip', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(downloadBlob).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the zip endpoint for the whole execution', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ body: 'PK', contentType: 'application/zip', filename: 'exec-1.zip' }),
    )

    await downloadExecutionZip('exec-1')

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${API_BASE}/artifacts/zip?execution_id=exec-1`)
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('exec-1.zip')
  })

  it('adds the subtree path and falls back to {executionId}.zip', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ body: 'PK', contentType: 'application/zip' }),
    )

    await downloadExecutionZip('exec-1', 'logs/smoke')

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      `${API_BASE}/artifacts/zip?execution_id=exec-1&path=logs%2Fsmoke`,
    )
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('exec-1.zip')
  })

  it('throws the backend error on a failed zip', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'No artifacts found for execution exec-1' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(downloadExecutionZip('exec-1')).rejects.toThrow(
      'No artifacts found for execution exec-1',
    )
  })
})
