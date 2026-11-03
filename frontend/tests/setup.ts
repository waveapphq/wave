import { afterAll, afterEach, beforeEach, vi, beforeAll } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'

// Extend the default waitFor/findBy timeout. Under high vitest parallelism
// (many workers on many-core machines) CPU contention can stretch async
// renders past the 1s default, producing flaky timeouts in otherwise-correct
// tests. 5s is still well below any real bug threshold. GitHub runners are
// CPU-starved, so lazy route pages can take 10s to appear there.
configure({ asyncUtilTimeout: process.env.GITHUB_ACTIONS === 'true' ? 20000 : 5000 })

// Import tree-sitter initialization for expression validation tests
// This is needed because expression validation uses tree-sitter WASM
import { initializeTreeSitter } from '../src/features/workbench/lib/tree-sitter-init'
import { useLayoutSessionStore } from '../src/stores/layout-session-store'

// Fix userEvent + fake timers compatibility with Vitest
// @testing-library/react checks for Jest's presence; this tricks it into working with Vitest
// See: https://github.com/testing-library/user-event/issues/1115
declare global {
  // eslint-disable-next-line no-var
  var jest: unknown
}

// Set up global jest object for @testing-library/react compatibility at module load time
// This ensures it's available before any tests run
globalThis.jest = {
  advanceTimersByTime: vi.advanceTimersByTime.bind(vi),
}

// jsdom does not implement HTMLCanvasElement.getContext (it just emits a
// "Not implemented" warning to stderr). The CI script treats unexpected
// stderr output as a test failure. Several components call getContext('2d')
// for measurement (e.g. WorkflowNode's name-wrap detector); install a stub
// that returns a minimal mock so the warning never fires. The stub returns
// `null`-compatible defaults so callers correctly fall through their early
// returns (which is what jsdom's not-implemented path would have done after
// the warning).
if (typeof HTMLCanvasElement !== 'undefined') {
  const stubContext = {
    font: '',
    measureText: () => ({ width: 0 }) as TextMetrics,
  }
  ;(HTMLCanvasElement.prototype as unknown as {
    getContext: () => unknown
  }).getContext = () => stubContext
}

// Global fetch mock to prevent any real API calls during tests
// CRITICAL: This REJECTS with an error for unmocked calls to make tests FAIL
// Tests must mock all API calls - real backend calls are NEVER allowed
const fallbackFetchMock = vi.fn().mockImplementation((url: string | URL | Request) => {
  const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
  const errorMessage = `[UNMOCKED FETCH] Test made a real API call to: ${urlStr}

This is a test isolation violation. Frontend unit tests must NEVER call real APIs.
Fix: Mock this API call using vi.mock() or vi.spyOn() before running the test.`

  console.error(errorMessage)
  // Return a rejected promise that will fail the test
  return Promise.reject(new Error(errorMessage))
})

// Set up fallback fetch mock only if fetch hasn't been mocked yet
// Check if fetch is already a vi mock (has mockClear method)
beforeAll(() => {
  if (!('mockClear' in global.fetch)) {
    global.fetch = fallbackFetchMock
  }
})

// Initialize tree-sitter for expression validation tests
// This is done globally because many component tests use expression validation
// Note: We don't reset the parser after tests - it's a singleton that stays initialized
beforeAll(async () => {
  await initializeTreeSitter()
})

// Handle React's concurrent mode error recovery exceptions
// These are thrown in development mode when error boundaries recover from errors
// NOTE: We don't mock console.error here because individual tests may spy on it
// and need to see the actual calls

// Suppress the unhandled exception that React throws during error recovery
// This is caught at the process level since window.onerror doesn't catch it in Node
if (typeof process !== 'undefined') {
  process.on('uncaughtException', (error) => {
    if (
      error.message &&
      error.message.includes('There was an error during concurrent rendering')
    ) {
      // Suppress this expected React 19 error recovery exception
      return
    }
    // Re-throw other uncaught exceptions
    throw error
  })
}

// Mock auth store with configurable state
// Tests can override authMockState before rendering
export const authMockState = {
  isAuthenticated: true,
  isLoading: false,
}

// Mock preload registry with configurable spies
// Tests can access these to verify preloading behavior
export const preloadMockSpies = {
  preloadDetailPage: vi.fn(),
  preloadEditPage: vi.fn(),
  preloadLivePage: vi.fn(),
  preloadRoute: vi.fn(),
  preloadWithPriority: vi.fn(),
  registerPreloadHint: vi.fn(),
}

// Mock navigation patterns with configurable spies
export const navigationPatternSpies = {
  registerPattern: vi.fn(),
  getPreloadSuggestions: vi.fn().mockReturnValue([]),
}

