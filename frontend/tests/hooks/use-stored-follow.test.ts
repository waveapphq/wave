/**
 * useStoredFollow: an open sheet hears once about each change to its stored Block, by content.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStoredFollow } from '@/hooks/use-stored-follow'

function renderFollow(initial: Record<string, unknown>) {
  const follow = vi.fn()
  const view = renderHook(({ stored }) => useStoredFollow(stored, follow), { initialProps: { stored: initial } })
  return { follow, change: (stored: Record<string, unknown>) => view.rerender({ stored }) }
}

describe('useStoredFollow', () => {
  it('stays quiet while the stored fields keep their content, even as new objects', () => {
    const { follow, change } = renderFollow({ bindings: { out: 'a' } })

    change({ bindings: { out: 'a' } })

    expect(follow).not.toHaveBeenCalled()
  })

  it('hands over the previous and the new fields once per change', () => {
    const { follow, change } = renderFollow({ bindings: { out: 'a' } })

    change({ bindings: { out: '' } })
    change({ bindings: { out: '' } })

    expect(follow).toHaveBeenCalledTimes(1)
    expect(follow).toHaveBeenCalledWith({ bindings: { out: 'a' } }, { bindings: { out: '' } })
  })
})
