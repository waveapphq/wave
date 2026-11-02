/**
 * Test Data API client (REQ-3.4.3.2, REQ-5.2.4.12).
 *
 * Module: frontend/src/features/tests/api/testdata.ts
 *
 * Every path is relative to the test's own folder ("" is the folder itself),
 * every method lives under /tests/{testId}/testdata, and the reference a block
 * carries is testdata://{rel}. Uploads go through the promoted multipart
 * helper, carrying the row the upload owns and the session that started it;
 * downloads through the shared binary-download helper. The upload rows every
 * session watching sees are read, canceled, dismissed and reported here too.
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
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
}))

vi.mock('@/lib/api/upload', () => ({
  postUpload: vi.fn(),
  encodePathSegments: (path: string) =>
    path.split('/').map(encodeURIComponent).join('/'),
}))

vi.mock('@/lib/download-file', () => ({
  downloadFromUrl: vi.fn(),
}))

import { apiClient } from '@/lib/api'
import { postUpload } from '@/lib/api/upload'
import { downloadFromUrl } from '@/lib/download-file'
import { testdataApi } from '@/features/tests/api/testdata'
import type { TestDataListing, TestDataUploadState } from '@/features/tests/api/types'

const API_BASE = 'http://localhost:8000'
const TEST_ID = 'test-42'
const UPLOAD_ID = 'upload-1'
const SESSION = 'tab-7'

const LISTING: TestDataListing = {
  entries: [
    { path: 'fixtures', kind: 'dir', size_bytes: 0, modified_at: '2026-09-01T10:00:00+00:00' },
    {
      path: 'fixtures/users.csv',
      kind: 'file',
      size_bytes: 18_432,
      modified_at: '2026-09-01T10:00:01+00:00',
    },
    {
      path: 'schema.xsd',
      kind: 'file',
      size_bytes: 2_355,
      modified_at: '2026-09-01T10:00:02+00:00',
    },
  ],
  total_files: 2,
  total_bytes: 20_787,
}

const UPLOAD_STATE: TestDataUploadState = {
  uploads: [
    {
      id: UPLOAD_ID,
      folder: 'fixtures',
      name: 'users.csv',
      path: 'fixtures/users.csv',
      total_bytes: 8,
      loaded_bytes: 4,
      eta_seconds: null,
      started_at: 1_757_000_000_000,
      session: SESSION,
    },
  ],
  interruptions: [
    {
      id: 'upload-2',
      folder: '',
      name: 'big.bin',
      path: 'big.bin',
      reason: 'Storing big.bin would leave less than 1 GB free',
      replace: false,
      at: 1_757_000_000_001,
    },
  ],
}

const UPLOADED = { path: 'fixtures/users.csv', size_bytes: 9, replaced: false }

function envelope<T>(data: T) {
  return { data, meta: { requestId: '' }, status: 200 }
}

function serverError(message: string, status: number) {
  return Object.assign(new Error(message), { status, message })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('testdataApi.list', () => {
  it('gets the test data listing under the test', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(envelope(LISTING))

    const result = await testdataApi.list(TEST_ID)

    expect(apiClient.get).toHaveBeenCalledWith(`/tests/${TEST_ID}/testdata`, {
      rawResponse: true,
    })
    expect(result).toEqual(LISTING)
  })

  it('surfaces the server message when the listing fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(serverError('Test not found: test-42', 404))

    await expect(testdataApi.list(TEST_ID)).rejects.toThrow('Test not found: test-42')
  })
})

describe('testdataApi.upload', () => {
  const usersFile = new File(['id,name\n'], 'users.csv', { type: 'text/csv' })

  function uploadFormData(): FormData {
    return vi.mocked(postUpload).mock.calls[0][1]
  }

  function uploadOptions() {
    return vi.mocked(postUpload).mock.calls[0][3]
  }

  function send(folder = 'fixtures', replace = false, extra = {}) {
    return testdataApi.upload(TEST_ID, folder, usersFile, replace, {
      uploadId: UPLOAD_ID,
      session: SESSION,
      ...extra,
    })
  }

  it('posts the one file with the target folder and the replace flag', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send()

    expect(vi.mocked(postUpload).mock.calls[0][0]).toBe(`/tests/${TEST_ID}/testdata/upload`)
    const form = uploadFormData()
    expect(form.getAll('files')).toEqual([usersFile])
    expect(form.get('path')).toBe('fixtures')
    expect(form.get('replace')).toBe('false')
  })

  it('sends every field before the file, so the server can refuse the target first', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send()

    expect([...uploadFormData().keys()]).toEqual([
      'path',
      'replace',
      'upload_id',
      'session',
      'size',
      'retry_of',
      'files',
    ])
  })

  it('names the row this upload owns and the session that started it', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send()

    const form = uploadFormData()
    expect(form.get('upload_id')).toBe(UPLOAD_ID)
    expect(form.get('session')).toBe(SESSION)
  })

  it("states the file's own size, so the server knows a body was truncated", async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send()

    expect(uploadFormData().get('size')).toBe(String(usersFile.size))
  })

  it('leaves retry_of empty when this is not a retry', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send()

    expect(uploadFormData().get('retry_of')).toBe('')
  })

  it('names the notice being retried, so the upload displaces its own leftover', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send('fixtures', false, { retryOf: 'upload-0' })

    expect(uploadFormData().get('retry_of')).toBe('upload-0')
  })

  it('sends the root as an empty path', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send('')

    expect(uploadFormData().get('path')).toBe('')
  })

  it('sends replace=true when the caller confirmed the replacement', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send('fixtures', true)

    expect(uploadFormData().get('replace')).toBe('true')
  })

  it('passes a fallback message to the multipart helper', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send('')

    expect(vi.mocked(postUpload).mock.calls[0][2]).toEqual(expect.any(String))
  })

  it('asks for the bare body the route answers', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await send('')

    expect(uploadOptions()).toEqual(expect.objectContaining({ rawResponse: true }))
  })

  it('forwards the progress callback and the abort signal', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)
    const onProgress = vi.fn()
    const controller = new AbortController()

    await send('', false, { onProgress, signal: controller.signal })

    expect(uploadOptions()).toEqual(
      expect.objectContaining({ onProgress, signal: controller.signal })
    )
  })

  it('resolves the one item the server reports', async () => {
    vi.mocked(postUpload).mockResolvedValue(UPLOADED)

    await expect(send()).resolves.toEqual(UPLOADED)
  })

  it('surfaces the server message when the upload fails', async () => {
    vi.mocked(postUpload).mockRejectedValue(
      serverError('File already exists: fixtures/users.csv', 409)
    )

    await expect(send()).rejects.toThrow('File already exists: fixtures/users.csv')
  })
})

describe('testdataApi.uploadState', () => {
  it('reads what is already in flight and what did not land', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(envelope(UPLOAD_STATE))

    const result = await testdataApi.uploadState(TEST_ID)

    expect(apiClient.get).toHaveBeenCalledWith(`/tests/${TEST_ID}/testdata/uploads`, {
      rawResponse: true,
    })
    expect(result).toEqual(UPLOAD_STATE)
  })

  it('surfaces the server message when the snapshot fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(serverError('Test not found: test-42', 404))

    await expect(testdataApi.uploadState(TEST_ID)).rejects.toThrow('Test not found: test-42')
  })
})

describe('testdataApi.cancelUpload', () => {
  it('names the session asking, so the server knows it may stop this upload', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(envelope(undefined))

    await expect(
      testdataApi.cancelUpload(TEST_ID, UPLOAD_ID, SESSION)
    ).resolves.toBeUndefined()

    expect(apiClient.post).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/uploads/${UPLOAD_ID}/cancel`,
      { session: SESSION },
      { rawResponse: true }
    )
  })

  it('surfaces the refusal when this session may not stop it', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      serverError('Only the session that started this upload can cancel it', 409)
    )

    await expect(testdataApi.cancelUpload(TEST_ID, UPLOAD_ID, SESSION)).rejects.toThrow(
      'Only the session that started this upload can cancel it'
    )
  })
})

describe('testdataApi.dismissUpload', () => {
  it('drops the notice the test is keeping', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(envelope(undefined))

    await expect(testdataApi.dismissUpload(TEST_ID, UPLOAD_ID)).resolves.toBeUndefined()

    expect(apiClient.post).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/uploads/${UPLOAD_ID}/dismiss`,
      {},
      { rawResponse: true }
    )
  })

  it('surfaces the server message when the notice is already gone', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(serverError('Upload not found: upload-1', 404))

    await expect(testdataApi.dismissUpload(TEST_ID, UPLOAD_ID)).rejects.toThrow(
      'Upload not found: upload-1'
    )
  })
})

describe('testdataApi.reportInterruption', () => {
  it('records why a file the client never sent did not land', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(envelope(undefined))

    await expect(
      testdataApi.reportInterruption(TEST_ID, UPLOAD_ID, {
        path: 'fixtures',
        name: 'big.bin',
        reason: 'Storing big.bin would leave less than 1 GB free',
        replace: false,
      })
    ).resolves.toBeUndefined()

    expect(apiClient.post).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/uploads/${UPLOAD_ID}/interrupt`,
      {
        path: 'fixtures',
        name: 'big.bin',
        reason: 'Storing big.bin would leave less than 1 GB free',
        replace: false,
      },
      { rawResponse: true }
    )
  })
})

describe('testdataApi.checkSpace', () => {
  it('asks whether the file fits before a byte is sent', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(envelope({ ok: true }))

    await testdataApi.checkSpace(TEST_ID, 8_192, 'users.csv')

    expect(apiClient.get).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/space?bytes=8192&name=users.csv`,
      { rawResponse: true }
    )
  })

  it('encodes a name the query string would otherwise break', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(envelope({ ok: true }))

    await testdataApi.checkSpace(TEST_ID, 1, 'my report&1.csv')

    expect(apiClient.get).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/space?bytes=1&name=my%20report%261.csv`,
      { rawResponse: true }
    )
  })

  it('surfaces the refusal so the body is never sent', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      serverError('Storing big.bin would leave less than 1 GB free', 507)
    )

    await expect(testdataApi.checkSpace(TEST_ID, 9_000, 'big.bin')).rejects.toThrow(
      'Storing big.bin would leave less than 1 GB free'
    )
  })
})

describe('testdataApi.createFolder', () => {
  it('posts the relative folder path', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(envelope({ path: 'fixtures/nested' }))

    const result = await testdataApi.createFolder(TEST_ID, 'fixtures/nested')

    expect(apiClient.post).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/folders`,
      { path: 'fixtures/nested' },
      { rawResponse: true }
    )
    expect(result).toEqual({ path: 'fixtures/nested' })
  })

  it('surfaces the server message when the folder cannot be created', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      serverError('Folder already exists: fixtures', 409)
    )

    await expect(testdataApi.createFolder(TEST_ID, 'fixtures')).rejects.toThrow(
      'Folder already exists: fixtures'
    )
  })
})

describe('testdataApi.rename', () => {
  it('patches the encoded current path with the new path in the body', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue(envelope({ path: 'fixtures/people.csv' }))

    const result = await testdataApi.rename(
      TEST_ID,
      'fixtures/users.csv',
      'fixtures/people.csv'
    )

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/fixtures/users.csv`,
      { path: 'fixtures/people.csv' },
      { rawResponse: true }
    )
    expect(result).toEqual({ path: 'fixtures/people.csv' })
  })

  it('encodes each segment independently so the separators survive', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue(envelope({ path: 'a/b.csv' }))

    await testdataApi.rename(TEST_ID, 'my fixtures/ünïcode name.csv', 'a/b.csv')

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/my%20fixtures/%C3%BCn%C3%AFcode%20name.csv`,
      { path: 'a/b.csv' },
      { rawResponse: true }
    )
  })

  it('surfaces the server message when the rename is refused', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      serverError("Test 'Login' is running; test data cannot be changed until it finishes", 409)
    )

    await expect(testdataApi.rename(TEST_ID, 'a.csv', 'b.csv')).rejects.toThrow(
      "Test 'Login' is running; test data cannot be changed until it finishes"
    )
  })
})

describe('testdataApi.remove', () => {
  it('deletes the encoded path and resolves void', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue(envelope(undefined))

    await expect(testdataApi.remove(TEST_ID, 'fixtures/users.csv')).resolves.toBeUndefined()

    expect(apiClient.delete).toHaveBeenCalledWith(
      `/tests/${TEST_ID}/testdata/fixtures/users.csv`
    )
  })

  it('surfaces the server message when the entry is gone', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(
      serverError('Test data entry not found: fixtures/users.csv', 404)
    )

    await expect(testdataApi.remove(TEST_ID, 'fixtures/users.csv')).rejects.toThrow(
      'Test data entry not found: fixtures/users.csv'
    )
  })
})

describe('testdataApi.contentUrl', () => {
  it('builds the content URL with each segment encoded', () => {
    expect(testdataApi.contentUrl(TEST_ID, 'my fixtures/users.csv')).toBe(
      `${API_BASE}/tests/${TEST_ID}/testdata/content/my%20fixtures/users.csv`
    )
  })
})

describe('testdataApi.zipUrl', () => {
  it('builds the zip URL with the folder as a query parameter', () => {
    const url = new URL(testdataApi.zipUrl(TEST_ID, 'fixtures'))

    expect(url.origin + url.pathname).toBe(`${API_BASE}/tests/${TEST_ID}/testdata/zip`)
    expect(url.searchParams.get('path')).toBe('fixtures')
  })

  it('asks for the whole folder with an empty path', () => {
    const url = new URL(testdataApi.zipUrl(TEST_ID, ''))

    expect(url.searchParams.get('path')).toBe('')
  })
})

describe('testdataApi.download', () => {
  it('downloads the file through the shared helper under its own name', async () => {
    vi.mocked(downloadFromUrl).mockResolvedValue(undefined)

    await testdataApi.download(TEST_ID, 'fixtures/users.csv')

    expect(downloadFromUrl).toHaveBeenCalledWith(
      `${API_BASE}/tests/${TEST_ID}/testdata/content/fixtures/users.csv`,
      'users.csv'
    )
  })

  it('propagates a failed download', async () => {
    vi.mocked(downloadFromUrl).mockRejectedValue(
      serverError('Test data entry not found: a.csv', 404)
    )

    await expect(testdataApi.download(TEST_ID, 'a.csv')).rejects.toThrow(
      'Test data entry not found: a.csv'
    )
  })
})

describe('testdataApi.downloadZip', () => {
  it('downloads the folder archive through the shared helper', async () => {
    vi.mocked(downloadFromUrl).mockResolvedValue(undefined)

    await testdataApi.downloadZip(TEST_ID, 'fixtures')

    const [url, fallback] = vi.mocked(downloadFromUrl).mock.calls[0]
    expect(new URL(url).searchParams.get('path')).toBe('fixtures')
    expect(fallback).toMatch(/\.zip$/)
  })
})