// Mock clipboard API for tests that need to check copy behavior
// This mock is set up in beforeAll and cleared in afterEach
export const clipboardMock = {
  writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
  readText: vi.fn<() => Promise<string>>().mockResolvedValue(''),
  read: vi.fn<() => Promise<ClipboardItems>>().mockResolvedValue([]),
  write: vi.fn<(items: ClipboardItems) => Promise<void>>().mockResolvedValue(undefined),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
}

// jsdom's Clipboard methods are not writable, so the whole object is replaced.
// user-event's setup() swaps in its own stub and never puts this one back, so
// every test re-installs it.
function installClipboardMock(): void {
  try {
    // @ts-expect-error - the property must be deleted before reassigning
    delete navigator.clipboard
  } catch {
    // Property may not be deletable
  }
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboardMock,
    configurable: true,
    writable: true,
  })
}

vi.mock('../src/app/preload-registry', () => ({
  usePreloadRegistry: () => preloadMockSpies,
  registerPreloadFunction: vi.fn(),
}))

vi.mock('../src/app/navigation-patterns', () => ({
  useNavigationPatterns: () => navigationPatternSpies,
}))

vi.mock('../src/features/auth/stores/auth-store', () => ({
  useAuthStore: vi.fn(() => ({
    get isAuthenticated() {
      return authMockState.isAuthenticated
    },
    get isLoading() {
      return authMockState.isLoading
    },
    login: vi.fn(() => {
      authMockState.isAuthenticated = true
    }),
    logout: vi.fn(() => {
      authMockState.isAuthenticated = false
    }),
    setLoading: vi.fn((loading: boolean) => {
      authMockState.isLoading = loading
    }),
  })),
}))

// Mock window.matchMedia for components that check reduced motion
// Guard for SSR tests running in node environment
beforeAll(() => {
  if (typeof window === 'undefined') {
    // Skip window mocks in node environment (SSR tests)
    return
  }

  // Mock DOMMatrixReadOnly for @xyflow/react which uses it for node transformations
  // jsdom doesn't implement this constructor, so we need to provide a mock
  if (typeof window.DOMMatrixReadOnly === 'undefined') {
    class DOMMatrixReadOnlyMock {
      readonly a: number = 1
      readonly b: number = 0
      readonly c: number = 0
      readonly d: number = 1
      readonly e: number = 0
      readonly f: number = 0
      readonly m11: number = 1
      readonly m12: number = 0
      readonly m13: number = 0
      readonly m14: number = 0
      readonly m21: number = 0
      readonly m22: number = 1
      readonly m23: number = 0
      readonly m24: number = 0
      readonly m31: number = 0
      readonly m32: number = 0
      readonly m33: number = 1
      readonly m34: number = 0
      readonly m41: number = 0
      readonly m42: number = 0
      readonly m43: number = 0
      readonly m44: number = 1
      readonly is2D: boolean = true
      readonly isIdentity: boolean = true

      constructor(_init?: string | number[]) {
        // Initialize from transform string or matrix values
        // For testing purposes, we just use identity matrix
      }

      flipX() { return new DOMMatrixReadOnlyMock() }
      flipY() { return new DOMMatrixReadOnlyMock() }
      inverse() { return new DOMMatrixReadOnlyMock() }
      multiply() { return new DOMMatrixReadOnlyMock() }
      rotate() { return new DOMMatrixReadOnlyMock() }
      rotateAxisAngle() { return new DOMMatrixReadOnlyMock() }
      rotateFromVector() { return new DOMMatrixReadOnlyMock() }
      scale() { return new DOMMatrixReadOnlyMock() }
      scale3d() { return new DOMMatrixReadOnlyMock() }
      scaleNonUniform() { return new DOMMatrixReadOnlyMock() }
      skewX() { return new DOMMatrixReadOnlyMock() }
      skewY() { return new DOMMatrixReadOnlyMock() }
      toFloat32Array() { return new Float32Array(16) }
      toFloat64Array() { return new Float64Array(16) }
      toJSON() { return {} }
      toString() { return 'matrix(1, 0, 0, 1, 0, 0)' }
      transformPoint() { return { x: 0, y: 0, z: 0, w: 1 } }
      translate() { return new DOMMatrixReadOnlyMock() }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).DOMMatrixReadOnly = DOMMatrixReadOnlyMock
  }

  // Mock ResizeObserver for components that use it (e.g., cmdk/Command, @radix-ui/react-dropdown-menu, @tanstack/react-virtual)
  class ResizeObserverMock implements ResizeObserver {
    private callback: ResizeObserverCallback
    private observedElements: Set<Element> = new Set()

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element) {
      // Skip callback if already observing this element to prevent infinite loops.
      // TanStack Virtual's measureElement uses ResizeObserver internally - when the
      // callback fires synchronously (as in this mock), _measureElement triggers a
      // re-render, which re-attaches the ref, calling observe() again → stack overflow.
      // Real browsers batch ResizeObserver callbacks asynchronously, avoiding this.
      const isNew = !this.observedElements.has(target)
      this.observedElements.add(target)
      if (!isNew) return
      // Immediately call callback with the element's dimensions
      // This is crucial for @tanstack/react-virtual to work in jsdom
      const rect = target.getBoundingClientRect()
      // Use inline style height if getBoundingClientRect returns 0 (jsdom limitation)
      const height = rect.height || parseInt((target as HTMLElement).style?.height || '200', 10)
      const width = rect.width || parseInt((target as HTMLElement).style?.width || '400', 10)
      const entry = {
        target,
        contentRect: { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0, toJSON: () => ({}) },
        borderBoxSize: [{ inlineSize: width, blockSize: height }],
        contentBoxSize: [{ inlineSize: width, blockSize: height }],
        devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
      } as ResizeObserverEntry
      // Call callback synchronously for test environment
      // Real ResizeObserver is async, but jsdom tests need immediate updates
      this.callback([entry], this)
    }

    unobserve(target: Element) {
      this.observedElements.delete(target)
    }

    disconnect() {
      this.observedElements.clear()
    }
  }
  global.ResizeObserver = ResizeObserverMock

  // Mock Element.scrollIntoView for components that use it (e.g., cmdk/Command component)
  Element.prototype.scrollIntoView = vi.fn()

  // Mock hasPointerCapture for Radix Select component
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()

  // Mock getClientRects for CodeMirror (used for text measurements)
  // jsdom's Range.getClientRects returns an empty object, not a proper DOMRectList
  // CodeMirror needs this for cursor positioning and text measurements
  const createDOMRect = (x = 0, y = 0, width = 10, height = 16): DOMRect => ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  })

  const mockDOMRectList = (): DOMRectList => {
    const rects = [createDOMRect()]
    return Object.assign(rects, {
      item: (index: number) => rects[index] ?? null,
      length: rects.length,
      [Symbol.iterator]: () => rects[Symbol.iterator](),
    }) as unknown as DOMRectList
  }

  // Mock Range.getClientRects for CodeMirror text measurements
  Range.prototype.getClientRects = vi.fn().mockReturnValue(mockDOMRectList())
  Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue(createDOMRect())

  // Mock matchMedia with full MediaQueryList interface
  // This is needed by shadcn's use-mobile hook and our responsive components
  const createMatchMediaMock = (query: string) => ({
    matches: query.includes('max-width') ? false : false, // Desktop by default
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(createMatchMediaMock),
  })

  // Ensure window dimensions are set for responsive tests
  Object.defineProperty(window, 'innerWidth', { writable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { writable: true, value: 800 })

  // Mock scrollTo for scroll restoration tests
  window.scrollTo = vi.fn()

  installClipboardMock()

  // Make window.location.hash writable for tests
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      ...window.location,
      hash: '',
      pathname: '/',
      search: '',
      href: 'http://localhost/',
    },
  })
})

