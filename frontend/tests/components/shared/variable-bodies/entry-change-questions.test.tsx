/**
 * useEntryChange - the questions a list or map editor asks before a type change or an {x} switch drops a
 * value; a host's own empty entry counts as nothing held (FIELD-7, FIELD-13).
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'

describe('useEntryChange - a host with its own empty entry', () => {
  const hostEmpty = () => ({ stat: 'count' })

  it('changes the type at once when the entry still holds the host empty entry', () => {
    const { result } = renderHook(() => useEntryChange(hostEmpty))
    const apply = vi.fn()
    act(() => result.current.requestType('map', 'string', { stat: 'count' }, apply))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(result.current.typeAsk).toBeNull()
  })

  it('asks before a type change drops anything else', () => {
    const { result } = renderHook(() => useEntryChange(hostEmpty))
    const apply = vi.fn()
    act(() => result.current.requestType('map', 'string', { stat: 'sum', field: 'latency_ms' }, apply))
    expect(apply).not.toHaveBeenCalled()
    expect(result.current.typeAsk).toMatchObject({ prev: 'map', next: 'string', count: 2 })
  })
})

describe('useEntryChange - a host with no empty entry of its own', () => {
  it('changes the type at once while the entry holds its type default', () => {
    const { result } = renderHook(() => useEntryChange())
    const apply = vi.fn()
    act(() => result.current.requestType('string', 'integer', '', apply))
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
