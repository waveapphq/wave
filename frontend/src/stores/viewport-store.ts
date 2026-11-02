/**
 * Viewport Store - REQ-5.2.1.17 Responsive layout state management
 *
 * Centralized viewport state management for responsive layout behavior.
 * Components subscribe to breakpoint changes rather than raw dimensions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  getCurrentBreakpoint,
  type BreakpointWithBase,
} from '@/design-system/responsive'
import { isBrowser } from '@/lib/utils'

interface ViewportState {
  width: number
  height: number
  breakpoint: BreakpointWithBase
  initialize: () => void
  updateDimensions: (width: number, height: number) => void
}

/**
 * Get initial window dimensions safely (SSR-safe)
 */
function getInitialDimensions(): { width: number; height: number } {
  if (!isBrowser()) {
    return { width: 1280, height: 800 } // Default for SSR
  }
  return { width: globalThis.innerWidth, height: globalThis.innerHeight }
}

/**
 * Zustand store for viewport state
 */
export const useViewportStore = create<ViewportState>()(
  subscribeWithSelector((set) => {
    const initial = getInitialDimensions()

    return {
      width: initial.width,
      height: initial.height,
      breakpoint: getCurrentBreakpoint(initial.width),

      initialize: () => {
        if (!isBrowser()) {
          return
        }
        const width = globalThis.innerWidth
        const height = globalThis.innerHeight
        set({
          width,
          height,
          breakpoint: getCurrentBreakpoint(width),
        })
      },

      updateDimensions: (width: number, height: number) => {
        set({
          width,
          height,
          breakpoint: getCurrentBreakpoint(width),
        })
      },
    }
  })
)
