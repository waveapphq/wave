/**
 * Shared Console types.
 *
 * Canonical definitions for log entries and display settings used by both the
 * Workbench console (log-store-backed) and the Execution Detail console
 * (SSE-backed).
 */

import type { LogLevel } from '@/lib/log-levels'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  blockId?: string
  // Ephemeral workbench sessions assign a per-session ``sequence``; tracked
  // executions assign a per-test ``seq`` with the owning ``run_id``. Dedup
  // keys off ``id`` (UUID, always present) so both shapes round-trip
  // through the same store without collisions.
  sequence?: number
  seq?: number
  run_id?: string
  variant?: 'success' | 'error' | 'warning' | 'paused' | 'suite-banner' | 'regression-banner'
}

export interface DisplaySettings {
  showTimestamps: boolean
  showLevel: boolean
  showSource: boolean
  sourceWidth: number
  showSystemLogs: boolean
  fontSize: number
}
