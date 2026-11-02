/**
 * Canonical log severity type and list, ordered least to most severe.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

// Keyed by the level type: a level added to that type fails to compile until it is listed here.
const LEVEL_KEYS: Record<LogLevel, true> = {
  DEBUG: true,
  INFO: true,
  WARN: true,
  ERROR: true,
  FATAL: true,
}

// Object.keys preserves declaration order, so the list stays least to most severe.
// Frozen once at load: shared across every consumer, so it must not be writable.
export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(Object.keys(LEVEL_KEYS) as LogLevel[])
