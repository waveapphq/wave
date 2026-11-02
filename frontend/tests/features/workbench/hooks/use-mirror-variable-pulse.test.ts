/**
 * useMirrorVariablePulse Hook Tests (watch-mode variable cue).
 *
 * Uses the real workflow store: changing store.variables while mirroring feeds
 * the changed names into the returned set for MIRROR_PULSE_MS, then clears them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useMirrorVariablePulse } from '@/features/workbench/hooks/use-mirror-variable-pulse'

const BASE: Set<string> = new Set(['base'])

function variable(name: string, value: string) {
  return { id: name, name, value, type: 'string', scope: 'test' }
}

function setVars(vars: ReturnType<typeof variable>[]) {
  act(() => {
    useWorkflowStore.setState({ variables: vars } as never)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  useWorkflowStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMirrorVariablePulse', () => {
  it('returns the base set unchanged when not mirroring', () => {
    const { result } = renderHook(() => useMirrorVariablePulse(false, BASE))
    expect(result.current).toBe(BASE)
  })

  it('does not pulse on an unchanged snapshot (baseline seeded with current vars)', () => {
    useWorkflowStore.setState({ variables: [variable('x', '1')] } as never)
    const { result } = renderHook(() => useMirrorVariablePulse(true, BASE))

    setVars([variable('x', '1')])

    expect([...result.current]).toEqual(['base'])
  })

  it('merges a changed variable into the set, then clears it after the window', () => {
    useWorkflowStore.setState({ variables: [variable('x', '1')] } as never)
    const { result } = renderHook(() => useMirrorVariablePulse(true, BASE))

    setVars([variable('x', '2')])
    expect(result.current.has('x')).toBe(true)
    expect(result.current.has('base')).toBe(true)

    // A second change before the window elapses resets the timer.
    setVars([variable('x', '3')])
    expect(result.current.has('x')).toBe(true)

    act(() => vi.advanceTimersByTime(700))
    expect(result.current.has('x')).toBe(false)
    expect([...result.current]).toEqual(['base'])
  })

  it('stops feeding changes once mirroring ends', () => {
    useWorkflowStore.setState({ variables: [variable('x', '1')] } as never)
    const { result, rerender } = renderHook(
      ({ mirroring }) => useMirrorVariablePulse(mirroring, BASE),
      { initialProps: { mirroring: true } },
    )

    rerender({ mirroring: false })
    setVars([variable('x', '9')])

    expect([...result.current]).toEqual(['base'])
  })
})
