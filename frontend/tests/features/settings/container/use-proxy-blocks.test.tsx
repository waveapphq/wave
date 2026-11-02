/**
 * useProxyBlocks Hook Tests
 *
 * REQ-4.7.14, REQ-3.4.2.10: the Proxy Blocks page state - the three block lists
 * read each time the page turns active, a failed read, retry. Nothing is staged.
 *
 * Module under test: frontend/src/features/settings/container/use-proxy-blocks.ts
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Every request is replaced; anything else the module exports stays real.
vi.mock('@/features/settings/api/proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/proxy')>()),
  fetchProxySettings: vi.fn(),
  updateProxySettings: vi.fn(),
  validateProxySettings: vi.fn(),
  fetchProxyBlocks: vi.fn(),
}))

import {
  fetchProxyBlocks,
  fetchProxySettings,
  updateProxySettings,
  validateProxySettings,
  type ProxyBlocks,
} from '@/features/settings/api/proxy'
import type { PageReadStatus } from '@/features/settings/container/use-activation-read'
import {
  useProxyBlocks,
  type UseProxyBlocksResult,
} from '@/features/settings/container/use-proxy-blocks'

const mockFetchProxyBlocks = vi.mocked(fetchProxyBlocks)

// ============================================================================
// Fixtures
// ============================================================================

const BLOCKS: ProxyBlocks = {
  supported: [
    { id: 'http-client', name: 'HTTP Client', category: 'network' },
    { id: 'helm-install', name: 'Helm Install', category: 'helm' },
  ],
  unsupported: [{ id: 'shell-exec', name: 'Shell Exec', category: 'system' }],
  not_applicable: [{ id: 'ping', name: 'Ping', category: 'network' }],
}

/** A later answer: one more block uses the proxy. */
const BLOCKS_LATER: ProxyBlocks = {
  ...BLOCKS,
  supported: [...BLOCKS.supported, { id: 'opensearch', name: 'OpenSearch', category: 'database' }],
}

const READ_FAILURE = 'Service Unavailable'

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================================
// Utilities
// ============================================================================

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
}

function renderProxyBlocks(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useProxyBlocks(isActive), {
    initialProps: { active },
  })
}

async function renderLoaded() {
  const view = renderProxyBlocks(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  return view
}

/** The fields that hold a value, sorted. */
function definedKeys(value: object): string[] {
  return Object.entries(value)
    .filter(([, held]) => held !== undefined)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b))
}

// ============================================================================
// Tests
// ============================================================================

describe('useProxyBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset, not clear: an answer queued by a failed test must not reach the next one.
    mockFetchProxyBlocks.mockReset().mockResolvedValue(BLOCKS)
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderProxyBlocks(false)
      await flush()

      expect(mockFetchProxyBlocks).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
      expect(result.current.blocks).toBeUndefined()
      expect(result.current.error).toBeUndefined()
    })

    it('is pending while the first read is in flight, then loaded with the three lists', async () => {
      const read = deferred<ProxyBlocks>()
      mockFetchProxyBlocks.mockReturnValueOnce(read.promise)

      const { result } = renderProxyBlocks(true)
      await flush()
      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')
      expect(result.current.blocks).toBeUndefined()

      await act(async () => {
        read.resolve(BLOCKS)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.blocks).toEqual(BLOCKS)
    })

    it('reads once the page turns active', async () => {
      const view = renderProxyBlocks(false)
      await flush()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
      expect(view.result.current.blocks).toEqual(BLOCKS)
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderLoaded()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(1)
    })

    it('reads again each time the page turns active again', async () => {
      const view = await renderLoaded()
      mockFetchProxyBlocks.mockResolvedValueOnce(BLOCKS_LATER)

      view.rerender({ active: false })
      await flush()
      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(1)

      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(2)
      expect(view.result.current.status).toBe('loaded')
      expect(view.result.current.blocks).toEqual(BLOCKS_LATER)
    })

    it('is failed with the API message when the read fails', async () => {
      mockFetchProxyBlocks.mockRejectedValueOnce(apiError(READ_FAILURE, 503))

      const { result } = renderProxyBlocks(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
      expect(result.current.blocks).toBeUndefined()
    })

    it('retry reads again: pending, then loaded', async () => {
      mockFetchProxyBlocks.mockRejectedValueOnce(apiError(READ_FAILURE, 503))
      const { result } = renderProxyBlocks(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const read = deferred<ProxyBlocks>()
      mockFetchProxyBlocks.mockReturnValueOnce(read.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')
      expect(result.current.error).toBeUndefined()

      await act(async () => {
        read.resolve(BLOCKS)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.blocks).toEqual(BLOCKS)
    })

    it('is failed again when the retry fails too', async () => {
      mockFetchProxyBlocks.mockRejectedValue(apiError(READ_FAILURE, 503))
      const { result } = renderProxyBlocks(true)
      await flush()

      act(() => {
        result.current.retry()
      })
      await flush()

      expect(mockFetchProxyBlocks).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
    })
  })

  describe('result', () => {
    it('holds the read state and retry, and nothing to stage or save', async () => {
      expectTypeOf<keyof UseProxyBlocksResult>().toEqualTypeOf<
        'status' | 'error' | 'blocks' | 'retry'
      >()
      expectTypeOf<UseProxyBlocksResult['status']>().toEqualTypeOf<PageReadStatus>()

      const { result } = await renderLoaded()

      expect(definedKeys(result.current)).toEqual(['blocks', 'retry', 'status'])
    })

    it('holds the reason in place of the lists after a failed read', async () => {
      mockFetchProxyBlocks.mockRejectedValueOnce(apiError(READ_FAILURE, 503))

      const { result } = renderProxyBlocks(true)
      await flush()

      expect(definedKeys(result.current)).toEqual(['error', 'retry', 'status'])
    })

    it('only ever asks for the block lists', async () => {
      const view = await renderLoaded()
      view.rerender({ active: false })
      view.rerender({ active: true })
      await flush()
      act(() => {
        view.result.current.retry()
      })
      await flush()

      expect(mockFetchProxyBlocks).toHaveBeenCalled()
      expect(vi.mocked(fetchProxySettings)).not.toHaveBeenCalled()
      expect(vi.mocked(updateProxySettings)).not.toHaveBeenCalled()
      expect(vi.mocked(validateProxySettings)).not.toHaveBeenCalled()
    })
  })
})
