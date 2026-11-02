/**
 * Platform Detection Utilities
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Shared utilities for platform-aware keyboard shortcut display.
 * Used by hint bar, context menus, and shortcut labels.
 */

/**
 * Detects whether the current platform is macOS.
 * Uses navigator.userAgent to detect Mac platform.
 */
export function isMac(): boolean {
  return navigator.userAgent.includes('Macintosh')
}

/**
 * Returns the display label for the primary modifier key.
 * "⌘" on macOS, "Ctrl" on Windows/Linux.
 */
export function getModifierLabel(): string {
  return isMac() ? '⌘' : 'Ctrl'
}

/**
 * Returns the DOM event modifier key name.
 * "Meta" on macOS (event.metaKey), "Control" on Windows/Linux (event.ctrlKey).
 */
export function getModifierKey(): string {
  return isMac() ? 'Meta' : 'Control'
}

/**
 * Formats a shortcut key with the platform modifier prefix.
 * Examples:
 *   formatShortcut('C')       → "⌘C" (Mac) or "Ctrl+C" (Win/Linux)
 *   formatShortcut('Shift+Z') → "⌘Shift+Z" (Mac) or "Ctrl+Shift+Z" (Win/Linux)
 */
export function formatShortcut(key: string): string {
  const mod = getModifierLabel()
  return isMac() ? `${mod}${key}` : `${mod}+${key}`
}
