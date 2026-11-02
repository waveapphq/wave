/**
 * Variable Updates Hook
 *
 * Processes real-time variable change events forwarded from useWorkbenchRun.
 * No own WebSocket connection - events arrive via registerVariableHandler.
 * Every variable_changed event lands in the runtime values map: the
 * redesigned panel monitors all variables, not a curated watch subset.
 *
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { useEffect, useRef, useState, useCallback } from 'react'

import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'

// ===========================================================================
// Types
// ===========================================================================

export interface VariableUpdate {
  /** The variable's key in its scope: the bare name at the root canvas (REQ-3.1.3.12). */
  path: string
  value: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  timestamp: number
}

interface VariableChangeMessage {
  type: 'variable_changed'
  /** Variable name/path */
  path: string
  value: unknown
  var_type: string
  /** Node ids of the Function instance that holds the variable; empty or absent at the root canvas. */
  function_path?: string[]
}

export interface UseVariableUpdatesOptions {
  /** Execution session ID - used to clear state on session change */
  sessionId: string | null
  /** Register handler with useWorkbenchRun to receive variable events */
  registerVariableHandler: (handler: ((payload: unknown) => void) | null) => void
  /** Callback when variable value changes */
  onVariableChange?: (update: VariableUpdate) => void
}

export interface UseVariableUpdatesReturn {
  /** Current variable values keyed by scope (`scopedVariableKey`): a root value by its bare name. */
  values: Map<string, unknown>
  /** Paths of variables that recently changed (for highlight animation) */
  recentlyChangedPaths: Set<string>
  /** Drop a variable's value: its source was re-armed, so it holds none until a run evaluates it. */
  forget: (path: string) => void
}

// ===========================================================================
// Constants
// ===========================================================================

const RECENTLY_CHANGED_DURATION_MS = 300

// ===========================================================================
// Hook
// ===========================================================================

export function useVariableUpdates(
  options: UseVariableUpdatesOptions
): UseVariableUpdatesReturn {
  const {
    sessionId,
    registerVariableHandler,
    onVariableChange,
  } = options

  const [values, setValues] = useState<Map<string, unknown>>(new Map())
  const [recentlyChangedPaths, setRecentlyChangedPaths] = useState<Set<string>>(new Set())

  const recentlyChangedTimeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const onVariableChangeRef = useRef(onVariableChange)
  onVariableChangeRef.current = onVariableChange

  const markRecentlyChanged = useCallback((path: string) => {
    setRecentlyChangedPaths((prev) => {
      const next = new Set(prev)
      next.add(path)
      return next
    })

    const existingTimeout = recentlyChangedTimeoutRefs.current.get(path)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(() => {
      setRecentlyChangedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      recentlyChangedTimeoutRefs.current.delete(path)
    }, RECENTLY_CHANGED_DURATION_MS)

    recentlyChangedTimeoutRefs.current.set(path, timeout)
  }, [])

  const handleVariableEvent = useCallback(
    (payload: unknown) => {
      const data = payload as Record<string, unknown>

      if (data.type === 'variable_changed') {
        const msg = data as unknown as VariableChangeMessage
        const key = scopedVariableKey(msg.path, msg.function_path)

        setValues((prev) => {
          const next = new Map(prev)
          next.set(key, msg.value)
          return next
        })

        markRecentlyChanged(key)

        const update: VariableUpdate = {
          path: key,
          value: msg.value,
          type: msg.var_type as VariableUpdate['type'],
          timestamp: Date.now(),
        }
        onVariableChangeRef.current?.(update)
      }
    },
    [markRecentlyChanged],
  )

  const forget = useCallback((path: string) => {
    setValues((prev) => {
      if (!prev.has(path)) return prev
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [])

  useEffect(() => {
    registerVariableHandler(handleVariableEvent)
    return () => {
      registerVariableHandler(null)
    }
  }, [registerVariableHandler, handleVariableEvent])

  // Clear runtime values only on Reset (sessionId -> null). Successive
  // session transitions between non-null ids preserve the prior values:
  // ad-hoc runs inherit backend variables and the panel should not reset
  // to definition defaults; a follow-up Run All re-emits change events as
  // it executes, replacing stale values almost immediately. The
  // null-first-session transition still must NOT clear (events can arrive
  // before the sessionId state propagates).
  const prevSessionIdRef = useRef<string | null>(sessionId)
  useEffect(() => {
    if (prevSessionIdRef.current !== null && sessionId === null) {
      setValues(new Map())
      setRecentlyChangedPaths(new Set())
    }
    prevSessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    return () => {
      recentlyChangedTimeoutRefs.current.forEach((timeout) => clearTimeout(timeout))
      recentlyChangedTimeoutRefs.current.clear()
    }
  }, [])

  return {
    values,
    recentlyChangedPaths,
    forget,
  }
}
