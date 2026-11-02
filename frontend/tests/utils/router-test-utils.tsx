/**
 * Router Test Utilities
 *
 * Provides helpers for testing components and hooks that require router context
 * in react-router-dom v7+.
 */

import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * Creates a wrapper for renderHook that provides router context.
 *
 * In react-router-dom v7, RouterProvider doesn't accept children directly.
 * This utility creates a route that renders the children, allowing hooks
 * to access router context.
 *
 * @param initialEntries - Initial history entries
 * @param routes - Optional route configuration (defaults to catch-all)
 * @returns An object with the wrapper component and router instance
 */
export function createRouterWrapper(
  initialEntries: string[] = ['/'],
  routes?: RouteObject[]
) {
  // Create routes that render the children
  const testRoutes: RouteObject[] = routes || [
    {
      path: '*',
      element: null, // Will be set by wrapper
    },
  ]

  // The router instance
  const router = createMemoryRouter(testRoutes, { initialEntries })

  // Wrapper component for renderHook
  const wrapper = ({ children }: { children: ReactNode }) => {
    // Create a new router with children as the element
    const testRouter = createMemoryRouter(
      [{ path: '*', element: children }],
      { initialEntries }
    )
    return <RouterProvider router={testRouter} />
  }

  return { wrapper, router }
}

/**
 * Simple wrapper using RouterProvider for basic render tests.
 * Use this when you don't need access to the router instance.
 */
export function createSimpleRouterWrapper(initialEntries: string[] = ['/']) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter(
      [{ path: '*', element: children }],
      { initialEntries }
    )
    return <RouterProvider router={router} />
  }
}
