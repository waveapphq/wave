/**
 * Profiles API Types
 *
 * REQ-4.7.4: Profile management UI
 *
 * Type definitions for profile API responses, requests, and frontend models.
 */

import type { ExportSecretsMode } from '@/types/import-export'

export interface ProfileApiResponse {
  id: string
  name: string
  type: string
  description: string | null
  tags: string[]
  usage: number
  config: Record<string, unknown>
  environment_values: Record<string, Record<string, unknown>>
  environments_count: number
  total_environments: number
  has_incomplete_environments: boolean
  created_at: string
  updated_at: string
}

export interface ProfilesPagination {
  total: number
  page: number
  per_page: number
  total_pages: number
  sort_by?: string | null
  sort_order?: string | null
}

/**
 * WAVE type system types for profile schema fields.
 * Maps to backend types and aligns with the design decisions (PROFILE-37).
 * Note: 'null' is excluded as it doesn't apply to profile parameters.
 */
export type WaveSchemaType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

export interface ProfileTypeSchemaField {
  name: string
  type: WaveSchemaType
  required: boolean
  secret: boolean
  /** The field's declared starting value, absent when it declares none; a map arrives as an object. */
  default?: string | number | boolean | Record<string, unknown>
  /** Declared numeric bounds of the field's value. */
  minimum?: number
  maximum?: number
  /** A URL, host or certificate: plain text only, so its value editor offers no format. */
  plain?: boolean
}

export interface ProfileTypeSchema {
  type: string
  fields: ProfileTypeSchemaField[]
}

export interface CreateProfileRequest {
  name: string
  type: string
  description?: string
  tags?: string[]
  config?: Record<string, unknown>
  environment_values?: Record<string, Record<string, unknown>>
}

export interface UpdateProfileRequest {
  name?: string
  type?: string
  description?: string
  tags?: string[]
  config?: Record<string, unknown>
  environment_values?: Record<string, Record<string, unknown>>
}

/**
 * Frontend profile model
 */
export interface Profile {
  id: string
  name: string
  type: string
  description: string | null
  tags: string[]
  usage: number
  config: Record<string, unknown>
  environmentValues: Record<string, Record<string, unknown>>
  environmentsCount: number
  totalEnvironments: number
  hasIncompleteEnvironments: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Environment model for dropdowns
 */
export interface Environment {
  id: string
  name: string
  description: string | null
  tags: string[]
  usage: number
}

export interface ProfileExportOptions {
  format?: 'yaml' | 'json'
  secrets?: ExportSecretsMode
}
