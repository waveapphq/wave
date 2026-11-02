/**
 * One layout choice kept for the browser session (SHELL-9).
 */

import { useCallback } from 'react'

import { useLayoutSessionStore } from '@/stores/layout-session-store'

export function useSessionLayoutState<T>(key: string, defaultValue: T): [T, (next: T) => void] {
  const stored = useLayoutSessionStore((state) => state.values[key])
  const setValue = useLayoutSessionStore((state) => state.setValue)
  const set = useCallback((next: T) => setValue(key, next), [key, setValue])
  return [stored === undefined ? defaultValue : (stored as T), set]
}
