/**
 * useSessionLayoutState: one layout choice, kept for the browser session under its key.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useSessionLayoutState } from '@/hooks/use-session-layout-state'
import { useLayoutSessionStore } from '@/stores/layout-session-store'

describe('useSessionLayoutState', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useLayoutSessionStore.setState(useLayoutSessionStore.getInitialState(), true)
  })

  it('gives the default until the user chooses', () => {
    const { result } = renderHook(() => useSessionLayoutState('page.section', true))

    expect(result.current[0]).toBe(true)
  })

  it('gives the choice once made, a false one included', () => {
    const { result } = renderHook(() => useSessionLayoutState('page.section', true))

    act(() => result.current[1](false))

    expect(result.current[0]).toBe(false)
  })

  it('gives the choice to a later mount with the same key', () => {
    const first = renderHook(() => useSessionLayoutState('page.section', true))
    act(() => first.result.current[1](false))
    first.unmount()

    const second = renderHook(() => useSessionLayoutState('page.section', true))

    expect(second.result.current[0]).toBe(false)
  })

  it('keeps two mounts with the same key in step', () => {
    const first = renderHook(() => useSessionLayoutState('page.section', true))
    const second = renderHook(() => useSessionLayoutState('page.section', true))

    act(() => first.result.current[1](false))

    expect(second.result.current[0]).toBe(false)
  })

  it('keeps each key to itself', () => {
    const first = renderHook(() => useSessionLayoutState('page.first', true))
    const second = renderHook(() => useSessionLayoutState('page.second', 200))

    act(() => first.result.current[1](false))

    expect(second.result.current[0]).toBe(200)
  })

  it('keeps the same setter between renders', () => {
    const { result, rerender } = renderHook(() => useSessionLayoutState('page.section', true))
    const setter = result.current[1]

    rerender()

    expect(result.current[1]).toBe(setter)
  })
})
