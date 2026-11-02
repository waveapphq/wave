/**
 * Application Root Component
 *
 * REQ-5.2.1.1: React 19 application with Vite build system
 * REQ-5.2.1.2: Client-side routing with navigation history
 * REQ-5.2.1.5: Zustand state management stores
 * REQ-5.2.1.8: Light and dark theme support with system preference detection
 * REQ-5.2.1.19: Toast notifications for user feedback
 * REQ-5.2.1.22: Error boundaries with recovery options
 *
 * This component wires together:
 * - ThemeProvider for light/dark mode support
 * - ToastProvider and ToastContainer for notifications
 * - ErrorBoundary for error handling
 * - AppRouterProvider for client-side routing
 * - AccidentalCloseGuard for preventing accidental page close
 */

import { useEffect } from 'react'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider, ToastContainer, useToast } from '@/components/ui/toast'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { ConnectionStatusBanner } from '@/components/connection-status-banner'
import { SessionContinuity } from '@/features/workbench/session-continuity'
import { startMaskingSettingsHydration } from '@/stores/masking-settings-store'
import { startSshHostPolicyHydration } from '@/stores/ssh-host-policy-store'
import { AppRouterProvider } from './router'

/**
 * Prevents accidental page close.
 * Shows a browser-native confirmation dialog on any close/refresh attempt.
 */
function AccidentalCloseGuard() {
  useEffect(() => {
    /* v8 ignore start - COV-JSDOM-008 */
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    /* v8 ignore stop */

    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return null
}

/**
 * Hydrates, once on app init, the settings the canvas reads without visiting
 * Settings: the secret-reveal flags and the SSH host key policy.
 */
function SettingsHydration() {
  const { error: toastError } = useToast()

  useEffect(() => {
    startMaskingSettingsHydration((reason) => {
      toastError(reason, 'Could Not Load Masking Settings')
    })
    startSshHostPolicyHydration((reason) => {
      toastError(reason, 'Could Not Load Host Key Policy')
    })
  }, [toastError])

  return null
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <SettingsHydration />
        <ConnectionStatusBanner />
        <ErrorBoundary level="root">
          <AccidentalCloseGuard />
          <SessionContinuity />
          <AppRouterProvider />
        </ErrorBoundary>
        <ToastContainer position="bottom-right" />
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
