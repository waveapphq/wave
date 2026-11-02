/**
 * useFocusCurrent Hook Tests (watch-mode).
 *
 * The hook returns a click handler that focuses the current target block
 * (navigate-to-scope + center via focusCurrentBlock), or does nothing when there
 * is no current block.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockFocusCurrentBlock = vi.fn()

vi.mock('@/features/workbench/lib/focus-current', () => ({
  focusCurrentBlock: (id: string) => mockFocusCurrentBlock(id),
}))

import { useFocusCurrent } from '@/features/workbench/hooks/use-focus-current'

describe('useFocusCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses the current block when invoked', () => {
    const { result } = renderHook(() => useFocusCurrent('node-1'))

    result.current()

    expect(mockFocusCurrentBlock).toHaveBeenCalledTimes(1)
    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('node-1')
  })

  it('does nothing when there is no current target', () => {
    const { result } = renderHook(() => useFocusCurrent(null))

    result.current()

    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })
})
