/**
 * useTestData - listing lifecycle, mutations and upload rows for one test
 * (TDATA-14, TDATA-15, TDATA-17).
 *
 * Module: frontend/src/features/workbench/common/testdata/use-testdata.ts
 *
 * The listing loads through the blocking-read model the session artifacts
 * sheet uses: a failed read blocks the surface and is never substituted with
 * an empty list. Every mutation re-reads on success. A refusal the server
 * answers with 409 - the test is running, or a name that appeared between the
 * conflict check and the request - is not a failed read: it lands in
 * blockedReason for inline display. An unsaved test has no folder yet, so it
 * has an empty listing, makes no request and mutates nothing.
 *
 * An upload is state of the test: the hook reads what is already in flight on
 * mount, follows the test's own topic, and renders its own rows beside the ones
 * other sessions started, merged by id with its own winning - only this tab
 * knows how many bytes have left the machine, and only this tab still holds the
 * file it can send again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('@/features/tests/api/testdata', () => ({
  testdataApi: {
    list: vi.fn(),
    upload: vi.fn(),
    uploadState: vi.fn(),
    cancelUpload: vi.fn(),
    dismissUpload: vi.fn(),
    reportInterruption: vi.fn(),
    checkSpace: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    contentUrl: vi.fn(),
    zipUrl: vi.fn(),
    download: vi.fn(),
    downloadZip: vi.fn(),
  },
}))

const { mockSubscribe, mockUnsubscribe, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>()
  const mockUnsubscribe = vi.fn()
  const mockSubscribe = vi.fn(
    (topic: string, handler: (payload: Record<string, unknown>) => void) => {
      handlers.set(topic, handler)
      return { topic, unsubscribe: mockUnsubscribe }
    }
  )
  return { mockSubscribe, mockUnsubscribe, handlers }
})

vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: () => ({ isConnected: true, subscribe: mockSubscribe }),
}))

import { testdataApi, type UploadOptions } from '@/features/tests/api/testdata'
import { useTestData } from '@/features/workbench/common/testdata/use-testdata'
import { usePageBlockStore } from '@/stores/page-block-store'
import { getSessionId } from '@/lib/session-identity'
import type {
  TestDataInterruptionRow,
  TestDataListing,
  TestDataUploadRow,
  TestDataUploadState,
} from '@/features/tests/api/types'

const TEST_ID = 'test-42'
const OTHER_TEST_ID = 'test-99'
const SESSION = getSessionId()
const OTHER_SESSION = 'another-tab'
const STARTED_AT = 1_757_000_000_000

const RUNNING_MESSAGE =
  "Test 'Login' is running; test data cannot be changed until it finishes"
const EXISTS_MESSAGE = 'File already exists: fixtures/users.csv'
const NO_ROOM_MESSAGE = 'Storing big.bin would leave less than 1 GB free'

const LISTING: TestDataListing = {
  entries: [
    { path: 'fixtures', kind: 'dir', size_bytes: 0, modified_at: '2026-09-01T10:00:00+00:00' },
    {
      path: 'fixtures/users.csv',
      kind: 'file',
      size_bytes: 18_432,
      modified_at: '2026-09-01T10:00:01+00:00',
    },
  ],
  total_files: 1,
  total_bytes: 18_432,
}

const EMPTY_LISTING: TestDataListing = { entries: [], total_files: 0, total_bytes: 0 }

const NO_UPLOADS: TestDataUploadState = { uploads: [], interruptions: [] }

/** A file another session is sending, as the snapshot and the topic report it. */
const OTHER_ROW: TestDataUploadRow = {
  id: 'up-other',
  folder: 'fixtures',
  name: 'notes.txt',
  path: 'fixtures/notes.txt',
  total_bytes: 9,
  loaded_bytes: 3,
  eta_seconds: null,
  started_at: STARTED_AT,
  session: OTHER_SESSION,
}

const SECOND_ROW: TestDataUploadRow = {
  ...OTHER_ROW,
  id: 'up-second',
  name: 'other.bin',
  path: 'fixtures/other.bin',
}

/** A file that did not land, kept with the test until somebody dismisses it. */
const NOTICE: TestDataInterruptionRow = {
  id: 'up-notice',
  folder: 'fixtures',
  name: 'users.csv',
  path: 'fixtures/users.csv',
  reason: EXISTS_MESSAGE,
  replace: true,
  at: STARTED_AT,
}

