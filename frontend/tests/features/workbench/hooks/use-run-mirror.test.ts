/**
 * useRunMirror Hook Tests (RUNM-1).
 *
 * A watcher live-attaches to an announced run: the console clears and binds to
 * the run's stream, the attach path hydrates the run (converge test, restore
 * painted block states, subscribe the run topics), and the mirror tears back
 * down to the plain draft mirror when the run ends. Console entries stay
 * readable after the run ends. The holder's own tab attaches the same way
 * to a run it did not start but never reads as a watcher.
 *
 * Hook under test:
 * frontend/src/features/workbench/hooks/use-run-mirror.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useLogStore } from '@/features/workbench/stores/log-store'
import type { MirroredRun } from '@/features/workbench/api/ownership'
import { useRunMirror } from '@/features/workbench/hooks/use-run-mirror'

const RUN: MirroredRun = {
  sessionId: 'run-session-1',
  testId: 'test-1',
  testName: 'Nightly Smoke',
  environmentId: 'env-1',
  environmentName: 'Staging',
  status: 'running',
}

const OTHER_RUN: MirroredRun = { ...RUN, sessionId: 'run-session-2', testName: 'Other Test' }

const attach = vi.fn()
const detach = vi.fn()

interface Deps {
  run: MirroredRun | null
  isMirroring: boolean
  browsingAway?: boolean
  localSessionId: string | null
  attach: typeof attach
  detach: typeof detach
}

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    run: null,
    isMirroring: true,
    localSessionId: null,
    attach,
    detach,
    ...overrides,
  }
}

function seedEntry(id: string) {
  useLogStore.getState().addEntry({
    id,
    timestamp: '2026-07-28T10:00:00.000Z',
    level: 'INFO',
    message: id,
    source: 'Plugin',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useLogStore.getState().clearLogs()
  useLogStore.getState().setSessionId(null)
})

describe('useRunMirror - idle', () => {
  it('reports no mirrored run and attaches nothing', () => {
    const { result } = renderHook(() => useRunMirror(deps()))

    expect(result.current.mirroredRun).toBeNull()
    expect(attach).not.toHaveBeenCalled()
  })

  it('reports no mirrored run when a run exists but this tab is not mirroring', () => {
    const { result } = renderHook(() =>
      useRunMirror(deps({ run: RUN, isMirroring: false })),
    )

    expect(result.current.mirroredRun).toBeNull()
  })
})

describe('useRunMirror - activation', () => {
  it('exposes the announced run to a watcher', () => {
    const { result } = renderHook(() => useRunMirror(deps({ run: RUN })))

    expect(result.current.mirroredRun).toEqual(RUN)
  })

  it('runs the attach path once when the run is announced', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps(),
    })

    rerender(deps({ run: RUN }))

    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(RUN)
  })

  it('clears the watcher console at run start', () => {
    seedEntry('stale-line')
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps(),
    })

    rerender(deps({ run: RUN }))

    expect(useLogStore.getState().entries).toEqual([])
  })

  it('keeps the backlog a tab already holds for that same run', () => {
    // A tab that loaded into the run is already bound to it and its console
    // holds the run's backlog; activation must not wipe what it just received.
    useLogStore.getState().setSessionId(RUN.sessionId)
    seedEntry('already-received-line')
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps(),
    })

    rerender(deps({ run: RUN }))

    expect(useLogStore.getState().entries).toHaveLength(1)
    expect(useLogStore.getState().sessionId).toBe(RUN.sessionId)
  })

  it('binds the console to the run session', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps(),
    })

    rerender(deps({ run: RUN }))

    expect(useLogStore.getState().sessionId).toBe(RUN.sessionId)
  })

  it('does not re-attach when the same run is re-announced', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })
    attach.mockClear()

    rerender(deps({ run: { ...RUN } }))

    expect(attach).not.toHaveBeenCalled()
  })

  it('re-attaches when a different run is announced', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })
    attach.mockClear()
    detach.mockClear()

    rerender(deps({ run: OTHER_RUN }))

    expect(detach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(OTHER_RUN)
    expect(useLogStore.getState().sessionId).toBe(OTHER_RUN.sessionId)
  })
})

describe('useRunMirror - deactivation', () => {
  it('drops back to the draft mirror when the run ends', () => {
    const { result, rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })

    rerender(deps({ run: null }))

    expect(result.current.mirroredRun).toBeNull()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('keeps the streamed console readable after the run ends', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })
    seedEntry('run-line')

    rerender(deps({ run: null }))

    expect(useLogStore.getState().entries.map((e) => e.id)).toEqual(['run-line'])
  })

  it('tears the mirror down when the watcher takes over mid-run', () => {
    const { result, rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: null }))

    expect(result.current.mirroredRun).toBeNull()
  })

  it('tears the mirror down on unmount', () => {
    const { unmount } = renderHook(() => useRunMirror(deps({ run: RUN })))
    detach.mockClear()

    unmount()

    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('never detaches when it never attached', () => {
    const { unmount } = renderHook(() => useRunMirror(deps()))

    unmount()

    expect(detach).not.toHaveBeenCalled()
  })
})

describe('useRunMirror - the holder tab', () => {
  it('attaches to a tracked run this tab did not start', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ isMirroring: false, localSessionId: null }),
    })

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: null }))

    expect(attach).toHaveBeenCalledWith(RUN)
  })

  it('never reads as a watcher, so no banner is shown', () => {
    const { result } = renderHook(() =>
      useRunMirror(deps({ run: RUN, isMirroring: false, localSessionId: null })),
    )

    expect(result.current.mirroredRun).toBeNull()
  })

  it('does not re-attach to the run it started itself', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ isMirroring: false, localSessionId: RUN.sessionId }),
    })

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId }))

    expect(attach).not.toHaveBeenCalled()
  })

  it('leaves its own console alone for the run it started itself', () => {
    seedEntry('own-line')

    renderHook(() => useRunMirror(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId })))

    expect(useLogStore.getState().entries.map((e) => e.id)).toEqual(['own-line'])
  })

  it('stays attached after the attach adopts the run session, until the run ends', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ isMirroring: false, localSessionId: null }),
    })
    rerender(deps({ run: RUN, isMirroring: false, localSessionId: null }))
    expect(attach).toHaveBeenCalledTimes(1)

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId }))
    expect(detach).not.toHaveBeenCalled()

    rerender(deps({ run: null, isMirroring: false, localSessionId: RUN.sessionId }))
    expect(detach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)
  })

  it('stays attached when the tab mounts into a foreign run and adopts its session', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN, isMirroring: false, localSessionId: null }),
    })
    expect(attach).toHaveBeenCalledTimes(1)

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId }))

    expect(detach).not.toHaveBeenCalled()
  })

  it('moves to the next foreign run announced after the adopted one', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN, isMirroring: false, localSessionId: null }),
    })
    rerender(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId }))

    rerender(deps({ run: OTHER_RUN, isMirroring: false, localSessionId: RUN.sessionId }))

    expect(detach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenLastCalledWith(OTHER_RUN)
  })

  it('still tears down when a watcher that adopted the run takes over mid-run', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN, isMirroring: true, localSessionId: null }),
    })
    rerender(deps({ run: RUN, isMirroring: true, localSessionId: RUN.sessionId }))

    rerender(deps({ run: RUN, isMirroring: false, localSessionId: RUN.sessionId }))

    expect(detach).toHaveBeenCalledTimes(1)
  })
})

describe('useRunMirror - free browsing', () => {
  it('never attaches for a browsing watcher', () => {
    const { result } = renderHook(() =>
      useRunMirror(deps({ run: RUN, browsingAway: true })),
    )

    expect(attach).not.toHaveBeenCalled()
    expect(result.current.mirroredRun).toBeNull()
  })

  it('detaches when the watcher browses away mid-run', () => {
    const { result, rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })
    expect(attach).toHaveBeenCalledTimes(1)

    rerender(deps({ run: RUN, browsingAway: true }))

    expect(detach).toHaveBeenCalledTimes(1)
    expect(result.current.mirroredRun).toBeNull()
  })

  it('keeps the streamed console entries when browsing away', () => {
    const { rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN }),
    })
    seedEntry('streamed-line')

    rerender(deps({ run: RUN, browsingAway: true }))

    expect(useLogStore.getState().entries.map((e) => e.id)).toEqual(['streamed-line'])
  })

  it('re-attaches with a fresh console when the watcher rejoins', () => {
    const { result, rerender } = renderHook((props: Deps) => useRunMirror(props), {
      initialProps: deps({ run: RUN, browsingAway: true }),
    })
    seedEntry('browsed-line')

    rerender(deps({ run: RUN, browsingAway: false }))

    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(RUN)
    expect(useLogStore.getState().entries).toEqual([])
    expect(result.current.mirroredRun).toEqual(RUN)
  })
})
