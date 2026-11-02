/**
 * Persists a modal's width across sessions via localStorage.
 *
 * Returns `[width, setWidth]`. The setter writes through to storage.
 * Out-of-bounds or non-numeric persisted values fall back to the default.
 */

import { useCallback, useState } from 'react'

const MIN_WIDTH = 480
const MAX_WIDTH = 1600

function readPersisted(storageKey: string, defaultWidth: number): number {
  /* v8 ignore next - COV-SSR-003 */
  if (globalThis.window === undefined) return defaultWidth
  const raw = globalThis.localStorage.getItem(storageKey)
  if (raw == null) return defaultWidth
  const n = Number(raw)
  if (!Number.isFinite(n)) return defaultWidth
  if (n < MIN_WIDTH || n > MAX_WIDTH) return defaultWidth
  return n
}

export function usePersistedModalWidth(
  storageKey: string,
  defaultWidth: number,
): [number, (w: number) => void] {
  const [width, setWidth] = useState<number>(() =>
    readPersisted(storageKey, defaultWidth),
  )

  const setPersistedWidth = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next))
      setWidth(clamped)
      /* v8 ignore next - COV-SSR-003 */
      if (globalThis.window !== undefined) {
        globalThis.localStorage.setItem(storageKey, String(clamped))
      }
    },
    [storageKey],
  )

  return [width, setPersistedWidth]
}
