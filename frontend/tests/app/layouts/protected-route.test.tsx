/**
 * Tests for ProtectedRoute component
 *
 * Verifies auth guard behavior: loading state, redirect when unauthenticated,
 * and rendering children when authenticated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from '@/app/layouts/protected-route'

// ---------------------------------------------------------------------------
// Mock: auth store
// ---------------------------------------------------------------------------
const mockAuthState = { isAuthenticated: true, isLoading: false }

vi.mock('@/features/auth/stores/auth-store', () => ({
  useAuthStore: () => mockAuthState,
}))

// ---------------------------------------------------------------------------
// Helper: render ProtectedRoute inside a router with specific initial path
// ---------------------------------------------------------------------------
function renderWithRouter(initialPath = '/dashboard') {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ProtectedRoute>
            <div data-testid="protected-content">Protected Content</div>
          </ProtectedRoute>
        ),
      },
      {
        path: '/login',
        element: <div data-testid="login-page">Login Page</div>,
      },
    ],
    { initialEntries: [initialPath] }
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = true
    mockAuthState.isLoading = false
  })

  it('renders children when authenticated', () => {
    renderWithRouter()
    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('shows loading state when auth is loading', () => {
    mockAuthState.isLoading = true
    renderWithRouter()
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument()
    expect(screen.getByText('Checking authentication…')).toBeInTheDocument()
  })

  it('redirects to login when not authenticated', () => {
    mockAuthState.isAuthenticated = false
    const { router } = renderWithRouter('/dashboard')
    // Should navigate to login with returnUrl
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe(
      '?returnUrl=%2Fdashboard'
    )
  })

  it('encodes full URL with search and hash in returnUrl', () => {
    mockAuthState.isAuthenticated = false
    const { router } = renderWithRouter('/tests?suite=abc#details')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toContain('returnUrl=')
    // The returnUrl should contain the encoded path+search+hash
    const params = new URLSearchParams(router.state.location.search)
    const returnUrl = params.get('returnUrl')
    expect(returnUrl).toBe('/tests?suite=abc#details')
  })

  it('does not render protected content when loading', () => {
    mockAuthState.isLoading = true
    renderWithRouter()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('does not render protected content when unauthenticated', () => {
    mockAuthState.isAuthenticated = false
    renderWithRouter()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })
})
