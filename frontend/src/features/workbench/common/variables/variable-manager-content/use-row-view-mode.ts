/**
 * Row View Mode Hook
 *
 * Per-row eye state for the Variable Manager. Default ON (runtime). The
 * stored set tracks ids that have been toggled to definition view, so any
 * unknown id reads as runtime without prefilling state. The set clears when
 * the runtime values map transitions from non-empty to empty: that is the
 * same Reset signal that wipes the underlying useVariableUpdates map, and
 * it is the only signal that resets the eye state. Pause / Stop / mid-run
 * updates do not reset, and neither does a session that drops its last value.
 *
 * REQ-3.2.2.18: Live variable values display
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type RowViewMode = 'runtime' | 'definition'

interface UseRowViewModeReturn {
  getMode: (id: string) => RowViewMode
  toggleMode: (id: string) => void
}

export function useRowViewMode(
  runtimeValues: Map<string, unknown>,
  sessionId?: string | null,
): UseRowViewModeReturn {
  const [definitionIds, setDefinitionIds] = useState<Set<string>>(() => new Set())
  const prevSizeRef = useRef(runtimeValues.size)
  const valuesSessionRef = useRef(sessionId)

  useEffect(() => {
    const emptied = prevSizeRef.current > 0 && runtimeValues.size === 0
    // The session that held the values is still there: it dropped its last one, no Reset.
    const sameSession = sessionId != null && sessionId === valuesSessionRef.current
    if (emptied && !sameSession) {
      setDefinitionIds(new Set())
    }
    prevSizeRef.current = runtimeValues.size
    if (runtimeValues.size > 0) valuesSessionRef.current = sessionId
  }, [runtimeValues, sessionId])

  const getMode = useCallback(
    (id: string): RowViewMode => (definitionIds.has(id) ? 'definition' : 'runtime'),
    [definitionIds],
  )

  const toggleMode = useCallback((id: string) => {
    setDefinitionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  return { getMode, toggleMode }
}
