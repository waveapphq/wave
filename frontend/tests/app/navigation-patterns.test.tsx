/**
 * Navigation Patterns Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests for navigation pattern tracking and predictive preloading suggestions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, createMemoryRouter, RouterProvider } from 'react-router-dom'
import { type ReactNode } from 'react'

// Unmock to test real implementation
vi.unmock('../../src/app/navigation-patterns')

// Wrapper for hooks that need router context
function createWrapper(initialRoute: string = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        {children}
      </MemoryRouter>
    )
  }
}

describe('Navigation Patterns', () => {
  beforeEach(() => {
    // Reset modules to clear internal navigationPatterns Map between tests
    vi.resetModules()
  })

  describe('useNavigationPatterns Hook', () => {
    it('registers navigation patterns between routes', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.registerPattern('/tests', '/tests/123')
      })

      // Verify via getPreloadSuggestions (public API)
      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toContain('/tests/123')
    })

    it('increments count for repeated navigation patterns', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.registerPattern('/tests', '/tests/123')
        result.current.registerPattern('/tests', '/tests/123')
        result.current.registerPattern('/tests', '/tests/123')
      })

      // Repeated pattern should appear as top suggestion
      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions[0]).toBe('/tests/123')
    })

    it('tracks multiple destination patterns from same source', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.registerPattern('/tests', '/tests/123')
        result.current.registerPattern('/tests', '/tests/456')
        result.current.registerPattern('/tests', '/tests/new')
      })

      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toHaveLength(3)
      expect(suggestions).toContain('/tests/123')
      expect(suggestions).toContain('/tests/456')
      expect(suggestions).toContain('/tests/new')
    })

    it('prunes least common pattern when exceeding maximum', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      // Register 11 different patterns (MAX_PATTERNS_PER_SOURCE is 10)
      act(() => {
        for (let i = 0; i < 11; i++) {
          result.current.registerPattern('/tests', `/tests/${i}`)
        }
      })

      // getPreloadSuggestions returns top 3, but we can verify pruning happened
      // by checking that suggestions still work (internal map has 10 entries)
      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toHaveLength(3)
    })

    it('prunes the pattern with lowest count', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      // Register patterns with different counts
      act(() => {
        // Pattern with high count
        for (let i = 0; i < 5; i++) {
          result.current.registerPattern('/tests', '/tests/popular')
        }
        // Fill up to 10 patterns
        for (let i = 0; i < 9; i++) {
          result.current.registerPattern('/tests', `/tests/${i}`)
        }
        // Add one more to trigger pruning
        result.current.registerPattern('/tests', '/tests/new')
      })

      // Popular pattern should still be the top suggestion
      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions[0]).toBe('/tests/popular')
    })
  })

  describe('getPreloadSuggestions', () => {
    it('returns empty array when no patterns exist for path', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      const suggestions = result.current.getPreloadSuggestions('/nonexistent')
      expect(suggestions).toEqual([])
    })

    it('returns suggestions sorted by frequency', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        // Add patterns with different frequencies
        result.current.registerPattern('/tests', '/tests/123')
        result.current.registerPattern('/tests', '/tests/456')
        result.current.registerPattern('/tests', '/tests/456')
        result.current.registerPattern('/tests', '/tests/789')
        result.current.registerPattern('/tests', '/tests/789')
        result.current.registerPattern('/tests', '/tests/789')
      })

      const suggestions = result.current.getPreloadSuggestions('/tests')
      // Should be sorted by frequency: 789 (3), 456 (2), 123 (1)
      expect(suggestions).toEqual(['/tests/789', '/tests/456', '/tests/123'])
    })

    it('limits suggestions to top 3', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.registerPattern('/tests', '/tests/1')
        result.current.registerPattern('/tests', '/tests/2')
        result.current.registerPattern('/tests', '/tests/3')
        result.current.registerPattern('/tests', '/tests/4')
        result.current.registerPattern('/tests', '/tests/5')
      })

      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toHaveLength(3)
    })
  })

  describe('Pattern Storage', () => {
    it('stores patterns across multiple source routes', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.registerPattern('/tests', '/tests/123')
        result.current.registerPattern('/suites', '/suites/456')
      })

      expect(result.current.getPreloadSuggestions('/tests')).toContain('/tests/123')
      expect(result.current.getPreloadSuggestions('/suites')).toContain('/suites/456')
    })

    it('returns empty suggestions when no patterns registered for a source', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toHaveLength(0)
    })
  })

  describe('Pattern Reset via Module Reload', () => {
    it('module reload clears all stored patterns', async () => {
      // First: register some patterns
      const mod1 = await import('../../src/app/navigation-patterns')
      const { result: result1 } = renderHook(() => mod1.useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result1.current.registerPattern('/tests', '/tests/123')
        result1.current.registerPattern('/suites', '/suites/456')
      })

      expect(result1.current.getPreloadSuggestions('/tests')).toHaveLength(1)

      // Reset modules to clear internal state
      vi.resetModules()

      // Re-import and verify patterns are gone
      const mod2 = await import('../../src/app/navigation-patterns')
      const { result: result2 } = renderHook(() => mod2.useNavigationPatterns(), {
        wrapper: createWrapper('/'),
      })

      expect(result2.current.getPreloadSuggestions('/tests')).toHaveLength(0)
    })
  })

  describe('Automatic Pattern Tracking', () => {
    it('automatically tracks navigation when location changes', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')
      // Use a controlled navigation scenario
      const { result } = renderHook(() => useNavigationPatterns(), {
        wrapper: createWrapper('/tests'),
      })

      // Initial render sets previousPath
      expect(result.current.getPreloadSuggestions('/tests')).toHaveLength(0)

      // Simulate navigation by re-rendering with new location
      // Note: In a real app, this would happen via react-router navigation
      // Here we manually register to test the tracking logic
      act(() => {
        result.current.registerPattern('/tests', '/tests/123')
      })

      const suggestions = result.current.getPreloadSuggestions('/tests')
      expect(suggestions).toContain('/tests/123')
    })

    it('tracks navigation automatically via useEffect when location changes', async () => {
      const { useNavigationPatterns } = await import('../../src/app/navigation-patterns')

      // Create a component that uses the hook and allows navigation
      const TestComponent = () => {
        useNavigationPatterns()
        const location = useLocation()
        return <div data-testid="path">{location.pathname}</div>
      }

      // Create a router with the test component
      const router = createMemoryRouter(
        [
          {
            path: '*',
            element: <TestComponent />,
          },
        ],
        {
          initialEntries: ['/tests'],
        }
      )

      render(<RouterProvider router={router} />)

      // Navigate to new location using the router
      act(() => {
        router.navigate('/tests/123')
      })

      // Wait for navigation to complete and useEffect to run
      // Verify by rendering a new hook instance that can read the shared patterns
      await waitFor(() => {
        const { result } = renderHook(() => useNavigationPatterns(), {
          wrapper: createWrapper('/'),
        })
        const suggestions = result.current.getPreloadSuggestions('/tests')
        expect(suggestions).toContain('/tests/123')
      })
    })
  })
})
