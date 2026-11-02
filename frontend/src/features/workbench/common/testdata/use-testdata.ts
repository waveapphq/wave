/**
 * Listing lifecycle, mutations and upload rows for one test's data
 * (REQ-3.4.3.2; TDATA-14, TDATA-15, TDATA-17).
 *
 * The listing loads through the blocking-read model the session artifacts
 * sheet uses: a failed read blocks the surface and is never replaced by an
 * empty list. A 409 (running test, or a name that appeared after the
 * pre-request conflict check) is a refusal, not a failed read: it lands in
 * blockedReason. An unsaved test has no folder: empty listing, no requests.
 *
 * An upload is state of the test, so this tab renders its own rows beside the
 * ones other sessions started, merged by id with its own winning: only this tab
 * knows how many bytes have left the machine, and only this tab still holds the
 * file it can send again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { testdataApi } from '@/features/tests/api/testdata'
import type {
  TestDataInterruptionRow,
  TestDataListing,
  TestDataUploadRow,
  TestDataUploadState,
} from '@/features/tests/api/types'
import { alreadyReported } from '@/features/workbench/lib/already-reported'
import { useTestDataUploadStore } from '@/features/workbench/stores/testdata-upload-store'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import { usePageBlock } from '@/hooks/use-page-block'
import { runBlockingRead } from '@/hooks/use-blocking-reads'
import { toFailureDetail, type FailureDetail } from '@/lib/failure-detail'
import { joinReference } from '@/lib/file-references'
import { getSessionId } from '@/lib/session-identity'
import { randomUUID } from '@/lib/uuid'
import { parentOf } from './testdata-entries'

/** Uploading, stopped on purpose, or stopped by something that went wrong. */
export type TestDataUploadStatus = 'uploading' | 'canceled' | 'interrupted'

export interface TestDataUpload {
  id: string
  /** The file's own name, which the row is labeled by. */
  name: string
  /** The folder it is going to; '' is the test's own folder. */
  folder: string
  path: string
  /** Bytes the server has received and written. */
  loaded: number
  total: number
  /** Seconds left, as the server worked it out; null while it cannot be measured. */
  eta: number | null
  /** Epoch ms the request started; the progress detail appears three seconds in. */
  startedAt: number
  status: TestDataUploadStatus
  /** The reason this file did not land; null while it is still going. */
  failure: string | null
  /** Sends the same bytes again; null where this tab no longer holds the file. */
  retry: (() => void) | null
  /** Sends a file the person picks; null while this tab still holds the original. */
  chooseFile: ((file: File) => void) | null
  /** Null where this session may not stop this upload. */
  cancel: (() => void) | null
  dismiss: () => void
}

export interface UseTestDataResult {
  listing: TestDataListing
  /** True until the first read of the current test settles. */
  loading: boolean
  /** The failed read that blocks the surface; null while reads succeed. */
  error: FailureDetail | null
  /** The server's 409 message for the last refused write; null otherwise. */
  blockedReason: string | null
  /** Every row on screen: going, stopped, and not landed. */
  uploads: TestDataUpload[]
  refresh: () => void
  upload: (folder: string, files: File[], replace: boolean) => Promise<void>
  createFolder: (path: string) => Promise<void>
  /** Renames the entry at `path` to `newName` beside its siblings. */
  rename: (path: string, newName: string) => Promise<void>
  remove: (path: string) => Promise<void>
}

/** One upload this tab started, while it is the row's best source of truth. */
interface LocalUpload {
  id: string
  folder: string
  name: string
  path: string
  replace: boolean
  /** The file's own size, until the server reports what it has received. */
  total: number
  startedAt: number
  failure: string | null
}

interface CanceledUpload {
  id: string
  name: string
  path: string
}

interface TestDataState {
  forTestId: string | null
  listing: TestDataListing
  loading: boolean
  error: FailureDetail | null
  blockedReason: string | null
  local: LocalUpload[]
  remote: TestDataUploadState
  canceled: CanceledUpload[]
  /** Row id -> the file offered under the wrong name, which replaces its reason. */
  wrongFile: Record<string, string>
}

