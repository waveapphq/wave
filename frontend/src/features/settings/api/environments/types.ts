/**
 * Environments API Types
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environments management
 *
 * Type definitions for environment API interactions.
 */

/**
 * Environment model for frontend components
 */
export interface Environment {
  id: string
  name: string
  description: string | null
  tags: string[]
  usage: number
  createdAt: string
  updatedAt: string
}

/**
 * Environment response from backend API (snake_case)
 */
export interface EnvironmentApiResponse {
  id: string
  name: string
  description?: string | null
  tags?: string[]
  usage: number
  created_at: string
  updated_at: string
}

/**
 * Pagination info from API
 */
export interface EnvironmentsApiPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
}

/**
 * Request to create a new environment
 */
export interface CreateEnvironmentRequest {
  name: string
  description?: string
  tags?: string[]
}

/**
 * Request to update an environment
 */
export interface UpdateEnvironmentRequest {
  name?: string
  description?: string | null
  tags?: string[]
}

/**
 * Result from list environments with transformed data
 */
export interface EnvironmentsListResult {
  data: Environment[]
  pagination: EnvironmentsApiPagination
}

/**
 * Lightweight environment data for dropdowns
 */
export interface EnvironmentName {
  id: string
  name: string
  tags: string[]
}

export interface EnvironmentExportOptions {
  format?: 'yaml' | 'json'
}
