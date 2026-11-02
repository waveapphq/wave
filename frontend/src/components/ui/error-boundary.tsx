/**
 * ErrorBoundary Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.22: Error boundaries with recovery options
 *
 * Error boundary system following design system specifications.
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
 * - Action group: gap space-3 (12px)
 */

import { Component, forwardRef, useId, type ErrorInfo, type HTMLAttributes, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { AlertCircleIcon } from './icon'
import { ToastContext } from './toast'

export type BoundaryLevel = 'root' | 'route' | 'feature'

export interface ErrorFallbackProps extends HTMLAttributes<HTMLDivElement> {
  error: Error
  errorInfo?: { componentStack?: string }
  resetErrorBoundary: () => void
  level?: BoundaryLevel
  title?: string
  description?: string
  showReload?: boolean
  onReportError?: (error: Error) => void
  showErrorDetails?: boolean
  isRecovering?: boolean
}

export const ErrorFallback = forwardRef<HTMLDivElement, ErrorFallbackProps>(
  (
    {
      error,
      errorInfo: _errorInfo, // Destructure to prevent spreading to DOM
      resetErrorBoundary,
      level = 'feature',
      title = 'Something went wrong',
      description = 'This section encountered an error and couldn\'t load. Your other work is safe.',
      showReload = false,
      onReportError,
      showErrorDetails = false,
      isRecovering = false,
      className = '',
      ...props
    },
    ref
  ) => {
    const titleId = useId()
    const showDashboardLink = level === 'root' || level === 'route'

    const handleReload = () => {
      globalThis.location.reload()
    }

    const handleReport = () => {
      onReportError?.(error)
    }

    const containerClasses = [
      'error-fallback',
      'bg-error',
      'border',
      'border-error',
      'rounded-lg',
      'p-6',
      'max-w-[480px]',
      'text-center',
      'flex',
      'flex-col',
      'items-center',
      isRecovering ? 'animate-fade-out' : 'animate-fade-in',
      isRecovering ? 'duration-150' : 'duration-200',
      isRecovering ? 'ease-in' : 'ease-out',
      'motion-reduce:transition-none',
      'motion-reduce:animate-none',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        ref={ref}
        role="alert"
        aria-labelledby={titleId}
        className={containerClasses}
        {...props}
      >
        {/* Icon */}
        <span
          data-error-icon
          aria-hidden="true"
          className="icon-xl text-error mb-4"
        >
          <AlertCircleIcon size={24} />
        </span>

        {/* Title */}
        <h3
          id={titleId}
          className="text-lg font-semibold text-error mb-2"
        >
          {title}
        </h3>

        {/* Description */}
        <p className="text-sm font-normal text-secondary leading-normal mb-6">
          {description}
        </p>

        {/* Error details (development only) */}
        {showErrorDetails && (
          <details className="mb-4 w-full text-left">
            <summary className="text-xs text-muted cursor-pointer">
              Error Details
            </summary>
            <pre className="text-xs text-muted mt-2 p-2 bg-muted rounded overflow-auto max-h-32">
              {error.message}
            </pre>
          </details>
        )}

        {/* Action group */}
        <div
          data-action-group
          className="flex gap-3 items-center justify-center flex-wrap"
        >
          {/* Primary action - Try Again */}
          <button
            type="button"
            onClick={resetErrorBoundary}
            className="btn btn-primary inline-flex items-center justify-center gap-2 font-semibold rounded-md"
          >
            Try Again
          </button>

          {/* Secondary action - Go to Dashboard */}
          {showDashboardLink && (
            <Link
              to="/dashboard"
              className="btn btn-ghost inline-flex items-center justify-center gap-2 font-semibold rounded-md"
            >
              Go to Dashboard
            </Link>
          )}

          {/* Reload Page */}
          {showReload && (
            <button
              type="button"
              onClick={handleReload}
              className="btn btn-ghost inline-flex items-center justify-center gap-2 font-semibold rounded-md"
            >
              Reload Page
            </button>
          )}

          {/* Report Problem */}
          {onReportError && (
            <button
              type="button"
              onClick={handleReport}
              className="btn btn-ghost inline-flex items-center justify-center gap-2 font-semibold rounded-md"
            >
              Report Problem
            </button>
          )}
        </div>
      </div>
    )
  }
)

ErrorFallback.displayName = 'ErrorFallback'

interface FallbackRenderProps {
  error: Error
  errorInfo?: { componentStack?: string }
  resetErrorBoundary: () => void
}

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  fallbackRender?: (props: FallbackRenderProps) => ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  onRetry?: () => void
  onSameErrorRecur?: (error: Error, count: number) => void
  onReportError?: (error: Error) => void
  level?: BoundaryLevel
  maxRetries?: number
  showToast?: boolean
  toastMessage?: string
  showErrorDetails?: boolean
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  retryCount: number
  lastErrorMessage: string | null
  sameErrorCount: number
  isRecovering: boolean
}

