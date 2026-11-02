/**
 * Route Boundaries - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Provides loading fallback and error boundary components for lazy-loaded routes.
 * Follows design system specifications for animations and transitions.
 */

import React, { Component, type ReactNode, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isSSR } from '@/lib/ssr'

// CSS keyframes need to be injected
const keyframesInjected = { current: false }

function injectKeyframes() {
  if (keyframesInjected.current || typeof document === 'undefined') return

  const style = document.createElement('style')
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `
  document.head.appendChild(style)
  keyframesInjected.current = true
}

/**
 * Check if user prefers reduced motion
 */
function prefersReducedMotion(): boolean {
  if (isSSR()) return false
  if (typeof globalThis.matchMedia !== 'function') return false
  const mediaQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
  return mediaQuery?.matches ?? false
}

/**
 * Loading fallback component for lazy-loaded routes
 * Uses design system specifications:
 * - 1000ms spinner rotation duration
 * - Linear timing function
 * - Infinite iteration
 * - Fade-in animation for appearance
 */
export function RouteLoadingFallback(): ReactNode {
  useEffect(() => {
    injectKeyframes()
  }, [])

  const reducedMotion = prefersReducedMotion()
  /* v8 ignore start - COV-BRANCH-129 */
  const animationDuration = reducedMotion ? '0.01ms' : '1000ms'

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
    animation: reducedMotion ? 'none' : 'fadeIn 300ms ease-in-out',
    /* v8 ignore stop */
    transitionProperty: 'opacity',
  }

  const spinnerStyle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    border: '3px solid #e5e7eb',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animationName: 'spin',
    animationDuration,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  }

  return (
    <div
      data-testid="route-loading"
      className="route-loading"
      style={containerStyle}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          data-testid="loading-spinner"
          style={spinnerStyle}
          aria-hidden="true"
        />
        <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading…</p>
      </div>
    </div>
  )
}

export interface RouteErrorBoundaryProps {
  children: ReactNode
  className?: string
  /** Current route path. A change clears a caught error so navigation is an escape hatch. */
  pathname?: string
}

interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
  retryKey: number
}

// Internal React lazy component status values
const LAZY_UNINITIALIZED = -1

// WeakMap to cache original factory functions for lazy components
const lazyFactoryCache = new WeakMap<object, () => Promise<{ default: React.ComponentType }>>()

// Interface for React lazy component internal structure
interface LazyPayload {
  _status: number
  _result: unknown
}

interface LazyComponentType {
  _payload?: LazyPayload
  $$typeof?: symbol
}

/**
 * Cache the factory function from a lazy component before it fails
 * Called when children are first rendered
 */
function cacheLazyFactory(element: ReactNode): void {
  if (!React.isValidElement(element)) return

  const elementType = element.type as LazyComponentType
  if (elementType?._payload) {
    const payload = elementType._payload
    // Only cache if status is uninitialized and result is a function (the factory)
    if (payload._status === LAZY_UNINITIALIZED && typeof payload._result === 'function') {
      lazyFactoryCache.set(elementType, payload._result as () => Promise<{ default: React.ComponentType }>)
    }
  }

  // Recursively cache children
  const props = element.props as { children?: ReactNode }
  if (props?.children) {
    React.Children.forEach(props.children, cacheLazyFactory)
  }
}

/**
 * Reset React.lazy component's internal cache to allow retry
 * This traverses the element tree and resets any lazy components found
 */
function resetLazyComponentCache(element: ReactNode): void {
  if (!React.isValidElement(element)) return

  // Check if this element's type is a lazy component
  const elementType = element.type as LazyComponentType
  if (elementType?._payload && typeof elementType._payload._status === 'number') {
    const payload = elementType._payload
    // Only reset if in error state (status 2 = Rejected)
    if (payload._status === 2) {
      // Get the original factory from cache
      const originalFactory = lazyFactoryCache.get(elementType)
      if (originalFactory) {
        // Reset to uninitialized state with original factory
        payload._status = LAZY_UNINITIALIZED
        payload._result = originalFactory
      }
    }
  }

  // Recursively check children
  const props = element.props as { children?: ReactNode }
  if (props?.children) {
    React.Children.forEach(props.children, resetLazyComponentCache)
  }
}

/**
 * Error boundary component for route errors
 * Catches errors in child components and displays error UI with retry option
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  private factoriesCached = false

  constructor(props: RouteErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, retryKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Route error:', error, errorInfo)
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.pathname !== this.props.pathname) {
      this.setState({ hasError: false, error: null })
    }
  }

  handleRetry = (): void => {
    // Reset lazy component cache so they will re-attempt loading
    resetLazyComponentCache(this.props.children)
    // Increment retryKey to force re-mounting of children (including lazy components)
    this.setState((state) => ({ hasError: false, error: null, retryKey: state.retryKey + 1 }))
  }

  render(): ReactNode {
    // Cache lazy component factories on first render (before any errors)
    if (!this.factoriesCached) {
      cacheLazyFactory(this.props.children)
      this.factoriesCached = true
    }

    if (this.state.hasError) {
      return <RouteErrorFallback error={this.state.error} onRetry={this.handleRetry} />
    }

    // Use key to force re-mounting children on retry
    return <div key={this.state.retryKey} className={this.props.className}>{this.props.children}</div>
  }
}

interface RouteErrorFallbackProps {
  error: Error | null
  onRetry: () => void
}

/**
 * Error fallback UI component
 */
function RouteErrorFallback({ error, onRetry }: Readonly<RouteErrorFallbackProps>): ReactNode {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    padding: '24px',
    textAlign: 'center',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    marginRight: '8px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  }

  const linkStyle: React.CSSProperties = {
    color: '#3b82f6',
    textDecoration: 'underline',
  }

  return (
    <div style={containerStyle} role="alert">
      <h2 style={{ marginBottom: '16px', color: '#dc2626' }}>Something went wrong</h2>
      <p style={{ marginBottom: '8px', color: '#6b7280' }}>
        Failed to load this page. Try refreshing the page.
      </p>
      {error && (
        <p style={{ marginBottom: '16px', color: '#9ca3af', fontSize: '14px' }}>
          {error.message}
        </p>
      )}
      <div>
        <button type="button" style={buttonStyle} onClick={onRetry}>
          Retry
        </button>
        <Link to="/dashboard" style={linkStyle}>
          Go to Dashboard
        </Link>
      </div>
    </div>
  )
}