const UPLOADED = { path: 'users.csv', size_bytes: 8, replaced: false }

const listMock = vi.mocked(testdataApi.list)
const uploadMock = vi.mocked(testdataApi.upload)
const uploadStateMock = vi.mocked(testdataApi.uploadState)
const cancelUploadMock = vi.mocked(testdataApi.cancelUpload)
const dismissUploadMock = vi.mocked(testdataApi.dismissUpload)
const reportInterruptionMock = vi.mocked(testdataApi.reportInterruption)
const checkSpaceMock = vi.mocked(testdataApi.checkSpace)
const createFolderMock = vi.mocked(testdataApi.createFolder)
const renameMock = vi.mocked(testdataApi.rename)
const removeMock = vi.mocked(testdataApi.remove)

function serverError(message: string, status: number) {
  return Object.assign(new Error(message), { status, message })
}

function upload(name = 'users.csv'): File {
  return new File(['id,name\n'], name, { type: 'text/csv' })
}

/** Hands one frame to the hook's subscriber for that test's topic. */
function emit(testId: string, payload: Record<string, unknown>): void {
  const handler = handlers.get(`testdata:${testId}`)
  if (handler === undefined) throw new Error(`nothing subscribed to testdata:${testId}`)
  act(() => handler(payload))
}

interface Pending {
  options: UploadOptions
  land: () => void
  fail: (error: unknown) => void
}

const pending: Pending[] = []

/** Holds every upload open so the rows can be inspected while they are in flight. */
function holdUploads(): void {
  uploadMock.mockImplementation(
    (_id, _folder, _file, _replace, options: UploadOptions) =>
      new Promise((resolve, reject) => {
        pending.push({ options, land: () => resolve(UPLOADED), fail: reject })
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('Upload canceled', 'AbortError'))
        )
      })
  )
}

/** Mounts the hook on a test whose only upload row is one this tab did not start. */
async function withRemoteRow(canWrite = true) {
  uploadStateMock.mockResolvedValue({ uploads: [OTHER_ROW], interruptions: [] })
  const view = renderHook(() => useTestData(TEST_ID, canWrite))
  await waitFor(() => expect(view.result.current.uploads).toHaveLength(1))
  return view
}

/** Mounts the hook on a test the server is keeping one interruption for. */
async function withServerNotice(canWrite = true) {
  uploadStateMock.mockResolvedValue({ uploads: [], interruptions: [NOTICE] })
  const view = renderHook(() => useTestData(TEST_ID, canWrite))
  await waitFor(() => expect(view.result.current.uploads).toHaveLength(1))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set<string>() })
  pending.length = 0
  handlers.clear()
  listMock.mockResolvedValue(LISTING)
  uploadMock.mockResolvedValue(UPLOADED)
  uploadStateMock.mockResolvedValue(NO_UPLOADS)
  cancelUploadMock.mockResolvedValue(undefined)
  dismissUploadMock.mockResolvedValue(undefined)
  reportInterruptionMock.mockResolvedValue(undefined)
  checkSpaceMock.mockResolvedValue(undefined)
  createFolderMock.mockResolvedValue({ path: 'fixtures' })
  renameMock.mockResolvedValue({ path: 'fixtures/people.csv' })
  removeMock.mockResolvedValue(undefined)
})

describe('useTestData - unsaved test', () => {
  it('exposes an empty listing without reading anything', async () => {
    const { result } = renderHook(() => useTestData(null, true))

    await act(async () => {})

    expect(listMock).not.toHaveBeenCalled()
    expect(uploadStateMock).not.toHaveBeenCalled()
    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(result.current.listing).toEqual(EMPTY_LISTING)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.blockedReason).toBeNull()
    expect(result.current.uploads).toEqual([])
  })

  it('makes no request from any mutation', async () => {
    const { result } = renderHook(() => useTestData(null, true))

    await act(async () => {
      await result.current.upload('', [upload()], false)
      await result.current.createFolder('fixtures')
      await result.current.rename('fixtures/users.csv', 'people.csv')
      await result.current.remove('fixtures/users.csv')
    })

    expect(checkSpaceMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(createFolderMock).not.toHaveBeenCalled()
    expect(renameMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })
})

describe('useTestData - loading the listing', () => {
  it('reads the listing for the test on mount', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(listMock).toHaveBeenCalledWith(TEST_ID)
    expect(result.current.listing).toEqual(LISTING)
    expect(result.current.error).toBeNull()
  })

  it('reports loading while the first read is in flight', async () => {
    listMock.mockReturnValue(new Promise(() => {}))
    uploadStateMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useTestData(TEST_ID, true))

    expect(result.current.loading).toBe(true)
    expect(result.current.listing).toEqual(EMPTY_LISTING)
  })

  it('reads again when the test id changes', async () => {
    const { result, rerender } = renderHook((id: string) => useTestData(id, true), {
      initialProps: TEST_ID,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender(OTHER_TEST_ID)

    await waitFor(() => expect(listMock).toHaveBeenCalledWith(OTHER_TEST_ID))
  })

  it('re-reads on refresh', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(listMock).toHaveBeenCalledTimes(2)
  })
})

