/**
 * Navigation Patterns - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tracks navigation patterns for predictive preloading and analytics.
 * Learns user behavior to optimize route loading.
 */

import { useCallback, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Store navigation patterns: from -> to -> count
const navigationPatterns = new Map<string, Map<string, number>>()

// Maximum patterns to store per source route
const MAX_PATTERNS_PER_SOURCE = 10

/**
 * Hook for tracking and predicting navigation patterns
 */
export function useNavigationPatterns() {
  const location = useLocation()
  const previousPath = useRef<string | null>(null)

  /**
   * Register a navigation pattern
   */
  const registerPattern = useCallback((from: string, to: string) => {
    let toPatterns = navigationPatterns.get(from)
    if (!toPatterns) {
      toPatterns = new Map()
      navigationPatterns.set(from, toPatterns)
    }

    const currentCount = toPatterns.get(to) || 0
    toPatterns.set(to, currentCount + 1)

    // Prune if too many patterns stored
    if (toPatterns.size > MAX_PATTERNS_PER_SOURCE) {
      // Find and remove the least common pattern
      let minKey: string | null = null
      let minCount = Infinity
      toPatterns.forEach((count, key) => {
        if (count < minCount) {
          minCount = count
          minKey = key
        }
      })
      if (minKey) {
        toPatterns.delete(minKey)
      }
    }
  }, [])

  /**
   * Get suggested routes to preload based on navigation patterns
   */
  const getPreloadSuggestions = useCallback((currentPath: string): string[] => {
    const patterns = navigationPatterns.get(currentPath)
    if (!patterns) {
      return []
    }

    // Sort by frequency and return top suggestions
    const sorted = Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([path]) => path)

    return sorted
  }, [])

  // Track navigation patterns automatically
  useEffect(() => {
    if (previousPath.current && previousPath.current !== location.pathname) {
      registerPattern(previousPath.current, location.pathname)
    }
    previousPath.current = location.pathname
  }, [location.pathname, registerPattern])

  return {
    registerPattern,
    getPreloadSuggestions,
  }
}
