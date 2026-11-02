/**
 * useTestDataActivity - what the Test Data chip carries with the sheet closed
 * (TDATA-16).
 *
 * Module: frontend/src/features/workbench/common/testdata/use-testdata-activity.ts
 *
 * The chip needs two counts and nothing else: how many files are on their way
 * in, and how many did not land and nobody has dismissed. It reads the test's
 * own snapshot on mount and follows the test's own topic, so it is right
 * whether or not the sheet was ever opened. A test with no folder yet reports
 * nothing and asks for nothing.
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

import { testdataApi } from '@/features/tests/api/testdata'
import { useTestDataActivity } from '@/features/workbench/common/testdata/use-testdata-activity'
import { useTestDataUploadStore } from '@/features/workbench/stores/testdata-upload-store'
import type {
  TestDataInterruptionRow,
  TestDataUploadRow,
  TestDataUploadState,
} from '@/features/tests/api/types'

const TEST_ID = 'test-42'
const OTHER_TEST_ID = 'test-99'
const STARTED_AT = 1_757_000_000_000

const IDLE = { uploads: 0, interruptions: 0 }

const UPLOAD_ROW: TestDataUploadRow = {
  id: 'up-1',
  folder: 'fixtures',
  name: 'notes.txt',
  path: 'fixtures/notes.txt',
  total_bytes: 9,
  loaded_bytes: 3,
  eta_seconds: null,
  started_at: STARTED_AT,
  session: 'another-tab',
}

const NOTICE_ROW: TestDataInterruptionRow = {
  id: 'up-2',
  folder: '',
  name: 'big.bin',
  path: 'big.bin',
  reason: 'Storing big.bin would leave less than 1 GB free',
  replace: false,
  at: STARTED_AT,
}

const BUSY: TestDataUploadState = {
  uploads: [UPLOAD_ROW, { ...UPLOAD_ROW, id: 'up-3' }],
  interruptions: [NOTICE_ROW],
}

const NO_UPLOADS: TestDataUploadState = { uploads: [], interruptions: [] }

const uploadStateMock = vi.mocked(testdataApi.uploadState)

/** Hands one frame to the hook's subscriber for that test's topic. */
function emit(testId: string, payload: Record<string, unknown>): void {
  const handler = handlers.get(`testdata:${testId}`)
  if (handler === undefined) throw new Error(`nothing subscribed to testdata:${testId}`)
  act(() => handler(payload))
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  useTestDataUploadStore.setState({ inFlight: {} })
  uploadStateMock.mockResolvedValue(NO_UPLOADS)
})

describe('useTestDataActivity - the snapshot', () => {
  it('reads what the test has in flight and what did not land', async () => {
    uploadStateMock.mockResolvedValue(BUSY)

    const { result } = renderHook(() => useTestDataActivity(TEST_ID))

    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))
    expect(uploadStateMock).toHaveBeenCalledWith(TEST_ID)
  })

  it('reports nothing until the snapshot lands', () => {
    uploadStateMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useTestDataActivity(TEST_ID))

    expect(result.current).toEqual(IDLE)
  })

  it('reports nothing when the snapshot fails', async () => {
    uploadStateMock.mockRejectedValue(
      Object.assign(new Error('Test not found: test-42'), { status: 404 })
    )

    const { result } = renderHook(() => useTestDataActivity(TEST_ID))

    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())
    expect(result.current).toEqual(IDLE)
  })
})

describe('useTestDataActivity - the topic', () => {
  it('follows the test data topic for that test', async () => {
    renderHook(() => useTestDataActivity(TEST_ID))

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled())
    expect(mockSubscribe.mock.calls[0][0]).toBe(`testdata:${TEST_ID}`)
  })

  it('takes both counts from the frame the server sends', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))

    emit(TEST_ID, {
      event: 'uploads_changed',
      uploads: [UPLOAD_ROW],
      interruptions: [NOTICE_ROW, { ...NOTICE_ROW, id: 'up-4' }],
    })

    expect(result.current).toEqual({ uploads: 1, interruptions: 2 })
  })

  it('reports nothing once the last upload settles', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))

    emit(TEST_ID, { event: 'uploads_changed', uploads: [], interruptions: [] })

    expect(result.current).toEqual(IDLE)
  })

  it('ignores the events that are not about the upload rows', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))

    emit(TEST_ID, { event: 'entries_changed' })
    emit(TEST_ID, {
      event: 'upload_canceled',
      id: UPLOAD_ROW.id,
      name: UPLOAD_ROW.name,
      path: UPLOAD_ROW.path,
    })

    expect(result.current).toEqual({ uploads: 2, interruptions: 1 })
  })

  it('stops following the topic when it goes away', async () => {
    const { unmount } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled())

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})

