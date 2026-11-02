/**
 * usePageBlock - the owner-side handle on the page block. Stable callbacks, one
 * identity per hook instance, and the block dies with its owner so navigating
 * away can never leave a stale block behind.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'

import { usePageBlock } from '@/hooks/use-page-block'
import { usePageBlockStore, type FailedRead } from '@/stores/page-block-store'

function makeFailure(overrides: Partial<FailedRead> = {}): FailedRead {
  return {
    label: 'environments',
    detail: { message: 'Internal Server Error' },
    retry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => {
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
})

describe('usePageBlock', () => {
  it('blocks the page, naming the read that failed', () => {
    const { result } = renderHook(() => usePageBlock())

    act(() => result.current.blockPage(makeFailure()))

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
  })

  it('clears the page block', () => {
    const { result } = renderHook(() => usePageBlock())

    act(() => result.current.blockPage(makeFailure()))
    act(() => result.current.clearPageBlock())

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('clears only the named read when the owner raised several', () => {
    const { result } = renderHook(() => usePageBlock())

    act(() => result.current.blockPage(makeFailure({ label: 'tags' })))
    act(() => result.current.blockPage(makeFailure({ label: 'environments' })))
    act(() => result.current.clearPageBlock('tags'))

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
  })

  it('keeps both callbacks stable across re-renders', () => {
    const { result, rerender } = renderHook(() => usePageBlock())
    const first = result.current

    rerender()

    expect(result.current.blockPage).toBe(first.blockPage)
    expect(result.current.clearPageBlock).toBe(first.clearPageBlock)
    expect(result.current).toBe(first)
  })

  it('clears the block when the owner unmounts', () => {
    const { result, unmount } = renderHook(() => usePageBlock())

    act(() => result.current.blockPage(makeFailure()))
    expect(usePageBlockStore.getState().block).not.toBeNull()

    unmount()

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('unmounting without a block leaves the store untouched', () => {
    const { unmount } = renderHook(() => usePageBlock())

    unmount()

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('does not let one surface erase a card another surface raised', () => {
    const raiser = renderHook(() => usePageBlock())
    const other = renderHook(() => usePageBlock())

    act(() => raiser.result.current.blockPage(makeFailure({ label: 'tags' })))
    act(() => other.result.current.clearPageBlock())

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load tags')
  })

  it('keeps both failures when a second surface fails too', () => {
    const first = renderHook(() => usePageBlock())
    const second = renderHook(() => usePageBlock())

    act(() => first.result.current.blockPage(makeFailure({ label: 'tags' })))
    act(() => second.result.current.blockPage(makeFailure({ label: 'environments' })))

    expect(usePageBlockStore.getState().block?.title).toBe(
      'Could not load tags and environments'
    )
  })

  it('drops a failure reported after the owner unmounted', () => {
    const { result, unmount } = renderHook(() => usePageBlock())
    const { blockPage } = result.current

    unmount()
    act(() => blockPage(makeFailure()))

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('keeps an owner able to raise after a StrictMode remount', () => {
    const { result } = renderHook(() => usePageBlock(), { wrapper: StrictMode })

    act(() => result.current.blockPage(makeFailure()))

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load environments')
  })

  it('leaves the other surface blocked when one of them unmounts', () => {
    const staying = renderHook(() => usePageBlock())
    const leaving = renderHook(() => usePageBlock())

    act(() => staying.result.current.blockPage(makeFailure({ label: 'tags' })))
    act(() => leaving.result.current.blockPage(makeFailure({ label: 'environments' })))

    leaving.unmount()

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load tags')
  })
})