describe('useTestData - failed read', () => {
  it('reports the failure as a FailureDetail and keeps the listing empty', async () => {
    listMock.mockRejectedValue(serverError('Test not found: test-42', 404))

    const { result } = renderHook(() => useTestData(TEST_ID, true))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toEqual(
      expect.objectContaining({ message: 'Test not found: test-42', status: 404 })
    )
    expect(result.current.listing).toEqual(EMPTY_LISTING)
    expect(result.current.loading).toBe(false)
  })

  it('blocks the surface that started the read', async () => {
    listMock.mockRejectedValue(serverError('Test not found: test-42', 404))

    renderHook(() => useTestData(TEST_ID, true))

    await waitFor(() =>
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load test data')
    )
    expect(usePageBlockStore.getState().block?.detail.message).toBe('Test not found: test-42')
  })

  it('clears the failure once a later read succeeds', async () => {
    listMock.mockRejectedValueOnce(serverError('Boom', 500))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.error).not.toBeNull())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.listing).toEqual(LISTING)
  })

  it('leaves the rows empty when the upload snapshot fails', async () => {
    uploadStateMock.mockRejectedValue(serverError('Boom', 500))

    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.uploads).toEqual([])
    expect(result.current.error).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('useTestData - mutations', () => {
  it('uploads the file into the target folder and re-reads', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const file = upload()

    await act(async () => {
      await result.current.upload('fixtures', [file], true)
    })

    expect(uploadMock).toHaveBeenCalledWith(
      TEST_ID,
      'fixtures',
      file,
      true,
      expect.objectContaining({
        session: SESSION,
        uploadId: expect.any(String),
        signal: expect.any(AbortSignal),
      })
    )
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('creates the folder and re-reads', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createFolder('fixtures/nested')
    })

    expect(createFolderMock).toHaveBeenCalledWith(TEST_ID, 'fixtures/nested')
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('renames an entry beside its siblings and re-reads', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.rename('fixtures/users.csv', 'people.csv')
    })

    expect(renameMock).toHaveBeenCalledWith(TEST_ID, 'fixtures/users.csv', 'fixtures/people.csv')
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('renames a root-level entry without a leading separator', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.rename('schema.xsd', 'schema-v2.xsd')
    })

    expect(renameMock).toHaveBeenCalledWith(TEST_ID, 'schema.xsd', 'schema-v2.xsd')
  })

  it('removes an entry and re-reads', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.remove('fixtures/users.csv')
    })

    expect(removeMock).toHaveBeenCalledWith(TEST_ID, 'fixtures/users.csv')
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})

describe('useTestData - refused mutations (409)', () => {
  it('surfaces a refused delete, folder creation and rename as a blocked reason', async () => {
    removeMock.mockRejectedValue(serverError(RUNNING_MESSAGE, 409))
    createFolderMock.mockRejectedValue(serverError(RUNNING_MESSAGE, 409))
    renameMock.mockRejectedValue(serverError(RUNNING_MESSAGE, 409))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.remove('schema.xsd')
    })
    expect(result.current.blockedReason).toBe(RUNNING_MESSAGE)

    await act(async () => {
      await result.current.createFolder('nested')
    })
    expect(result.current.blockedReason).toBe(RUNNING_MESSAGE)

    await act(async () => {
      await result.current.rename('schema.xsd', 'other.xsd')
    })
    expect(result.current.blockedReason).toBe(RUNNING_MESSAGE)
  })

  it('leaves the blocked reason clear for a failure that is not a refusal', async () => {
    removeMock.mockRejectedValue(serverError('Delete failed', 500))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.remove('schema.xsd').catch(() => {})
    })

    expect(result.current.blockedReason).toBeNull()
  })
})

