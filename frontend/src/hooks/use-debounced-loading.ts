/**
 * useDebouncedLoading - Debounces loading state to prevent skeleton flicker.
 *
 * When a server response arrives faster than the debounce threshold,
 * the loading state never becomes true - the data swaps instantly.
 * Only shows loading (skeletons) when the fetch genuinely takes time.
 *
 * `settled` is the other half of that: until the first read has finished there
 * is nothing to show yet, whatever the debounced flag says, so a surface must
 * not read "no rows" as "nothing here".
 */

import { useCallback, useRef, useState } from 'react'

const DEFAULT_DELAY_MS = 150

export interface UseDebouncedLoadingReturn {
  /** The debounced loading state. Use this for rendering skeletons. */
  loading: boolean
  /** False until the first fetch has finished, however it finished. */
  settled: boolean
  /** Call when a fetch starts. Loading becomes true only after the delay. */
  startLoading: () => void
  /** Call when a fetch completes. Cancels any pending debounce. */
  stopLoading: () => void
}

export function useDebouncedLoading(delayMs = DEFAULT_DELAY_MS): UseDebouncedLoadingReturn {
  const [loading, setLoading] = useState(false)
  const [settled, setSettled] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startLoading = useCallback(() => {
    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current)
    // Only set loading after the delay
    timerRef.current = setTimeout(() => {
      setLoading(true)
      timerRef.current = null
    }, delayMs)
  }, [delayMs])

  const stopLoading = useCallback(() => {
    // Cancel the pending timer if the response arrived before the delay
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setLoading(false)
    setSettled(true)
  }, [])

  return { loading, settled, startLoading, stopLoading }
}
