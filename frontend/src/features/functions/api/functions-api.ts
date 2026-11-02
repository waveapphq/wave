/**
 * REST client for the Function backend.
 *
 * Every method calls `global.fetch` directly (bypassing the unified
 * `apiClient`) so that the Function-specific ETag handshake and the envelope
 * shape `{ success, data, pagination }` can be parsed inline. The shared
 * `getApiBaseUrl()` helper is applied to every path so the same call site
 * works in dev (Vite `/api` proxy) and in prod / container CI (direct
 * `VITE_API_BASE_URL`).
 */

import { getApiBaseUrl } from '@/lib/api'
import type { FunctionVariablesSeed } from '@/types/function-variables'
import type {
  AddFunctionVersionPayload,
  AddFunctionVersionResult,
  BatchCreateResult,
  BatchDeleteResult,
  ComputedBumps,
  CreateFunctionPayload,
  DetachFunctionResult,
  FunctionDefinition,
  FunctionDependentsResponse,
  FunctionListResponse,
  GetVersionResult,
  ListFunctionsParams,
  ListVersionsResult,
  PublishFunctionPayload,
  PublishFunctionResult,
  ValidateBumpsPayload,
} from './types'


function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`
}


export class FunctionsApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'FunctionsApiError'
  }
}


/** The server answering that the library holds no such Function. That is an
 *  answer the product renders as the missing-function state, not a failed read. */
export function isFunctionAbsent(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404
}


type EnvelopeError = {
  success: false
  error: { message: string; code?: string }
}

type EnvelopeSuccess<T> = {
  success: true
  data: T
  pagination?: unknown
}


async function parseBackendError(response: Response): Promise<FunctionsApiError> {
  const body = (await response.json()) as EnvelopeError
  return new FunctionsApiError(response.status, body.error.message)
}


async function fetchEnvelope<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(apiUrl(path), init)
  if (!response.ok) {
    throw await parseBackendError(response)
  }
  const body = (await response.json()) as EnvelopeSuccess<T>
  return { data: body.data, response }
}


function buildListQuery(params?: ListFunctionsParams): string {
  if (!params) return ''
  const usp = new URLSearchParams()
  if (params.page !== undefined) usp.set('page', String(params.page))
  if (params.per_page !== undefined) usp.set('per_page', String(params.per_page))
  if (params.search) usp.set('search', params.search)
  if (params.tags?.length) usp.set('tags', params.tags.join(','))
  if (params.sort_by) usp.set('sort_by', params.sort_by)
  if (params.sort_order) usp.set('sort_order', params.sort_order)
  return `?${usp.toString()}`
}


export async function listFunctionTags(): Promise<string[]> {
  const { data } = await fetchEnvelope<string[]>('/functions/tags')
  return data
}


export async function listFunctions(
  params?: ListFunctionsParams,
): Promise<FunctionListResponse> {
  const response = await fetch(apiUrl(`/functions${buildListQuery(params)}`))
  if (!response.ok) {
    throw await parseBackendError(response)
  }
  const body = (await response.json()) as EnvelopeSuccess<unknown> & {
    pagination: FunctionListResponse['pagination']
  }
  return {
    functions: body.data as FunctionListResponse['functions'],
    pagination: body.pagination,
  }
}


export async function getFunction(
  id: string,
): Promise<{ definition: FunctionDefinition; etag: string }> {
  const { data, response } = await fetchEnvelope<FunctionDefinition>(
    `/functions/${id}`,
  )
  return { definition: data, etag: response.headers.get('ETag') as string }
}


export async function createFunction(
  payload: CreateFunctionPayload,
): Promise<{ definition: FunctionDefinition; etag: string }> {
  const { data, response } = await fetchEnvelope<FunctionDefinition>(
    '/functions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return { definition: data, etag: response.headers.get('ETag') as string }
}


export async function deleteFunction(
  id: string,
  options?: { cascade?: boolean },
): Promise<void> {
  const query = options?.cascade ? '?cascade=true' : ''
  const response = await fetch(apiUrl(`/functions/${id}${query}`), { method: 'DELETE' })
  if (!response.ok) {
    throw await parseBackendError(response)
  }
}


export async function getDependents(
  id: string,
  version?: string,
): Promise<FunctionDependentsResponse> {
  const query = version ? `?version=${encodeURIComponent(version)}` : ''
  const { data } = await fetchEnvelope<FunctionDependentsResponse>(
    `/functions/${id}/dependents${query}`,
  )
  return data
}


export async function getDependentsByVersion(
  id: string,
): Promise<Record<string, FunctionDependentsResponse>> {
  const { data } = await fetchEnvelope<Record<string, FunctionDependentsResponse>>(
    `/functions/${id}/dependents/by-version`,
  )
  return data
}


export async function deleteFunctionVersion(
  id: string,
  version: string,
): Promise<void> {
  const response = await fetch(apiUrl(`/functions/${id}/versions/${version}`), {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw await parseBackendError(response)
  }
}


export async function batchCreateFunctions(
  items: CreateFunctionPayload[],
): Promise<BatchCreateResult> {
  const { data } = await fetchEnvelope<BatchCreateResult>('/functions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  return data
}


export async function batchDeleteFunctions(
  ids: string[],
  options?: { cascade?: boolean },
): Promise<BatchDeleteResult> {
  const cascade = options?.cascade ?? false
  const { data } = await fetchEnvelope<BatchDeleteResult>('/functions/batch', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, cascade }),
  })
  return data
}


export async function publishLocalFunction(
  testId: string,
  nodeId: string,
  payload: PublishFunctionPayload,
  options?: { etag?: string },
): Promise<PublishFunctionResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options?.etag) headers['If-Match'] = options.etag
  const body = {
    node_id: nodeId,
    name: payload.name,
    description: payload.description,
    tags: payload.tags,
    changelog: payload.changelog ?? '',
    details: payload.details ?? '',
    version: payload.version ?? '1.0.0',
  }
  const { data } = await fetchEnvelope<PublishFunctionResult>(
    `/tests/${testId}/functions/publish`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  )
  return data
}


export async function detachPublishedInstance(
  testId: string,
  nodeId: string,
  options?: { etag?: string },
): Promise<DetachFunctionResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options?.etag) headers['If-Match'] = options.etag
  const { data } = await fetchEnvelope<DetachFunctionResult>(
    `/tests/${testId}/functions/detach`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ node_id: nodeId }),
    },
  )
  return data
}


// ---------------------------------------------------------------------------
// Versioning and edit-mode
// ---------------------------------------------------------------------------


export async function listFunctionVersions(
  functionId: string,
): Promise<ListVersionsResult> {
  const { data } = await fetchEnvelope<ListVersionsResult>(
    `/functions/${functionId}/versions`,
  )
  return data
}


export async function getFunctionVersion(
  functionId: string,
  version: string,
): Promise<GetVersionResult> {
  const { data, response } = await fetchEnvelope<{
    definition: FunctionDefinition
    etag?: string
  }>(`/functions/${functionId}/versions/${version}`)
  const etag = data.etag ?? (response.headers.get('ETag') as string)
  return { definition: data.definition, etag }
}


export async function validateBumps(
  functionId: string,
  payload: ValidateBumpsPayload,
): Promise<ComputedBumps> {
  const { data } = await fetchEnvelope<ComputedBumps>(
    `/functions/${functionId}/validate-bumps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_definition: payload.draftDefinition,
        source_version: payload.sourceVersion,
      }),
    },
  )
  return data
}