// Module-level storage for error boundary state that persists across React remounts.
// React 19's concurrent mode may remount error boundaries during error recovery,
// which would reset component state. We use a WeakMap keyed by children reference
// to maintain state across remounts. All state is scoped per-boundary instance.
interface PersistedErrorState {
  lastErrorMessage: string | null
  sameErrorCount: number
  retryCount: number
  // Track the first error in current error recovery cycle
  firstErrorInCycle: string | null
  errorCycleProcessed: boolean
  // State that was previously module-level, now scoped per instance
  firstErrorMessageInCycle: string | null
  errorCycleInProgress: boolean
  lastErrorMessageForRecurrence: string | null
  errorDuringCycle: Error | null
  pendingCallbacks: PendingCallbacks | null
  callbacksProcessed: boolean
}

interface PendingCallbacks {
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  onSameErrorRecur?: (error: Error, count: number) => void
  error: Error | null
  componentStack: string | null
  showToast?: boolean
  toastMessage?: string
}

const persistedStateMap = new WeakMap<object, PersistedErrorState>()

// Module-level state required for React's static getDerivedStateFromError method.
// These are temporary values that get copied to persisted state in componentDidCatch.
// React 19's concurrent mode may call getDerivedStateFromError multiple times.
let currentErrorMessage: string | null = null
let currentErrorObject: Error | null = null
let currentErrorCycleActive = false

// Track which ErrorBoundary instance (by children key) is currently in an error cycle.
// This coordinates between nested boundaries to ensure only the nearest catches errors.
let errorCycleInstanceKey: object | null = null

function getPersistedState(key: object): PersistedErrorState {
  let state = persistedStateMap.get(key)
  if (!state) {
    state = {
      lastErrorMessage: null,
      sameErrorCount: 0,
      retryCount: 0,
      firstErrorInCycle: null,
      errorCycleProcessed: false,
      firstErrorMessageInCycle: null,
      errorCycleInProgress: false,
      lastErrorMessageForRecurrence: null,
      errorDuringCycle: null,
      pendingCallbacks: null,
      callbacksProcessed: false,
    }
    persistedStateMap.set(key, state)
  }
  return state
}

function hasPersistedState(key: object): boolean {
  return persistedStateMap.has(key)
}

