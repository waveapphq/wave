/**
 * Workbench session-role store - REQ-5.2.7.15
 *
 * The smallest app-scoped slice of the shared workbench session: whether this
 * tab currently holds it or mirrors it. Written by the ownership hook, read by
 * the app-scoped leave beacon, and deliberately untouched by screen unmounts.
 * The role is mirrored into per-tab storage so a reloaded page can resume it.
 */

import { create } from 'zustand'

const ROLE_KEY = 'wave.session-role'

export interface SessionRole {
  isHolder: boolean
  isWatching: boolean
}

interface WorkbenchSessionState extends SessionRole {
  setSessionRole: (role: SessionRole) => void
}

export function getPersistedSessionRole(): SessionRole {
  try {
    const raw = globalThis.sessionStorage?.getItem(ROLE_KEY)
    return raw ? (JSON.parse(raw) as SessionRole) : { isHolder: false, isWatching: false }
  } catch {
    return { isHolder: false, isWatching: false }
  }
}

export const useWorkbenchSessionStore = create<WorkbenchSessionState>((set) => ({
  isHolder: false,
  isWatching: false,
  setSessionRole: (role) => set({ isHolder: role.isHolder, isWatching: role.isWatching }),
}))

// Subscribe (not the setter) so every state write persists, however it happens.
useWorkbenchSessionStore.subscribe((state) => {
  try {
    globalThis.sessionStorage?.setItem(
      ROLE_KEY,
      JSON.stringify({ isHolder: state.isHolder, isWatching: state.isWatching }),
    )
  } catch {
    // Resume-after-reload degrades when per-tab storage is unavailable.
  }
})