describe('useTestData - uploads in flight', () => {
  it('sends one request per file, each with its own row and abort signal', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      void result.current.upload('fixtures', [upload('a.csv'), upload('b.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(2))

    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(pending[0].options.signal).not.toBe(pending[1].options.signal)
    expect(pending[0].options.uploadId).not.toBe(pending[1].options.uploadId)
    expect(pending[0].options.session).toBe(SESSION)
  })

  it('holds a row per file in flight, named and sized', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      void result.current.upload('', [upload('a.csv'), upload('b.csv')], false)
    })

    await waitFor(() => expect(result.current.uploads).toHaveLength(2))
    expect(result.current.uploads.map((row) => row.name)).toEqual(['a.csv', 'b.csv'])
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({ loaded: 0, total: 8, failure: null, status: 'uploading' })
    )
  })

  it('shows the file size until the server says what it has received', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(1))

    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({ loaded: 0, total: upload('a.csv').size, eta: null })
    )
  })

  it('moves its own row along on the count the server keeps, not on bytes sent', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    const uploadId = pending[0].options.uploadId

    emit(TEST_ID, {
      event: 'uploads_changed',
      uploads: [
        {
          ...OTHER_ROW,
          id: uploadId,
          name: 'a.csv',
          path: 'a.csv',
          loaded_bytes: 4,
          total_bytes: 8,
          eta_seconds: 12,
        },
      ],
      interruptions: [],
    })

    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({ loaded: 4, total: 8, eta: 12 })
    )
  })

  it('drops the row and re-reads when the file lands', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(1))

    await act(async () => {
      pending[0].land()
    })

    expect(result.current.uploads).toHaveLength(0)
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('checks the space a file needs before sending its body', async () => {
    const file = upload('a.csv')
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upload('fixtures', [file], false)
    })

    expect(checkSpaceMock).toHaveBeenCalledWith(TEST_ID, file.size, 'a.csv')
  })

  it('re-reads the listing as each file settles', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upload('', [upload('a.csv'), upload('b.csv')], false)
    })

    expect(listMock).toHaveBeenCalledTimes(3)
  })

  it('leaves the new test alone when an upload for the old one lands', async () => {
    holdUploads()
    const { result, rerender } = renderHook((id: string) => useTestData(id, true), {
      initialProps: TEST_ID,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(result.current.uploads).toHaveLength(1))

    rerender(OTHER_TEST_ID)
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      pending[0].land()
    })

    expect(result.current.uploads).toHaveLength(0)
  })
})

