/**
 * Protected Route Component
 *
 * Wrapper that redirects to login if not authenticated.
 */

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/stores/auth-store'

/**
 * Protected route wrapper - redirects to login if not authenticated
 */
export function ProtectedRoute({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return <div data-testid="auth-loading">Checking authentication…</div>
  }

  if (!isAuthenticated) {
    const returnUrl = encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`
    )
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />
  }

  return <>{children}</>
}
