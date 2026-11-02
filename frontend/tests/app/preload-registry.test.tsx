/**
 * Preload Registry Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests for route preloading functionality.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Unmock to test real implementation
vi.unmock('../../src/app/preload-registry')

// Mock requestIdleCallback
const originalRequestIdleCallback = globalThis.requestIdleCallback

beforeEach(() => {
  // Reset modules to clear internal preload state between tests
  vi.resetModules()

  // Mock requestIdleCallback to execute immediately
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    callback()
    return 1
  })
})

afterEach(() => {
  if (originalRequestIdleCallback) {
    vi.stubGlobal('requestIdleCallback', originalRequestIdleCallback)
  }
  vi.restoreAllMocks()
})

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

// Helper to get fresh module with registerPreloadFunction and usePreloadRegistry
async function importModule() {
  return await import('../../src/app/preload-registry')
}

describe('Preload Registry', () => {
  describe('registerPreloadFunction', () => {
    it('registers a preload function for a component', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('test-component', preloadFn)

      const { result } = renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/'),
      })

      act(() => {
        result.current.preloadRoute('test-component')
      })

      expect(preloadFn).toHaveBeenCalled()
    })
  })

  describe('usePreloadRegistry Hook', () => {
    describe('preloadDetailPage', () => {
      it('preloads a detail page component', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        mod.registerPreloadFunction('detail-page', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadDetailPage('detail-page')
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('does not preload same component twice', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        mod.registerPreloadFunction('detail-once', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadDetailPage('detail-once')
          result.current.preloadDetailPage('detail-once')
        })

        expect(preloadFn).toHaveBeenCalledTimes(1)
      })

      it('retries preload after failure', async () => {
        const mod = await importModule()
        let callCount = 0
        const preloadFn = vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.reject(new Error('Load failed'))
          }
          return Promise.resolve({})
        })
        mod.registerPreloadFunction('detail-retry', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        // First call fails
        await act(async () => {
          result.current.preloadDetailPage('detail-retry')
          // Wait for rejection to be handled
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        // Second call should work after failure cleared the preloaded flag
        await act(async () => {
          result.current.preloadDetailPage('detail-retry')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalledTimes(2)
      })
    })

    describe('preloadEditPage', () => {
      it('preloads an edit page component', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        mod.registerPreloadFunction('edit-page', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadEditPage('edit-page')
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('handles preload failure gracefully', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockRejectedValue(new Error('Load failed'))
        mod.registerPreloadFunction('edit-fail', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        // Should not throw
        await act(async () => {
          result.current.preloadEditPage('edit-fail')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalled()
      })
    })

    describe('preloadLivePage', () => {
      it('preloads a live page component', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        mod.registerPreloadFunction('live-page', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadLivePage('live-page')
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('handles preload failure gracefully', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockRejectedValue(new Error('Load failed'))
        mod.registerPreloadFunction('live-fail', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadLivePage('live-fail')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalled()
      })
    })

    describe('preloadRoute', () => {
      it('preloads a generic route component', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        mod.registerPreloadFunction('generic-route', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadRoute('generic-route')
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('does nothing for unregistered component', async () => {
        const mod = await importModule()
        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        // Should not throw
        act(() => {
          result.current.preloadRoute('nonexistent-route')
        })

        expect(result.current.preloadRoute).toBeDefined()
      })

      it('handles preload failure gracefully', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockRejectedValue(new Error('Load failed'))
        mod.registerPreloadFunction('route-fail', preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadRoute('route-fail')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalled()
      })
    })

    describe('preloadWithPriority', () => {
      it('preloads high priority components immediately', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        const componentName = `high-priority-${Date.now()}`
        mod.registerPreloadFunction(componentName, preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        act(() => {
          result.current.preloadWithPriority(componentName, 'high')
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('defers low priority components via requestIdleCallback', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        const componentName = `low-priority-${Date.now()}`
        mod.registerPreloadFunction(componentName, preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadWithPriority(componentName, 'low')
          // Wait for requestIdleCallback to execute
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        // With mocked requestIdleCallback, it executes
        expect(preloadFn).toHaveBeenCalled()
      })

      it('handles high priority preload failure', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockRejectedValue(new Error('Failed'))
        const componentName = `high-fail-${Date.now()}`
        mod.registerPreloadFunction(componentName, preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadWithPriority(componentName, 'high')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('handles low priority preload failure', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockRejectedValue(new Error('Failed'))
        const componentName = `low-fail-${Date.now()}`
        mod.registerPreloadFunction(componentName, preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadWithPriority(componentName, 'low')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalled()
      })

      it('does not preload already preloaded component', async () => {
        const mod = await importModule()
        const preloadFn = vi.fn().mockResolvedValue({})
        const componentName = `priority-once-${Date.now()}`
        mod.registerPreloadFunction(componentName, preloadFn)

        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        await act(async () => {
          result.current.preloadWithPriority(componentName, 'high')
          await new Promise(resolve => setTimeout(resolve, 10))
          result.current.preloadWithPriority(componentName, 'low')
          await new Promise(resolve => setTimeout(resolve, 10))
        })

        expect(preloadFn).toHaveBeenCalledTimes(1)
      })
    })

    describe('registerPreloadHint', () => {
      it('accepts preload hints', async () => {
        const mod = await importModule()
        const { result } = renderHook(() => mod.usePreloadRegistry(), {
          wrapper: createWrapper('/'),
        })

        // Should not throw
        act(() => {
          result.current.registerPreloadHint({
            from: '/tests',
            to: '/tests/123',
            priority: 'high',
          })
        })

        expect(result.current.registerPreloadHint).toBeDefined()
      })
    })
  })

  describe('Predictive Preloading', () => {
    it('preloads detail pages when on tests list', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('test-detail', preloadFn)
      mod.registerPreloadFunction('test-create', vi.fn().mockResolvedValue({}))

      renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/tests'),
      })

      // The useEffect should trigger preloading
      await waitFor(() => {
        expect(preloadFn).toHaveBeenCalled()
      })
    })

    it('preloads detail pages when on suites list', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('suite-detail', preloadFn)
      mod.registerPreloadFunction('suite-create', vi.fn().mockResolvedValue({}))

      renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/suites'),
      })

      await waitFor(() => {
        expect(preloadFn).toHaveBeenCalled()
      })
    })

    it('preloads detail pages when on executions list', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('execution-detail', preloadFn)

      renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/executions'),
      })

      await waitFor(() => {
        expect(preloadFn).toHaveBeenCalled()
      })
    })

    it('preloads edit page when on test detail page', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('test-edit', preloadFn)

      renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/tests/123'),
      })

      await waitFor(() => {
        expect(preloadFn).toHaveBeenCalled()
      })
    })

    it('preloads live page when on execution detail page', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      mod.registerPreloadFunction('execution-live', preloadFn)

      renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/executions/456'),
      })

      await waitFor(() => {
        expect(preloadFn).toHaveBeenCalled()
      })
    })
  })

  describe('requestIdleCallback Polyfill', () => {
    // The polyfill is evaluated at module load time, so we can only verify
    // that low-priority preloading still works when using the fallback
    it('low priority preloading works regardless of requestIdleCallback availability', async () => {
      const mod = await importModule()
      const preloadFn = vi.fn().mockResolvedValue({})
      const componentName = `fallback-test-${Date.now()}`
      mod.registerPreloadFunction(componentName, preloadFn)

      const { result } = renderHook(() => mod.usePreloadRegistry(), {
        wrapper: createWrapper('/'),
      })

      await act(async () => {
        result.current.preloadWithPriority(componentName, 'low')
        // Wait for either requestIdleCallback or setTimeout fallback
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      // Preload should complete regardless of which callback mechanism is used
      expect(preloadFn).toHaveBeenCalled()
    })
  })

  describe('requestIdleCallback Native Branch', () => {
    it('uses native requestIdleCallback when available', async () => {
      // Reset modules to re-evaluate the requestIdleCallback const
      vi.resetModules()

      // Set up native requestIdleCallback BEFORE importing
      const mockRequestIdleCallback = vi.fn((callback: () => void) => {
        callback()
        return 42
      })
      vi.stubGlobal('requestIdleCallback', mockRequestIdleCallback)

      // Now dynamically import the module - this will evaluate the const with requestIdleCallback available
      const { registerPreloadFunction: register, usePreloadRegistry: useRegistry } =
        await import('../../src/app/preload-registry')

      const preloadFn = vi.fn().mockResolvedValue({})
      const componentName = `native-ric-${Date.now()}`
      register(componentName, preloadFn)

      const { result } = renderHook(() => useRegistry(), {
        wrapper: createWrapper('/'),
      })

      await act(async () => {
        result.current.preloadWithPriority(componentName, 'low')
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      // The native requestIdleCallback should have been used (via the module-level const)
      expect(preloadFn).toHaveBeenCalled()
    })
  })

  describe('requestIdleCallback setTimeout Fallback', () => {
    it('uses setTimeout fallback when requestIdleCallback is unavailable', async () => {
      // Reset modules to re-evaluate the requestIdleCallback const
      vi.resetModules()

      // Remove requestIdleCallback so the module uses the setTimeout fallback
      const saved = globalThis.requestIdleCallback
      // @ts-expect-error removing global for test
      delete globalThis.requestIdleCallback

      const { registerPreloadFunction: register, usePreloadRegistry: useRegistry } =
        await import('../../src/app/preload-registry')

      const preloadFn = vi.fn().mockResolvedValue({})
      const componentName = `fallback-setTimeout-${Date.now()}`
      register(componentName, preloadFn)

      const { result } = renderHook(() => useRegistry(), {
        wrapper: createWrapper('/'),
      })

      await act(async () => {
        result.current.preloadWithPriority(componentName, 'low')
        // Wait for setTimeout(callback, 1) fallback to fire
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      expect(preloadFn).toHaveBeenCalled()

      // Restore
      if (saved) {
        globalThis.requestIdleCallback = saved
      }
    })
  })
})
