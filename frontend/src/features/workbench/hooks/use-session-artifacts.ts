/**
 * Single source of the live workbench session's artifact list + count for the
 * breadcrumb chip, the Session Artifacts sheet, and the warn-on-wipe guards.
 *
 * Refresh contract: fetch when the session becomes active (mount / recovery),
 * on run start, on the terminal transition, on sheet open, after remove(),
 * and on a 2s poll only while the sheet is open AND the run is executing.
 * No session and no artifacts both read as an empty list; a failure on a
 * gesture or transition read blocks the canvas, while a failed poll tick keeps
 * the last known items and notes the failure inside the sheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { workbenchApi, type WorkbenchSessionArtifact } from '@/features/workbench/api/workbench'
import { usePageBlock } from '@/hooks/use-page-block'
import { runBlockingRead } from '@/hooks/use-blocking-reads'
import { toFailureDetail } from '@/lib/failure-detail'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

export interface UseSessionArtifactsOptions {
  sessionActive: boolean
  running: boolean
  sheetOpen: boolean
}

export interface UseSessionArtifactsResult {
  items: WorkbenchSessionArtifact[]
  count: number
  totalBytes: number
  /** A failed poll tick's reason; null while ticks succeed. */
  pollError: string | null
  refresh: () => Promise<void>
  remove: (path: string) => Promise<void>
}

const POLL_INTERVAL_MS = 2000
const NO_ITEMS: WorkbenchSessionArtifact[] = []
const ARTIFACTS_LABEL = 'session artifacts'

export function useSessionArtifacts({
  sessionActive,
  running,
  sheetOpen,
}: UseSessionArtifactsOptions): UseSessionArtifactsResult {
  const [items, setItems] = useState<WorkbenchSessionArtifact[]>(NO_ITEMS)
  const [pollError, setPollError] = useState<string | null>(null)
  const { blockPage, clearPageBlock } = usePageBlock()

  const read = useCallback(async () => {
    const response = await workbenchApi.listSessionArtifacts()
    setItems(response.items)
    clearPageBlock(ARTIFACTS_LABEL)
    setPollError(null)
  }, [clearPageBlock])

  const refresh = useCallback(
    () => runBlockingRead({ label: ARTIFACTS_LABEL, run: read }, blockPage),
    [blockPage, read]
  )

  // Transition-driven fetches; prev-value refs survive StrictMode re-runs.
  const prevRef = useRef({ sessionActive: false, running: false, sheetOpen: false })
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = { sessionActive, running, sheetOpen }
    if (!sessionActive) {
      if (prev.sessionActive) {
        setItems(NO_ITEMS)
        setPollError(null)
      }
      return
    }
    const activated = !prev.sessionActive
    const runToggled = prev.running !== running
    const sheetOpened = !prev.sheetOpen && sheetOpen
    if (activated || runToggled || sheetOpened) {
      refresh().catch(alreadyReported)
    }
  }, [sessionActive, running, sheetOpen, refresh])

  // Poll while files appear mid-run; a failed tick keeps the last good list and reports beside it.
  useEffect(() => {
    if (!sessionActive || !sheetOpen || !running) return
    const id = setInterval(() => {
      read().catch((err: unknown) => {
        setPollError(toFailureDetail(err).message)
      })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [sessionActive, sheetOpen, running, read])

  // The list is read again either way, so a file the delete did not remove
  // stays on screen, and the caller is told the delete failed.
  const remove = useCallback(
    async (path: string) => {
      try {
        await workbenchApi.deleteSessionArtifact(path)
      } finally {
        await refresh().catch(alreadyReported)
      }
    },
    [refresh]
  )

  return {
    items,
    count: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.size_bytes, 0),
    pollError,
    refresh,
    remove,
  }
}
