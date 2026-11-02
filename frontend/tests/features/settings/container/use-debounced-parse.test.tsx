/**
 * useDebouncedParse Hook Tests
 *
 * REQ-4.5.14, REQ-4.5.16: the one debounced parse behind both Network Add dialogs.
 *
 * Module under test: frontend/src/features/settings/container/use-debounced-parse.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'

// ============================================================================
// Fixtures
// ============================================================================

interface ParseResult {
  entries: string[]
  errors: string[]
}

type Parse = (text: string) => Promise<ParseResult>

const RESULT_A: ParseResult = { entries: ['db1'], errors: [] }
const RESULT_B: ParseResult = { entries: ['db1', 'web-01.lab.internal'], errors: [] }
const RESULT_PRIMED: ParseResult = { entries: ['Lab Root CA'], errors: [] }

const LINE_A = 'db1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
const LINE_B = `${LINE_A}\nweb-01.lab.internal ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKtjP3h0Bq1Y3yJ5n4Rzv8m2t0LQ9kq6dHc8W1s3fG7a`
const PEM_TEXT = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ\n-----END CERTIFICATE-----'

// ============================================================================
// Utilities
// ============================================================================

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderParse(text: string, parse: Parse) {
  return renderHook(({ text: value, fn }: { text: string; fn: Parse }) => useDebouncedParse(value, fn), {
    initialProps: { text, fn: parse },
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve()
    }
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('useDebouncedParse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('blank text', () => {
    it('is idle with no result and never parses empty text', () => {
      const parse = vi.fn<Parse>()
      const { result } = renderParse('', parse)

      expect(result.current.status).toBe('idle')
      expect(result.current.result).toBeUndefined()
      expect(result.current.error).toBeUndefined()

      advance(1000)
      expect(parse).not.toHaveBeenCalled()
    })

    it('treats whitespace-only text as blank', () => {
      const parse = vi.fn<Parse>()
      const { result } = renderParse('   \n\t  \n', parse)

      expect(result.current.status).toBe('idle')
      advance(1000)
      expect(parse).not.toHaveBeenCalled()
    })

    it('goes back to idle and drops the waiting parse when the text is cleared', () => {
      const parse = vi.fn<Parse>()
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(100)

      rerender({ text: '', fn: parse })

      expect(result.current.status).toBe('idle')
      advance(1000)
      expect(parse).not.toHaveBeenCalled()
    })

    it('ignores the in-flight response once the text is cleared', async () => {
      const pending = deferred<ParseResult>()
      const parse = vi.fn<Parse>().mockReturnValue(pending.promise)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      expect(parse).toHaveBeenCalledTimes(1)

      rerender({ text: '  ', fn: parse })
      await act(async () => {
        pending.resolve(RESULT_A)
      })
      await settle()

      expect(result.current.status).toBe('idle')
      expect(result.current.result).toBeUndefined()
    })

    it('forgets the last result once the text is cleared: the next text waits with none', async () => {
      const parse = vi.fn<Parse>().mockResolvedValue(RESULT_A)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()
      expect(result.current.result).toEqual(RESULT_A)

      rerender({ text: '', fn: parse })
      rerender({ text: LINE_B, fn: parse })

      expect(result.current.status).toBe('pending')
      expect(result.current.result).toBeUndefined()
    })

    it('asks again for the same text after it was cleared', async () => {
      const parse = vi.fn<Parse>().mockResolvedValue(RESULT_A)
      const { rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()

      rerender({ text: '', fn: parse })
      rerender({ text: LINE_A, fn: parse })
      advance(300)
      await settle()

      expect(parse).toHaveBeenCalledTimes(2)
    })
  })

  describe('debounce (300 ms)', () => {
    it('is pending at once and parses 300 ms after the text appears, not at 299 ms', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { result } = renderParse(LINE_A, parse)

      expect(result.current.status).toBe('pending')
      advance(299)
      expect(parse).not.toHaveBeenCalled()

      advance(1)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(parse).toHaveBeenCalledWith(LINE_A)
    })

    it('sends one parse for a burst of edits, 300 ms after the last one', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { result, rerender } = renderParse('', parse)

      rerender({ text: 'd', fn: parse })
      advance(200)
      rerender({ text: 'db', fn: parse })
      advance(200)
      rerender({ text: 'db1', fn: parse })
      expect(result.current.status).toBe('pending')

      advance(299)
      expect(parse).not.toHaveBeenCalled()

      advance(1)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(parse).toHaveBeenCalledWith('db1')
    })

    it('stays pending while the parse is in flight', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { result } = renderParse(LINE_A, parse)

      advance(300)

      expect(parse).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')
      expect(result.current.result).toBeUndefined()
    })

    it('does not parse again when only the parse function changes', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { rerender } = renderParse(LINE_A, parse)
      advance(300)
      expect(parse).toHaveBeenCalledTimes(1)

      const nextParse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      rerender({ text: LINE_A, fn: nextParse })
      advance(1000)

      expect(parse).toHaveBeenCalledTimes(1)
      expect(nextParse).not.toHaveBeenCalled()
    })

    it('drops the waiting parse on unmount', () => {
      const parse = vi.fn<Parse>()
      const { unmount } = renderParse(LINE_A, parse)
      advance(100)

      unmount()
      advance(1000)

      expect(parse).not.toHaveBeenCalled()
    })
  })

  describe('results', () => {
    it('is done with the result when the parse resolves', async () => {
      const parse = vi.fn<Parse>().mockResolvedValue(RESULT_A)
      const { result } = renderParse(LINE_A, parse)

      advance(300)
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_A)
      expect(result.current.error).toBeUndefined()
    })

    it('keeps the previous result while a newer text waits and while its parse is in flight', async () => {
      const second = deferred<ParseResult>()
      const parse = vi
        .fn<Parse>()
        .mockResolvedValueOnce(RESULT_A)
        .mockReturnValueOnce(second.promise)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()
      expect(result.current.status).toBe('done')

      rerender({ text: LINE_B, fn: parse })
      expect(result.current.status).toBe('pending')
      expect(result.current.result).toEqual(RESULT_A)

      advance(300)
      expect(parse).toHaveBeenCalledTimes(2)
      expect(parse).toHaveBeenLastCalledWith(LINE_B)
      expect(result.current.status).toBe('pending')
      expect(result.current.result).toEqual(RESULT_A)

      await act(async () => {
        second.resolve(RESULT_B)
      })
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)
    })

    it('ignores a late response for an older text once a newer text was requested', async () => {
      const first = deferred<ParseResult>()
      const second = deferred<ParseResult>()
      const parse = vi
        .fn<Parse>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      rerender({ text: LINE_B, fn: parse })
      advance(300)
      expect(parse).toHaveBeenCalledTimes(2)

      await act(async () => {
        second.resolve(RESULT_B)
      })
      await settle()
      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)

      await act(async () => {
        first.resolve(RESULT_A)
      })
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)
    })

    it('ignores an older response that arrives first while the newer parse is in flight', async () => {
      const first = deferred<ParseResult>()
      const second = deferred<ParseResult>()
      const parse = vi
        .fn<Parse>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      rerender({ text: LINE_B, fn: parse })
      advance(300)

      await act(async () => {
        first.resolve(RESULT_A)
      })
      await settle()

      expect(result.current.status).toBe('pending')
      expect(result.current.result).toBeUndefined()

      await act(async () => {
        second.resolve(RESULT_B)
      })
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)
    })
  })

  describe('failures', () => {
    it('is failed with the API message when the parse rejects', async () => {
      const parse = vi.fn<Parse>().mockRejectedValue(new Error('Network error'))
      const { result } = renderParse(LINE_A, parse)

      advance(300)
      await settle()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('Network error')
    })

    it('passes a string rejection through as the message', async () => {
      const parse = vi.fn<Parse>().mockRejectedValue('Service unavailable')
      const { result } = renderParse(LINE_A, parse)

      advance(300)
      await settle()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('Service unavailable')
    })

    it('falls back to the shared failure message when the rejection carries none', async () => {
      const parse = vi.fn<Parse>().mockRejectedValue({})
      const { result } = renderParse(LINE_A, parse)

      advance(300)
      await settle()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('Request failed')
    })

    it('ignores a late rejection for an older text once a newer text was requested', async () => {
      const first = deferred<ParseResult>()
      const parse = vi
        .fn<Parse>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(RESULT_B)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      rerender({ text: LINE_B, fn: parse })
      advance(300)
      await settle()
      expect(result.current.status).toBe('done')

      await act(async () => {
        first.reject(new Error('Network error'))
      })
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)
      expect(result.current.error).toBeUndefined()
    })

    it('parses again after a failure when the text changes', async () => {
      const parse = vi
        .fn<Parse>()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(RESULT_B)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()
      expect(result.current.status).toBe('failed')

      rerender({ text: LINE_B, fn: parse })
      expect(result.current.status).toBe('pending')
      advance(300)
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_B)
      expect(result.current.error).toBeUndefined()
    })
  })

  describe('prime', () => {
    it('makes a primed text done at once with its result and never parses it', () => {
      const parse = vi.fn<Parse>()
      const { result, rerender } = renderParse('', parse)

      act(() => {
        result.current.prime(PEM_TEXT, RESULT_PRIMED)
      })
      rerender({ text: PEM_TEXT, fn: parse })

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_PRIMED)

      advance(1000)
      expect(parse).not.toHaveBeenCalled()
    })

    it('still parses a text that was not primed', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { result, rerender } = renderParse('', parse)

      act(() => {
        result.current.prime(PEM_TEXT, RESULT_PRIMED)
      })
      rerender({ text: LINE_A, fn: parse })

      expect(result.current.status).toBe('pending')
      advance(300)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(parse).toHaveBeenCalledWith(LINE_A)
    })

    it('ignores the response for the text it replaced', async () => {
      const inFlight = deferred<ParseResult>()
      const parse = vi.fn<Parse>().mockReturnValue(inFlight.promise)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      expect(parse).toHaveBeenCalledTimes(1)

      act(() => {
        result.current.prime(PEM_TEXT, RESULT_PRIMED)
      })
      rerender({ text: PEM_TEXT, fn: parse })
      await act(async () => {
        inFlight.resolve(RESULT_A)
      })
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.result).toEqual(RESULT_PRIMED)
      advance(1000)
      expect(parse).toHaveBeenCalledTimes(1)
    })
  })

  describe('last good result', () => {
    it('is undefined before any answer', () => {
      const parse = vi.fn<Parse>().mockReturnValue(new Promise<ParseResult>(() => {}))
      const { result } = renderParse(LINE_A, parse)

      expect(result.current.lastGoodResult).toBeUndefined()

      advance(300)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(result.current.lastGoodResult).toBeUndefined()
    })

    it('holds the answer once a parse resolves', async () => {
      const parse = vi.fn<Parse>().mockResolvedValue(RESULT_A)
      const { result } = renderParse(LINE_A, parse)

      advance(300)
      await settle()

      expect(result.current.result).toEqual(RESULT_A)
      expect(result.current.lastGoodResult).toEqual(RESULT_A)
    })

    it('is kept while a newer text is pending', async () => {
      const parse = vi
        .fn<Parse>()
        .mockResolvedValueOnce(RESULT_A)
        .mockReturnValueOnce(new Promise<ParseResult>(() => {}))
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()

      rerender({ text: LINE_B, fn: parse })
      expect(result.current.status).toBe('pending')
      expect(result.current.lastGoodResult).toEqual(RESULT_A)

      advance(300)
      expect(parse).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')
      expect(result.current.lastGoodResult).toEqual(RESULT_A)
    })

    it('is kept after a newer parse fails', async () => {
      const parse = vi
        .fn<Parse>()
        .mockResolvedValueOnce(RESULT_A)
        .mockRejectedValueOnce(new Error('Network error'))
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()

      rerender({ text: LINE_B, fn: parse })
      advance(300)
      await settle()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('Network error')
      expect(result.current.result).toBeUndefined()
      expect(result.current.lastGoodResult).toEqual(RESULT_A)
    })

    it('is replaced by the next success', async () => {
      const parse = vi
        .fn<Parse>()
        .mockResolvedValueOnce(RESULT_A)
        .mockResolvedValueOnce(RESULT_B)
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()
      expect(result.current.lastGoodResult).toEqual(RESULT_A)

      rerender({ text: LINE_B, fn: parse })
      advance(300)
      await settle()

      expect(result.current.status).toBe('done')
      expect(result.current.lastGoodResult).toEqual(RESULT_B)
    })

    it('is set by prime', () => {
      const parse = vi.fn<Parse>()
      const { result, rerender } = renderParse('', parse)

      act(() => {
        result.current.prime(PEM_TEXT, RESULT_PRIMED)
      })
      rerender({ text: PEM_TEXT, fn: parse })

      expect(result.current.lastGoodResult).toEqual(RESULT_PRIMED)

      advance(1000)
      expect(parse).not.toHaveBeenCalled()
    })

    it('is forgotten when the text goes blank', async () => {
      const parse = vi
        .fn<Parse>()
        .mockResolvedValueOnce(RESULT_A)
        .mockReturnValueOnce(new Promise<ParseResult>(() => {}))
      const { result, rerender } = renderParse(LINE_A, parse)
      advance(300)
      await settle()
      expect(result.current.lastGoodResult).toEqual(RESULT_A)

      rerender({ text: '', fn: parse })
      expect(result.current.status).toBe('idle')
      expect(result.current.lastGoodResult).toBeUndefined()

      rerender({ text: LINE_B, fn: parse })
      expect(result.current.status).toBe('pending')
      expect(result.current.lastGoodResult).toBeUndefined()
    })
  })
})
