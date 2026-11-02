/**
 * useCanvasRoute Hook
 *
 * Detects if current route is a canvas route that requires auto-collapsed sidebar.
 * Per SHELL-6, canvas routes auto-collapse the sidebar
 * to provide maximum workspace.
 *
 * Canvas Routes (trigger auto-collapse):
 * - /workbench - Live workbench (creates a new test / opens a draft)
 * - /workbench/:blockId - Live workbench editing a specific entity
 * - /executions/history/:runId - Historical test canvas (per-run)
 *
 * Non-Canvas Routes (respect user preference):
 * - List pages, dashboard, settings, detail pages, etc.
 */

import { useLocation } from 'react-router-dom'

/**
 * Checks if a pathname is a canvas route
 * @param pathname - The URL pathname to check
 * @returns true if the pathname is a canvas route
 */
export function isCanvasRoute(pathname: string): boolean {
  // Normalize pathname by removing trailing slash (except for empty string)
  const normalizedPath = pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname

  // /workbench - live workbench (exact match)
  if (normalizedPath === '/workbench') {
    return true
  }

  // /workbench/:blockId - live workbench editing a specific entity
  const workbenchMatch = /^\/workbench\/([^/]+)$/.exec(normalizedPath)
  if (workbenchMatch?.[1]) {
    return true
  }

  // /executions/history/:runId - historical test canvas (per-run)
  if (/^\/executions\/history\/[^/]+$/.test(normalizedPath)) {
    return true
  }

  return false
}

/**
 * Hook to detect if current route is a canvas route
 * @returns true if current route is a canvas route
 */
export function useCanvasRoute(): boolean {
  const location = useLocation()
  return isCanvasRoute(location.pathname)
}
