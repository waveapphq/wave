/**
 * System Info API Client
 *
 * REQ-5.2.1.42: Settings and preferences screen - About section
 * SETTINGS-16: About: version, build, support links
 *
 * Fetches system info from the backend API and transforms it
 * for frontend components.
 */

import { apiClient } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

/**
 * Support links in frontend model (camelCase)
 */
export interface SupportInfo {
  documentationUrl: string | null
  issuesUrl: string | null
  contactEmail: string | null
}

/**
 * Runtime info in frontend model (camelCase)
 */
export interface RuntimeInfo {
  pythonVersion: string | null
  os: string | null
  osVersion: string | null
}

/**
 * System info model for frontend components
 */
export interface SystemInfo {
  version: string
  build: string
  buildDate: string | null
  support: SupportInfo
  runtime: RuntimeInfo
}

/**
 * Support links from API response (snake_case)
 */
interface SupportApiResponse {
  documentation_url?: string
  issues_url?: string
  contact_email?: string
}

/**
 * Runtime info from API response (snake_case)
 */
interface RuntimeApiResponse {
  python_version?: string
  os?: string
  os_version?: string
}

/**
 * System info response from backend API (snake_case)
 */
export interface SystemInfoApiResponse {
  version: string
  build: string
  build_date?: string | null
  support?: SupportApiResponse
  runtime?: RuntimeApiResponse
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform API system info response to frontend model
 */
export function transformSystemInfoResponse(apiResponse: SystemInfoApiResponse): SystemInfo {
  return {
    version: apiResponse.version,
    build: apiResponse.build,
    buildDate: apiResponse.build_date ?? null,
    support: {
      documentationUrl: apiResponse.support?.documentation_url ?? null,
      issuesUrl: apiResponse.support?.issues_url ?? null,
      contactEmail: apiResponse.support?.contact_email ?? null,
    },
    runtime: {
      pythonVersion: apiResponse.runtime?.python_version ?? null,
      os: apiResponse.runtime?.os ?? null,
      osVersion: apiResponse.runtime?.os_version ?? null,
    },
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch system info
 */
export async function fetchSystemInfo(): Promise<SystemInfo> {
  const response = await apiClient.get<SystemInfoApiResponse>('/api/v1/system/info')
  return transformSystemInfoResponse(response.data)
}
