/**
 * Route Utilities
 *
 * Utility functions and constants for route handling.
 */

import { isSSR } from '@/lib/ssr'

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (isSSR()) return false
  if (typeof globalThis.matchMedia !== 'function') return false
  const mediaQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
  return mediaQuery?.matches ?? false
}

/**
 * Helper to validate returnUrl to prevent open redirect attacks
 */
export function isValidReturnUrl(url: string): boolean {
  if (!url.startsWith('/')) return false
  if (/\bjavascript\s*:/i.test(url)) return false
  if (url.startsWith('//')) return false
  return true
}

/**
 * Known route patterns for determining if current path is a 404
 */
const KNOWN_ROUTES = [
  /^\/$/,
  /^\/login$/,
  /^\/dashboard$/,
  /^\/tests$/,
  /^\/tests\/new$/,
  // /tests/:testId currently returns 404 at the router level, but the shell
  // should still render (with sidebar + breadcrumb) so the not-found page
  // does not look like a broken application.
  /^\/tests\/[^/]+$/,
  /^\/suites$/,
  /^\/suites\/new$/,
  /^\/suites\/[^/]+$/,
  /^\/suites\/[^/]+\/edit$/,
  /^\/regressions$/,
  /^\/regressions\/new$/,
  /^\/regressions\/[^/]+$/,
  /^\/regressions\/[^/]+\/edit$/,
  /^\/executions$/,
  /^\/executions\/[^/]+$/,
  /^\/executions\/[^/]+\/live$/,
  /^\/executions\/history\/[^/]+$/,
  /^\/settings(\/[^/]+)?$/,
  /^\/settings\/network\/[^/]+$/,
  /^\/settings\/network\/proxy\/[^/]+$/,
  /^\/workbench$/,
  /^\/workbench\/[^/]+$/,
  /^\/user$/,
  /^\/functions$/,
  /^\/functions\/[^/]+$/,
  /^\/profiles$/,
  /^\/profiles\/new$/,
  /^\/profiles\/[^/]+$/,
  /^\/profiles\/[^/]+\/edit$/,
  /^\/reports$/,
  /^\/reports\/[^/]+$/,
  /^\/artifacts$/,
  /^\/artifacts\/[^/]+$/,
]

/**
 * Check if a pathname matches a known route
 */
export function isKnownRoute(pathname: string): boolean {
  return KNOWN_ROUTES.some((pattern) => pattern.test(pathname))
}
