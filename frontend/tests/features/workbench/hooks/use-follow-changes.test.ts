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
const requestBringIntoView = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.getState().reset()
  useWorkflowStore.setState({
    requestFitView,
    requestBringIntoView,
    mirrorLastChangeNodeId: null,
    mirrorChangeTick: 0,
    mirrorBuildBounds: null,
  } as never)
})

const BUILD = { x: -80, y: 140, width: 160, height: 353 }
const NEXT_BUILD = { x: -80, y: 140, width: 160, height: 913 }

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

describe('useFollowChanges - a watched build (WATCH-8)', () => {
  function startBuild(bounds = BUILD) {
    act(() =>
      useWorkflowStore.setState({ mirrorBuildBounds: bounds, mirrorLastChangeNodeId: 'n1', mirrorChangeTick: 1 } as never),
    )
  }

  it('frames the finished test once when the build starts', () => {
    renderHook(() => useFollowChanges(true))

    startBuild()

    expect(requestFitView).toHaveBeenCalledTimes(1)
    expect(requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0, bounds: BUILD })
    expect(requestBringIntoView).not.toHaveBeenCalled()
    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })

  it('asks to keep each later Block in view, never framing or centering again', () => {
    renderHook(() => useFollowChanges(true))
    startBuild()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 2 } as never))
    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n3', mirrorChangeTick: 3 } as never))

    expect(requestBringIntoView.mock.calls).toEqual([['n2'], ['n3']])
    expect(requestFitView).toHaveBeenCalledTimes(1)
    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })

  it('ignores a frame that changes no Block', () => {
    renderHook(() => useFollowChanges(true))
    startBuild()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: null } as never))

    expect(requestBringIntoView).not.toHaveBeenCalled()
  })

  it('frames again when the next build starts', () => {
    renderHook(() => useFollowChanges(true))
    startBuild()
    act(() => useWorkflowStore.setState({ mirrorBuildBounds: null } as never))

    startBuild(NEXT_BUILD)

    expect(requestFitView).toHaveBeenCalledTimes(2)
    expect(requestFitView).toHaveBeenLastCalledWith({ padding: 0.2, duration: 0, bounds: NEXT_BUILD })
  })

  it('leaves the view alone when the build ends', () => {
    renderHook(() => useFollowChanges(true))
    startBuild()
    requestFitView.mockClear()

    act(() =>
      useWorkflowStore.setState({ mirrorBuildBounds: null, mirrorLastChangeNodeId: 'n4', mirrorChangeTick: 4 } as never),
    )

    expect(requestFitView).not.toHaveBeenCalled()
    expect(requestBringIntoView).not.toHaveBeenCalled()
  })

  it('lets Follow Changes win: the first Block is centered, nothing framed', () => {
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    requestFitView.mockClear()

    startBuild()
    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 2 } as never))

    expect(requestFitView).not.toHaveBeenCalled()
    expect(requestBringIntoView).not.toHaveBeenCalled()
    expect(mockFocusCurrentBlock.mock.calls).toEqual([['n1'], ['n2']])
  })

  it('turning Follow Changes off mid-build leaves the view where it is, then keeps new Blocks in view', () => {
    const { result } = renderHook(() => useFollowChanges(true))
    act(() => result.current.toggleFollow())
    startBuild()
    requestFitView.mockClear()
    mockFocusCurrentBlock.mockClear()

    act(() => result.current.toggleFollow())

    expect(result.current.following).toBe(false)
    expect(requestFitView).not.toHaveBeenCalled()
    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()

    act(() => useWorkflowStore.setState({ mirrorLastChangeNodeId: 'n2', mirrorChangeTick: 2 } as never))

    expect(requestFitView).not.toHaveBeenCalled()
    expect(requestBringIntoView).toHaveBeenCalledWith('n2')
  })
})