beforeEach(() => {
  installClipboardMock()
})

// Cleanup after each test and reset zustand store
afterEach(() => {
  // Only cleanup DOM in browser environment
  if (typeof window !== 'undefined') {
    cleanup()
    // Reset window.location.hash
    window.location.hash = ''
    // Clear localStorage to prevent test pollution
    if (typeof localStorage !== 'undefined' && localStorage?.clear) {
      localStorage.clear()
    }
    // Layout choices are kept per tab (SHELL-9): every test starts in a new tab.
    useLayoutSessionStore.setState(useLayoutSessionStore.getInitialState(), true)
    sessionStorage.clear()
  }
  // Reset auth state to default (authenticated)
  authMockState.isAuthenticated = true
  authMockState.isLoading = false
  // Reset preload registry spies
  Object.values(preloadMockSpies).forEach((spy) => spy.mockClear())
  // Reset navigation pattern spies
  Object.values(navigationPatternSpies).forEach((spy) => spy.mockClear())
  // Reset clipboard mock spies
  Object.values(clipboardMock).forEach((spy) => spy.mockClear())
  // Reset modules to ensure fresh imports in tests that expect module initialization
  // This is necessary for tests that verify module-level side effects like localStorage reads
  vi.resetModules()
})

// Coverage is taken right after afterAll; a module still loading then shifts that file's merged coverage.
type LoadingModule = { promise?: Promise<unknown>; evaluated?: boolean }
type ModuleCache = Map<string, LoadingModule> & { invalidateModule(mod: LoadingModule): boolean }
const { moduleCache } = (globalThis as unknown as { __vitest_worker__: { moduleCache: ModuleCache } }).__vitest_worker__
const moduleLoads = new Set<Promise<unknown>>()
const invalidateModule = moduleCache.invalidateModule.bind(moduleCache)
moduleCache.invalidateModule = (mod) => {
  if (mod.promise && !mod.evaluated) moduleLoads.add(mod.promise)
  return invalidateModule(mod)
}

