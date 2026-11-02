/**
 * useExpressionValidator tests.
 *
 * The parser load behind every expression surface. An expression editor may
 * only call an expression valid while `ready` is true: a parser that never
 * loaded returns no issues, and no issues must never read as "valid".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  initializeTreeSitter: vi.fn<() => Promise<unknown>>(() => Promise.resolve({})),
  isInitialized: vi.fn(() => false),
}))

vi.mock('@/features/workbench/lib/tree-sitter-init', () => ({
  initializeTreeSitter: () => mocks.initializeTreeSitter(),
  isInitialized: () => mocks.isInitialized(),
}))

import {
  useExpressionValidator,
  notCheckedMessage,
} from '@/features/workbench/hooks/use-expression-validator'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInitialized.mockReturnValue(false)
  mocks.initializeTreeSitter.mockResolvedValue({})
})

describe('useExpressionValidator', () => {
  it('is ready without loading anything when the parser is already loaded', () => {
    mocks.isInitialized.mockReturnValue(true)

    const { result } = renderHook(() => useExpressionValidator())

    expect(result.current.ready).toBe(true)
    expect(result.current.failure).toBeNull()
    expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
  })

  it('loads the parser and becomes ready', async () => {
    const { result } = renderHook(() => useExpressionValidator())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mocks.initializeTreeSitter).toHaveBeenCalled()
    expect(result.current.failure).toBeNull()
  })

  it('reports the reason and stays not-ready when the parser fails to load', async () => {
    mocks.initializeTreeSitter.mockRejectedValue(new Error('Tree-sitter failed to load: 404'))

    const { result } = renderHook(() => useExpressionValidator())

    await waitFor(() => expect(result.current.failure).not.toBeNull())
    expect(result.current.failure?.message).toBe('Tree-sitter failed to load: 404')
    expect(result.current.ready).toBe(false)
  })

  it('does not load the parser while the surface is inactive', async () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useExpressionValidator(active),
      { initialProps: { active: false } },
    )

    expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)

    rerender({ active: true })

    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('retry loads again and clears the reported failure', async () => {
    mocks.initializeTreeSitter.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useExpressionValidator())
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    mocks.initializeTreeSitter.mockResolvedValue({})
    await act(async () => {
      result.current.retry()
    })

    expect(result.current.failure).toBeNull()
    expect(result.current.ready).toBe(true)
    expect(mocks.initializeTreeSitter).toHaveBeenCalledTimes(2)
  })

  it('retry is ready at once when the parser loaded meanwhile', async () => {
    mocks.initializeTreeSitter.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useExpressionValidator())
    await waitFor(() => expect(result.current.failure).not.toBeNull())

    mocks.isInitialized.mockReturnValue(true)
    await act(async () => {
      result.current.retry()
    })

    expect(result.current.ready).toBe(true)
    expect(mocks.initializeTreeSitter).toHaveBeenCalledTimes(1)
  })
})

describe('notCheckedMessage', () => {
  it('says the expression was not checked and why', () => {
    expect(notCheckedMessage({ message: 'Failed to fetch' })).toBe(
      'Not checked - could not load expression validation. Failed to fetch',
    )
  })
})