interface TestDataEvent {
  event: 'uploads_changed' | 'upload_canceled' | 'entries_changed'
  uploads?: TestDataUploadRow[]
  interruptions?: TestDataInterruptionRow[]
  id?: string
  name?: string
  path?: string
}

const READ_LABEL = 'test data'
const REFUSED_STATUS = 409
const EMPTY_LISTING: TestDataListing = { entries: [], total_files: 0, total_bytes: 0 }
const NO_UPLOADS: TestDataUploadState = { uploads: [], interruptions: [] }

export const TESTDATA_TOPIC_PREFIX = 'testdata:'

/** A body or frame that carries no rows means no rows, never a broken surface. */
export function toUploadState(value: Partial<TestDataUploadState>): TestDataUploadState {
  return {
    uploads: Array.isArray(value.uploads) ? value.uploads : [],
    interruptions: Array.isArray(value.interruptions) ? value.interruptions : [],
  }
}

function wrongFileMessage(expected: string, chosen: string): string {
  return `That is ${chosen}, not ${expected}.`
}

function withoutLocal(rows: LocalUpload[], uploadId: string): LocalUpload[] {
  return rows.filter((row) => row.id !== uploadId)
}

function withoutKey(map: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _dropped, ...rest } = map
  return rest
}

function withLocalChanges(
  rows: LocalUpload[],
  uploadId: string,
  changes: Partial<LocalUpload>
): LocalUpload[] {
  return rows.map((row) => (row.id === uploadId ? { ...row, ...changes } : row))
}

function initialState(testId: string | null): TestDataState {
  return {
    forTestId: testId,
    listing: EMPTY_LISTING,
    loading: testId !== null,
    error: null,
    blockedReason: null,
    local: [],
    remote: NO_UPLOADS,
    canceled: [],
    wrongFile: {},
  }
}

