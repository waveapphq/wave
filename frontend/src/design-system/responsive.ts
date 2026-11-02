/**
 * Responsive Layout Configuration
 *
 * REQ-5.2.1.17: Responsive layout with desktop and tablet breakpoints
 *
 * Implements responsive layout system following design specifications.
 */

// ===========================================================================
// Breakpoint Configuration
// ===========================================================================

export type BreakpointKey = 'sm' | 'md' | 'lg' | 'xl' | '2xl'
export type BreakpointWithBase = 'base' | BreakpointKey

export const breakpoints: Record<BreakpointKey, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

// ===========================================================================
// Sidebar Configuration
// ===========================================================================

export const sidebarConfig = {
  expandedWidth: 240,
  collapsedWidth: 64,
  visibilityThreshold: 1024,
} as const

// ===========================================================================
// Workflow Canvas Configuration
// ===========================================================================

export const canvasConfig = {
  interactionThreshold: 768,
} as const

// ===========================================================================
// Viewport Configuration
// ===========================================================================

export const viewportConfig = {
  resizeDebounceMs: 100,
} as const

// ===========================================================================
// Breakpoint Utility Functions
// ===========================================================================

export function getCurrentBreakpoint(viewportWidth: number): BreakpointWithBase {
  if (viewportWidth >= breakpoints['2xl']) return '2xl'
  if (viewportWidth >= breakpoints.xl) return 'xl'
  if (viewportWidth >= breakpoints.lg) return 'lg'
  if (viewportWidth >= breakpoints.md) return 'md'
  if (viewportWidth >= breakpoints.sm) return 'sm'
  return 'base'
}

export function isAtLeast(
  viewportWidth: number,
  breakpoint: BreakpointKey
): boolean {
  return viewportWidth >= breakpoints[breakpoint]
}

export function isBelow(
  viewportWidth: number,
  breakpoint: BreakpointKey
): boolean {
  return viewportWidth < breakpoints[breakpoint]
}
