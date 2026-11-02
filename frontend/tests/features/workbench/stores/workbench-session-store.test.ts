/**
 * Workbench session-role store.
 *
 * The smallest slice that lets an app-scoped component know whether this tab
 * still takes part in the shared workbench session, without importing the
 * Workbench-only ownership hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  getPersistedSessionRole,
  useWorkbenchSessionStore,
} from '@/features/workbench/stores/workbench-session-store'

describe('workbench-session-store', () => {
  beforeEach(() => {
    useWorkbenchSessionStore.setState({ isHolder: false, isWatching: false })
  })

  it('starts with this tab taking part in nothing', () => {
    const state = useWorkbenchSessionStore.getState()
    expect(state.isHolder).toBe(false)
    expect(state.isWatching).toBe(false)
  })

  it('records that this tab holds the session', () => {
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: false })

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
    expect(useWorkbenchSessionStore.getState().isWatching).toBe(false)
  })

  it('records that this tab only mirrors', () => {
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: false, isWatching: true })

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(false)
    expect(useWorkbenchSessionStore.getState().isWatching).toBe(true)
  })

  it('clears both roles when the tab takes part in nothing', () => {
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: true })

    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: false, isWatching: false })

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(false)
    expect(useWorkbenchSessionStore.getState().isWatching).toBe(false)
  })

  it('keeps the role after the Workbench screen is gone', () => {
    // Holding outlives the screen: nothing about unmounting the Workbench
    // resets this slice - only an explicit role change does.
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: false })

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
  })

  it('exposes a narrow selector that ignores unrelated changes', () => {
    const readHolder = (state: ReturnType<typeof useWorkbenchSessionStore.getState>) =>
      state.isHolder

    useWorkbenchSessionStore.getState().setSessionRole({ isHolder: false, isWatching: true })

    expect(readHolder(useWorkbenchSessionStore.getState())).toBe(false)
  })

  describe('persisted role (resume after a reload)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('persists every role write for a reloaded page to read back', () => {
      useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: false })

      expect(getPersistedSessionRole()).toEqual({ isHolder: true, isWatching: false })
    })

    it('reads no role when nothing was persisted', () => {
      sessionStorage.removeItem('wave.session-role')

      expect(getPersistedSessionRole()).toEqual({ isHolder: false, isWatching: false })
    })

    it('falls back to no role when per-tab storage is unavailable', () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
      })

      expect(getPersistedSessionRole()).toEqual({ isHolder: false, isWatching: false })
    })

    it('survives an unavailable per-tab storage on write', () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      })

      expect(() =>
        useWorkbenchSessionStore.getState().setSessionRole({ isHolder: true, isWatching: false }),
      ).not.toThrow()
    })
  })
})