describe('useTestData - the rows other sessions own', () => {
  it('reads what is already in flight when this session arrives', async () => {
    const { result } = await withRemoteRow()

    expect(uploadStateMock).toHaveBeenCalledWith(TEST_ID)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({
        id: OTHER_ROW.id,
        name: 'notes.txt',
        folder: 'fixtures',
        path: 'fixtures/notes.txt',
        loaded: 3,
        total: 9,
        startedAt: STARTED_AT,
        status: 'uploading',
        failure: null,
      })
    )
  })

  it('follows the test data topic for the test it has open', async () => {
    renderHook(() => useTestData(TEST_ID, true))

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled())
    expect(mockSubscribe.mock.calls[0][0]).toBe(`testdata:${TEST_ID}`)
  })

  it('stops following the topic when the sheet goes away', async () => {
    const { unmount } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled())

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalled()
  })

  it('replaces the rows it did not start when the server reports a change', async () => {
    const { result } = await withRemoteRow()

    emit(TEST_ID, { event: 'uploads_changed', uploads: [SECOND_ROW], interruptions: [] })

    expect(result.current.uploads.map((row) => row.name)).toEqual(['other.bin'])
  })

  it('takes the notices the server keeps from the same frame', async () => {
    const { result } = await withRemoteRow()

    emit(TEST_ID, { event: 'uploads_changed', uploads: [], interruptions: [NOTICE] })

    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({
        id: NOTICE.id,
        name: 'users.csv',
        status: 'interrupted',
        failure: EXISTS_MESSAGE,
      })
    )
  })

  it('re-reads the listing when the entries moved', async () => {
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledTimes(1)

    emit(TEST_ID, { event: 'entries_changed' })

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('turns a stopped row amber', async () => {
    const { result } = await withRemoteRow()

    emit(TEST_ID, {
      event: 'upload_canceled',
      id: OTHER_ROW.id,
      name: OTHER_ROW.name,
      path: OTHER_ROW.path,
    })

    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({
        id: OTHER_ROW.id,
        name: 'notes.txt',
        folder: 'fixtures',
        status: 'canceled',
        failure: null,
        retry: null,
        chooseFile: null,
        cancel: null,
      })
    )
  })

  it('ignores a cancellation that belongs to a test it no longer has open', async () => {
    uploadStateMock.mockResolvedValue({ uploads: [OTHER_ROW], interruptions: [] })
    const { result, rerender } = renderHook((id: string) => useTestData(id, true), {
      initialProps: TEST_ID,
    })
    await waitFor(() => expect(result.current.uploads).toHaveLength(1))
    uploadStateMock.mockResolvedValue(NO_UPLOADS)

    rerender(OTHER_TEST_ID)
    await waitFor(() => expect(result.current.uploads).toHaveLength(0))
    emit(TEST_ID, {
      event: 'upload_canceled',
      id: OTHER_ROW.id,
      name: OTHER_ROW.name,
      path: OTHER_ROW.path,
    })

    expect(result.current.uploads).toEqual([])
  })

  it('offers Cancel on a row another session started only to a session that may write', async () => {
    const { result } = await withRemoteRow(false)

    expect(result.current.uploads[0].cancel).toBeNull()
  })

  it('offers Cancel on a row another session started when this one may write', async () => {
    const { result } = await withRemoteRow(true)

    expect(result.current.uploads[0].cancel).toEqual(expect.any(Function))
  })

  it('always offers Cancel on a row this session started', async () => {
    uploadStateMock.mockResolvedValue({
      uploads: [{ ...OTHER_ROW, session: SESSION }],
      interruptions: [],
    })
    const { result } = renderHook(() => useTestData(TEST_ID, false))

    await waitFor(() => expect(result.current.uploads).toHaveLength(1))
    expect(result.current.uploads[0].cancel).toEqual(expect.any(Function))
  })

  it('keeps its own row when the server reports the same upload', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('fixtures', [upload('a.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    const uploadId = pending[0].options.uploadId

    emit(TEST_ID, {
      event: 'uploads_changed',
      uploads: [
        {
          ...OTHER_ROW,
          id: uploadId,
          name: 'a.csv',
          path: 'fixtures/a.csv',
          loaded_bytes: 4,
          eta_seconds: null,
          total_bytes: 8,
          session: 'another-tab',
        },
      ],
      interruptions: [],
    })

    // One row, this tab's own - it keeps the folder it is sending to and the
    // Cancel it owns, while the counts come off the server's copy.
    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({ id: uploadId, name: 'a.csv', folder: 'fixtures', loaded: 4 })
    )
    expect(result.current.uploads[0].cancel).not.toBeNull()
  })
})

