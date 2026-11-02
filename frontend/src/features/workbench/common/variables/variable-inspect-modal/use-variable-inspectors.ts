/**
 * useVariableInspectors - the open inspect sheets, keyed by scoped name and persisted per open test.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { refocusSheet } from '@/components/shared/draggable-sheet'

const STORAGE_KEY = 'var-mgr.open-inspectors'

function readPersisted(persistenceKey: string | null | undefined): string[] {
  if (typeof persistenceKey !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entry = parsed as { testId?: unknown; names?: unknown }
      if (entry.testId === persistenceKey && Array.isArray(entry.names)) {
        return entry.names.filter((name): name is string => typeof name === 'string')
      }
    }
    return []
  } catch {
    return []
  }
}

function persistNames(
  persistenceKey: string | null | undefined,
  names: string[],
): void {
  if (typeof persistenceKey !== 'string') return
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ testId: persistenceKey, names }),
  )
}

export interface UseVariableInspectors {
  openIds: string[]
  open: (key: string) => void
  close: (key: string) => void
  isOpen: (key: string) => boolean
}

export function useVariableInspectors(
  persistenceKey?: string | null,
): UseVariableInspectors {
  const [openIds, setOpenIds] = useState<string[]>(() =>
    readPersisted(persistenceKey),
  )
  const prevKeyRef = useRef(persistenceKey)

  // Leaving a test (close or switch) drops its watchers - they never carry
  // over to another test, even one with identically named variables.
  useEffect(() => {
    if (prevKeyRef.current === persistenceKey) return
    const prev = prevKeyRef.current
    prevKeyRef.current = persistenceKey
    if (typeof prev === 'string') localStorage.removeItem(STORAGE_KEY)
    setOpenIds(readPersisted(persistenceKey))
  }, [persistenceKey])

  const open = useCallback(
    (key: string) => {
      if (openIds.includes(key)) {
        refocusSheet(`var-inspect-${key}`)
        return
      }
      const next = [...openIds, key]
      persistNames(persistenceKey, next)
      setOpenIds(next)
    },
    [openIds, persistenceKey],
  )

  const close = useCallback(
    (key: string) => {
      // Functional update: several watchers can close in one commit (the test
      // save re-locking every secret) - each removal must compose, never
      // last-write-win. The idempotent persist rides the updater so the
      // stored names always match the final state.
      setOpenIds((prev) => {
        if (!prev.includes(key)) return prev
        const next = prev.filter((openKey) => openKey !== key)
        persistNames(persistenceKey, next)
        return next
      })
    },
    [persistenceKey],
  )

  const isOpen = useCallback((key: string) => openIds.includes(key), [openIds])

  return { openIds, open, close, isOpen }
}
