/**
 * useLogSubscription Hook - REQ-5.2.1.4
 *
 * Manages WebSocket subscription to log events, handling real-time
 * log streaming with level filtering.
 * - Topic pattern: `log:{session_id}`
 * - Subscribe with level parameter for server-side filtering
 * - Handle level switch protocol
 * - Request historical logs on level change
 */

import { useEffect, useRef, useCallback } from 'react'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import { useLogStore } from '@/features/workbench/stores/log-store'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'
import { toFailureDetail } from '@/lib/failure-detail'
import { randomUUID } from '@/lib/uuid'
import type { LogEntry } from '@/types/console'
import type { Subscription } from '@/services/websocket-client'

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 100

// Not 'SYSTEM': a display preference hides those rows, and this one must show.
const CONSOLE_SOURCE = 'CONSOLE'

/** Opaque paging marker the server echoes back; absent when there is no more history. */
type LogCursor = string | number | null

// Built once so the per-frame check is a set lookup, not a scan.
const KNOWN_LEVELS = new Set<string>(LOG_LEVELS)

// ============================================================================
// Frame validation
// ============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLogEntry = (value: unknown): value is LogEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id !== '' &&
  typeof value.timestamp === 'string' &&
  typeof value.message === 'string' &&
  typeof value.source === 'string' &&
  typeof value.level === 'string' &&
  KNOWN_LEVELS.has(value.level)

// A frame the console cannot read leaves a trace for developers, not a row for the user.
const reportUnreadable = (what: string, payload: unknown): void => {
  console.warn(`useLogSubscription dropped ${what}`, payload)
}

const readCursor = (value: unknown): LogCursor =>
  typeof value === 'string' || typeof value === 'number' ? value : null

const readableEntries = (values: readonly unknown[]): LogEntry[] => {
  const readable = values.filter(isLogEntry)
  if (readable.length !== values.length) {
    reportUnreadable(`${values.length - readable.length} of ${values.length} log entries`, values)
  }
  return readable
}

// ============================================================================
// Hook
// ============================================================================

export function useLogSubscription(
  sessionId: string | null,
  level: LogLevel
): { requestMore: (cursor: LogCursor) => void } {
  const subscriptionRef = useRef<Subscription | null>(null)
  const previousLevelRef = useRef<LogLevel>(level)
  const hasMountedRef = useRef(false)

  const { isConnected, subscribe, connect } = useWebSocketStore()
  const addEntry = useLogStore((state) => state.addEntry)
  const addEntries = useLogStore((state) => state.addEntries)
  // clearLogs removed - we no longer clear on level change, filtering is client-side
  const prependHistoricalEntries = useLogStore((state) => state.prependHistoricalEntries)
  const setPaginationLoading = useLogStore((state) => state.setPaginationLoading)
  const setPaginationHasMore = useLogStore((state) => state.setPaginationHasMore)
  const setPaginationCursor = useLogStore((state) => state.setPaginationCursor)
  const pagination = useLogStore((state) => state.pagination)

  // Handle incoming WebSocket events
  // Note: websocket-client passes payload directly to handlers, not the full envelope
  const handleEvent = useCallback(
    (payload: unknown) => {
      // Check if it's a batch (array of entries)
      if (Array.isArray(payload)) {
        addEntries(readableEntries(payload))
        return
      }

      // Check if it's a history response (has entries array)
      if (isRecord(payload) && Array.isArray(payload.entries)) {
        // A page-back the console asked for is strictly older than what it
        // holds, so it prepends. The unsolicited page a subscribe delivers can
        // overlap lines that already arrived live, so it merges in log order.
        const entries = readableEntries(payload.entries)
        if (pagination?.isLoading) {
          prependHistoricalEntries(entries)
        } else {
          addEntries(entries)
        }
        // The page answers a request the console is waiting on, so its
        // pagination state is released even when its rows are not readable.
        setPaginationHasMore(payload.hasMore === true)
        setPaginationCursor(readCursor(payload.cursor))
        setPaginationLoading(false)
        return
      }

      // Single log entry
      if (isLogEntry(payload)) {
        addEntry(payload)
        return
      }

      reportUnreadable('a log frame', payload)
    },
    [
      addEntry,
      addEntries,
      prependHistoricalEntries,
      pagination?.isLoading,
      setPaginationHasMore,
      setPaginationCursor,
      setPaginationLoading,
    ]
  )

  // Request more historical logs
  const requestMore = useCallback(
    (cursor: LogCursor) => {
      // Don't request if already loading
      // Use optional chaining for defensive coding against undefined state
      if (pagination?.isLoading) {
        return
      }
      // No session yet - nothing to page. Avoid flipping the loading flag
      // on (it would get stuck until the next subscribe tick).
      if (!sessionId) return

      setPaginationLoading(true)

      // Send request through subscription. The backend router selects
      // the log: handler via the explicit `topic` field, so the message
      // MUST include it - without it the router silently drops the
      // request and the console gets stuck on "Loading…".
      if (subscriptionRef.current?.send) {
        subscriptionRef.current.send({
          type: 'request_history',
          topic: `log:${sessionId}`,
          cursor,
          pageSize: PAGE_SIZE,
        })
      } else {
        // No send channel (e.g. subscription hasn't wired yet). Release
        // the loading flag so the UI doesn't spin forever.
        setPaginationLoading(false)
      }
    },
    [pagination?.isLoading, setPaginationLoading, sessionId]
  )

  // Subscribe to log topic
  useEffect(() => {
    if (!sessionId) {
      return
    }

    // The console stays empty when the socket never lands, so the reason goes
    // where the emptiness is.
    const reportNotConnected = (error: unknown): void => {
      addEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        source: CONSOLE_SOURCE,
        message: `Console not connected - this run's log will not appear: ${toFailureDetail(error).message}`,
      })
    }

    // Ensure connection
    if (!isConnected) {
      connect().catch(reportNotConnected)
    }

    const topic = `log:${sessionId}`

    // Note: We don't clear logs on level change anymore since we filter client-side
    // The log store's getFilteredEntries() handles level filtering
    previousLevelRef.current = level
    hasMountedRef.current = true

    // Cleanup previous subscription
    // Note: In normal React flow, the useEffect cleanup (lines 137-142) runs before the effect
    // re-executes, setting subscriptionRef.current to null. This cleanup is defensive code for
    // potential React concurrent mode edge cases where cleanup might not run before re-execution.
    /* v8 ignore next 4 - COV-REACT-005 */
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }

    // Subscribe with level parameter
    try {
      const subscription = subscribe(topic, handleEvent, { level })
      subscriptionRef.current = subscription
    } catch (error) {
      console.error('Failed to subscribe to log topic:', error)
      reportNotConnected(error)
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [sessionId, level, isConnected, connect, subscribe, handleEvent, addEntry])

  return { requestMore }
}
