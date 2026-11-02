/**
 * Hook that debounces a POST /functions/{id}/validate-bumps call as the user
 * edits a Function draft inside the edit-mode publish dialog.
 *
 * Returns the canonical ``{allowed, blocked}`` shape plus loading + failure
 * state. The hook re-runs whenever the draft definition changes, coalescing
 * rapid keystrokes into a single API call via a 250ms debounce window.
 *
 * A failed read never empties the allowed set: only an answered read says a
 * bump level is unavailable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { validateBumps } from '@/features/functions/api/functions-api'
import type { BumpLevel, ComputedBumps } from '@/features/functions/api/types'

const DEBOUNCE_MS = 250

export interface UseAllowedBumpsResult {
  allowed: BumpLevel[]
  blocked: Partial<Record<BumpLevel, string>>
  isLoading: boolean
  /** The read failed: an empty allowed set is NOT an answer. */
  failed: boolean
  /** Runs the read again. */
  retry: () => void
}

export function useAllowedBumps(
  functionId: string,
  sourceVersion: string,
  draftDefinition: unknown,
): UseAllowedBumpsResult {
  const [state, setState] = useState({
    allowed: [] as BumpLevel[],
    blocked: {} as Partial<Record<BumpLevel, string>>,
    isLoading: true,
    failed: false,
  })
  const [attempt, setAttempt] = useState(0)
  // Stabilize the dependency by hashing the draft body. Callers may pass a
  // fresh object on every render; without this memo the effect would re-arm
  // continuously and burn the debounce window.
  const draftKey = useMemo(() => JSON.stringify(draftDefinition ?? null), [draftDefinition])
  const latestRef = useRef(draftDefinition)
  latestRef.current = draftDefinition

  useEffect(() => {
    if (!functionId || !sourceVersion) {
      setState({ allowed: [], blocked: {}, isLoading: false, failed: false })
      return
    }
    setState((prev) => ({ ...prev, isLoading: true, failed: false }))
    // The dialog reads `failed` and offers the retry; there is nothing else to report to.
    const markFailed = (): void => {
      setState((prev) => ({ ...prev, isLoading: false, failed: true }))
    }
    const computeBumps = async (): Promise<void> => {
      try {
        const result: ComputedBumps = await validateBumps(functionId, {
          sourceVersion,
          draftDefinition: latestRef.current as never,
        })
        setState({
          allowed: result.allowed,
          blocked: result.blocked,
          isLoading: false,
          failed: false,
        })
      } catch {
        markFailed()
      }
    }
    const handle = setTimeout(() => {
      computeBumps().catch(markFailed)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [functionId, sourceVersion, draftKey, attempt])

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  return { ...state, retry }
}