export function useTestData(testId: string | null, canWrite: boolean): UseTestDataResult {
  const [state, setState] = useState(() => initialState(testId))
  const { blockPage, clearPageBlock } = usePageBlock()
  // Destructured like every other workbench subscriber, so the effect deps stay
  // on isConnected rather than on store function identities.
  const { isConnected, subscribe } = useWebSocketStore()
  const subscribeRef = useRef(subscribe)
  subscribeRef.current = subscribe
  // The bytes this tab still holds, so an interrupted row can send them again.
  const filesRef = useRef(new Map<string, File>())
  // Ids this tab already knows were stopped on purpose, so their request's
  // rejection is not reported as something that went wrong.
  const canceledRef = useRef(new Set<string>())
  // Notices this tab is already sending again, hidden until the server drops them.
  const retriedRef = useRef(new Set<string>())
  // How to stop each request this tab has open, by row id.
  const abortsRef = useRef(new Map<string, () => void>())
  const session = getSessionId()

  // State is stamped with the test it belongs to, so a test change starts
  // from a fresh state and a read that lands late for another test is ignored.
  const current = state.forTestId === testId ? state : initialState(testId)

  const patch = useCallback(
    (changes: Partial<TestDataState>) => {
      setState((previous) => {
        const base = previous.forTestId === testId ? previous : initialState(testId)
        return { ...base, ...changes, forTestId: testId }
      })
    },
    [testId]
  )

  const patchLocal = useCallback(
    (id: string, change: (rows: LocalUpload[]) => LocalUpload[]) => {
      setState((previous) =>
        previous.forTestId === id ? { ...previous, local: change(previous.local) } : previous
      )
    },
    []
  )

  const load = useCallback(async (): Promise<void> => {
    if (testId === null) return
    const id = testId
    const run = async () => {
      const listing = await testdataApi.list(id)
      patch({ listing, loading: false, error: null })
      clearPageBlock(READ_LABEL)
    }
    try {
      await runBlockingRead({ label: READ_LABEL, run }, blockPage)
    } catch (error_) {
      patch({ listing: EMPTY_LISTING, loading: false, error: toFailureDetail(error_) })
    }
  }, [testId, patch, blockPage, clearPageBlock])

  const refresh = useCallback(() => {
    load().catch(alreadyReported)
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  // What is already in flight when this session arrives (TDATA-14). A failed
  // read leaves the rows empty; the listing is what blocks the surface.
  useEffect(() => {
    if (testId === null) return
    let canceled = false
    testdataApi
      .uploadState(testId)
      .then((remote) => {
        if (!canceled) patch({ remote: toUploadState(remote) })
      })
      .catch(alreadyReported)
    return () => {
      canceled = true
    }
  }, [testId, patch])

  const handleEvent = useCallback(
    (payload: TestDataEvent) => {
      if (payload.event === 'entries_changed') {
        refresh()
        return
      }
      if (payload.event === 'upload_canceled') {
        const row = {
          id: payload.id as string,
          name: payload.name as string,
          path: payload.path as string,
        }
        canceledRef.current.add(row.id)
        abortsRef.current.get(row.id)?.()
        setState((previous) =>
          previous.forTestId !== testId || previous.canceled.some((known) => known.id === row.id)
            ? previous
            : {
                ...previous,
                local: withoutLocal(previous.local, row.id),
                canceled: [...previous.canceled, row],
              }
        )
        return
      }
      patch({ remote: toUploadState(payload) })
    },
    [patch, refresh, testId]
  )

  useEffect(() => {
    if (testId === null) return
    const subscription = subscribeRef.current<TestDataEvent>(
      `${TESTDATA_TOPIC_PREFIX}${testId}`,
      handleEvent
    )
    return () => subscription.unsubscribe()
  }, [testId, isConnected, handleEvent])

  const mutate = useCallback(
    async (request: (id: string) => Promise<unknown>): Promise<void> => {
      if (testId === null) return
      try {
        await request(testId)
        patch({ blockedReason: null })
      } catch (error_) {
        const detail = toFailureDetail(error_)
        if (detail.status !== REFUSED_STATUS) throw error_
        patch({ blockedReason: detail.message })
      } finally {
        await load()
      }
    },
    [testId, patch, load]
  )

  const runUpload = useCallback(
    async (
      id: string,
      folder: string,
      file: File,
      replace: boolean,
      retryOf?: string
    ): Promise<void> => {
      const uploadId = randomUUID()
      const path = joinReference(folder, file.name)
      const controller = new AbortController()
      const change = (changes: Partial<LocalUpload>) =>
        patchLocal(id, (rows) => withLocalChanges(rows, uploadId, changes))
      filesRef.current.set(uploadId, file)
      abortsRef.current.set(uploadId, () => controller.abort())
      const { begin, end } = useTestDataUploadStore.getState()
      begin(id, uploadId)
      if (retryOf !== undefined) {
        retriedRef.current.add(retryOf)
        setState((previous) => ({
          ...previous,
          wrongFile: withoutKey(previous.wrongFile, retryOf),
        }))
      }
      patchLocal(id, (rows) => [
        ...withoutLocal(rows, retryOf ?? ''),
        {
          id: uploadId,
          folder,
          name: file.name,
          path,
          replace,
          total: file.size,
          startedAt: Date.now(),
          failure: null,
        },
      ])
      try {
        await testdataApi.checkSpace(id, file.size, file.name)
      } catch (error_) {
        // The pre-check never reaches the upload route, so the notice it should
        // have left is reported instead (TDATA-14).
        const reason = toFailureDetail(error_).message
        change({ failure: reason })
        await testdataApi
          .reportInterruption(id, uploadId, { path: folder, name: file.name, reason, replace })
          .catch(alreadyReported)
        abortsRef.current.delete(uploadId)
        end(id, uploadId)
        return
      }

      try {
        await testdataApi.upload(id, folder, file, replace, {
          uploadId,
          session,
          retryOf,
          signal: controller.signal,
        })
        patchLocal(id, (rows) => withoutLocal(rows, uploadId))
        filesRef.current.delete(uploadId)
      } catch (error_) {
        if (canceledRef.current.has(uploadId)) {
          patchLocal(id, (rows) => withoutLocal(rows, uploadId))
        } else {
          change({ failure: toFailureDetail(error_).message })
        }
      } finally {
        abortsRef.current.delete(uploadId)
        end(id, uploadId)
        await load()
      }
    },
    [patchLocal, load, session]
  )

  const upload = useCallback(
    async (folder: string, files: File[], replace: boolean): Promise<void> => {
      if (testId === null) return
      const id = testId
      await Promise.all(files.map((file) => runUpload(id, folder, file, replace)))
    },
    [testId, runUpload]
  )

  // Every row-driven action runs for the test the row belongs to, which
  // buildRows guarantees is a real one: it renders nothing without a test.
  const stopUpload = useCallback(
    (id: string, uploadId: string, name: string, path: string) => {
      testdataApi
        .cancelUpload(id, uploadId, session)
        .then(() => handleEvent({ event: 'upload_canceled', id: uploadId, name, path }))
        .catch(alreadyReported)
    },
    [session, handleEvent]
  )

  const dismissUpload = useCallback(
    (id: string, uploadId: string, local: boolean) => {
      patchLocal(id, (rows) => withoutLocal(rows, uploadId))
      filesRef.current.delete(uploadId)
      // Dropped here as well as on the server, so the row goes at once rather
      // than on the frame that follows.
      setState((previous) => ({
        ...previous,
        canceled: previous.canceled.filter((row) => row.id !== uploadId),
        wrongFile: withoutKey(previous.wrongFile, uploadId),
        remote: {
          ...previous.remote,
          interruptions: previous.remote.interruptions.filter((row) => row.id !== uploadId),
        },
      }))
      if (!local) {
        testdataApi.dismissUpload(id, uploadId).catch(alreadyReported)
      }
    },
    [patchLocal]
  )

  const createFolder = useCallback(
    (path: string) => mutate((id) => testdataApi.createFolder(id, path)),
    [mutate]
  )

  const rename = useCallback(
    (path: string, newName: string) =>
      mutate((id) => testdataApi.rename(id, path, joinReference(parentOf(path), newName))),
    [mutate]
  )

  const remove = useCallback(
    (path: string) => mutate((id) => testdataApi.remove(id, path)),
    [mutate]
  )

  const rows = useMemo(
    () =>
      buildRows({
        state: current,
        files: filesRef.current,
        retried: retriedRef.current,
        session,
        canWrite,
        testId,
        onCancel: (uploadId, name, path) =>
          stopUpload(testId as string, uploadId, name, path),
        onDismiss: (uploadId, local) => dismissUpload(testId as string, uploadId, local),
        onSend: (row, file) => {
          runUpload(testId as string, row.folder, file, row.replace, row.id).catch(alreadyReported)
        },
        // The row that asks for a file is the server's, so its answer cannot live
        // on this tab's own rows; it sits beside them, keyed by the same id.
        onWrongFile: (uploadId, message) =>
          setState((previous) => ({
            ...previous,
            wrongFile: { ...previous.wrongFile, [uploadId]: message },
          })),
      }),
    [
      current,
      session,
      canWrite,
      testId,
      stopUpload,
      dismissUpload,
      runUpload,
    ]
  )

  return {
    listing: current.listing,
    loading: current.loading,
    error: current.error,
    blockedReason: current.blockedReason,
    uploads: rows,
    refresh,
    upload,
    createFolder,
    rename,
    remove,
  }
}

/** What a row needs beyond its own data to become one the browser can render. */
interface RowContext {
  state: TestDataState
  files: Map<string, File>
  /** Notices this tab is already sending again; the server drops them a moment later. */
  retried: Set<string>
  session: string
  canWrite: boolean
  testId: string | null
  onCancel: (uploadId: string, name: string, path: string) => void
  onDismiss: (uploadId: string, local: boolean) => void
  onSend: (row: { id: string; folder: string; replace: boolean }, file: File) => void
  onWrongFile: (uploadId: string, message: string) => void
}

/** What the server knows about a row this tab is also holding, if anything. */
function serverRow(context: RowContext, uploadId: string): TestDataUploadRow | undefined {
  return context.state.remote.uploads.find((row) => row.id === uploadId)
}

/** A row that did not land, with the two ways back: the same bytes, or a picked file. */
function interruptedRow(
  row: { id: string; folder: string; name: string; path: string; replace: boolean },
  failure: string,
  startedAt: number,
  context: RowContext
): TestDataUpload {
  const held = context.files.get(row.id) ?? null
  const send = (file: File) => context.onSend(row, file)
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    path: row.path,
    loaded: 0,
    total: 0,
    eta: null,
    startedAt,
    status: 'interrupted',
    failure: context.state.wrongFile[row.id] ?? failure,
    retry: context.canWrite && held !== null ? () => send(held) : null,
    chooseFile:
      context.canWrite && held === null
        ? (file: File) => {
            if (file.name === row.name) {
              send(file)
              return
            }
            context.onWrongFile(row.id, wrongFileMessage(row.name, file.name))
          }
        : null,
    cancel: null,
    dismiss: () => context.onDismiss(row.id, false),
  }
}

/** This tab's own row, its progress read off the server so every session agrees. */
function localRow(row: LocalUpload, context: RowContext): TestDataUpload {
  if (row.failure !== null) {
    return interruptedRow(row, row.failure, row.startedAt, context)
  }
  const server = serverRow(context, row.id)
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    path: row.path,
    loaded: server?.loaded_bytes ?? 0,
    total: server?.total_bytes ?? row.total,
    eta: server?.eta_seconds ?? null,
    startedAt: row.startedAt,
    status: 'uploading',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel: () => context.onCancel(row.id, row.name, row.path),
    dismiss: () => context.onDismiss(row.id, true),
  }
}

