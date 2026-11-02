/**
 * Artifact browser API client (REQ-5.2.1.41).
 *
 * Execution-first landing summaries, per-execution artifact listing (with the
 * include-removed tombstone toggle), and soft-delete of a single artifact or a
 * whole execution's artifacts.
 */

import type {
  ArtifactMeta,
  ArtifactsApiPagination,
  ExecutionArtifactSummary,
  FetchExecutionSummariesParams,
} from './types'
import { apiClient, getApiBaseUrl } from '@/lib/api'

const DRILL_PAGE_SIZE = 100

export interface ExecutionSummariesResult {
  data: ExecutionArtifactSummary[]
  pagination: ArtifactsApiPagination
}

/** Landing list: one row per execution that has live artifacts. */
export async function fetchExecutionArtifactSummaries(
  params?: FetchExecutionSummariesParams,
): Promise<ExecutionSummariesResult> {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', params.page.toString())
  if (params?.per_page) query.set('per_page', params.per_page.toString())
  if (params?.search) query.set('search', params.search)
  if (params?.type && params.type.length > 0) query.set('type', params.type.join(','))
  if (params?.status && params.status.length > 0) query.set('status', params.status.join(','))

  const suffix = query.toString()
  const path = suffix ? `/artifacts/executions?${suffix}` : '/artifacts/executions'
  const response = await apiClient.get<ExecutionArtifactSummary[], ArtifactsApiPagination>(path)
  return { data: response.data, pagination: response.pagination! }
}

/** All artifacts of one execution; include_removed surfaces tombstones. */
export async function fetchExecutionArtifacts(
  executionId: string,
  includeRemoved = false,
): Promise<ArtifactMeta[]> {
  const query = new URLSearchParams({
    execution_id: executionId,
    per_page: DRILL_PAGE_SIZE.toString(),
  })
  if (includeRemoved) {
    query.set('include_removed', 'true')
  }
  const response = await apiClient.get<ArtifactMeta[]>(`/artifacts?${query.toString()}`)
  return response.data
}

export interface DrillExecutionMeta {
  name: string
  entityType?: string
  status: string
  finishedAt?: string | null
}

interface ExecutionMetaResponse {
  name: string
  entity_type?: string
  type?: string
  status: string
  ended_at?: string | null
  completed_at?: string | null
}

/**
 * Execution metadata for the drill header (name / type / status). The drill is
 * keyed by execution, so it owns this read of the executions endpoint directly
 * rather than reaching into the executions feature.
 */
export async function fetchDrillExecution(executionId: string): Promise<DrillExecutionMeta> {
  const response = await apiClient.get<ExecutionMetaResponse>(`/executions/${executionId}`)
  const data = response.data
  return {
    name: data.name,
    entityType: data.entity_type ?? data.type,
    status: data.status,
    finishedAt: data.ended_at ?? data.completed_at,
  }
}

/**
 * Fetch and parse a JSON artifact's raw content (e.g. the causal error.json
 * that drives the Logs-tree failure tint). The content endpoint streams the
 * file as-is, so this bypasses the API envelope and parses the body directly.
 */
export async function fetchArtifactJson<T>(artifactId: string): Promise<T> {
  const response = await fetch(
    `${getApiBaseUrl()}/artifacts/content/${artifactId}?disposition=inline`,
  )
  if (!response.ok) {
    throw new Error(`Failed to load artifact ${artifactId}: ${response.status}`)
  }
  return (await response.json()) as T
}

/** Soft-delete a single artifact file. */
export async function deleteArtifact(artifactId: string): Promise<void> {
  await apiClient.delete(`/artifacts/${artifactId}`)
}

/** Soft-delete every live artifact of an execution. */
export async function deleteExecutionArtifacts(executionId: string): Promise<void> {
  await apiClient.delete(`/artifacts/executions/${executionId}`)
}
