import type { ExportSecretsMode } from '@/types/import-export'

export interface SuiteApiResponse {
  id: string
  name: string
  version: string
}

export interface SuitesApiResult {
  success: boolean
  data: SuiteApiResponse[]
}

export type SuiteStatus = 'passed' | 'failed' | 'never_run'

export interface SuiteListApiResponse {
  id: string
  name: string
  description: string | null
  version: string
  created_at: string
  updated_at: string
  tests_count: number
  status: SuiteStatus
  last_run: string | null
  tags: string[]
}

export interface SuitesListApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface SuitesListApiResult {
  success: boolean
  data: SuiteListApiResponse[]
  pagination: SuitesListApiPagination
}

/**
 * Suite type for Suites List page (matches suites-table.tsx Suite interface)
 */
export interface SuiteListItem {
  id: string
  name: string
  description?: string | null
  testsCount: number
  status: SuiteStatus
  lastRun: string | null
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Test info for run dialog
 */
export interface TestInfo {
  id: string
  name: string
}

/**
 * Lightweight suite name entry for dropdowns
 */
export interface SuiteName {
  id: string
  name: string
}

// ============================================================================
// Suite Detail Types
// ============================================================================

/**
 * Variable types - matches backend VALID_VAR_TYPES (derived from ReturnValueType enum)
 */
import type { VariableType } from '@/lib/variable-types'

export type SuiteVariableType = VariableType

/**
 * Suite variable definition
 */
export interface SuiteVariable {
  type: SuiteVariableType
  value: string
  secret: boolean
  computed?: boolean
  expression?: string
}

/**
 * Raw API response for a test within a suite (snake_case)
 */
export interface SuiteTestApiResponse {
  id: string
  name: string
  version: string
  created_at: string
  updated_at: string
  tags: string[]
  metadata: {
    status?: string
    last_run?: string
  }
}

/**
 * Test entry within a suite (camelCase, transformed from API)
 */
export interface SuiteTestEntry {
  id: string
  name: string
  status: string
  lastRun: string | null
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Full suite detail from API (snake_case)
 */
export interface SuiteDetailApiResponse {
  id: string
  name: string
  description: string | null
  version: string
  created_at: string
  updated_at: string
  tests: string[]
  tests_count: number
  status: SuiteStatus
  last_run: string | null
  tags: string[]
  variables: Record<string, SuiteVariable>
  metadata: Record<string, unknown>
}

/**
 * Suite detail for frontend (camelCase)
 */
export interface SuiteDetail {
  id: string
  name: string
  description: string | null
  version: string
  createdAt: string
  updatedAt: string
  testIds: string[]
  testsCount: number
  status: SuiteStatus
  lastRun: string | null
  tags: string[]
  variables: Record<string, SuiteVariable>
}

/**
 * Payload for creating a new suite
 */
export interface CreateSuitePayload {
  name: string
  description?: string
  tags?: string[]
}

/**
 * Payload for updating an existing suite
 */
export interface UpdateSuitePayload {
  name?: string
  description?: string
  tags?: string[]
  tests?: string[]
  variables?: Record<string, SuiteVariable>
}

/**
 * Options for suite export API calls
 */
export interface SuiteExportOptions {
  format?: 'yaml' | 'json'
  secrets?: ExportSecretsMode
}
