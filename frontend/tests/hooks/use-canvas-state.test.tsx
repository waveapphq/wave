/**
 * useCanvasState hook tests
 *
 * localStorage-persisted state for canvas-page Environment selection and
 * debug options. Exercises initializers, persistence wrappers, and the
 * recents-tracking logic.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasState, STORAGE_KEYS, noop } from '@/hooks/use-canvas-state'

function clearStorage(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key)
  }
}

// Reusable stable environment references so changes in tests reflect real
// (reference-stable) prop updates rather than spurious new arrays on every
// render, which would retrigger the hook's validation effect without bound.
const ENVS_ONE = [{ id: 'env-1', name: 'One' }]
const ENVS_TWO = [
  { id: 'env-1', name: 'One' },
  { id: 'env-2', name: 'Two' },
]

describe('STORAGE_KEYS and noop', () => {
  beforeEach(clearStorage)

  it('exposes stable localStorage key names', () => {
    expect(STORAGE_KEYS.SELECTED_ENV).toBe('wave_selected_environment')
    expect(STORAGE_KEYS.REMEMBER_SELECTION).toBe('wave_remember_env_selection')
    expect(STORAGE_KEYS.DEBUG_OPTIONS).toBe('wave_debug_options')
    expect(STORAGE_KEYS.RECENT_ENVS).toBe('wave_recent_environments')
  })

  it('noop is callable and returns undefined', () => {
    expect(noop()).toBeUndefined()
  })
})

describe('useCanvasState - initializers', () => {
  beforeEach(clearStorage)

  it('defaults rememberSelection to false and env null', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.rememberSelection).toBe(false)
    expect(result.current.selectedEnvironment).toBeNull()
  })

  it('hydrates the remembered env from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, 'env-1')
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.rememberSelection).toBe(true)
    expect(result.current.selectedEnvironment).toBe('env-1')
  })

  it('hydrates recent environments from localStorage', () => {
    localStorage.setItem(
      STORAGE_KEYS.RECENT_ENVS,
      JSON.stringify([{ id: 'env-1', name: 'One' }]),
    )
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.recentEnvironments).toEqual([{ id: 'env-1', name: 'One' }])
  })

  it('ignores malformed recent-envs JSON and defaults to []', () => {
    localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, 'not-json')
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.recentEnvironments).toEqual([])
  })

  it('hydrates debug options and falls back to defaults when malformed', () => {
    localStorage.setItem(
      STORAGE_KEYS.DEBUG_OPTIONS,
      JSON.stringify({ pauseOnFirstBlock: true, pauseOnErrors: true }),
    )
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.debugOptions).toEqual({
      pauseOnFirstBlock: true,
      pauseOnErrors: true,
    })
  })

  it('debug options default to all-false when stored JSON is broken', () => {
    localStorage.setItem(STORAGE_KEYS.DEBUG_OPTIONS, '{broken')
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.debugOptions).toEqual({
      pauseOnFirstBlock: false,
      pauseOnErrors: false,
    })
  })

  it('migrates legacy pauseOnFirst localStorage key to pauseOnFirstBlock', () => {
    // Older Debug Options payload used the short key `pauseOnFirst`; the
    // hydrator accepts either shape so persisted state is not lost during
    // the rename.
    localStorage.setItem(
      STORAGE_KEYS.DEBUG_OPTIONS,
      JSON.stringify({ pauseOnFirst: true, pauseOnErrors: false }),
    )
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    expect(result.current.debugOptions).toEqual({
      pauseOnFirstBlock: true,
      pauseOnErrors: false,
    })
  })
})

describe('useCanvasState - recents survive a failed environments read', () => {
  beforeEach(clearStorage)

  const STORED = [
    { id: 'env-1', name: 'One' },
    { id: 'env-9', name: 'Gone' },
  ]
  const NO_ENVS: { id: string; name: string }[] = []

  it('keeps stored recents when the environments read has not answered', () => {
    localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(STORED))
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
    localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, 'env-1')

    const { result } = renderHook(() => useCanvasState(NO_ENVS, false))

    expect(result.current.recentEnvironments).toEqual(STORED)
    expect(localStorage.getItem(STORAGE_KEYS.RECENT_ENVS)).toBe(JSON.stringify(STORED))
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBe('env-1')
  })

  it('clears stored recents when the backend answers with no environments', () => {
    localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(STORED))

    const { result } = renderHook(() => useCanvasState(NO_ENVS, true))

    expect(result.current.recentEnvironments).toEqual([])
    expect(localStorage.getItem(STORAGE_KEYS.RECENT_ENVS)).toBe('[]')
  })

  it('prunes only the recents the answered list no longer has', () => {
    localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(STORED))

    const { result } = renderHook(() => useCanvasState(ENVS_ONE, true))

    expect(result.current.recentEnvironments).toEqual([{ id: 'env-1', name: 'One' }])
    expect(localStorage.getItem(STORAGE_KEYS.RECENT_ENVS)).toBe(
      JSON.stringify([{ id: 'env-1', name: 'One' }]),
    )
  })
})

describe('useCanvasState - persistence wrappers', () => {
  beforeEach(clearStorage)

  it('persists selected environment when remember=true and tracks recents', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_TWO))

    act(() => result.current.setRememberSelection(true))
    act(() => result.current.setSelectedEnvironment('env-1'))

    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBe('env-1')
    expect(result.current.recentEnvironments.map((r) => r.id)).toEqual(['env-1'])
  })

  it('clears stored env on remember=false and on null selection', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    act(() => result.current.setRememberSelection(true))
    act(() => result.current.setSelectedEnvironment('env-1'))
    act(() => result.current.setRememberSelection(false))
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBeNull()

    act(() => result.current.setSelectedEnvironment(null))
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBeNull()
  })

  it('persists debug options', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    act(() =>
      result.current.setDebugOptions({ pauseOnFirstBlock: true, pauseOnErrors: false }),
    )
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.DEBUG_OPTIONS) ?? '{}')).toEqual({
      pauseOnFirstBlock: true,
      pauseOnErrors: false,
    })
  })

  it('dedups the recents list when the same env is re-selected', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_TWO))
    act(() => result.current.setSelectedEnvironment('env-1'))
    act(() => result.current.setSelectedEnvironment('env-2'))
    act(() => result.current.setSelectedEnvironment('env-1'))
    // env-1 moved to the front, env-2 still in second place; no duplicates.
    expect(result.current.recentEnvironments.map((r) => r.id)).toEqual(['env-1', 'env-2'])
  })

  it('writes the current env to localStorage when remember is toggled on after a prior selection', () => {
    const { result } = renderHook(() => useCanvasState(ENVS_ONE))
    act(() => result.current.setSelectedEnvironment('env-1'))
    // Prior state: env selected but remember=false. Toggling on should
    // persist the current selection.
    act(() => result.current.setRememberSelection(true))
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)).toBe('env-1')
  })
})
