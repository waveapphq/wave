/**
 * Utility functions for the frontend
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { plainNumberText } from '@/lib/number-rule'

/**
 * Merge Tailwind CSS classes with proper precedence
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// ===========================================================================
// Cryptographically Secure Random Utilities
// ===========================================================================

const UINT32_RANGE = 0x100000000

/** Return a random float in [0, 1) using crypto.getRandomValues */
export function secureRandom(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / UINT32_RANGE
}

/** Return an unbiased random integer in [0, bound) for a whole bound from 1 to 2^32 */
export function secureRandomInt(bound: number): number {
  // A draw at or past the last full multiple of bound is redrawn, so no result is favored.
  const limit = UINT32_RANGE - (UINT32_RANGE % bound)
  for (;;) {
    const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1))
    if (value < limit) return value % bound
  }
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Return a random alphanumeric string of the given length */
export function secureRandomId(length: number = 7): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += ID_CHARS[secureRandomInt(ID_CHARS.length)]
  }
  return result
}

/** Generate a unique ID with a prefix, timestamp, and random suffix */
export function generateUniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${secureRandomId(7)}`
}

// ===========================================================================
// Safe Stringification
// ===========================================================================

/**
 * Safely convert an unknown value to a string, handling objects with JSON.stringify.
 * Returns empty string for null/undefined; a number in plain digits (REQ-3.1.3.14).
 */
export function safeStringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') return plainNumberText(value)
  return String(value as string | boolean)
}

// ===========================================================================
// SSR Safety Utilities
// ===========================================================================

/**
 * Check if code is running in a browser environment
 * Returns false during SSR (Server-Side Rendering) when window is undefined
 */
export function isBrowser(): boolean {
  return globalThis.window !== undefined
}

/**
 * Detect if the device has touch capability
 * Returns false if window is undefined (SSR) or no touch capability detected
 */
export function detectTouchDevice(): boolean {
  if (!isBrowser()) {
    return false
  }
  // The standards check; ontouchstart-style heuristics false-positive on
  // desktops (and jsdom) that expose touch events without touch hardware.
  return navigator.maxTouchPoints > 0
}
