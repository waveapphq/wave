/** The shared wait of a server search: the callback runs `delayMs` after the last call, which a newer call or an unmount cancels. */

import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<T>(
  callback: ((value: T) => void) | undefined,
  delayMs: number | undefined,
): (value: T) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  return useCallback(
    (value: T) => {
      if (!callback || !delayMs) return
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        callback(value)
      }, delayMs)
    },
    [callback, delayMs],
  )
}
