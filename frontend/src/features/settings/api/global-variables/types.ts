/**
 * System Variables - Type Definitions
 *
 * Uses shared VariableRecord for variable entries.
 * System-specific additions: masked flag, API response shape.
 */

import type { VariableType, VariableRecord } from '@/lib/variable-types'

export type SystemVariableType = VariableType

export interface SystemVariableEntry extends VariableRecord {
  masked?: boolean
  description?: string
}

export type SystemVariablesMap = Record<string, SystemVariableEntry>

export interface SystemVariablesApiResponse {
  success: boolean
  data: {
    variables: SystemVariablesMap
  }
  meta: {
    request_id: string
    timestamp: string
  }
}
