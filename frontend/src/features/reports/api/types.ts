/**
 * Reports Feature Types
 *
 * REQ-5.2.4.13: Reporting endpoints (execution-centric listing + job views)
 * REQ-3.7.2.8: Report viewer log filtering (JSON report schema v1)
 */

export type ReportFormat = 'json' | 'html'

export type ReportJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ReportJobProgress {
  runs_processed: number
  runs_total: number
}

/** Job view returned by POST/GET /executions/{id}/report. */
export interface ReportJobView {
  execution_id: string
  format: ReportFormat
  status: ReportJobStatus
  progress: ReportJobProgress
  artifact_id: string | null
  error: string | null
  started_at: string | null
  ended_at: string | null
}

/** Latest report artifact metadata for one format in a listing row. */
export interface ReportFormatMeta {
  artifact_id: string
  version: number
  size_bytes: number
  generated_at: string
}

/** Trimmed execution summary carried by a reports listing row. */
export interface ReportListExecution {
  id: string
  name: string
  entity_type: 'test' | 'suite' | 'regression'
  entity_id: string
  status: string
  triggered_by: string
  started_at: string
  ended_at: string | null
  duration: number | null
}

/** One row of GET /reports: execution summary + per-format report slots. */
export interface ReportListRow {
  execution: ReportListExecution
  reports: {
    json: ReportFormatMeta | null
    html: ReportFormatMeta | null
  }
}

export interface ReportsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface FetchReportsParams {
  page?: number
  per_page?: number
  search?: string
  status?: string[]
  type?: string[]
  triggered_by?: string[]
  from_date?: string
  to_date?: string
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

// ---------------------------------------------------------------------------
// JSON report schema v1 (the artifact the viewer renders)
// ---------------------------------------------------------------------------

export interface ReportExecutionInfo {
  id: string
  name: string
  entity_type: 'test' | 'suite' | 'regression'
  entity_id: string
  environment: string | null
  triggered_by: string
  status: string
  started_at: string
  ended_at: string | null
  duration: number | null
  profile_id?: string
  entity_version?: string
}

export interface ReportCounts {
  total: number
  passed: number
  failed: number
  skipped: number
  stopped: number
  excluded: number
  pending: number
}

export interface ReportSummary {
  status: string
  duration: number | null
  counts: ReportCounts
}

/** One dispatched test run in a suite/regression report timeline. */
export interface ReportTimelineRun {
  order: number
  run_id: string
  test_id: string | null
  test_name: string
  suite_id: string | null
  suite_name: string
  status: string
  started_at: string | null
  ended_at: string | null
  duration: number | null
  variables: Record<string, unknown>
}

/** One canvas block in a test report timeline. */
export interface ReportTimelineBlock {
  order: number
  block_id: string
  block_path: string
  status: string
  started_at: string | null
  ended_at: string | null
  duration: number | null
}

export interface ReportError {
  run_id: string | null
  test_id: string | null
  test_name: string | null
  suite_name: string | null
  block_path: string | null
  level: 'ERROR' | 'FATAL'
  message: string
  timestamp: string
}

/** One entry of the report's merged log stream (raw; the adapter normalizes). */
export interface ReportLogRecord {
  id?: string
  timestamp?: string
  level?: string
  message?: string
  source?: string
  blockId?: string | null
  variant?: 'success' | 'error' | 'warning' | 'paused' | 'suite-banner' | 'regression-banner'
}

export interface WaveReport {
  schema_version: number
  generated_at: string
  execution: ReportExecutionInfo
  summary: ReportSummary
  timeline: {
    runs: ReportTimelineRun[]
    blocks: ReportTimelineBlock[]
  }
  errors: ReportError[]
  logs: ReportLogRecord[]
}
