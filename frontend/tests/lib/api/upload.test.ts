/**
 * Shared multipart upload helper and path-segment encoder.
 *
 * Module: frontend/src/lib/api/upload.ts
 *
 * The helper posts through XMLHttpRequest, the only browser API that reports
 * how many bytes of the body have left the machine, so a caller can show
 * progress and cancel. Callers that pass neither option keep the plain
 * post-and-await shape.
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

import { getApiBaseUrl } from '@/lib/api'
import { postUpload, encodePathSegments } from '@/lib/api/upload'

interface UploadedItem {
  path: string
  size_bytes: number
  replaced: boolean
}

interface Answer {
  status?: number
  statusText?: string
  body?: unknown
  json?: boolean
  headers?: string
}

/** The XMLHttpRequest surface the helper drives, with the events under test control. */
class FakeXhr {
  static instances: FakeXhr[] = []

  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  method = ''
  url = ''
  body: FormData | null = null
  sent = false
  status = 200
  statusText = 'OK'
  responseText = ''
  headers = 'content-type: application/json'

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  send(body: FormData): void {
    this.sent = true
    this.body = body
  }

  abort(): void {
    this.onabort?.()
  }

  getAllResponseHeaders(): string {
    return this.headers
  }
}

function only(): FakeXhr {
  expect(FakeXhr.instances).toHaveLength(1)
  return FakeXhr.instances[0]
}

function answer({ status = 200, statusText = 'OK', body, json = true, headers }: Answer = {}) {
  const request = only()
  request.status = status
  request.statusText = statusText
  request.responseText = body === undefined ? '' : JSON.stringify(body)
  request.headers = headers ?? (json ? 'content-type: application/json' : '')
  request.onload?.()
}

function progress(loaded: number, total: number): void {
  only().upload.onprogress?.({ loaded, total } as ProgressEvent)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getApiBaseUrl).mockReturnValue('http://localhost:8000')
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postUpload - the request', () => {
  it('posts the form data to the API base URL joined with the path', async () => {
    const formData = new FormData()
    formData.append('path', 'fixtures')
    const pending = postUpload('/tests/t1/testdata/upload', formData, 'Upload failed')

    answer({ body: { data: { items: [] } } })
    await pending

    expect(only().method).toBe('POST')
    expect(only().url).toBe('http://localhost:8000/tests/t1/testdata/upload')
    expect(only().body).toBe(formData)
  })

  it('resolves the envelope data, not the envelope', async () => {
    const items: UploadedItem[] = [{ path: 'fixtures/users.csv', size_bytes: 12, replaced: false }]
    const pending = postUpload<{ items: UploadedItem[] }>(
      '/tests/t1/testdata/upload',
      new FormData(),
      'Upload failed'
    )

    answer({ body: { data: { items } } })

    await expect(pending).resolves.toEqual({ items })
  })

  it('resolves the bare body when the route answers without an envelope', async () => {
    const item: UploadedItem = { path: 'users.csv', size_bytes: 12, replaced: true }
    const pending = postUpload<UploadedItem>(
      '/tests/t1/testdata/upload',
      new FormData(),
      'Upload failed',
      { rawResponse: true }
    )

    answer({ status: 201, statusText: 'Created', body: item })

    await expect(pending).resolves.toEqual(item)
  })
})

describe('postUpload - failures', () => {
  it('throws the fallback message with the status label when the body carries no reason', async () => {
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed')

    answer({ status: 500, statusText: 'Internal Server Error', json: false })

    await expect(pending).rejects.toThrow('Upload failed: Internal Server Error')
  })

  it('uses the caller fallback verbatim, so two callers report different failures', async () => {
    const pending = postUpload('/tests/t1/import', new FormData(), 'Import failed')

    answer({ status: 500, statusText: 'Internal Server Error', json: false })

    await expect(pending).rejects.toThrow('Import failed: Internal Server Error')
  })

  it('reports the reason the server sent instead of the fallback', async () => {
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed')

    answer({
      status: 409,
      statusText: 'Conflict',
      body: { error: { message: "File already exists: 'fixtures/users.csv'" } },
    })

    await expect(pending).rejects.toThrow("File already exists: 'fixtures/users.csv'")
  })

  it('carries the HTTP status on the thrown error so callers can branch on 409', async () => {
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed')

    answer({
      status: 409,
      statusText: 'Conflict',
      body: {
        error: {
          message: "Test 'Login' is running; test data cannot be changed until it finishes",
        },
      },
    })

    const error = await pending
      .then(() => null)
      .catch((caught: unknown) => caught as { status?: number; message: string })

    expect(error?.status).toBe(409)
    expect(error?.message).toBe(
      "Test 'Login' is running; test data cannot be changed until it finishes"
    )
  })

  it('carries the correlation id the server answered with', async () => {
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed')

    answer({
      status: 500,
      statusText: 'Internal Server Error',
      headers: 'content-type: application/json\r\nX-Request-ID: req-77',
      body: { error: { message: 'Boom' } },
    })

    const error = await pending
      .then(() => null)
      .catch((caught: unknown) => caught as { requestId?: string })

    expect(error?.requestId).toBe('req-77')
  })

  it('reports a transport failure the browser could not explain', async () => {
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed')

    only().onerror?.()

    await expect(pending).rejects.toThrow('Failed to fetch')
  })
})

