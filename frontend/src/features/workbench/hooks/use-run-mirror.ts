/**
 * useRunMirror - live-attach to the holder's announced run (REQ-5.2.7.15).
 *
 * Watchers attach to the announced run (console cleared + bound, block paint
 * and live variables ride the attach path) and tear back down to the plain
 * draft mirror when the run ends. The holder's own tab attaches the same way
 * to a tracked run it did not start, but never reads as a watcher.
 */

import { useEffect, useRef, useState } from 'react'
import type { MirroredRun } from '@/features/workbench/api/ownership'
import { useLogStore } from '@/features/workbench/stores/log-store'

/** A run the holder tab did not start: announced while it held the slot, under another session. */
function isForeignRun(
  runSessionId: string | null,
  isMirroring: boolean,
  localSessionId: string | null,
): boolean {
  return runSessionId !== null && !isMirroring && runSessionId !== localSessionId
}

export interface UseRunMirrorDeps {
  /** The announced run from the ownership slot, or null. */
  run: MirroredRun | null
  /** Whether this tab is a read-only mirror of the draft. */
  isMirroring: boolean
  /** True while the watcher browses freely; a browsing tab never attaches. */
  browsingAway?: boolean
  /** This tab's own live workbench session id, if it started one. */
  localSessionId: string | null
  /** Hydrate the announced run (converge test, restore paint, subscribe topics). */
  attach: (run: MirroredRun) => void
  /** Unsubscribe from the attached run's topics. */
  detach: () => void
}

export interface UseRunMirrorResult {
  /** The run this WATCHER is mirroring; null for a holder tab or when idle. */
  mirroredRun: MirroredRun | null
}

export function useRunMirror({
  run,
  isMirroring,
  browsingAway = false,
  localSessionId,
  attach,
  detach,
}: UseRunMirrorDeps): UseRunMirrorResult {
  const attachedSessionRef = useRef<string | null>(null)
  const attachRef = useRef(attach)
  attachRef.current = attach
  const detachRef = useRef(detach)
  detachRef.current = detach

  // Judged once per announced run: the attach adopts the run's session id as this tab's own.
  const runSessionId = run?.sessionId ?? null
  const [announced, setAnnounced] = useState(() => ({
    sessionId: runSessionId,
    foreign: isForeignRun(runSessionId, isMirroring, localSessionId),
  }))
  let foreign = announced.foreign
  if (announced.sessionId !== runSessionId) {
    foreign = isForeignRun(runSessionId, isMirroring, localSessionId)
    setAnnounced({ sessionId: runSessionId, foreign })
  }

  // Attach for a watcher, and for the holder tab when the run is not its own.
  // A browsing watcher stays where it is; rejoining re-arms the attach.
  const target = run != null && !browsingAway && (isMirroring || foreign) ? run : null
  const targetSessionId = target?.sessionId ?? null

  useEffect(() => {
    if (targetSessionId === null || target === null) {
      if (attachedSessionRef.current !== null) {
        detachRef.current()
        attachedSessionRef.current = null
      }
      return
    }
    if (attachedSessionRef.current !== null) {
      detachRef.current()
    }
    const logStore = useLogStore.getState()
    // A tab that loaded into the run is already bound to it and holds its
    // backlog; clearing is only for switching away from another session.
    if (logStore.sessionId !== targetSessionId) {
      logStore.clearLogs()
      logStore.setSessionId(targetSessionId)
    }
    attachRef.current(target)
    attachedSessionRef.current = targetSessionId
    // `target` tracks targetSessionId; keying on the id avoids re-attaching on
    // same-run re-announces that arrive as fresh objects.
  }, [targetSessionId])

  useEffect(
    () => () => {
      if (attachedSessionRef.current !== null) {
        detachRef.current()
        attachedSessionRef.current = null
      }
    },
    [],
  )

  return { mirroredRun: isMirroring && !browsingAway && run != null ? run : null }
}