afterAll(async () => {
  for (const mod of moduleCache.values()) if (mod.promise) moduleLoads.add(mod.promise)
  await Promise.allSettled(moduleLoads)
}, 60_000)

// Extend RouterProvider to accept children for testing purposes
// In react-router-dom v7, RouterProvider doesn't accept children directly
// but many tests rely on this pattern for isolated component testing
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()

  // Create a wrapper component that renders both routes and children
  // For tests using renderHook with children, we use the router directly
  // and render children as part of the router's routes
  const EnhancedRouterProvider: React.FC<{
    router: ReturnType<typeof actual.createMemoryRouter>
    children?: React.ReactNode
  }> = ({ router, children }) => {
    // If no children, just use normal RouterProvider
    if (!children) {
      return React.createElement(actual.RouterProvider, { router })
    }
    // For children, create a router that renders children at the current path
    // This ensures useBlocker and other hooks are connected to THIS router
    // Use stored initial entries if available (from enhanced createMemoryRouter)
    type RouterWithMeta = typeof router & {
      _initialEntries?: string[]
      _initialIndex?: number
    }
    const routerMeta = router as RouterWithMeta
    const initialEntries = routerMeta._initialEntries || [
      router.state.location.pathname + router.state.location.search,
    ]
    const initialIndex = routerMeta._initialIndex

    const childRouter = actual.createMemoryRouter(
      [
        {
          path: '*',
          element: children,
        },
      ],
      {
        initialEntries,
        initialIndex,
      }
    )
    // Sync navigation from original router to child router
    // When navigate is called on original router, call it on child router too
    // This makes useBlocker work since it's connected to childRouter
    router.navigate = ((to: unknown, opts?: unknown) => {
      // Navigate child router - this is where useBlocker is connected
      return childRouter.navigate(to as string, opts as undefined)
    }) as typeof router.navigate

    // Also expose child router's state on the original router for tests
    Object.defineProperty(router, 'state', {
      get() {
        return childRouter.state
      },
    })

    return React.createElement(actual.RouterProvider, { router: childRouter })
  }

  // Wrap createMemoryRouter to sync navigation with window.location
  // Also store initial entries for child router creation
  const enhancedCreateMemoryRouter: typeof actual.createMemoryRouter = (
    routes,
    opts
  ) => {
    const router = actual.createMemoryRouter(routes, opts)
    const originalNavigate = router.navigate.bind(router)

    // Store initial entries on router for EnhancedRouterProvider to use
    type RouterWithMeta = typeof router & {
      _initialEntries?: string[]
      _initialIndex?: number
    }
    const routerMeta = router as RouterWithMeta
    routerMeta._initialEntries = opts?.initialEntries as string[] | undefined
    routerMeta._initialIndex = opts?.initialIndex

    // Wrap navigate to sync window.location.hash
    router.navigate = ((to: Parameters<typeof router.navigate>[0], opts?: Parameters<typeof router.navigate>[1]) => {
      // Extract hash from navigation target synchronously
      if (typeof to === 'string' && to.includes('#')) {
        const hashIndex = to.indexOf('#')
        window.location.hash = to.slice(hashIndex)
      }
      // Call original navigate with proper types
      return originalNavigate(to, opts)
    }) as typeof router.navigate

    return router
  }

  // Fallback location for components rendered outside router context
  const fallbackLocation = {
    pathname: '/',
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }

  // Wrap hooks to handle being called outside router context
  const safeUseLocation = () => {
    try {
      return actual.useLocation()
    } catch {
      return fallbackLocation
    }
  }

  const safeUseNavigate = () => {
    try {
      return actual.useNavigate()
    } catch {
      // Return a no-op navigate function
      return vi.fn()
    }
  }

  // Wrap Link component to handle being used outside router context
  const SafeLink: React.FC<{
    to: string
    children?: React.ReactNode
    role?: string
    style?: React.CSSProperties
    [key: string]: unknown
  }> = ({ to, children, ...props }) => {
    // Try to use real Link, fall back to anchor tag if no router context
    try {
      const ctx = React.useContext((actual as { UNSAFE_NavigationContext: React.Context<unknown> }).UNSAFE_NavigationContext)
      if (ctx) {
        // Router context exists, use actual Link
        return React.createElement(actual.Link, { to, ...props }, children)
      }
    } catch {
      // No router context, fall through to anchor tag
    }
    // Fall back to anchor tag for tests without router context
    return React.createElement('a', { href: to, ...props }, children)
  }

  return {
    ...actual,
    RouterProvider: EnhancedRouterProvider,
    createMemoryRouter: enhancedCreateMemoryRouter,
    useLocation: safeUseLocation,
    useNavigate: safeUseNavigate,
    Link: SafeLink,
  }
})
