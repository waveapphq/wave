/**
 * The catalog pull behind a script editor chip (Get Tables, Get fields), shared through the store (SQL-12, OS-13).
 */

import { use, useEffect, useState } from 'react'
import { ToastContext } from '@/components/ui/toast'
import {
  OPENSEARCH_CATALOG_NOUNS,
  SQL_CATALOG_NOUNS,
  type CatalogChipState,
} from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'
import {
  catalogStateKey,
  type CatalogJobStatus,
  type CatalogRequest,
} from '@/features/workbench/lib/catalog-request'
import {
  useWorkflowStore,
  useWorkflowStoreInstance,
  type CatalogPullEntry,
} from '@/features/workbench/stores/workflow-store'
import { extractErrorMessage } from '@/services/api-client/errors'

export const CATALOG_POLL_MS = 500
export const CATALOG_DONE_HOLD_MS = 3000

type JobAnswer<T> = { status: CatalogJobStatus; error?: string } & Partial<T>

/** The endpoints of one catalog and how its answers hold the data `T`. */
export interface CatalogPullApi<T, Request extends object = object> {
  start: (body: Request & { refresh?: boolean }) => Promise<{ job_id: string; cached: boolean } & Partial<T>>
  get: (jobId: string) => Promise<JobAnswer<T>>
  cancel: (jobId: string) => Promise<unknown>
  /** The data of a cached or done answer. */
  dataOf: (answer: Partial<T>) => T
  /** The data while nothing is loaded. */
  empty: T
}

export interface CatalogPullResult<T> {
  state: CatalogChipState
  /** Loaded data, null until the entry is loaded. */
  data: T | null
  /** The job the loaded data came from, null until the entry is loaded. */
  jobId: string | null
  error: string | null
  /** A failure toast takes `failedTitle`, or the title of the catalog without one. */
  start: (failedTitle?: string) => void
  stop: () => void
  refresh: () => void
  /** Ends the Done hold at once. */
  settle: () => void
}

type WorkflowStoreApi = ReturnType<typeof useWorkflowStoreInstance>

type CatalogKind = 'sql' | 'opensearch'

/** Tells the author why a pull failed; a row list has no room for the chip's tooltip. */
type ReportFailure = (error: string) => void

const FAILED_TITLES: Record<CatalogKind, string> = {
  sql: SQL_CATALOG_NOUNS.failed,
  opensearch: OPENSEARCH_CATALOG_NOUNS.failed,
}

type BusyEntry = CatalogPullEntry & { status: 'connecting' | 'reading' }

function isBusy(entry: CatalogPullEntry | undefined): entry is BusyEntry {
  return entry?.status === 'connecting' || entry?.status === 'reading'
}

function ignore(): void {
  // A refused cancel changes nothing the author sees.
}

function pullKeyOf(kind: CatalogKind, request: object): string {
  return `${kind}:${catalogStateKey(request as CatalogRequest<object>)}`
}

/** Runs one pull against the store; it outlives the editor and stops once its entry is gone or replaced. */
function runPull<T, Request extends object>(
  store: WorkflowStoreApi,
  key: string,
  body: Request & { refresh?: boolean },
  api: CatalogPullApi<T, Request>,
  reportFailure: ReportFailure,
): void {
  let current: CatalogPullEntry = { status: 'connecting', jobId: null, data: api.empty, error: null }
  const isCurrent = () => store.getState().catalogPulls.get(key) === current
  const ifCurrent =
    <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A): void => {
      if (isCurrent()) handler(...args)
    }
  const write = (entry: CatalogPullEntry) => {
    current = entry
    store.getState().setCatalogPull(key, entry)
  }
  const load = (jobId: string, answer: Partial<T>) =>
    write({ status: 'loaded', jobId, data: api.dataOf(answer), error: null })
  const failWith = (jobId: string | null, error: string | null) => {
    write({ status: 'failed', jobId, data: api.empty, error })
    if (error) reportFailure(error)
  }
  const fail = ifCurrent((error: unknown) => failWith(current.jobId, extractErrorMessage(error)))

  const poll = (jobId: string) => {
    const onJob = (job: JobAnswer<T>) => {
      if (job.status === 'done') {
        load(jobId, job)
      } else if (job.status === 'failed') {
        failWith(jobId, job.error ?? null)
      } else if (job.status === 'canceled') {
        store.getState().removeCatalogPull(key)
      } else {
        if (job.status !== current.status) write({ ...current, status: job.status })
        poll(jobId)
      }
    }
    setTimeout(
      ifCurrent(() => {
        api.get(jobId).then(ifCurrent(onJob), fail)
      }),
      CATALOG_POLL_MS,
    )
  }

  write(current)
  api.start(body).then((answer) => {
    if (!isCurrent()) {
      if (!answer.cached) api.cancel(answer.job_id).catch(ignore)
      return
    }
    if (answer.cached) {
      load(answer.job_id, answer)
      return
    }
    write({ ...current, jobId: answer.job_id })
    poll(answer.job_id)
  }, fail)
}

/** The pull state of one catalog request, shared by every editor on the same `kind:stateKey`. */
export function useCatalogPull<T, Request extends object = object>(
  kind: CatalogKind,
  request: Request | null,
  api: CatalogPullApi<T, Request>,
): CatalogPullResult<T> {
  const store = useWorkflowStoreInstance()
  const toast = use(ToastContext)
  const key = request === null ? null : pullKeyOf(kind, request)
  const entry = useWorkflowStore((state) => (key === null ? undefined : state.catalogPulls.get(key)))
  const [hold, setHold] = useState<{ key: string } | null>(null)

  useEffect(() => {
    if (key === null) return undefined
    return store.subscribe((state, previous) => {
      const now = state.catalogPulls.get(key)
      if (now?.status === 'loaded' && isBusy(previous.catalogPulls.get(key))) setHold({ key })
    })
  }, [store, key])

  useEffect(() => {
    if (hold === null) return undefined
    const timer = setTimeout(() => setHold(null), CATALOG_DONE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [hold])

  let state: CatalogChipState = 'idle'
  if (entry?.status === 'loaded') state = hold?.key === key ? 'done' : 'settled'
  else if (entry) state = entry.status
  const loaded = entry?.status === 'loaded' ? entry : null

  const pull = (refresh: boolean, failedTitle = FAILED_TITLES[kind]) => {
    if (request === null) return
    const pullKey = pullKeyOf(kind, request)
    const existing = store.getState().catalogPulls.get(pullKey)
    if (isBusy(existing) || (!refresh && existing?.status === 'loaded')) return
    const reportFailure: ReportFailure = (error) => toast?.error(error, failedTitle)
    runPull(store, pullKey, refresh ? { ...request, refresh: true } : request, api, reportFailure)
  }

  const stop = () => {
    if (key === null) return
    const existing = store.getState().catalogPulls.get(key)
    if (!isBusy(existing)) return
    store.getState().removeCatalogPull(key)
    if (existing.jobId !== null) api.cancel(existing.jobId).catch(ignore)
  }

  return {
    state,
    data: loaded === null ? null : (loaded.data as T),
    jobId: loaded === null ? null : loaded.jobId,
    error: entry?.error ?? null,
    start: (failedTitle) => pull(false, failedTitle),
    stop,
    refresh: () => pull(true),
    settle: () => setHold(null),
  }
}
