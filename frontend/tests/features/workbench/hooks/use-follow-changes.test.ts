/**
 * useFollowChanges Hook Tests (watch-mode, Follow Changes toggle).
 *
 * Uses the real workflow store (like the store tests) with requestFitView
 * replaced by a spy and focusCurrentBlock mocked, so the recenter/fit wiring is
 * asserted against store state transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const mockFocusCurrentBlock = vi.fn()
vi.mock('@/features/workbench/lib/focus-current', () => ({
  focusCurrentBlock: (id: string) => mockFocusCurrentBlock(id),
}))

import { useFollowChanges } from '@/features/workbench/hooks/use-follow-changes'

const requestFitView = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.getState().reset()
  useWorkflowStore.setState({ requestFitView, mirrorLastChangeNodeId: null, mirrorChangeTick: 0 } as never)
})

describe('useFollowChanges', () => {
  it('starts not following', () => {
    const { result } = renderHook(() => useFollowChanges(true))
    expect(result.current.following).toBe(false)
    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
    expect(requestFitView).not.toHaveBeenCalled()
  })

  it('engaging with no change yet fits the whole test on screen', () => {
    const { result } = renderHook(() => useFollowChanges(true))

    act(() => result.current.toggleFollow())

    expect(result.current.following).toBe(true)
    expect(requestFitView).toHaveBeenCalledTimes(1)
    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })

  it('engaging with a change already present focuses it, not fit', () => {
    useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n1', mirrorChangeTick: 1 } as never)
    const { result } = renderHook(() => useFollowChanges(true))

    act(() => result.current.toggleFollow())

    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('n1')
    expect(requestFitView).not.toHaveBeenCalled()
  })

  it('focuses each new block change while following', () => {
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    mockFocusCurrentBlock.mockClear()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 1 } as never))
    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('n2')

    mockFocusCurrentBlock.mockClear()
    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n3', mirrorChangeTick: 2 } as never))
    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('n3')
  })

  it('re-centers when the SAME block changes again (tick bump)', () => {
    useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 1 } as never)
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    mockFocusCurrentBlock.mockClear()

    // Same id, new tick -> must re-center.
    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 2 } as never))
    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('n2')

    mockFocusCurrentBlock.mockClear()
    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 3 } as never))
    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('n2')
  })

  it('ignores metadata/variable frames (null change) while following', () => {
    useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n1' } as never)
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    mockFocusCurrentBlock.mockClear()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: null } as never))

    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
    expect(requestFitView).not.toHaveBeenCalled()
  })

  it('stops focusing after the toggle is turned off', () => {
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    act(() => result.current.toggleFollow())
    expect(result.current.following).toBe(false)
    mockFocusCurrentBlock.mockClear()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n9' } as never))

    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })

  it('leaves following when the mirror ends', () => {
    const { result, rerender } = renderHook(({ mirroring }) => useFollowChanges(mirroring), {
      initialProps: { mirroring: true },
    })
    act(() => result.current.toggleFollow())
    expect(result.current.following).toBe(true)

    rerender({ mirroring: false })

    expect(result.current.following).toBe(false)
  })
})
