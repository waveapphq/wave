/**
 * Route Utils Tests
 *
 * Tests for shared route utility functions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  prefersReducedMotion,
  isValidReturnUrl,
  isKnownRoute,
} from '@/lib/route-utils'

describe('isValidReturnUrl', () => {
  it('accepts valid relative paths', () => {
    expect(isValidReturnUrl('/tests')).toBe(true)
    expect(isValidReturnUrl('/workbench?editTest=123')).toBe(true)
    expect(isValidReturnUrl('/settings')).toBe(true)
  })

  it('rejects non-relative URLs', () => {
    expect(isValidReturnUrl('https://evil.com')).toBe(false)
    expect(isValidReturnUrl('http://evil.com')).toBe(false)
    expect(isValidReturnUrl('ftp://evil.com')).toBe(false)
  })

  it('rejects javascript: protocol URLs', () => {
    expect(isValidReturnUrl('/JavaScript:alert(1)')).toBe(false)
    expect(isValidReturnUrl('/javascript:void(0)')).toBe(false)
  })

  it('rejects protocol-relative URLs (double slash)', () => {
    expect(isValidReturnUrl('//evil.com')).toBe(false)
    expect(isValidReturnUrl('//evil.com/path')).toBe(false)
  })

  it('accepts valid path /dashboard', () => {
    expect(isValidReturnUrl('/dashboard')).toBe(true)
  })

  it('rejects JAVASCRIPT: in uppercase (case insensitive)', () => {
    expect(isValidReturnUrl('/JAVASCRIPT:alert(1)')).toBe(false)
  })

  it('rejects javascript with space before colon', () => {
    expect(isValidReturnUrl('/javascript :void(0)')).toBe(false)
  })

  it('rejects URLs that do not start with /', () => {
    expect(isValidReturnUrl('dashboard')).toBe(false)
    expect(isValidReturnUrl('relative/path')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidReturnUrl('')).toBe(false)
  })
})

describe('prefersReducedMotion', () => {
  const originalMatchMedia = globalThis.matchMedia

  afterEach(() => {
    globalThis.matchMedia = originalMatchMedia
  })

  it('returns false when matchMedia returns no match', () => {
    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false })
    expect(prefersReducedMotion()).toBe(false)
  })

  it('returns true when matchMedia matches reduced motion', () => {
    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: true })
    expect(prefersReducedMotion()).toBe(true)
  })

  it('returns false when matchMedia is not a function', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.matchMedia = undefined as any
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('isKnownRoute', () => {
  it.each([
    '/',
    '/tests',
    '/tests/new',
    '/tests/abc-123',
    '/suites',
    '/regressions',
    '/executions',
    '/executions/abc-123',
    '/executions/history/run-abc-123',
    '/profiles',
    '/settings',
    '/settings/Other-1',
    '/settings/network/ssh-hosts',
    '/settings/network/Other-1',
    '/settings/network/certificates',
    '/settings/network/proxy',
    '/settings/network/proxy/setup',
    '/settings/network/proxy/blocks',
    '/settings/network/proxy/Other-1',
    '/workbench',
    '/functions',
    '/functions/fn-123',
  ])('recognizes known route: %s', (route) => {
    expect(isKnownRoute(route)).toBe(true)
  })

  it('no longer recognizes the removed /blocks routes', () => {
    expect(isKnownRoute('/blocks')).toBe(false)
    expect(isKnownRoute('/blocks/abc')).toBe(false)
  })

  it('does not recognize a further part under a Proxy page', () => {
    expect(isKnownRoute('/settings/network/proxy/setup/x')).toBe(false)
  })

  it('returns false for unknown route', () => {
    expect(isKnownRoute('/unknown')).toBe(false)
  })
})
