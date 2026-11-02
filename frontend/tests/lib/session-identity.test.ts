/**
 * Session Identity Tests
 *
 * getSessionId mints a stable per-tab UUID; getSessionLabel derives a
 * "{Browser} ({OS})" connection label from the User-Agent, matching the
 * server-derived roster label (REQ-5.2.7.15).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import {
  getOwnSessionIds,
  getSessionId,
  getSessionLabel,
  rememberOwnSession,
} from '@/lib/session-identity'

function stubUserAgent(userAgent: string | undefined): void {
  vi.stubGlobal('navigator', userAgent === undefined ? undefined : { userAgent })
}

describe('session-identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getSessionId', () => {
    it('returns a stable id across calls', () => {
      const first = getSessionId()
      const second = getSessionId()
      expect(first).toBe(second)
      expect(first).toMatch(/[0-9a-f-]{36}/i)
    })
  })

  /**
   * The tab's participant identity survives a reload and dies with the
   * tab, and a tab duplicated from another takes a fresh one so the
   * single-active-session guarantee cannot be broken by copying a tab.
   */
  describe('per-tab identity across reloads', () => {
    const TAB_KEY = 'wave.tab-session-id'
    const LIVE_KEY = 'wave.live-tab-ids'

    /** A fresh page load in the same tab: the module starts over, storage does not. */
    async function loadPage(): Promise<typeof import('@/lib/session-identity')> {
      vi.resetModules()
      return import('@/lib/session-identity')
    }

    function liveIds(): string[] {
      return JSON.parse(localStorage.getItem(LIVE_KEY) ?? '[]') as string[]
    }

    beforeEach(() => {
      vi.unstubAllGlobals()
      localStorage.clear()
      sessionStorage.clear()
    })

    it('persists the minted id to per-tab storage', async () => {
      const identity = await loadPage()

      const id = identity.getSessionId()

      expect(sessionStorage.getItem(TAB_KEY)).toBe(id)
    })

    it('registers the id as live for the other tabs to see', async () => {
      const identity = await loadPage()

      const id = identity.getSessionId()

      expect(liveIds()).toContain(id)
    })

    it('releases the live claim when the page goes away', async () => {
      const identity = await loadPage()
      const id = identity.getSessionId()

      globalThis.dispatchEvent(new Event('pagehide'))

      expect(liveIds()).not.toContain(id)
      expect(sessionStorage.getItem(TAB_KEY)).toBe(id)
    })

    it('comes back as the same participant after a reload', async () => {
      const first = await loadPage()
      const original = first.getSessionId()
      globalThis.dispatchEvent(new Event('pagehide'))

      const second = await loadPage()

      expect(second.getSessionId()).toBe(original)
      expect(liveIds()).toContain(original)
    })

    it('names each page load apart', async () => {
      const first = await loadPage()
      const firstPage = first.getPageId()

      const second = await loadPage()

      expect(first.getPageId()).toBe(firstPage)
      expect(firstPage).toMatch(/[0-9a-f-]{36}/i)
      expect(second.getPageId()).not.toBe(firstPage)
      expect(second.getPageId()).toBe(second.getPageId())
    })

    it('takes a fresh identity when the stored one is already live elsewhere', async () => {
      // A duplicated tab copies per-tab storage while the source tab is still
      // running, so the stored id is still claimed.
      const source = await loadPage()
      const sourceId = source.getSessionId()

      const duplicate = await loadPage()
      const duplicateId = duplicate.getSessionId()

      expect(duplicateId).not.toBe(sourceId)
      expect(sessionStorage.getItem(TAB_KEY)).toBe(duplicateId)
      expect(liveIds()).toEqual(expect.arrayContaining([sourceId, duplicateId]))
    })

    it('keeps the fresh identity stable for the rest of that load', async () => {
      const source = await loadPage()
      source.getSessionId()

      const duplicate = await loadPage()

      expect(duplicate.getSessionId()).toBe(duplicate.getSessionId())
    })

    it('falls back to a per-load identity when per-tab storage is unavailable', async () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      })
      const identity = await loadPage()

      const id = identity.getSessionId()

      expect(id).toMatch(/[0-9a-f-]{36}/i)
      expect(identity.getSessionId()).toBe(id)
    })

    it('mints a new identity per load when per-tab storage is unavailable', async () => {
      vi.stubGlobal('sessionStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      })
      const first = await loadPage()
      const firstId = first.getSessionId()

      const second = await loadPage()

      expect(second.getSessionId()).not.toBe(firstId)
    })

    it('still returns a stable id when the cross-tab store is unavailable', async () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      })
      const identity = await loadPage()

      const id = identity.getSessionId()

      expect(id).toMatch(/[0-9a-f-]{36}/i)
      expect(identity.getSessionId()).toBe(id)
    })
  })

  describe('getSessionLabel', () => {
    const CASES: ReadonlyArray<[string, string]> = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Chrome (Windows)',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Chrome (macOS)',
      ],
      [
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Chrome (Linux)',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Firefox (Windows)',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Safari (macOS)',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Edge (Windows)',
      ],
      [
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Chrome (Android)',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
        'Safari (iOS)',
      ],
      [
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Chrome',
      ],
      ['curl/8.4.0', 'Browser'],
      ['', 'Browser'],
    ]

    it.each(CASES)('derives the label for %s', (userAgent, expected) => {
      stubUserAgent(userAgent)
      expect(getSessionLabel()).toBe(expected)
    })

    it('falls back to "Browser" when navigator is unavailable', () => {
      stubUserAgent(undefined)
      expect(getSessionLabel()).toBe('Browser')
    })
  })

  describe('own session ids', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('is empty before anything is remembered', () => {
      expect(getOwnSessionIds().size).toBe(0)
    })

    it('remembers ids across calls (shared via localStorage)', () => {
      rememberOwnSession('a')
      rememberOwnSession('b')
      const ids = getOwnSessionIds()
      expect(ids.has('a')).toBe(true)
      expect(ids.has('b')).toBe(true)
      expect(getOwnSessionIds().has('c')).toBe(false)
    })

    it('caps the set, keeping the most recent ids', () => {
      for (let i = 0; i < 105; i++) rememberOwnSession(`id-${i}`)
      const ids = getOwnSessionIds()
      expect(ids.size).toBe(100)
      expect(ids.has('id-104')).toBe(true)
      expect(ids.has('id-0')).toBe(false)
    })

    it('degrades gracefully when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      })
      expect(() => rememberOwnSession('x')).not.toThrow()
      expect(getOwnSessionIds().size).toBe(0)
    })
  })
})
