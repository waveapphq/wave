/**
 * ErrorBoundary Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.22: Error boundaries with recovery options
 *
 * Tests for ErrorBoundary and ErrorFallback components following design system
 * specifications.
 *
 * ErrorBoundary specifications:
 * - Catches errors in component tree and displays fallback UI
 * - Boundary placement strategy: root-level, route-level, feature-level
 * - Reset behavior: retry resets error state, tracks retry attempts
 * - Nested boundary behavior: nearest ancestor catches error
 *
 * ErrorFallback specifications:
 * - Container: background --color-error-bg, border 1px solid --color-error-border,
 *   border-radius rounded-lg (8px), padding space-6 (24px), max-width 480px, text-align center
 * - Icon: size icon-xl (24px), color --color-error-text, margin-bottom space-4 (16px)
 * - Title: font-size text-lg (18px), font-weight font-semibold (600),
 *   color --color-error-text, margin-bottom space-2 (8px)
 * - Description: font-size text-sm (14px), font-weight font-normal (400),
 *   color --color-text-secondary, line-height 1.5, margin-bottom space-6 (24px)
 * - Action group: gap space-3 (12px), Primary action (Primary button), Secondary action (Ghost button)
 *
 * Recovery Actions:
 * - "Try Again": Always shown (primary), resets error state
 * - "Go to Dashboard": Route-level and root boundaries
 * - "Reload Page": After repeated retry failures
 * - "Report Problem": When error reporting is enabled
 *
 * Animation:
 * - Fallback fades in over 200ms on error
 * - Recovery fades out/in over 150ms
 *
 * Reduced Motion:
 * - Instant visibility changes without fade animations
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ErrorBoundary, ErrorFallback } from '@/components/ui/error-boundary'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

// Helper component that throws an error
function ThrowError({ error }: { error: Error }): never {
  throw error
}

// Wrapper with required providers
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>
        {children}
        <ToastContainer />
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('ErrorBoundary Component', () => {
  // Suppress console.error for error boundary tests
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <div data-testid="child-content">Child Content</div>
          </ErrorBoundary>
        </TestWrapper>
      )
      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.getByText('Child Content')).toBeInTheDocument()
    })

    it('passes through children without modification', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <div className="test-class" data-custom="value">
              Content
            </div>
          </ErrorBoundary>
        </TestWrapper>
      )
      const content = screen.getByText('Content')
      expect(content).toHaveClass('test-class')
      expect(content).toHaveAttribute('data-custom', 'value')
    })

    it('renders multiple children', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <div>First</div>
            <div>Second</div>
            <div>Third</div>
          </ErrorBoundary>
        </TestWrapper>
      )
      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
      expect(screen.getByText('Third')).toBeInTheDocument()
    })
  })

  describe('Error Catching', () => {
    it('catches errors thrown by child components', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('Test error')} />
          </ErrorBoundary>
        </TestWrapper>
      )
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('catches errors thrown during render', () => {
      const BrokenComponent = () => {
        throw new Error('Render error')
      }

      render(
        <TestWrapper>
          <ErrorBoundary>
            <BrokenComponent />
          </ErrorBoundary>
        </TestWrapper>
      )
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('displays error fallback UI on error', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('Test error')} />
          </ErrorBoundary>
        </TestWrapper>
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('logs error to console (for monitoring)', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const testError = new Error('Logged error')

      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={testError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('captures component stack trace', () => {
      const onError = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onError={onError}>
            <ThrowError error={new Error('Stack trace error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(onError).toHaveBeenCalled()
      // onError should receive error and errorInfo with componentStack
      const [error, errorInfo] = onError.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Stack trace error')
      expect(errorInfo).toBeDefined()
      expect(errorInfo.componentStack).toBeDefined()
      expect(typeof errorInfo.componentStack).toBe('string')
    })

    it('component stack trace includes component hierarchy', () => {
      const onError = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onError={onError}>
            <ThrowError error={new Error('Hierarchy error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      const [, errorInfo] = onError.mock.calls[0]
      // Stack should contain component names
      expect(errorInfo.componentStack).toContain('ThrowError')
    })

    it('passes error info to fallbackRender for debugging', () => {
      const testError = new Error('Debug error')
      let capturedErrorInfo: { componentStack?: string } | undefined

      render(
        <TestWrapper>
          <ErrorBoundary
            fallbackRender={({ error, errorInfo }) => {
              capturedErrorInfo = errorInfo
              return <div>Error: {error.message}</div>
            }}
          >
            <ThrowError error={testError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(capturedErrorInfo).toBeDefined()
      expect(capturedErrorInfo?.componentStack).toBeDefined()
    })
  })

  describe('Reset Behavior', () => {
    it('resets error state when Try Again is clicked', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const ConditionalThrow = () => {
        if (shouldThrow) {
          throw new Error('Recoverable error')
        }
        return <div>Recovered Content</div>
      }

      const { rerender } = render(
        <TestWrapper>
          <ErrorBoundary>
            <ConditionalThrow />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Error is shown
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Fix the error condition
      shouldThrow = false

      // Click retry
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Force rerender to see recovered state
      rerender(
        <TestWrapper>
          <ErrorBoundary>
            <ConditionalThrow />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Should show recovered content
      await waitFor(() => {
        expect(screen.getByText('Recovered Content')).toBeInTheDocument()
      })
    })

    it('tracks retry attempts', async () => {
      const user = userEvent.setup()
      const onRetry = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onRetry={onRetry}>
            <ThrowError error={new Error('Persistent error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Click retry multiple times
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await user.click(screen.getByRole('button', { name: /try again/i }))

      expect(onRetry).toHaveBeenCalledTimes(3)
    })

    it('shows reload page option after multiple retry failures', async () => {
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <ErrorBoundary maxRetries={2}>
            <ThrowError error={new Error('Persistent error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Initial state - no reload button
      expect(screen.queryByRole('button', { name: /reload page/i })).not.toBeInTheDocument()

      // Retry maximum times
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // After exceeding max retries, reload option should appear
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
      })
    })

    it('detects when same error recurs immediately after reset', async () => {
      const user = userEvent.setup()
      const onSameErrorRecur = vi.fn()
      const persistentError = new Error('Same recurring error')

      render(
        <TestWrapper>
          <ErrorBoundary onSameErrorRecur={onSameErrorRecur}>
            <ThrowError error={persistentError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First retry - same error will recur
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Boundary should detect the same error recurring
      expect(onSameErrorRecur).toHaveBeenCalledWith(persistentError, 1)

      // Second retry
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Should report second occurrence
      expect(onSameErrorRecur).toHaveBeenCalledWith(persistentError, 2)
    })

    it('resets recurrence count when a different error occurs', async () => {
      const user = userEvent.setup()
      const onSameErrorRecur = vi.fn()
      // Track user-initiated retries via onRetry callback, not render count.
      // This is resilient to React 19's concurrent mode which may call
      // the component multiple times during error recovery.
      let retryCount = 0

      const ChangingErrorComponent = () => {
        // retryCount 0 = initial error
        // retryCount 1 = first retry (same error)
        // retryCount 2+ = different error
        if (retryCount <= 1) {
          throw new Error('First error type')
        }
        throw new Error('Different error type')
      }

      render(
        <TestWrapper>
          <ErrorBoundary
            onSameErrorRecur={onSameErrorRecur}
            onRetry={() => retryCount++}
          >
            <ChangingErrorComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First retry - same error type
      await user.click(screen.getByRole('button', { name: /try again/i }))
      expect(onSameErrorRecur).toHaveBeenCalledTimes(1)

      // Second retry - different error type
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Should not call onSameErrorRecur for different error
      // The last call should still be count 1, not count 2
      expect(onSameErrorRecur).toHaveBeenCalledTimes(1)
    })

    it('shows persistent error messaging after same error recurs multiple times', async () => {
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <ErrorBoundary maxRetries={2}>
            <ThrowError error={new Error('Persistent error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Retry multiple times with same error
      await user.click(screen.getByRole('button', { name: /try again/i }))
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Should show messaging about persistent error
      await waitFor(() => {
        expect(screen.getByText(/this error keeps occurring/i)).toBeInTheDocument()
      })
    })

    it('tracks error identity by message and type', async () => {
      const user = userEvent.setup()
      const onSameErrorRecur = vi.fn()
      let errorCount = 0

      const SameMessageComponent = () => {
        errorCount++
        // Same message but potentially different stack
        throw new Error('Identical error message')
      }

      render(
        <TestWrapper>
          <ErrorBoundary onSameErrorRecur={onSameErrorRecur}>
            <SameMessageComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Should detect as same error based on message
      expect(onSameErrorRecur).toHaveBeenCalled()
      const [error] = onSameErrorRecur.mock.calls[0]
      expect(error.message).toBe('Identical error message')
    })
  })

  describe('Custom Fallback', () => {
    it('supports custom fallback component via prop', () => {
      const CustomFallback = () => <div data-testid="custom-fallback">Custom Error UI</div>

      render(
        <TestWrapper>
          <ErrorBoundary fallback={<CustomFallback />}>
            <ThrowError error={new Error('Test error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
      expect(screen.getByText('Custom Error UI')).toBeInTheDocument()
    })

    it('supports fallback render function with error info', () => {
      const testError = new Error('Detailed error')

      render(
        <TestWrapper>
          <ErrorBoundary
            fallbackRender={({ error }) => (
              <div data-testid="render-fallback">Error: {error.message}</div>
            )}
          >
            <ThrowError error={testError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByTestId('render-fallback')).toBeInTheDocument()
      expect(screen.getByText('Error: Detailed error')).toBeInTheDocument()
    })

    it('passes resetErrorBoundary to fallback render function', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const RecoverableComponent = () => {
        if (shouldThrow) throw new Error('Recoverable')
        return <div>Recovered</div>
      }

      render(
        <TestWrapper>
          <ErrorBoundary
            fallbackRender={({ resetErrorBoundary }) => (
              <div>
                <span>Error occurred</span>
                <button onClick={resetErrorBoundary}>Reset</button>
              </div>
            )}
          >
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText('Error occurred')).toBeInTheDocument()

      shouldThrow = false
      await user.click(screen.getByRole('button', { name: 'Reset' }))

      await waitFor(() => {
        expect(screen.getByText('Recovered')).toBeInTheDocument()
      })
    })
  })

  describe('Nested Boundary Behavior', () => {
    it('nearest ancestor boundary catches the error', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <div>Outer Content</div>
            <ErrorBoundary>
              <ThrowError error={new Error('Inner error')} />
            </ErrorBoundary>
          </ErrorBoundary>
        </TestWrapper>
      )

      // Outer content should still be visible
      expect(screen.getByText('Outer Content')).toBeInTheDocument()
      // Inner boundary should show error
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('error does not propagate to parent when caught by child boundary', () => {
      const outerOnError = vi.fn()
      const innerOnError = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onError={outerOnError}>
            <div>Outer</div>
            <ErrorBoundary onError={innerOnError}>
              <ThrowError error={new Error('Inner error')} />
            </ErrorBoundary>
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(innerOnError).toHaveBeenCalled()
      expect(outerOnError).not.toHaveBeenCalled()
    })
  })

  describe('Boundary Level Prop', () => {
    it('supports level="root" for root-level boundaries', () => {
      render(
        <TestWrapper>
          <ErrorBoundary level="root">
            <ThrowError error={new Error('Root error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Root level should show "Go to Dashboard" option
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    })

    it('supports level="route" for route-level boundaries', () => {
      render(
        <TestWrapper>
          <ErrorBoundary level="route">
            <ThrowError error={new Error('Route error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Route level should show "Go to Dashboard" option
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    })

    it('supports level="feature" for feature-level boundaries', () => {
      render(
        <TestWrapper>
          <ErrorBoundary level="feature">
            <ThrowError error={new Error('Feature error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Feature level should NOT show "Go to Dashboard" option
      expect(screen.queryByRole('link', { name: /go to dashboard/i })).not.toBeInTheDocument()
    })
  })

  describe('Error Reporting', () => {
    it('shows Report Problem button when onReportError is provided', () => {
      render(
        <TestWrapper>
          <ErrorBoundary onReportError={() => {}}>
            <ThrowError error={new Error('Reportable error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByRole('button', { name: /report problem/i })).toBeInTheDocument()
    })

    it('calls onReportError when Report Problem is clicked', async () => {
      const user = userEvent.setup()
      const onReportError = vi.fn()
      const testError = new Error('Reported error')

      render(
        <TestWrapper>
          <ErrorBoundary onReportError={onReportError}>
            <ThrowError error={testError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      await user.click(screen.getByRole('button', { name: /report problem/i }))

      expect(onReportError).toHaveBeenCalledWith(testError)
    })

    it('does not show Report Problem when onReportError is not provided', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('Unreported error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.queryByRole('button', { name: /report problem/i })).not.toBeInTheDocument()
    })
  })

  describe('Toast Integration', () => {
    it('shows toast notification on error when showToast is true', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showToast>
            <ThrowError error={new Error('Toast error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Both fallback alert and toast should appear
      const alerts = screen.getAllByRole('alert')
      // Should have at least 2 alerts: ErrorFallback and Toast
      expect(alerts.length).toBeGreaterThanOrEqual(2)
      // Toast should have error variant styling
      const toast = document.querySelector('[data-toast]')
      expect(toast).toBeInTheDocument()
      expect(toast).toHaveClass('toast-error')
    })

    it('toast includes error variant styling', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showToast>
            <ThrowError error={new Error('Toast styled error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      const toast = document.querySelector('[data-toast]')
      expect(toast).toBeInTheDocument()
      // Toast should use error variant styling via CSS class
      expect(toast).toHaveClass('toast-error')
    })

    it('toast message references the affected area', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showToast toastMessage="Component failed to load">
            <ThrowError error={new Error('Referenced error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      const toast = document.querySelector('[data-toast]')
      expect(toast).toBeInTheDocument()
      expect(toast).toHaveTextContent('Component failed to load')
    })

    it('does not show toast when showToast is false (default)', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('No toast error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Only fallback alert, no toast
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBe(1)
      expect(document.querySelector('[data-toast]')).not.toBeInTheDocument()
    })

    it('shows toast notification on retry error via componentDidCatch path', async () => {
      // This test covers the componentDidCatch toast path (lines 557-559)
      // After a retry, callbacksProcessed is reset to false, so componentDidCatch
      // will run the toast code instead of returning early
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <ErrorBoundary showToast toastMessage="Retry error toast">
            <ThrowError error={new Error('Retry toast error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First error - toast shown via componentDidMount path
      const firstToast = document.querySelector('[data-toast]')
      expect(firstToast).toBeInTheDocument()

      // Click retry - this resets callbacksProcessed
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Second error - toast shown via componentDidCatch path (lines 557-559)
      // Should have at least 2 toasts now (one from each error)
      const toasts = document.querySelectorAll('[data-toast]')
      expect(toasts.length).toBeGreaterThanOrEqual(2)
    })

    it('shows default toast message when toastMessage prop is not provided in componentDidCatch', async () => {
      // This test specifically covers line 557 where toastMessage defaults to 'An error occurred in this section'
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <ErrorBoundary showToast>
            <ThrowError error={new Error('Default message error')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First error
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Second error triggers componentDidCatch toast path with default message
      const toasts = document.querySelectorAll('[data-toast]')
      expect(toasts.length).toBeGreaterThanOrEqual(2)

      // At least one toast should have the default message
      const hasDefaultMessage = Array.from(toasts).some(
        (toast) => toast.textContent?.includes('An error occurred in this section')
      )
      expect(hasDefaultMessage).toBe(true)
    })
  })

  describe('React 19 Concurrent Mode Edge Cases', () => {
    it('componentDidMount handles recurring error detection via pending callbacks', async () => {
      // This test covers the recurring error detection behavior.
      // In React 19 concurrent mode, componentDidMount may run before componentDidCatch
      // when the ErrorBoundary is remounted during error recovery.
      const user = userEvent.setup()
      const onSameErrorRecur = vi.fn()

      // We use a component that will throw the same error on each render
      let errorCount = 0
      const AlwaysThrows = () => {
        errorCount++
        throw new Error('Concurrent mode recurring error')
      }

      render(
        <TestWrapper>
          <ErrorBoundary onSameErrorRecur={onSameErrorRecur}>
            <AlwaysThrows />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First error - initial render
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Retry triggers same error
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // onSameErrorRecur should be called with count 1
      expect(onSameErrorRecur).toHaveBeenCalled()
      expect(onSameErrorRecur.mock.calls[0][0].message).toBe('Concurrent mode recurring error')
    })
  })
})

describe('ErrorFallback Component', () => {
  describe('Basic Rendering', () => {
    it('renders error fallback element', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toBeInTheDocument()
    })

    it('renders as div element', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback').tagName.toLowerCase()).toBe('div')
    })

    it('applies error-fallback base class', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('error-fallback')
    })

    it('has role="alert" for screen reader announcement', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  describe('Container Styling (per design system)', () => {
    it('applies bg-error-bg background color', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('bg-error')
    })

    it('applies border border-error-border', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('border')
      expect(screen.getByTestId('error-fallback')).toHaveClass('border-error')
    })

    it('applies rounded-lg border radius (8px per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('rounded-lg')
    })

    it('applies p-6 padding (24px per space-6)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('p-6')
    })

    it('applies max-w-[480px] maximum width', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('max-w-[480px]')
    })

    it('applies text-center for centered text alignment', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('text-center')
    })

    it('applies flex layout for vertical stacking', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('flex')
      expect(screen.getByTestId('error-fallback')).toHaveClass('flex-col')
    })

    it('applies items-center for horizontal centering', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('items-center')
    })
  })

  describe('Icon Element', () => {
    it('renders error icon', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toBeInTheDocument()
    })

    it('applies icon-xl size (24px per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toHaveClass('icon-xl')
    })

    it('applies text-error color', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toHaveClass('text-error')
    })

    it('applies mb-4 margin bottom (16px per space-4)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toHaveClass('mb-4')
    })

    it('icon has aria-hidden for decorative purpose', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Title Element', () => {
    it('renders title text "Something went wrong"', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('applies text-lg font size (18px per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText('Something went wrong')).toHaveClass('text-lg')
    })

    it('applies font-semibold weight (600 per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText('Something went wrong')).toHaveClass('font-semibold')
    })

    it('applies text-error color', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText('Something went wrong')).toHaveClass('text-error')
    })

    it('applies mb-2 margin bottom (8px per space-2)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText('Something went wrong')).toHaveClass('mb-2')
    })

    it('renders as h3 element for semantic hierarchy', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const title = screen.getByText('Something went wrong')
      expect(title.tagName.toLowerCase()).toBe('h3')
    })

    it('supports custom title via prop', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            title="Custom Error Title"
          />
        </TestWrapper>
      )
      expect(screen.getByText('Custom Error Title')).toBeInTheDocument()
    })
  })

  describe('Description Element', () => {
    it('renders description text with context and reassurance', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByText(/encountered an error/i)).toBeInTheDocument()
    })

    it('applies text-sm font size (14px per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description).toHaveClass('text-sm')
    })

    it('applies font-normal weight (400 per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description).toHaveClass('font-normal')
    })

    it('applies text-secondary color', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description).toHaveClass('text-secondary')
    })

    it('applies leading-normal line height (1.5 per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description).toHaveClass('leading-normal')
    })

    it('applies mb-6 margin bottom (24px per space-6)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description).toHaveClass('mb-6')
    })

    it('renders as p element', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const description = screen.getByText(/encountered an error/i)
      expect(description.tagName.toLowerCase()).toBe('p')
    })

    it('supports custom description via prop', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            description="Custom error description text."
          />
        </TestWrapper>
      )
      expect(screen.getByText('Custom error description text.')).toBeInTheDocument()
    })
  })

  describe('Action Group', () => {
    it('renders action group container', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toBeInTheDocument()
    })

    it('action group has flex layout', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('flex')
    })

    it('action group has gap-3 spacing (12px per space-3)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('gap-3')
    })

    it('action group centers items', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('items-center')
      expect(actionGroup).toHaveClass('justify-center')
    })

    it('action group wraps on mobile', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('flex-wrap')
    })
  })

  describe('Primary Action - Try Again', () => {
    it('renders Try Again button', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('Try Again button has primary variant styling', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /try again/i })).toHaveClass('btn-primary')
    })

    it('calls resetErrorBoundary when Try Again is clicked', async () => {
      const user = userEvent.setup()
      const resetErrorBoundary = vi.fn()

      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={resetErrorBoundary} />
        </TestWrapper>
      )

      await user.click(screen.getByRole('button', { name: /try again/i }))
      expect(resetErrorBoundary).toHaveBeenCalledTimes(1)
    })

    it('Try Again button has btn class', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /try again/i })).toHaveClass('btn')
    })
  })

  describe('Secondary Action - Go to Dashboard', () => {
    it('renders Go to Dashboard link when level is root', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            level="root"
          />
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    })

    it('renders Go to Dashboard link when level is route', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            level="route"
          />
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    })

    it('does not render Go to Dashboard when level is feature', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            level="feature"
          />
        </TestWrapper>
      )
      expect(screen.queryByRole('link', { name: /go to dashboard/i })).not.toBeInTheDocument()
    })

    it('Go to Dashboard link has ghost button styling', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            level="root"
          />
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toHaveClass('btn-ghost')
    })

    it('Go to Dashboard link has correct href', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            level="root"
          />
        </TestWrapper>
      )
      expect(screen.getByRole('link', { name: /go to dashboard/i })).toHaveAttribute(
        'href',
        '/dashboard'
      )
    })
  })

  describe('Reload Page Action', () => {
    it('renders Reload Page button when showReload is true', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            showReload
          />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
    })

    it('does not render Reload Page by default', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.queryByRole('button', { name: /reload page/i })).not.toBeInTheDocument()
    })

    it('Reload Page button triggers page reload', async () => {
      const user = userEvent.setup()
      const reloadFn = vi.fn()
      Object.defineProperty(window, 'location', {
        value: { reload: reloadFn },
        writable: true,
      })

      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            showReload
          />
        </TestWrapper>
      )

      await user.click(screen.getByRole('button', { name: /reload page/i }))
      expect(reloadFn).toHaveBeenCalled()
    })
  })

  describe('Report Problem Action', () => {
    it('renders Report Problem button when onReportError is provided', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            onReportError={() => {}}
          />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /report problem/i })).toBeInTheDocument()
    })

    it('does not render Report Problem when onReportError is not provided', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.queryByRole('button', { name: /report problem/i })).not.toBeInTheDocument()
    })

    it('calls onReportError when Report Problem is clicked', async () => {
      const user = userEvent.setup()
      const onReportError = vi.fn()
      const testError = new Error('Reported error')

      render(
        <TestWrapper>
          <ErrorFallback
            error={testError}
            resetErrorBoundary={() => {}}
            onReportError={onReportError}
          />
        </TestWrapper>
      )

      await user.click(screen.getByRole('button', { name: /report problem/i }))
      expect(onReportError).toHaveBeenCalledWith(testError)
    })

    it('Report Problem button has ghost button styling', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            onReportError={() => {}}
          />
        </TestWrapper>
      )
      expect(screen.getByRole('button', { name: /report problem/i })).toHaveClass('btn-ghost')
    })
  })

  describe('Animation Behavior', () => {
    it('applies animation classes for fade-in', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('animate-fade-in')
    })

    it('has duration-200 for 200ms fade-in (per design system)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('duration-200')
    })

    it('applies ease-out timing function for entrance', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('ease-out')
    })
  })

  describe('isRecovering State', () => {
    it('applies fade-out animation when isRecovering is true', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            isRecovering={true}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('animate-fade-out')
    })

    it('applies duration-150 when isRecovering is true', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            isRecovering={true}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('duration-150')
    })

    it('applies ease-in timing when isRecovering is true', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            isRecovering={true}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('ease-in')
    })

    it('applies fade-in animation when isRecovering is false (default)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            isRecovering={false}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('animate-fade-in')
      expect(screen.getByTestId('error-fallback')).toHaveClass('duration-200')
      expect(screen.getByTestId('error-fallback')).toHaveClass('ease-out')
    })
  })

  describe('Recovery Transition Animation', () => {
    // Suppress React's error boundary logging for these tests
    // (errors are expected and caught by ErrorBoundary)
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })
    it('applies fade-out animation class when recovering', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const RecoverableComponent = () => {
        if (shouldThrow) throw new Error('Recoverable')
        return <div data-testid="recovered-content">Recovered</div>
      }

      render(
        <TestWrapper>
          <ErrorBoundary>
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Get fallback element before recovery
      const fallback = screen.getByRole('alert')
      expect(fallback).toHaveClass('animate-fade-in')

      // Trigger recovery
      shouldThrow = false
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // During transition, fallback should have fade-out class
      // Note: This tests that the component supports the animation class
      expect(fallback).toHaveClass('animate-fade-out')
    })

    it('recovery transition uses duration-150 (150ms per design system)', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const RecoverableComponent = () => {
        if (shouldThrow) throw new Error('Recoverable')
        return <div>Recovered</div>
      }

      render(
        <TestWrapper>
          <ErrorBoundary>
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      const fallback = screen.getByRole('alert')

      shouldThrow = false
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Recovery transition should use 150ms duration
      expect(fallback).toHaveClass('duration-150')
    })

    it('recovered content applies fade-in animation', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const RecoverableComponent = () => {
        if (shouldThrow) throw new Error('Recoverable')
        return (
          <div data-testid="recovered-content" className="animate-fade-in duration-150">
            Recovered
          </div>
        )
      }

      const { rerender } = render(
        <TestWrapper>
          <ErrorBoundary>
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      shouldThrow = false
      await user.click(screen.getByRole('button', { name: /try again/i }))

      rerender(
        <TestWrapper>
          <ErrorBoundary>
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      await waitFor(() => {
        const recovered = screen.getByTestId('recovered-content')
        expect(recovered).toBeInTheDocument()
      })
    })

    it('recovery transition uses ease-in for exit animation', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      const RecoverableComponent = () => {
        if (shouldThrow) throw new Error('Recoverable')
        return <div>Recovered</div>
      }

      render(
        <TestWrapper>
          <ErrorBoundary>
            <RecoverableComponent />
          </ErrorBoundary>
        </TestWrapper>
      )

      const fallback = screen.getByRole('alert')

      shouldThrow = false
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Exit animation uses ease-in per design system
      expect(fallback).toHaveClass('ease-in')
    })
  })

  describe('Reduced Motion Support', () => {
    it('respects reduced-motion preference', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('motion-reduce:transition-none')
    })

    it('applies motion-reduce:animate-none for animation override', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('motion-reduce:animate-none')
    })
  })

  describe('Error Display', () => {
    it('does not display error message in production (development only)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Secret error details')}
            resetErrorBoundary={() => {}}
          />
        </TestWrapper>
      )
      // Production should not expose error details
      expect(screen.queryByText('Secret error details')).not.toBeInTheDocument()
    })

    it('shows error message when showErrorDetails is true (development)', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Debug error message')}
            resetErrorBoundary={() => {}}
            showErrorDetails
          />
        </TestWrapper>
      )
      expect(screen.getByText('Debug error message')).toBeInTheDocument()
    })

    it('error details have subtle styling', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Debug error message')}
            resetErrorBoundary={() => {}}
            showErrorDetails
          />
        </TestWrapper>
      )
      const errorDetails = screen.getByText('Debug error message')
      expect(errorDetails).toHaveClass('text-xs')
      expect(errorDetails).toHaveClass('text-muted')
    })

    it('error details are in a collapsible details element', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Debug error message')}
            resetErrorBoundary={() => {}}
            showErrorDetails
          />
        </TestWrapper>
      )
      const details = document.querySelector('details')
      expect(details).toBeInTheDocument()
    })
  })

  describe('Visual Hierarchy', () => {
    it('renders elements in correct order: icon, title, description, actions', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      const container = screen.getByTestId('error-fallback')
      const children = Array.from(container.children)

      expect(children.length).toBeGreaterThanOrEqual(4)
      expect(children[0]).toHaveAttribute('data-error-icon')
      expect(children[1].tagName.toLowerCase()).toBe('h3')
      expect(children[2].tagName.toLowerCase()).toBe('p')
      expect(children[3]).toHaveAttribute('data-action-group')
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            className="custom-class"
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      expect(screen.getByTestId('error-fallback')).toHaveClass('custom-class')
    })

    it('merges className with base classes', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            className="custom-class"
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      const fallback = screen.getByTestId('error-fallback')
      expect(fallback).toHaveClass('error-fallback')
      expect(fallback).toHaveClass('custom-class')
    })

    it('passes through additional HTML attributes', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-custom="value"
            id="custom-id"
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      const fallback = screen.getByTestId('error-fallback')
      expect(fallback).toHaveAttribute('data-custom', 'value')
      expect(fallback).toHaveAttribute('id', 'custom-id')
    })
  })

  describe('Accessibility', () => {
    it('has role="alert" for immediate announcement', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('icon is decorative (aria-hidden)', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const icon = document.querySelector('[data-error-icon]')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    })

    it('title is a heading for screen reader navigation', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Something went wrong')
    })

    it('action buttons are focusable', () => {
      render(
        <TestWrapper>
          <ErrorFallback error={new Error('Test error')} resetErrorBoundary={() => {}} />
        </TestWrapper>
      )
      const tryAgainButton = screen.getByRole('button', { name: /try again/i })
      expect(tryAgainButton).not.toHaveAttribute('tabindex', '-1')
    })

    it('supports aria-labelledby for title association', () => {
      render(
        <TestWrapper>
          <ErrorFallback
            error={new Error('Test error')}
            resetErrorBoundary={() => {}}
            data-testid="error-fallback"
          />
        </TestWrapper>
      )
      const fallback = screen.getByTestId('error-fallback')
      const title = screen.getByRole('heading', { level: 3 })

      expect(title).toHaveAttribute('id')
      expect(fallback).toHaveAttribute('aria-labelledby', title.id)
    })
  })
})

describe('ErrorBoundary with ErrorFallback Integration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ErrorBoundary uses ErrorFallback as default fallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary>
          <ThrowError error={new Error('Test error')} />
        </ErrorBoundary>
      </TestWrapper>
    )

    // Should render ErrorFallback component
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('passes error to ErrorFallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary showErrorDetails>
          <ThrowError error={new Error('Specific error message')} />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('Specific error message')).toBeInTheDocument()
  })

  it('passes level prop to ErrorFallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="root">
          <ThrowError error={new Error('Root error')} />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
  })
})

describe('ErrorBoundary Branch Coverage', () => {
  // These tests cover specific branch conditions that are difficult to hit via normal rendering

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('persistedState key fallback (line 313)', () => {
    it('handles null children in persistedState key', () => {
      // When children is null/undefined, props should be used as fallback key
      // This tests the nullish coalescing branch
      const ChildlessWrapper = () => {
        const [showError, setShowError] = React.useState(false)
        React.useEffect(() => {
          setShowError(true)
        }, [])
        if (showError) {
          throw new Error('Error with null children context')
        }
        return null
      }

      render(
        <TestWrapper>
          <ErrorBoundary>
            <ChildlessWrapper />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })
  })

  describe('errorCycleInstanceKey comparison (line 330)', () => {
    it('handles different ErrorBoundary instances in same error cycle', () => {
      // Tests the branch where errorCycleInstanceKey !== null but !== childrenKey
      // Create two different error-throwing components
      const ErrorA = () => {
        throw new Error('Error A')
      }

      const ErrorB = () => {
        throw new Error('Error B')
      }

      // First boundary catches first error
      const { unmount: unmount1 } = render(
        <TestWrapper>
          <ErrorBoundary>
            <ErrorA />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      unmount1()

      // Second boundary with different children
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ErrorB />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })
  })

  describe('onError callback in componentDidCatch (line 541-543)', () => {
    it('does not call onError when not provided', async () => {
      // This test covers the falsy branch of the if(onError) check
      const user = userEvent.setup()

      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('No onError callback')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // Error should be caught and displayed without onError callback
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

      // Retry to ensure componentDidCatch path runs with alreadyProcessed = false
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // Second error should also work without onError
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('calls onError when provided and componentDidCatch runs after retry', async () => {
      // This test covers the truthy branch of the if(onError) check
      // After retry, callbacksProcessed is reset, so componentDidCatch runs fully
      const user = userEvent.setup()
      const onError = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onError={onError}>
            <ThrowError error={new Error('onError callback test')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // First error - onError called
      expect(onError).toHaveBeenCalled()
      const initialCallCount = onError.mock.calls.length

      // Retry to trigger second error
      await user.click(screen.getByRole('button', { name: /try again/i }))

      // onError should be called again via componentDidCatch
      expect(onError.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  describe('displayError fallback chain (line 613)', () => {
    it('handles error rendering with state.error present', () => {
      // Normal case where state.error is truthy
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError error={new Error('State error present')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })
  })

  describe('componentStack fallback (line 618)', () => {
    it('handles error without componentStack in errorInfo', () => {
      // This test covers the fallback when componentStack is undefined
      const testError = new Error('No component stack')
      let capturedErrorInfo: { componentStack?: string } | undefined

      render(
        <TestWrapper>
          <ErrorBoundary
            fallbackRender={({ errorInfo }) => {
              capturedErrorInfo = errorInfo
              return <div>Error handled</div>
            }}
          >
            <ThrowError error={testError} />
          </ErrorBoundary>
        </TestWrapper>
      )

      // ErrorInfo should have a componentStack (either real or fallback)
      expect(capturedErrorInfo).toBeDefined()
      expect(typeof capturedErrorInfo?.componentStack).toBe('string')
    })
  })

  describe('firstErrorMessageInCycle fallback (line 471)', () => {
    it('uses error.message when firstErrorMessageInCycle is captured', () => {
      // Normal flow where firstErrorMessageInCycle is set by getDerivedStateFromError
      const onSameErrorRecur = vi.fn()

      render(
        <TestWrapper>
          <ErrorBoundary onSameErrorRecur={onSameErrorRecur}>
            <ThrowError error={new Error('Error message tracking')} />
          </ErrorBoundary>
        </TestWrapper>
      )

      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    })
  })
})
