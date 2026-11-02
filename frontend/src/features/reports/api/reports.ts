/**
 * Reports API Client
 *
 * REQ-5.2.4.13: Reporting endpoints
 *
 * GET /reports listing, report job start/poll, raw JSON artifact fetch, and
 * the ensureReport orchestration (POST -> poll -> single re-POST on 404)
 * shared by the viewer (json) and the Export HTML action (html).
 */

import type {
  FetchReportsParams,
  ReportFormat,
  ReportJobView,
  ReportListRow,
  ReportsApiPagination,
  WaveReport,
} from './types'
import { apiClient } from '@/lib/api'
import { toSnakeCase } from '@/lib/string-case'

const POLL_INTERVAL_MS = 1500
/** One tick may drop; a run of failures this long is the poll itself failing. */
const MAX_FAILED_POLLS = 3

export type ReportErrorKind =
  | 'execution-running'
  | 'no-artifacts'
  | 'job-failed'
  | 'job-lost'
  | 'request-failed'
  | 'canceled'
  | 'artifact-fetch-failed'

/** Error carrying a classified kind alongside the raw backend message. */
export type ClassifiedReportError = Error & { kind: ReportErrorKind }

export interface EnsureReportOptions {
  onProgress?: (progress: { processed: number; total: number }) => void
  isCanceled?: () => boolean
}

export interface ReportsListResult {
  data: ReportListRow[]
  pagination: ReportsApiPagination
}

function reportError(kind: ReportErrorKind, message: string): ClassifiedReportError {
  return Object.assign(new Error(message), { kind })
}

/** Fetch the execution-centric reports listing with optional filters. */
export async function fetchReports(params?: FetchReportsParams): Promise<ReportsListResult> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.set('page', params.page.toString())
  if (params?.per_page) queryParams.set('per_page', params.per_page.toString())
  if (params?.search) queryParams.set('search', params.search)
  if (params?.status && params.status.length > 0) queryParams.set('status', params.status.join(','))
  if (params?.type && params.type.length > 0) queryParams.set('type', params.type.join(','))
  if (params?.triggered_by && params.triggered_by.length > 0)
    queryParams.set('triggered_by', params.triggered_by.join(','))
  if (params?.from_date) queryParams.set('from_date', params.from_date)
  if (params?.to_date) queryParams.set('to_date', params.to_date)
  if (params?.sort_by) queryParams.set('sort', toSnakeCase(params.sort_by))
  if (params?.sort_order) queryParams.set('order', params.sort_order)

  const path = `/reports${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await apiClient.get<ReportListRow[], ReportsApiPagination>(path)
  return { data: response.data, pagination: response.pagination! }
}

/** Idempotent ensure-POST: existing artifact (completed view) or job start. */
export async function startReportJob(
  executionId: string,
  format: ReportFormat,
): Promise<ReportJobView> {
  const response = await apiClient.post<ReportJobView>(
    `/executions/${executionId}/report?format=${format}`,
  )
  return response.data
}

/** Poll the in-flight report generation job. */
export async function getReportJobStatus(
  executionId: string,
  format: ReportFormat,
): Promise<ReportJobView> {
  const response = await apiClient.get<ReportJobView>(
    `/executions/${executionId}/report?format=${format}`,
  )
  return response.data
}

/** Fetch the JSON report artifact body (raw, not envelope-unwrapped). */
export async function fetchReportJson(artifactId: string): Promise<WaveReport> {
  const response = await apiClient.get<WaveReport>(
    `/artifacts/content/${artifactId}?disposition=inline`,
    { rawResponse: true },
  )
  return response.data
}

function classifyStartError(error: unknown): ClassifiedReportError {
  const status = (error as { status?: number }).status
  const message = (error as Error).message
  if (status === 409) {
    const kind = message.includes('Wait for the execution to finish')
      ? 'execution-running'
      : 'no-artifacts'
    return reportError(kind, message)
  }
  return reportError('request-failed', message)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Poll once; on a 404 re-POST exactly once (job state lost on restart).
 * A failing tick is thrown raw, so the caller can keep the progress it has. */
async function nextJobView(
  executionId: string,
  format: ReportFormat,
  repostState: { reposted: boolean },
): Promise<ReportJobView> {
  try {
    return await getReportJobStatus(executionId, format)
  } catch (error) {
    if ((error as { status?: number }).status !== 404) {
      throw error
    }
    if (repostState.reposted) {
      throw reportError('job-lost', (error as Error).message)
    }
    repostState.reposted = true
    return startReportJob(executionId, format)
  }
}

/** The last known progress stays on screen; the poll says it is failing. */
function pollFailed(error: unknown): ClassifiedReportError {
  return reportError(
    'request-failed',
    `Could not read the report progress after ${MAX_FAILED_POLLS} attempts. ${(error as Error).message}`,
  )
}

interface PollState {
  view: ReportJobView
  failedPolls: number
}

/** One poll tick. A failed tick keeps the last view, so the progress on screen stands. */
async function advancePoll(
  state: PollState,
  executionId: string,
  format: ReportFormat,
  repostState: { reposted: boolean },
): Promise<PollState> {
  try {
    return { view: await nextJobView(executionId, format, repostState), failedPolls: 0 }
  } catch (error) {
    if ((error as Partial<ClassifiedReportError>).kind !== undefined) throw error
    const failedPolls = state.failedPolls + 1
    if (failedPolls >= MAX_FAILED_POLLS) throw pollFailed(error)
    return { view: state.view, failedPolls }
  }
}

/**
 * Ensure the report of the given format exists and resolve its artifact id.
 *
 * POSTs the idempotent ensure endpoint, polls the job every 1500ms, and
 * re-POSTs exactly once when the poll 404s (job state lost on restart).
 * Rejects with a ClassifiedReportError. A failed tick keeps the progress
 * already reported and tries again; a run of them rejects with the reason,
 * so a failing poll is never an endless wait.
 */
export async function ensureReport(
  executionId: string,
  format: ReportFormat,
  opts: EnsureReportOptions = {},
): Promise<{ artifactId: string }> {
  let state: PollState
  try {
    state = { view: await startReportJob(executionId, format), failedPolls: 0 }
  } catch (error) {
    throw classifyStartError(error)
  }
  const repostState = { reposted: false }
  for (;;) {
    const { view } = state
    if (view.status === 'completed') {
      return { artifactId: view.artifact_id as string }
    }
    if (view.status === 'failed') {
      throw reportError('job-failed', view.error as string)
    }
    opts.onProgress?.({
      processed: view.progress.runs_processed,
      total: view.progress.runs_total,
    })
    await delay(POLL_INTERVAL_MS)
    if (opts.isCanceled?.()) {
      throw reportError('canceled', 'Report generation canceled')
    }
    state = await advancePoll(state, executionId, format, repostState)
  }
}
