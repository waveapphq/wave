/**
 * Regression API Types
 *
 * Consolidated type definitions for all regression API operations.
 * Follows the same pattern as suites/api/types.ts.
 */

import type { ExportSecretsMode } from '@/types/import-export'
import type { VariableType } from '@/lib/variable-types'

// ============================================================================
// List-level Types
// ============================================================================

export type RegressionStatus = 'passed' | 'failed' | 'running' | 'stopped' | 'never_run'

export interface RegressionApiResponse {
  id: string
  name: string
  version: string
  description: string | null
  created_at: string
  updated_at: string
  suites_count: number
  tests_count: number
  status: RegressionStatus
  last_run: string | null
  tags: string[]
}

export interface RegressionsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface RegressionsApiResult {
  success: boolean
  data: RegressionApiResponse[]
  pagination: RegressionsApiPagination
}

export interface RegressionApiResult {
  success: boolean
  data: RegressionApiResponse
}

/**
 * Regression type for component use (camelCase properties)
 */
export interface Regression {
  id: string
  name: string
  version: string
  description: string | null
  suitesCount: number
  testsCount: number
  status: RegressionStatus
  lastRun: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Result from fetchRegressions after transformation
 */
export interface FetchRegressionsResult {
  success: boolean
  data: Regression[]
  pagination: RegressionsApiPagination
}

/**
 * Test info for run dialog
 */
export interface TestInfo {
  id: string
  name: string
}

/**
 * Suite with tests for run dialog
 */
export interface SuiteWithTests {
  id: string
  name: string
  tests: TestInfo[]
}

// ============================================================================
// Detail-level Types
// ============================================================================

/**
 * Regression variable definition
 */
export type RegressionVariableType = VariableType

export interface RegressionVariable {
  type: RegressionVariableType
  value: string
  secret: boolean
}

/**
 * Raw API response for regression detail (snake_case)
 */
export interface RegressionDetailApiResponse {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  suites: string[]
  suites_count: number
  tests_count: number
  status: string
  last_run: string | null
  tags: string[]
  variables: Record<string, RegressionVariable>
}

/**
 * Regression detail for frontend (camelCase)
 */
export interface RegressionDetail {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  suiteIds: string[]
  suitesCount: number
  testsCount: number
  status: string
  lastRun: string | null
  tags: string[]
  variables: Record<string, RegressionVariable>
}

/**
 * Raw API response for a suite within a regression (snake_case)
 */
export interface RegressionSuiteApiResponse {
  id: string
  name: string
  description: string | null
  status: string
  last_run: string | null
  tags: string[]
  tests_count: number
  avg_duration: number | null
  created_at: string
  updated_at: string
}

/**
 * Suite entry within a regression (camelCase, transformed from API)
 */
export interface RegressionSuiteEntry {
  id: string
  name: string
  description: string | null
  status: string
  lastRun: string | null
  tags: string[]
  testsCount: number
  avgDuration: number | null
  createdAt: string
  updatedAt: string
}

/**
 * Payload for updating an existing regression
 */
export interface UpdateRegressionPayload {
  name?: string
  description?: string
  tags?: string[]
  suites?: string[]
  variables?: Record<string, RegressionVariable>
}

/**
 * Options for regression export API calls
 */
export interface RegressionExportOptions {
  format?: 'yaml' | 'json'
  secrets?: ExportSecretsMode
}