// The error boundary class component
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Use static contextType to access ToastContext in class component
  static readonly contextType = ToastContext
  declare context: React.ContextType<typeof ToastContext>

  // Stable key for persisted state - we use the props object itself
  private get persistedState(): PersistedErrorState {
    // Use children as the key since it's the most stable identifier.
    // ErrorBoundary always has children (required prop), so we can use it directly.
    return getPersistedState(this.props.children as object)
  }

  constructor(props: ErrorBoundaryProps) {
    super(props)
    const childrenKey = props.children as object

    // Check if this is a completely new instance (not seen before in this session).
    // New instances reset module-level state for proper isolation.
    const isNewInstance = !hasPersistedState(childrenKey)

    // Check if THIS instance is the one currently in an error cycle
    const isThisInstanceInErrorCycle = errorCycleInstanceKey === childrenKey

    // For new instances not in an error cycle, reset module-level state.
    // This ensures proper isolation between different ErrorBoundary instances
    // and naturally cleans up state when components with new children mount.
    if (isNewInstance && !isThisInstanceInErrorCycle && errorCycleInstanceKey === null) {
      currentErrorMessage = null
      currentErrorObject = null
      currentErrorCycleActive = false
    }

    // Get persisted state (creates entry if new)
    const persisted = this.persistedState

    // When React remounts during error recovery, componentDidCatch hasn't run yet.
    // Use the persisted lastErrorMessageForRecurrence for recurrence detection.
    const effectiveLastErrorMessage = persisted.lastErrorMessage || persisted.lastErrorMessageForRecurrence

    /* v8 ignore start - COV-REACT-001 */
    if (persisted.errorCycleInProgress && !persisted.callbacksProcessed && persisted.errorDuringCycle) {
      persisted.pendingCallbacks = {
        onError: props.onError,
        onSameErrorRecur: props.onSameErrorRecur,
        error: persisted.errorDuringCycle,
        componentStack: null,
        showToast: props.showToast,
        toastMessage: props.toastMessage,
      }
    }
    /* v8 ignore stop */

    this.state = {
      // If we're in an error cycle for THIS instance, preserve hasError=true
      hasError: isThisInstanceInErrorCycle,
      error: null,
      errorInfo: null,
      retryCount: persisted.retryCount,
      lastErrorMessage: effectiveLastErrorMessage,
      sameErrorCount: persisted.sameErrorCount,
      isRecovering: false,
    }
  }

  componentWillUnmount() {
    // Component is being unmounted - state persists in WeakMap for potential remounts
  }

  componentDidMount() {
    // Handle pending callbacks from React concurrent mode remounts.
    // When the original ErrorBoundary was unmounted before componentDidCatch ran,
    // we process the callbacks here from the remounted instance.
    const childrenKey = this.props.children as object
    const persisted = this.persistedState

    // Check if we can process callbacks:
    // 1. This instance is identified as the one in the error cycle, OR
    // 2. No instance has claimed the cycle AND we're in an error cycle
    const isThisInstanceInErrorCycle = errorCycleInstanceKey === childrenKey
    /* v8 ignore start - COV-REACT-002 */
    const canClaimErrorCycle = errorCycleInstanceKey === null &&
      persisted.errorCycleInProgress &&
      persisted.errorDuringCycle !== null
    /* v8 ignore stop */

    /* v8 ignore start - COV-REACT-003 */
    if (persisted.pendingCallbacks && !persisted.callbacksProcessed && (isThisInstanceInErrorCycle || canClaimErrorCycle)) {
      // Claim the error cycle for this instance
      if (canClaimErrorCycle) {
        errorCycleInstanceKey = childrenKey
      }
      const { onError, error, componentStack, showToast, toastMessage } = persisted.pendingCallbacks

      if (error) {
        // Create a synthetic errorInfo for React 19 concurrent mode remount case
        const syntheticErrorInfo: ErrorInfo = {
          componentStack: componentStack || '\n    in Component\n    in ErrorBoundary',
        }

        // Update state with the error info
        this.setState({ errorInfo: syntheticErrorInfo })

        // Call the onError callback if provided
        if (onError) {
          onError(error, syntheticErrorInfo)
        }

        // Show toast notification if enabled
        if (showToast && this.context) {
          const message = toastMessage || 'An error occurred in this section'
          this.context.error(message, 'Error')
        }

        // Handle recurrence detection
        this.handleRecurrenceDetection(
          error,
          persisted.pendingCallbacks.onSameErrorRecur,
          null
        )
      }

      // Mark callbacks as processed
      persisted.callbacksProcessed = true
      persisted.pendingCallbacks = null
    }
    /* v8 ignore stop */
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Capture the FIRST error in this error recovery cycle.
    // React may call this multiple times during recovery, but we track
    // only the original error for recurrence detection.
    if (!currentErrorCycleActive) {
      currentErrorCycleActive = true
      currentErrorMessage = error.message
      currentErrorObject = error
    }

    return { hasError: true, error, isRecovering: false }
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, _prevState: ErrorBoundaryState) {
    // Animation handling is done via CSS classes based on isRecovering state
    // The actual transition happens immediately when hasError becomes false
  }

  /**
   * Handles recurring error detection and callbacks.
   * Called from both componentDidMount (React 19 concurrent mode) and componentDidCatch.
   */
  private handleRecurrenceDetection(
    error: Error,
    onSameErrorRecur: ((error: Error, count: number) => void) | undefined,
    errorInfo: ErrorInfo | null
  ): void {
    const persisted = this.persistedState
    // currentErrorMessage is set by getDerivedStateFromError before this method is called
    const errorMessageForTracking = currentErrorMessage!
    const isSameError = persisted.lastErrorMessageForRecurrence !== null &&
      persisted.lastErrorMessageForRecurrence === errorMessageForTracking

    if (isSameError) {
      // Increment count for recurring error
      this.setState(prev => {
        const newCount = prev.sameErrorCount + 1
        persisted.sameErrorCount = newCount
        onSameErrorRecur?.(error, newCount)
        return {
          errorInfo,
          sameErrorCount: newCount,
          isRecovering: false,
        }
      })
    } else {
      // Different error or first error - reset recurrence tracking
      persisted.lastErrorMessage = errorMessageForTracking
      persisted.lastErrorMessageForRecurrence = errorMessageForTracking
      persisted.sameErrorCount = 0

      this.setState({
        errorInfo,
        lastErrorMessage: errorMessageForTracking,
        sameErrorCount: 0,
        isRecovering: false,
      })
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, onSameErrorRecur, showToast, toastMessage } = this.props
    const childrenKey = this.props.children as object
    const persisted = this.persistedState

    // Set the instance key so we know which ErrorBoundary caught this error
    errorCycleInstanceKey = childrenKey

    // Copy module-level state to persisted state and sync error cycle info
    persisted.firstErrorMessageInCycle = currentErrorMessage
    persisted.errorDuringCycle = currentErrorObject
    persisted.errorCycleInProgress = currentErrorCycleActive

    // Check if componentDidMount already processed the callbacks (React concurrent mode)
    const alreadyProcessed = persisted.callbacksProcessed

    // Mark callbacks as processed to prevent double-calling
    persisted.callbacksProcessed = true
    persisted.pendingCallbacks = null

    // Reset module-level cycle state - componentDidCatch is only called once per cycle
    currentErrorCycleActive = false

    /* v8 ignore start - COV-REACT-004 */
    if (alreadyProcessed) {
      this.setState({ errorInfo, isRecovering: false })
      return
    }
    /* v8 ignore stop */

    // Handle recurrence detection FIRST (before updating lastErrorMessageForRecurrence)
    this.handleRecurrenceDetection(error, onSameErrorRecur, errorInfo)

    // Call onError callback if provided
    if (onError) {
      onError(error, errorInfo)
    }

    // Show toast notification if enabled
    if (showToast && this.context) {
      const message = toastMessage || 'An error occurred in this section'
      this.context.error(message, 'Error')
    }
  }

  resetErrorBoundary = () => {
    const { onRetry } = this.props
    const { retryCount } = this.state
    const persisted = this.persistedState

    // Call onRetry callback
    onRetry?.()

    // Increment retry count
    const newRetryCount = retryCount + 1
    persisted.retryCount = newRetryCount

    // End the current error cycle and prepare for the next one.
    // Save current error message for recurrence detection in the next cycle.
    if (persisted.firstErrorMessageInCycle !== null) {
      persisted.lastErrorMessageForRecurrence = persisted.firstErrorMessageInCycle
    }

    // Reset persisted cycle state
    persisted.errorCycleInProgress = false
    persisted.errorDuringCycle = null
    persisted.callbacksProcessed = false
    persisted.pendingCallbacks = null

    // Reset module-level state
    currentErrorCycleActive = false
    currentErrorMessage = null
    currentErrorObject = null
    errorCycleInstanceKey = null

    // Use flushSync to immediately render the fade-out animation state.
    // This ensures the fallback shows the exit animation before we reset hasError.
    flushSync(() => {
      this.setState({ isRecovering: true })
    })

    // Reset error state to allow children to render again.
    // If children throw, getDerivedStateFromError + componentDidCatch run synchronously.
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: newRetryCount,
      isRecovering: false,
    })
  }

  render() {
    const {
      children,
      fallback,
      fallbackRender,
      level = 'feature',
      maxRetries = Infinity,
      onReportError,
      showErrorDetails = false,
    } = this.props
    const { hasError, error, errorInfo, retryCount, sameErrorCount, isRecovering } = this.state

    // Don't render children if hasError is true
    // During React's concurrent mode error recovery, hasError may be true but error temporarily null
    // We must not render children in this state, or the child component's side effects would trigger
    if (hasError) {
      // getDerivedStateFromError always sets both error state and errorDuringCycle.
      // We use non-null assertion since hasError=true guarantees error is set.
      const displayError = error!

      // Provide errorInfo for debugging. If componentDidCatch hasn't run yet (React 19 remount),
      // create a synthetic errorInfo. The real stack will be available after componentDidMount.
      // React always provides componentStack as a string, so we can safely cast.
      const displayErrorInfo: { componentStack?: string } = errorInfo
        ? { componentStack: errorInfo.componentStack as string | undefined }
        : { componentStack: '\n    in ErrorBoundary' }

      // Determine if we should show reload button (after exceeding max retries)
      const showReload = retryCount >= maxRetries

      // Determine description based on retry state
      let description = 'This section encountered an error and couldn\'t load. Your other work is safe.'
      if (sameErrorCount >= 2 || retryCount >= maxRetries) {
        description = 'This error keeps occurring. Try reloading the page or contact support.'
      }

      // Use custom fallback if provided
      if (fallback) {
        return fallback
      }

      // Use fallback render function if provided
      if (fallbackRender) {
        return fallbackRender({
          error: displayError,
          errorInfo: displayErrorInfo,
          resetErrorBoundary: this.resetErrorBoundary,
        })
      }

      // Use default ErrorFallback component
      return (
        <ErrorFallback
          error={displayError}
          errorInfo={displayErrorInfo}
          resetErrorBoundary={this.resetErrorBoundary}
          level={level}
          description={description}
          showReload={showReload}
          onReportError={onReportError}
          showErrorDetails={showErrorDetails}
          isRecovering={isRecovering}
        />
      )
    }

    return children
  }
}
