/**
 * Preload Registry - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Manages predictive preloading of route components based on navigation patterns.
 * Supports priority-based preloading for optimized user experience.
 */

import { useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Registry of lazy-loaded components and their preload functions
type PreloadFunction = () => Promise<unknown>
const preloadFunctions = new Map<string, PreloadFunction>()
const preloadedComponents = new Set<string>()

/**
 * Register a component's preload function
 */
export function registerPreloadFunction(componentName: string, preloadFn: PreloadFunction): void {
  preloadFunctions.set(componentName, preloadFn)
}

/**
 * Hook for managing route preloading
 */
export function usePreloadRegistry() {
  const location = useLocation()

  /**
   * Preload a detail page component
   */
  const preloadDetailPage = useCallback((componentName: string) => {
    const preloadFn = preloadFunctions.get(componentName)
    if (preloadFn && !preloadedComponents.has(componentName)) {
      preloadedComponents.add(componentName)
      preloadFn().catch(() => {
        // Remove from preloaded set on failure so it can be retried
        preloadedComponents.delete(componentName)
      })
    }
  }, [])

  /**
   * Preload an edit page component
   */
  const preloadEditPage = useCallback((componentName: string) => {
    const preloadFn = preloadFunctions.get(componentName)
    if (preloadFn && !preloadedComponents.has(componentName)) {
      preloadedComponents.add(componentName)
      preloadFn().catch(() => {
        preloadedComponents.delete(componentName)
      })
    }
  }, [])

  /**
   * Preload a live/streaming page component
   */
  const preloadLivePage = useCallback((componentName: string) => {
    const preloadFn = preloadFunctions.get(componentName)
    if (preloadFn && !preloadedComponents.has(componentName)) {
      preloadedComponents.add(componentName)
      preloadFn().catch(() => {
        preloadedComponents.delete(componentName)
      })
    }
  }, [])

  /**
   * Generic route preloading
   */
  const preloadRoute = useCallback((routeName: string) => {
    const preloadFn = preloadFunctions.get(routeName)
    if (preloadFn && !preloadedComponents.has(routeName)) {
      preloadedComponents.add(routeName)
      preloadFn().catch(() => {
        preloadedComponents.delete(routeName)
      })
    }
  }, [])

  /**
   * Preload with priority
   */
  const preloadWithPriority = useCallback((componentName: string, priority: 'high' | 'low') => {
    const preloadFn = preloadFunctions.get(componentName)
    if (preloadFn && !preloadedComponents.has(componentName)) {
      if (priority === 'high') {
        // Preload immediately
        preloadedComponents.add(componentName)
        preloadFn().catch(() => {
          preloadedComponents.delete(componentName)
        })
      } else {
        // Defer low-priority preloads
        requestIdleCallback(() => {
          if (!preloadedComponents.has(componentName)) {
            preloadedComponents.add(componentName)
            preloadFn().catch(() => {
              preloadedComponents.delete(componentName)
            })
          }
        })
      }
    }
  }, [])

  /**
   * Register a preload hint for future use
   */
  const registerPreloadHint = useCallback((_hint: { from: string; to: string; priority: 'high' | 'low' }) => {
    // Store hint for future navigation pattern prediction
    // This could be stored in localStorage or a context for persistence
  }, [])

  // Predictive preloading based on current location
  useEffect(() => {
    const pathname = location.pathname

    // On list pages, preload detail pages
    if (pathname === '/tests') {
      preloadDetailPage('test-detail')
      preloadWithPriority('test-create', 'low')
    } else if (pathname === '/suites') {
      preloadDetailPage('suite-detail')
      preloadWithPriority('suite-create', 'low')
    } else if (pathname === '/executions') {
      preloadDetailPage('execution-detail')
    }

    // On detail pages, preload related pages
    if (/^\/tests\/[^/]+$/.exec(pathname)) {
      preloadEditPage('test-edit')
    } else if (/^\/executions\/[^/]+$/.exec(pathname)) {
      preloadLivePage('execution-live')
    }
  }, [location.pathname, preloadDetailPage, preloadEditPage, preloadLivePage, preloadWithPriority])

  return {
    preloadDetailPage,
    preloadEditPage,
    preloadLivePage,
    preloadRoute,
    preloadWithPriority,
    registerPreloadHint,
  }
}

// Polyfill for requestIdleCallback - use built-in type or fallback
// The ternary branches are evaluated at module load time based on environment
const requestIdleCallback: (callback: () => void) => number =
  globalThis.window !== undefined && 'requestIdleCallback' in globalThis.window
    ? (callback: () => void) => globalThis.window.requestIdleCallback(() => callback())
    : (callback: () => void) => globalThis.window.setTimeout(callback, 1) as unknown as number
