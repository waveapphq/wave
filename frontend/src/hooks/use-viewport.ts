/**
 * useViewport Hook - REQ-5.2.1.17 Responsive layout viewport management
 *
 * Provides viewport state with breakpoint detection, resize handling,
 * and responsive helper methods.
 */

import { useEffect, useMemo, useCallback } from 'react'
import { useViewportStore } from '@/stores/viewport-store'
import {
  breakpoints,
  sidebarConfig,
  canvasConfig,
  viewportConfig,
  isAtLeast as isAtLeastFn,
  isBelow as isBelowFn,
  type BreakpointKey,
  type BreakpointWithBase,
} from '@/design-system/responsive'
import { isBrowser, detectTouchDevice } from '@/lib/utils'

interface UseViewportResult {
  width: number
  height: number
  breakpoint: BreakpointWithBase
  isAtLeast: (breakpoint: BreakpointKey) => boolean
  isBelow: (breakpoint: BreakpointKey) => boolean
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  sidebarShouldBeVisible: boolean
  canvasInteractionEnabled: boolean
  isTouchDevice: boolean
}

/**
 * Hook for accessing viewport state with responsive utilities
 */
export function useViewport(): UseViewportResult {
  const width = useViewportStore((state) => state.width)
  const height = useViewportStore((state) => state.height)
  const breakpoint = useViewportStore((state) => state.breakpoint)
  const updateDimensions = useViewportStore((state) => state.updateDimensions)
  const initialize = useViewportStore((state) => state.initialize)

  // Initialize store with current window dimensions on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Set up resize listener with debouncing
  useEffect(() => {
    if (!isBrowser()) {
      return
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const handleResize = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        updateDimensions(globalThis.innerWidth, globalThis.innerHeight)
        debounceTimer = null
      }, viewportConfig.resizeDebounceMs)
    }

    globalThis.addEventListener('resize', handleResize)

    return () => {
      globalThis.removeEventListener('resize', handleResize)
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
      }
    }
  }, [updateDimensions])

  // Memoized breakpoint comparison functions
  const isAtLeast = useCallback(
    (bp: BreakpointKey): boolean => isAtLeastFn(width, bp),
    [width]
  )

  const isBelow = useCallback(
    (bp: BreakpointKey): boolean => isBelowFn(width, bp),
    [width]
  )

  // Computed responsive properties
  const isMobile = useMemo(() => width < breakpoints.lg, [width])
  const isTablet = useMemo(
    () => width >= breakpoints.md && width < breakpoints.lg,
    [width]
  )
  const isDesktop = useMemo(() => width >= breakpoints.lg, [width])

  // Sidebar visibility based on lg breakpoint
  const sidebarShouldBeVisible = useMemo(
    () => width >= sidebarConfig.visibilityThreshold,
    [width]
  )

  // Canvas interaction based on md breakpoint
  const canvasInteractionEnabled = useMemo(
    () => width >= canvasConfig.interactionThreshold,
    [width]
  )

  // Touch device detection (cached)
  const isTouchDevice = useMemo(() => detectTouchDevice(), [])

  return {
    width,
    height,
    breakpoint,
    isAtLeast,
    isBelow,
    isMobile,
    isTablet,
    isDesktop,
    sidebarShouldBeVisible,
    canvasInteractionEnabled,
    isTouchDevice,
  }
}
