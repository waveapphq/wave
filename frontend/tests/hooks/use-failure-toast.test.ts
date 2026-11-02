/**
 * useFailureToast - the one catch behind gestures whose props cannot carry a
 * rejection.
 *
 * Module: frontend/src/hooks/use-failure-toast.ts
 *
 * Every rejection is named in a toast under the gesture's title; a resolving
 * action is silent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { useFailureToast } from '@/hooks/use-failure-toast'

describe('useFailureToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports an Error under the given title', () => {
    const { result } = renderHook(() => useFailureToast('Some Title'))

    act(() => {
      result.current.report(new Error('boom'))
    })

    expect(mockToastError).toHaveBeenCalledWith('boom', 'Some Title')
  })

  it('passes a string rejection through verbatim', () => {
    const { result } = renderHook(() => useFailureToast('Some Title'))

    act(() => {
      result.current.report('weird')
    })

    expect(mockToastError).toHaveBeenCalledWith('weird', 'Some Title')
  })

  it('falls back to a plain reason when the rejection carries none', () => {
    const { result } = renderHook(() => useFailureToast('Some Title'))

    act(() => {
      result.current.report({})
    })

    expect(mockToastError).toHaveBeenCalledWith('Request failed', 'Some Title')
  })

  it('forwards the arguments and reports a rejected action', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Service Unavailable'))
    const { result } = renderHook(() => useFailureToast('Some Title'))

    await act(async () => {
      result.current.run(action)('a', 'b')
    })

    expect(action).toHaveBeenCalledWith('a', 'b')
    expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Some Title')
  })

  it('stays silent when the action resolves', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useFailureToast('Some Title'))

    await act(async () => {
      result.current.run(action)()
    })

    expect(action).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
