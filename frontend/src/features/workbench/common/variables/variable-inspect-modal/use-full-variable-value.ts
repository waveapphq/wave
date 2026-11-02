/**
 * useFullVariableValue - event-driven full-value fetch for complex watchers.
 *
 * Live complex runtime values arrive as WS summary envelopes; the watcher
 * fetches the full value from the session variables endpoint when an
 * envelope lands (250ms trailing debounce per watcher, stale-while-revalidate,
 * a failed tick keeps the previous value, reports itself beside that value,
 * and retries on the next envelope).
 * History snapshots and idle definitions never fetch.
 *
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { useEffect, useRef, useState } from 'react'

import { workbenchApi } from '@/features/workbench/api/workbench'
import { toFailureDetail } from '@/lib/failure-detail'
import { isSummaryEnvelope } from '@/lib/variable-format'
import type { ElementTypes } from '@/lib/variable-validation'

const FETCH_DEBOUNCE_MS = 250

/** A refresh tick that failed, reported beside the value it could not refresh. */
export interface VariableValueRefreshFailure {
  /** Why the read failed, as the API reported it. */
  reason: string
  /** A value arrived on an earlier tick and is still the one on screen. */
  hasLastValue: boolean
}

export interface UseFullVariableValueParams {
  sessionId?: string | null
  variableName: string
  runtimeValue: unknown
  hasRuntimeValue: boolean
  isComplex: boolean
  /** The Function instance path the variable lives in (node ids, outermost first); absent or empty = Test scope. */
  functionPath?: string[]
}

export interface UseFullVariableValueResult {
  fullValue: unknown
  /** The fetched array / map value's real element types (REQ-3.1.3.19). */
  fullElementTypes: ElementTypes | undefined
  isFirstFetchPending: boolean
  /** Null while the latest tick succeeded. */
  refreshFailure: VariableValueRefreshFailure | null
}

export function useFullVariableValue({
  sessionId,
  variableName,
  runtimeValue,
  hasRuntimeValue,
  isComplex,
  functionPath,
}: UseFullVariableValueParams): UseFullVariableValueResult {
  const [fetched, setFetched] = useState<{ value: unknown; elementTypes?: ElementTypes } | null>(
    null,
  )
  const [failure, setFailure] = useState<VariableValueRefreshFailure | null>(null)
  const fetchedRef = useRef(false)

  const needsFetch =
    isComplex && hasRuntimeValue && isSummaryEnvelope(runtimeValue) && !!sessionId
  // A value key, so an equal path in a new array does not re-arm the debounce.
  const pathKey = JSON.stringify(functionPath ?? [])

  // runtimeValue is the invalidation signal: each WS envelope is a fresh
  // object, so an identity change re-arms the trailing debounce.
  useEffect(() => {
    if (!needsFetch || !sessionId) {
      // A watcher that stops polling drops its last reason rather than replaying
      // it if polling resumes.
      setFailure((current) => (current === null ? current : null))
      return
    }
    let disposed = false
    const path = JSON.parse(pathKey) as string[]
    const timer = setTimeout(() => {
      const read =
        path.length > 0
          ? workbenchApi.getSessionVariables(sessionId, [variableName], path)
          : workbenchApi.getSessionVariables(sessionId, [variableName])
      read
        .then((variables) => {
          if (disposed || !(variableName in variables)) return
          fetchedRef.current = true
          setFailure(null)
          const entry = variables[variableName]
          setFetched({ value: entry.value, elementTypes: entry.elementTypes })
        })
        .catch((error_: unknown) => {
          // Keep the previous value; the next envelope retries.
          if (disposed) return
          setFailure({
            reason: toFailureDetail(error_).message,
            hasLastValue: fetchedRef.current,
          })
        })
    }, FETCH_DEBOUNCE_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [needsFetch, sessionId, variableName, runtimeValue, pathKey])

  return {
    fullValue: needsFetch ? fetched?.value : undefined,
    fullElementTypes: needsFetch ? fetched?.elementTypes : undefined,
    isFirstFetchPending: needsFetch && fetched === null,
    refreshFailure: needsFetch ? failure : null,
  }
}