describe('useTestDataActivity - a test with no folder', () => {
  it('reports nothing and asks for nothing', async () => {
    const { result } = renderHook(() => useTestDataActivity(null))

    await act(async () => {})

    expect(result.current).toEqual(IDLE)
    expect(uploadStateMock).not.toHaveBeenCalled()
    expect(mockSubscribe).not.toHaveBeenCalled()
  })
})

describe('useTestDataActivity - changing test', () => {
  it('reports nothing while the next test is being read', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result, rerender } = renderHook((id: string) => useTestDataActivity(id), {
      initialProps: TEST_ID,
    })
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))
    uploadStateMock.mockReturnValue(new Promise(() => {}))

    rerender(OTHER_TEST_ID)

    expect(result.current).toEqual(IDLE)
  })

  it('reads the test it moved to and follows its topic', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result, rerender } = renderHook((id: string) => useTestDataActivity(id), {
      initialProps: TEST_ID,
    })
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))
    uploadStateMock.mockResolvedValue({ uploads: [UPLOAD_ROW], interruptions: [] })

    rerender(OTHER_TEST_ID)

    await waitFor(() => expect(result.current).toEqual({ uploads: 1, interruptions: 0 }))
    expect(uploadStateMock).toHaveBeenLastCalledWith(OTHER_TEST_ID)
    expect(mockSubscribe.mock.calls.at(-1)?.[0]).toBe(`testdata:${OTHER_TEST_ID}`)
  })
})

describe("useTestDataActivity - this tab's own uploads", () => {
  it('counts a file this tab is sending before the server has heard of it', async () => {
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())

    act(() => useTestDataUploadStore.getState().begin(TEST_ID, 'own-1'))

    expect(result.current).toEqual({ uploads: 1, interruptions: 0 })
  })

  it('counts it once, not twice, when the server reports the same upload', async () => {
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())
    act(() => useTestDataUploadStore.getState().begin(TEST_ID, 'own-1'))

    emit(TEST_ID, {
      event: 'uploads_changed',
      uploads: [{ ...UPLOAD_ROW, id: 'own-1' }],
      interruptions: [],
    })

    expect(result.current).toEqual({ uploads: 1, interruptions: 0 })
  })

  it('stops counting it once this tab is done sending it', async () => {
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())
    act(() => useTestDataUploadStore.getState().begin(TEST_ID, 'own-1'))

    act(() => useTestDataUploadStore.getState().end(TEST_ID, 'own-1'))

    expect(result.current).toEqual(IDLE)
  })

  it('ignores what this tab is sending into another test', async () => {
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())

    act(() => useTestDataUploadStore.getState().begin(OTHER_TEST_ID, 'own-1'))

    expect(result.current).toEqual(IDLE)
  })
})

describe('useTestDataActivity - an answer that carries no rows', () => {
  it('reports nothing rather than taking the canvas down with it', async () => {
    uploadStateMock.mockResolvedValue({} as unknown as TestDataUploadState)

    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(uploadStateMock).toHaveBeenCalled())

    expect(result.current).toEqual(IDLE)
  })

  it('does the same for a frame that carries no rows', async () => {
    uploadStateMock.mockResolvedValue(BUSY)
    const { result } = renderHook(() => useTestDataActivity(TEST_ID))
    await waitFor(() => expect(result.current).toEqual({ uploads: 2, interruptions: 1 }))

    emit(TEST_ID, { event: 'uploads_changed' })

    expect(result.current).toEqual(IDLE)
  })
})