describe('useTestData - a file that did not land', () => {
  it('keeps the row with the reason and the same bytes to send again', async () => {
    uploadMock.mockRejectedValue(serverError(EXISTS_MESSAGE, 409))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upload('fixtures', [upload('users.csv')], false)
    })

    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({
        name: 'users.csv',
        status: 'interrupted',
        failure: EXISTS_MESSAGE,
        chooseFile: null,
        cancel: null,
      })
    )
    expect(result.current.uploads[0].retry).toEqual(expect.any(Function))
  })

  it('keeps the reason on the file that failed and lands the others', async () => {
    uploadMock.mockRejectedValueOnce(serverError(EXISTS_MESSAGE, 409))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upload('fixtures', [upload('a.csv'), upload('b.csv')], false)
    })

    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({ name: 'a.csv', failure: EXISTS_MESSAGE })
    )
    expect(result.current.blockedReason).toBeNull()
    expect(result.current.error).toBeNull()
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('sends the same bytes again with the notice it is retrying', async () => {
    uploadMock.mockRejectedValueOnce(serverError(EXISTS_MESSAGE, 409))
    const file = upload('users.csv')
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.upload('fixtures', [file], true)
    })
    const failedId = result.current.uploads[0].id
    const retry = result.current.uploads[0].retry as () => void

    await act(async () => {
      retry()
    })

    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(uploadMock).toHaveBeenLastCalledWith(
      TEST_ID,
      'fixtures',
      file,
      true,
      expect.objectContaining({ retryOf: failedId, session: SESSION })
    )
    expect(result.current.uploads).toHaveLength(0)
  })

  it('offers a picked file instead once this tab no longer holds the bytes', async () => {
    const { result } = await withServerNotice()

    expect(result.current.uploads[0]).toEqual(
      expect.objectContaining({
        id: NOTICE.id,
        name: 'users.csv',
        status: 'interrupted',
        failure: EXISTS_MESSAGE,
        retry: null,
        cancel: null,
      })
    )
    expect(result.current.uploads[0].chooseFile).toEqual(expect.any(Function))
  })

  it('offers neither way back to a session that may not write', async () => {
    const { result } = await withServerNotice(false)

    expect(result.current.uploads[0].retry).toBeNull()
    expect(result.current.uploads[0].chooseFile).toBeNull()
  })

  it('sends a picked file under the expected name with the notice it replaces', async () => {
    const { result } = await withServerNotice()
    const picked = upload('users.csv')
    const chooseFile = result.current.uploads[0].chooseFile as (file: File) => void

    await act(async () => {
      chooseFile(picked)
    })

    expect(uploadMock).toHaveBeenCalledWith(
      TEST_ID,
      'fixtures',
      picked,
      true,
      expect.objectContaining({ retryOf: NOTICE.id, session: SESSION })
    )
  })

  it('reports a differently named file on the row and sends nothing', async () => {
    const { result } = await withServerNotice()
    const chooseFile = result.current.uploads[0].chooseFile as (file: File) => void

    await act(async () => {
      chooseFile(upload('people.csv'))
    })

    expect(uploadMock).not.toHaveBeenCalled()
    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0].failure).toBe('That is people.csv, not users.csv.')
  })

  it('reports the refusal of its own space check as a notice for that file', async () => {
    checkSpaceMock.mockRejectedValue(serverError(NO_ROOM_MESSAGE, 507))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upload('fixtures', [upload('big.bin')], false)
    })

    expect(uploadMock).not.toHaveBeenCalled()
    expect(result.current.uploads).toHaveLength(1)
    expect(result.current.uploads[0].failure).toBe(NO_ROOM_MESSAGE)
    expect(reportInterruptionMock).toHaveBeenCalledWith(
      TEST_ID,
      result.current.uploads[0].id,
      { path: 'fixtures', name: 'big.bin', reason: NO_ROOM_MESSAGE, replace: false }
    )
  })

  it('drops a dismissed notice and tells the server to forget it', async () => {
    uploadMock.mockRejectedValue(serverError(EXISTS_MESSAGE, 409))
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.upload('', [upload('a.csv')], false)
    })
    const failedId = result.current.uploads[0].id

    act(() => result.current.uploads[0].dismiss())

    expect(result.current.uploads).toHaveLength(0)
    expect(dismissUploadMock).toHaveBeenCalledWith(TEST_ID, failedId)
  })

  it('tells the server to forget a notice it is keeping', async () => {
    const { result } = await withServerNotice()

    act(() => result.current.uploads[0].dismiss())

    expect(dismissUploadMock).toHaveBeenCalledWith(TEST_ID, NOTICE.id)
  })
})

describe('useTestData - stopping an upload', () => {
  it('asks the server first, then stops its own request', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    const uploadId = pending[0].options.uploadId

    await act(async () => {
      result.current.uploads[0].cancel?.()
    })

    expect(cancelUploadMock).toHaveBeenCalledWith(TEST_ID, uploadId, SESSION)
    expect(pending[0].options.signal?.aborted).toBe(true)
  })

  it('leaves an amber row rather than a reason', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv'), upload('b.csv')], false)
    })
    await waitFor(() => expect(result.current.uploads).toHaveLength(2))

    await act(async () => {
      result.current.uploads[0].cancel?.()
    })

    expect(result.current.uploads.map((row) => row.name)).toEqual(['b.csv', 'a.csv'])
    expect(result.current.uploads[1]).toEqual(
      expect.objectContaining({ name: 'a.csv', status: 'canceled', failure: null })
    )
  })

  it('dismisses a cancellation without telling the server', async () => {
    holdUploads()
    const { result } = renderHook(() => useTestData(TEST_ID, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      void result.current.upload('', [upload('a.csv')], false)
    })
    await waitFor(() => expect(result.current.uploads).toHaveLength(1))
    await act(async () => {
      result.current.uploads[0].cancel?.()
    })
    expect(result.current.uploads[0].status).toBe('canceled')

    act(() => result.current.uploads[0].dismiss())

    expect(result.current.uploads).toHaveLength(0)
    expect(dismissUploadMock).not.toHaveBeenCalled()
  })
})
