/**
 * Login Container
 *
 * Login page with redirect logic.
 */

import type { ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import { isValidReturnUrl } from '@/lib/route-utils'

/**
 * Login page - redirects if already authenticated
 */
export function LoginContainer(): ReactNode {
  const { isAuthenticated } = useAuthStore()
  const [searchParams] = useSearchParams()
  const returnUrl = searchParams.get('returnUrl')

  if (isAuthenticated) {
    // Validate returnUrl to prevent open redirect
    if (returnUrl && isValidReturnUrl(returnUrl)) {
      return <Navigate to={returnUrl} replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  return <div data-testid="login-page">Login Page</div>
}