function remoteRow(row: TestDataUploadRow, context: RowContext): TestDataUpload {
  const mine = row.session === context.session
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    path: row.path,
    loaded: row.loaded_bytes,
    total: row.total_bytes,
    eta: row.eta_seconds,
    startedAt: row.started_at,
    status: 'uploading',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel:
      mine || context.canWrite ? () => context.onCancel(row.id, row.name, row.path) : null,
    dismiss: () => context.onDismiss(row.id, true),
  }
}

function canceledRow(row: CanceledUpload, context: RowContext): TestDataUpload {
  return {
    id: row.id,
    name: row.name,
    folder: parentOf(row.path),
    path: row.path,
    loaded: 0,
    total: 0,
    eta: null,
    startedAt: 0,
    status: 'canceled',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel: null,
    dismiss: () => context.onDismiss(row.id, true),
  }
}

/** This tab's own rows first, then the ones other sessions started (TDATA-14). */
function buildRows(context: RowContext): TestDataUpload[] {
  if (context.testId === null) return []
  const { local, remote, canceled } = context.state
  const stopped = new Set(canceled.map((row) => row.id))
  const own = local.filter((row) => !stopped.has(row.id))
  const taken = new Set([...own.map((row) => row.id), ...stopped, ...context.retried])
  return [
    ...own.map((row) => localRow(row, context)),
    ...remote.uploads
      .filter((row) => !taken.has(row.id))
      .map((row) => remoteRow(row, context)),
    ...remote.interruptions
      .filter((row) => !taken.has(row.id))
      .map((row) => interruptedRow(row, row.reason, row.at, context)),
    ...canceled.map((row) => canceledRow(row, context)),
  ]
}
