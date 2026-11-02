/**
 * WebSocket Event Types - REQ-5.2.1.4
 *
 * Event payload types for the various WebSocket message categories:
 * execution, system, debug, variable, and error events.
 */

// ============================================================================
// Event Types
// ============================================================================

/**
 * Base event type with common fields
 */
export interface BaseEvent {
  topic: string
  payload: unknown
}

/**
 * Execution event payload
 */
export interface ExecutionEvent {
  executionId: string
  status: string
  blockId?: string
  startTime?: string
  endTime?: string
  progress?: number
  result?: unknown
}

/**
 * System event payload
 */
export interface SystemEvent {
  eventType: string
  message: string
  affectedKeys?: string[]
}

/**
 * Debug event payload
 */
export interface DebugEvent {
  action: string
  executionId?: string
  blockId?: string
  lineNumber?: number
  variables?: Record<string, unknown>
}

/**
 * Variable event payload
 */
export interface VariableEvent {
  executionId?: string
  variableName: string
  value: unknown
  previousValue?: unknown
  blockId?: string
}

/**
 * Error event payload
 */
export interface ErrorEvent {
  errorCode: string
  message: string
  executionId?: string
  blockId?: string
  details?: Record<string, unknown>
}

/**
 * WebSocket event union type (discriminated union)
 */
export type WebSocketEvent =
  | { type: 'execution'; payload: ExecutionEvent }
  | { type: 'system'; payload: SystemEvent }
  | { type: 'debug'; payload: DebugEvent }
  | { type: 'variable'; payload: VariableEvent }
  | { type: 'error'; payload: ErrorEvent }