describe('postUpload - progress', () => {
  it('reports the bytes sent so far to the caller', async () => {
    const onProgress = vi.fn()
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed', {
      rawResponse: true,
      onProgress,
    })

    progress(2_048, 8_192)
    progress(8_192, 8_192)
    answer({ status: 201, statusText: 'Created', body: { path: 'a', size_bytes: 8192 } })
    await pending

    expect(onProgress.mock.calls).toEqual([
      [2_048, 8_192],
      [8_192, 8_192],
    ])
  })

  it('leaves the progress hook unset when the caller wants no progress', async () => {
    const pending = postUpload('/tests/t1/import', new FormData(), 'Import failed')

    expect(only().upload.onprogress).toBeNull()

    answer({ body: { data: null } })
    await pending
  })
})

describe('postUpload - canceling', () => {
  it('aborts the request when the signal fires', async () => {
    const controller = new AbortController()
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed', {
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).rejects.toThrow('Upload canceled')
  })

  it('rejects an already aborted signal without sending anything', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed', {
        signal: controller.signal,
      })
    ).rejects.toThrow('Upload canceled')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('stops listening once the request settled, so a later abort changes nothing', async () => {
    const controller = new AbortController()
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed', {
      rawResponse: true,
      signal: controller.signal,
    })
    answer({ status: 201, statusText: 'Created', body: { path: 'a' } })
    await expect(pending).resolves.toEqual({ path: 'a' })

    const abortHandler = vi.spyOn(only(), 'abort')
    controller.abort()

    expect(abortHandler).not.toHaveBeenCalled()
  })

  it('stops listening once the request failed', async () => {
    const controller = new AbortController()
    const pending = postUpload('/tests/t1/testdata/upload', new FormData(), 'Upload failed', {
      signal: controller.signal,
    })
    only().onerror?.()
    await expect(pending).rejects.toThrow('Failed to fetch')

    const abortHandler = vi.spyOn(only(), 'abort')
    controller.abort()

    expect(abortHandler).not.toHaveBeenCalled()
  })
})

describe('encodePathSegments', () => {
  it('leaves a plain single segment untouched', () => {
    expect(encodePathSegments('users.csv')).toBe('users.csv')
  })

  it('leaves a plain nested path untouched', () => {
    expect(encodePathSegments('fixtures/users.csv')).toBe('fixtures/users.csv')
  })

  it('keeps the separators so the path structure survives', () => {
    const encoded = encodePathSegments('a/b/c.csv')

    expect(encoded).toBe('a/b/c.csv')
    expect(encoded).not.toContain('%2F')
  })

  it('encodes spaces in every segment', () => {
    expect(encodePathSegments('my folder/user data.csv')).toBe('my%20folder/user%20data.csv')
  })

  it('encodes non-ASCII names', () => {
    expect(encodePathSegments('donnees/naive.csv')).toBe('donnees/naive.csv')
    expect(encodePathSegments('déjà/naïve.csv')).toBe('d%C3%A9j%C3%A0/na%C3%AFve.csv')
  })

  it('encodes characters that would otherwise change the URL meaning', () => {
    expect(encodePathSegments('report#1.csv')).toBe('report%231.csv')
    expect(encodePathSegments('a?b/c&d.csv')).toBe('a%3Fb/c%26d.csv')
  })

  it('returns an empty string for an empty path', () => {
    expect(encodePathSegments('')).toBe('')
  })
})