export async function addFunctionVersion(
  functionId: string,
  payload: AddFunctionVersionPayload,
): Promise<AddFunctionVersionResult> {
  const { data } = await fetchEnvelope<AddFunctionVersionResult>(
    `/functions/${functionId}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_version: payload.sourceVersion,
        target_version: payload.targetVersion,
        draft_definition: payload.draftDefinition,
        changelog: payload.changelog,
        description: payload.description ?? '',
        tags: payload.tags ?? [],
        details: payload.details ?? '',
      }),
    },
  )
  return data
}


/** Run session returned by the standalone Function run endpoint - the same
 *  shape the workbench run endpoint returns (session id + WS topic + warnings). */
export interface FunctionRunSession {
  session_id: string
  status: string
  websocket_topic: string
  warnings: { type?: string; message: string }[]
  execution_id?: string | null
  test_name?: string | null
}

export interface RunFunctionStandalonePayload {
  version?: string | null
  draft?: Record<string, unknown> | null
  environmentId: string
  sessionId?: string
  debug?: { breakpoints: string[]; options?: Record<string, boolean> } | null
  /** The Current values set before the run, as the run seed `/workbench/run` takes (FNCFG-8). */
  variables?: Record<string, unknown>
  /** The Current values of Function instances nested in the run, each under its path (REQ-3.2.1.6). */
  function_variables?: FunctionVariablesSeed[]
}

/** Run/debug a Published version (or an edit-mode draft) of a Function in the
 *  read-only library View, with no parent Test. */
export async function runFunctionStandalone(
  functionId: string,
  payload: RunFunctionStandalonePayload,
): Promise<FunctionRunSession> {
  const { data } = await fetchEnvelope<FunctionRunSession>(`/functions/${functionId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: payload.version ?? null,
      draft: payload.draft ?? null,
      environment_id: payload.environmentId,
      session_id: payload.sessionId,
      debug: payload.debug ?? null,
      variables: payload.variables,
      function_variables: payload.function_variables,
    }),
  })
  return data
}

/** Best-effort teardown of an ephemeral standalone-run session (library View). */
export async function sweepFunctionRun(sessionId: string): Promise<void> {
  await fetch(apiUrl(`/functions/view-session/${sessionId}`), { method: 'DELETE' })
}
