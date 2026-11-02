/**
 * Artifact browser feature types (REQ-5.2.1.41, REQ-3.7.1.x).
 *
 * Snake_case fields mirror the backend artifact API verbatim (no client-side
 * renaming). Artifacts are unversioned; a soft-deleted artifact carries the
 * tombstone audit fields removed_at / removed_by.
 */

export interface ArtifactMeta {
  id: string
  execution_id: string
  name: string
  path: string
  size_bytes: number
  content_type: string
  compression: string | null
  created_at: string
  removed_at?: string | null
  removed_by?: string | null
}

/** One landing-list row: an execution that has live artifacts. */
export interface ExecutionArtifactSummary {
  execution_id: string
  name: string | null
  entity_type: string | null
  status: string | null
  finished_at: string | null
  artifact_count: number
  total_size_bytes: number
}

export interface ArtifactsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
  /** Filter-aware grand total size across every matching execution (all pages). */
  total_size_bytes: number
}

export interface FetchExecutionSummariesParams {
  page?: number
  per_page?: number
  search?: string
  type?: string[]
  status?: string[]
}
