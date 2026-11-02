/**
 * Tests for useVariableInspectors - multi-instance open-inspectors state for
 * the per-variable inspect modal.
 *
 * Contract under test:
 *   - ordered open ids (position supplies the cascade index)
 *   - open / close / isOpen
 *   - focus-existing on duplicate open: open(id) for an already-open id
 *     raises + pulses its sheet ('var-inspect-<id>') via the shared
 *     refocusSheet reopen affordance instead of duplicating
 *   - open keys persist in localStorage ('var-mgr.open-inspectors') scoped
 *     by persistenceKey (the editing test id): same-test reloads and
 *     navigation restore watchers; closing or switching the test drops them
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The hook must call refocusSheet (the shared raise + pulse reopen affordance)
// from the draggable-sheet module (direct import, no barrel) so this
// module-level mock intercepts it.
vi.mock('@/components/shared/draggable-sheet', () => ({
  refocusSheet: vi.fn(),
}))

import { refocusSheet } from '@/components/shared/draggable-sheet'
import { useVariableInspectors } from '@/features/workbench/common/variables/variable-inspect-modal/use-variable-inspectors'

beforeEach(() => {
  vi.mocked(refocusSheet).mockClear()
  localStorage.clear()
})

describe('useVariableInspectors - open / close / isOpen', () => {
  it('starts with no open inspectors', () => {
    const { result } = renderHook(() => useVariableInspectors())
    expect(result.current.openIds).toEqual([])
  })

  it('open() adds the id and isOpen() reports it', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    expect(result.current.openIds).toEqual(['var-a'])
    expect(result.current.isOpen('var-a')).toBe(true)
  })

  it('isOpen() is false for an id that was never opened', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    expect(result.current.isOpen('var-b')).toBe(false)
  })

  it('close() removes the id and keeps the order of the rest', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.open('var-c'))
    act(() => result.current.close('var-b'))
    expect(result.current.openIds).toEqual(['var-a', 'var-c'])
    expect(result.current.isOpen('var-b')).toBe(false)
  })

  it('close() on an id that is not open is a no-op', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    act(() => result.current.close('var-ghost'))
    expect(result.current.openIds).toEqual(['var-a'])
  })

  it('removes every id when several close in one commit (the save re-mask)', () => {
    // Multiple secret watchers close in the SAME render commit when a test
    // save re-locks them; each close must compose, not last-write-win.
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.open('var-c'))
    act(() => {
      result.current.close('var-a')
      result.current.close('var-b')
    })
    expect(result.current.openIds).toEqual(['var-c'])
    expect(
      JSON.parse(localStorage.getItem('var-mgr.open-inspectors') ?? 'null'),
    ).toEqual({ testId: 'test-1', names: ['var-c'] })
  })
})

describe('useVariableInspectors - ordered ids (cascade indexes)', () => {
  it('appends ids in open order so positions provide cascade indexes', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.open('var-c'))
    expect(result.current.openIds).toEqual(['var-a', 'var-b', 'var-c'])
  })

  it('an id reopened after close joins at the end (fresh cascade slot)', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.close('var-a'))
    act(() => result.current.open('var-a'))
    expect(result.current.openIds).toEqual(['var-b', 'var-a'])
    // Reopening a CLOSED id is a fresh open, not a focus request.
    expect(refocusSheet).not.toHaveBeenCalled()
  })
})

describe('useVariableInspectors - persistence (per-test, reload/navigation)', () => {
  const STORAGE_KEY = 'var-mgr.open-inspectors'

  function setStored(testId: string, names: unknown) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ testId, names }))
  }

  it('restores the persisted open keys (and their order) for the same test', () => {
    setStored('test-1', ['var-b', 'var-a'])
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual(['var-b', 'var-a'])
  })

  it('ignores an entry stored for a different test', () => {
    setStored('test-OTHER', ['var-a'])
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual([])
  })

  it('does not restore without a persistence key', () => {
    setStored('test-1', ['var-a'])
    const { result } = renderHook(() => useVariableInspectors())
    expect(result.current.openIds).toEqual([])
  })

  it('persists opens to localStorage stamped with the test id', () => {
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      testId: 'test-1',
      names: ['var-a', 'var-b'],
    })
  })

  it('persists closes to localStorage', () => {
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.close('var-a'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      testId: 'test-1',
      names: ['var-b'],
    })
  })

  it('does not write to localStorage without a persistence key', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('a remounted hook with the same key picks up the state (navigation/reload)', () => {
    const first = renderHook(() => useVariableInspectors('test-1'))
    act(() => first.result.current.open('var-a'))
    first.unmount()

    const second = renderHook(() => useVariableInspectors('test-1'))
    expect(second.result.current.openIds).toEqual(['var-a'])
    expect(second.result.current.isOpen('var-a')).toBe(true)
  })

  it('switching tests resets the watchers and clears the stored entry', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useVariableInspectors(key),
      { initialProps: { key: 'test-1' as string | null } },
    )
    act(() => result.current.open('var-a'))

    rerender({ key: 'test-2' })

    expect(result.current.openIds).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('closing the test (key becomes null) drops the watchers and the entry', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useVariableInspectors(key),
      { initialProps: { key: 'test-1' as string | null } },
    )
    act(() => result.current.open('var-a'))

    rerender({ key: null })

    expect(result.current.openIds).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('a late-arriving key restores that test entry (loading race)', () => {
    setStored('test-1', ['var-a'])
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useVariableInspectors(key),
      { initialProps: { key: null as string | null } },
    )
    expect(result.current.openIds).toEqual([])

    rerender({ key: 'test-1' })

    expect(result.current.openIds).toEqual(['var-a'])
  })

  it('ignores corrupt storage content', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{')
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual([])
  })

  it('ignores a payload whose names is not an array', () => {
    setStored('test-1', 'nope')
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual([])
  })

  it('ignores a non-object payload', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['var-a']))
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual([])
  })

  it('drops non-string entries from a tampered payload', () => {
    setStored('test-1', ['var-a', 42, null])
    const { result } = renderHook(() => useVariableInspectors('test-1'))
    expect(result.current.openIds).toEqual(['var-a'])
  })
})

describe('useVariableInspectors - focus-existing on duplicate open', () => {
  it('does not call refocusSheet on a first open', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    expect(refocusSheet).not.toHaveBeenCalled()
  })

  it('open() on an already-open id raises + pulses its sheet instead of duplicating', () => {
    const { result } = renderHook(() => useVariableInspectors())
    act(() => result.current.open('var-a'))
    act(() => result.current.open('var-b'))
    act(() => result.current.open('var-a'))
    expect(refocusSheet).toHaveBeenCalledTimes(1)
    expect(refocusSheet).toHaveBeenCalledWith('var-inspect-var-a')
    // No duplicate entry and the original order is preserved.
    expect(result.current.openIds).toEqual(['var-a', 'var-b'])
  })
})

describe('useVariableInspectors - watchers only (VMGR-106)', () => {
  it('returns the watcher API only: the pencil opens the window, never a watcher in edit', () => {
    const { result } = renderHook(() => useVariableInspectors())
    expect(Object.keys(result.current).sort()).toEqual(['close', 'isOpen', 'open', 'openIds'])
  })
})
