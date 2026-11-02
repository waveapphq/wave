/**
 * Browser History Integration Tests - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Tests browser history integration including back/forward buttons,
 * navigation actions, and history state preservation.
 */

import { describe, it, expect } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routeConfig } from '../../src/app/router'

describe('Browser History Integration', () => {
  describe('History Navigation', () => {
    it('back button returns to previous route', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests'],
        initialIndex: 1,
      })

      render(<RouterProvider router={router} />)

      // Verify we're on tests page
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })

      // Go back
      act(() => {
        router.navigate(-1)
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })

    it('forward button returns to next route after going back', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests', '/suites'],
        initialIndex: 2,
      })

      render(<RouterProvider router={router} />)

      // Go back twice
      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })

      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })

      // Go forward
      act(() => {
        router.navigate(1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })
    })

    it('multiple back navigations work correctly', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests', '/suites', '/regressions'],
        initialIndex: 3,
      })

      render(<RouterProvider router={router} />)

      expect(router.state.location.pathname).toBe('/regressions')

      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites')
      })

      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })

      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })

    it('history state is preserved during navigation', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Navigate with state
      act(() => {
        router.navigate('/tests', { state: { filter: 'active', page: 2 } })
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
        expect(router.state.location.state).toEqual({ filter: 'active', page: 2 })
      })

      // Navigate away
      act(() => {
        router.navigate('/suites')
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites')
      })

      // Go back - state should be preserved
      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
        expect(router.state.location.state).toEqual({ filter: 'active', page: 2 })
      })
    })

    it('query parameters are preserved in history', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Navigate with query params
      act(() => {
        router.navigate('/tests?status=failed&page=3')
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
        expect(router.state.location.search).toBe('?status=failed&page=3')
      })

      // Navigate away and back
      act(() => {
        router.navigate('/suites')
        router.navigate(-1)
      })

      await waitFor(() => {
        expect(router.state.location.search).toBe('?status=failed&page=3')
      })
    })

    it('hash fragments are preserved in history', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      act(() => {
        router.navigate('/tests/test-123#section-results')
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests/test-123')
        expect(router.state.location.hash).toBe('#section-results')
      })

      act(() => {
        router.navigate('/suites')
        router.navigate(-1)
      })

      await waitFor(() => {
        expect(router.state.location.hash).toBe('#section-results')
      })
    })
  })

  describe('History Action Types', () => {
    it('regular navigation creates PUSH action', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      act(() => {
        router.navigate('/tests')
      })

      await waitFor(() => {
        expect(router.state.historyAction).toBe('PUSH')
      })
    })

    it('replace navigation creates REPLACE action', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      act(() => {
        router.navigate('/tests', { replace: true })
      })

      await waitFor(() => {
        expect(router.state.historyAction).toBe('REPLACE')
      })
    })

    it('back navigation creates POP action', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests'],
        initialIndex: 1,
      })

      render(<RouterProvider router={router} />)

      act(() => {
        router.navigate(-1)
      })

      await waitFor(() => {
        expect(router.state.historyAction).toBe('POP')
      })
    })

    it('forward navigation creates POP action', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests'],
        initialIndex: 0,
      })

      render(<RouterProvider router={router} />)

      act(() => {
        router.navigate('/tests')
        router.navigate(-1)
        router.navigate(1)
      })

      await waitFor(() => {
        expect(router.state.historyAction).toBe('POP')
      })
    })
  })

  describe('Browser URL Updates', () => {
    it('URL reflects current route', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests'],
      })

      render(<RouterProvider router={router} />)

      expect(router.state.location.pathname).toBe('/tests')

      act(() => {
        router.navigate('/suites/suite-123')
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites/suite-123')
      })
    })

    it('URL includes query parameters', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests?status=active'],
      })

      render(<RouterProvider router={router} />)

      expect(router.state.location.search).toBe('?status=active')
    })

    it('URL includes hash fragments', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/tests/test-1#execution-log'],
      })

      render(<RouterProvider router={router} />)

      expect(router.state.location.hash).toBe('#execution-log')
    })
  })

  describe('Programmatic History Management', () => {
    it('can navigate to specific history index', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests', '/suites', '/regressions'],
        initialIndex: 3,
      })

      render(<RouterProvider router={router} />)

      // Go back 2 steps
      act(() => {
        router.navigate(-2)
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })
    })

    it('replace does not add history entry', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Push first
      act(() => {
        router.navigate('/tests')
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })

      // Replace
      act(() => {
        router.navigate('/suites', { replace: true })
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/suites')
      })

      // Go back - should go to dashboard, not tests
      act(() => {
        router.navigate(-1)
      })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })
  })

  describe('History State Edge Cases', () => {
    it('handles navigation at history start (cannot go back)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Try to go back at the start
      act(() => {
        router.navigate(-1)
      })

      // Should still be on dashboard
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    })

    it('handles navigation at history end (cannot go forward)', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard', '/tests'],
        initialIndex: 1,
      })

      render(<RouterProvider router={router} />)

      // Try to go forward at the end
      act(() => {
        router.navigate(1)
      })

      // Should still be on tests
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tests')
      })
    })

    it('handles rapid navigation correctly', async () => {
      const router = createMemoryRouter(routeConfig, {
        initialEntries: ['/dashboard'],
      })

      render(<RouterProvider router={router} />)

      // Rapid navigation
      act(() => {
        router.navigate('/tests')
        router.navigate('/suites')
        router.navigate('/regressions')
        router.navigate('/executions')
      })

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/executions')
      })
    })
  })
})
