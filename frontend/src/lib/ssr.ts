/**
 * SSR Detection Utilities
 *
 * Provides utilities for detecting server-side rendering environment.
 * These functions are extracted for modularity and consistent SSR checks.
 */

/**
 * Check if code is running in a server-side rendering environment
 * @returns true if window is undefined (SSR), false otherwise
 */
export function isSSR(): boolean {
  return globalThis.window === undefined
}

/**
 * Get the current globalThis.location.hash safely
 * @returns The hash string or empty string if in SSR
 */
export function getWindowLocationHash(): string {
  if (isSSR()) return ''
  return globalThis.location.hash
}
