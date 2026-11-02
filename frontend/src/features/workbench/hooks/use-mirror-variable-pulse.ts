/**
 * useMirrorVariablePulse - the watch-mode variable change cue.
 *
 * While mirroring, no run events arrive, so this diffs the mirror-applied store
 * variables between draft snapshots and marks the changed names as recently
 * changed for MIRROR_PULSE_MS (the row shows a temporary violet bar + pulse).
 * The baseline is seeded with the current variables on mirror start so the first
 * snapshot does not pulse every row. Returns the base set merged with the pulsed
 * names.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkflowStore, type WorkflowVariable } from '@/features/workbench/stores/workflow-store'
import { changedVariableNames } from '@/features/workbench/lib/variable-diff'

const MIRROR_PULSE_MS = 700
const EMPTY: Set<string> = new Set()

export function useMirrorVariablePulse(
  isMirroring: boolean,
  baseRecentlyChanged: Set<string>,
): Set<string> {
  const [changedVars, setChangedVars] = useState<Set<string>>(EMPTY)
  const prevRef = useRef<WorkflowVariable[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isMirroring) {
      setChangedVars(EMPTY)
      return
    }
    prevRef.current = useWorkflowStore.getState().variables
    return useWorkflowStore.subscribe(
      (state) => state.variables,
      (variables) => {
        const changed = changedVariableNames(prevRef.current, variables)
        prevRef.current = variables
        if (changed.length === 0) return
        setChangedVars(new Set(changed))
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setChangedVars(EMPTY), MIRROR_PULSE_MS)
      },
    )
  }, [isMirroring])

  return useMemo(
    () =>
      changedVars.size === 0
        ? baseRecentlyChanged
        : new Set([...baseRecentlyChanged, ...changedVars]),
    [baseRecentlyChanged, changedVars],
  )
}
