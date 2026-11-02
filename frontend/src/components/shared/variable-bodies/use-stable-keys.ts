/**
 * useStableKeys - stable per-position React keys for a positional editor list
 * (array items / map entries / table rows + columns). The keys regenerate only
 * when the count changes (add / remove), so controlled inputs keep their identity
 * and focus by position across edits without keying on the raw array index.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useRef } from 'react'

export function useStableKeys(count: number): readonly string[] {
  const keysRef = useRef<string[]>([])
  const seqRef = useRef(0)
  if (keysRef.current.length !== count) {
    const next = keysRef.current.slice(0, count)
    while (next.length < count) next.push(`sk${seqRef.current++}`)
    keysRef.current = next
  }
  return keysRef.current
}
