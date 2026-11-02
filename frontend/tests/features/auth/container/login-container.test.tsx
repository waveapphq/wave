/**
 * Tests for LoginContainer component
 *
 * Verifies login page behavior: redirect when authenticated,
 * return URL handling, and login page rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { LoginContainer } from '@/features/auth/container/login-container'

// ---------------------------------------------------------------------------
// Mock: auth store
// ---------------------------------------------------------------------------
const mockAuthState = { isAuthenticated: false }

vi.mock('@/features/auth/stores/auth-store', () => ({
  useAuthStore: () => mockAuthState,
}))

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderLogin(initialPath = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginContainer /> },
      { path: '/dashboard', element: <div data-testid="dashboard">Dashboard</div> },
      { path: '*', element: <div data-testid="other-page">Other</div> },
    ],
    { initialEntries: [initialPath] }
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginContainer', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = false
  })

  it('renders login page when not authenticated', () => {
    renderLogin()
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('redirects to dashboard when authenticated and no returnUrl', () => {
    mockAuthState.isAuthenticated = true
    const { router } = renderLogin('/login')
    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('redirects to returnUrl when authenticated and valid returnUrl is provided', () => {
    mockAuthState.isAuthenticated = true
    const { router } = renderLogin('/login?returnUrl=/tests')
    expect(router.state.location.pathname).toBe('/tests')
  })

  it('redirects to dashboard when authenticated and returnUrl is invalid', () => {
    mockAuthState.isAuthenticated = true
    const { router } = renderLogin('/login?returnUrl=https://evil.com/phish')
    expect(router.state.location.pathname).toBe('/dashboard')
  })
})
