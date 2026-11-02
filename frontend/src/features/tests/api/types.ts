/**
 * Tests API Types
 *
 * Shared type definitions for the tests API module.
 */

import type { ExportSecretsMode } from '@/types/import-export'

// Domain types (used by both API and components)
export type TestStatus = 'passed' | 'failed' | 'running' | 'stopped' | 'never_run'

export interface Test {
  id: string
  name: string
  suiteCount: number
  suiteIds: string[]
  suiteNames: string[]
  status: TestStatus
  lastRun: string | null
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
}

export interface Suite {
  id: string
  name: string
}

// API wire types
export interface TestApiResponse {
  id: string
  name: string
  version: string
  created_at: string
  updated_at: string
  description?: string
  tags?: string[]
  suite_count?: number
  suite_ids?: string[]
  suite_names?: string[]
  metadata: {
    status?: string
    last_run?: string
    tags?: string[]
  }
}

export interface TestsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface TestsApiResult {
  success: boolean
  data: TestApiResponse[]
  pagination: TestsApiPagination
}

// ===========================================================================
// Test Create/Update Types
// ===========================================================================

export interface WorkflowBlock {
  id: string
  type: 'plugin' | 'control' | 'block'
  name: string
  category: string
  config: Record<string, unknown>
  position: { x: number; y: number }
  connections: {
    incoming: string[]
    outgoing: string[]
  }
  branches?: Record<string, string>
}

export interface WorkflowPayload {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, unknown>
    width?: number
    height?: number
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

export interface CreateTestPayload {
  name: string
  description?: string
  tags?: string[]
  workflow?: WorkflowPayload
  workflow_blocks?: WorkflowBlock[]
  /** Variables for the test, keyed by name - test-local only */
  variables?: Record<string, { value?: unknown; type: string; isExpression?: boolean }>
}

export interface UpdateTestPayload {
  name?: string
  description?: string
  tags?: string[]
  workflow?: WorkflowPayload
  workflow_blocks?: WorkflowBlock[]
  /** Variables for the test, keyed by name - test-local only */
  variables?: Record<string, { value?: unknown; type: string; isExpression?: boolean }>
}

export interface UpdateTestMetadataPayload {
  name: string
  description?: string
  tags?: string[]
}

// ===========================================================================
// Test Detail Types
// ===========================================================================

export interface TestDetailApiResponse {
  id: string
  name: string
  version: string
  created_at: string
  updated_at: string
  description?: string
  tags?: string[]
  suite_ids?: string[]
  suite_names?: string[]
  /** Merged variable metadata from all suites containing this test (name + type) */
  suite_variables?: Array<{ name: string; type: string }>
  /** Merged variable metadata from all regressions containing this test's suites */
  regression_variables?: Array<{ name: string; type: string }>
  metadata: {
    status?: string
    last_run?: string
    tags?: string[]
  }
  /** Test variables keyed by name; `value` is absent for a declaration holding null */
  variables?: Record<string, { value?: unknown; type: string; isExpression?: boolean }>
}

export interface TestWorkflowApiResponse {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, unknown>
    width?: number
    height?: number
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

// ===========================================================================
// Validation Types
// ===========================================================================

export interface TestValidationError {
  path: string
  node_id?: string
  node_label?: string
  element_type?: string
  code: string
  message: string
  severity?: 'error' | 'warning'
  fix_action?: string | null
}

export interface TestValidationResult {
  fatal: boolean
  errors: TestValidationError[]
  warnings: TestValidationError[]
}

/** A workflow and its variables not saved yet; variables left out are the stored ones. */
export interface UnsavedTestBody {
  workflow: { nodes: unknown[]; edges: unknown[] }
  variables?: Record<string, unknown>
}

export interface FixTestWarning {
  path: string
  node_id?: string
  node_label?: string
  element_type?: string
  code: string
  message: string
  severity?: 'error' | 'warning'
  fix_action?: string | null
}

export interface FixTestResponse extends TestDetailApiResponse {
  /** The fix response includes the full workflow (nodes + edges) */
  workflow?: TestWorkflowApiResponse
}

export interface FixTestResult {
  test: FixTestResponse
  warnings: FixTestWarning[]
}

// ===========================================================================
// Export/Import Types
// ===========================================================================

export interface ExportOptions {
  format?: 'yaml' | 'json'
  secrets?: ExportSecretsMode
  /** Download-name stem of a single-test export when the server sends no filename. */
  name?: string
}

export interface ValidationTestResult {
  name: string
  status: 'ok' | 'conflict' | 'fixable' | 'fatal'
  fatal_errors: Array<{ code: string; message: string }>
  fixable_errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  existing_test_id: string | null
}

export interface ValidateImportResult {
  tests: ValidationTestResult[]
  total: number
  importable: number
  blocked: number
}

export interface ImportedTest {
  name: string
  id: string
  action: 'created' | 'renamed' | 'overwritten'
}

export interface ImportResult {
  imported: ImportedTest[]
  skipped: Array<{ name: string; reason: string }>
  fixes_applied: Array<{ name: string; fixes: string[] }>
  total_imported: number
  total_skipped: number
}

// ===========================================================================
// Test Data Types (REQ-3.4.3.2)
// ===========================================================================

/** One entry of a test's data folder; the path is relative to that folder. */
export interface TestDataEntry {
  path: string
  kind: 'file' | 'dir'
  size_bytes: number
  modified_at: string
}

export interface TestDataListing {
  entries: TestDataEntry[]
  total_files: number
  total_bytes: number
}

export interface TestDataUploadItem {
  path: string
  size_bytes: number
  replaced: boolean
}

/** One file on its way into a test's data, as every session watching sees it. */
export interface TestDataUploadRow {
  id: string
  folder: string
  name: string
  path: string
  total_bytes: number
  loaded_bytes: number
  /** Seconds left at the rate so far, worked out by the server; null when it cannot be. */
  eta_seconds: number | null
  started_at: number
  /** The session that started it; only it and the holder may cancel it. */
  session: string
}

/** One file that did not land, kept with the test until it is dismissed. */
export interface TestDataInterruptionRow {
  id: string
  folder: string
  name: string
  path: string
  reason: string
  replace: boolean
  at: number
}

export interface TestDataUploadState {
  uploads: TestDataUploadRow[]
  interruptions: TestDataInterruptionRow[]
}
