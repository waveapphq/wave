/**
 * Theme Provider
 *
 * REQ-5.2.1.8: Light and dark theme support with system preference detection
 *
 * Provides theme context to the application with support for light, dark,
 * and system themes. Persists preference to localStorage and responds to
 * system preference changes.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light' | 'dark'
  themes: Theme[]
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const THEMES: Theme[] = ['light', 'dark', 'system']
const DEFAULT_STORAGE_KEY = 'wave-theme'

// Mobile browser chrome color. Must track --color-bg-page in index.css.
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark: '#09090b',
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableStorage?: boolean
}

function getSystemTheme(): 'light' | 'dark' {
  /* v8 ignore start - COV-SSR-004 */
  if (globalThis.window === undefined || typeof globalThis.window.matchMedia !== 'function') {
    return 'light'
  }
  /* v8 ignore stop */
  const result = globalThis.window.matchMedia('(prefers-color-scheme: dark)')
  return result?.matches ? 'dark' : 'light'
}

function getStoredTheme(storageKey: string): Theme | null {
  const stored = localStorage.getItem(storageKey)
  if (stored && THEMES.includes(stored as Theme)) {
    return stored as Theme
  }
  return null
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = DEFAULT_STORAGE_KEY,
  disableStorage = false,
}: Readonly<ThemeProviderProps>) {
  // Initialize theme from storage or default
  const [theme, setTheme] = useState<Theme>(() => {
    if (!disableStorage) {
      const stored = getStoredTheme(storageKey)
      if (stored) {
        return stored
      }
    }
    return defaultTheme
  })

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme)

  // Compute the resolved theme
  const resolvedTheme = useMemo((): 'light' | 'dark' => {
    if (theme === 'system') {
      return systemTheme
    }
    return theme
  }, [theme, systemTheme])

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement

    // Set data-theme attribute
    root.dataset.theme = resolvedTheme

    // Toggle dark class
    if (resolvedTheme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // The in-app toggle can disagree with the OS, so this cannot be a
    // media-scoped tag in index.html.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', THEME_COLOR[resolvedTheme])
    }
  }, [resolvedTheme])

  // Listen for system preference changes
  useEffect(() => {
    /* v8 ignore start - COV-SSR-005 */
    if (globalThis.window === undefined || typeof globalThis.window.matchMedia !== 'function') {
      return
    }
    /* v8 ignore stop */

    const mediaQuery = globalThis.window.matchMedia('(prefers-color-scheme: dark)')
    /* v8 ignore start - COV-SSR-006 */
    if (!mediaQuery || typeof mediaQuery.addEventListener !== 'function') {
      return
    }
    /* v8 ignore stop */

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  // Theme setter with persistence
  const handleSetTheme = useCallback(
    (newTheme: Theme) => {
      setTheme(newTheme)
      if (!disableStorage) {
        localStorage.setItem(storageKey, newTheme)
      }
    },
    [disableStorage, storageKey]
  )

  const value = useMemo(
    (): ThemeContextValue => ({
      theme,
      setTheme: handleSetTheme,
      resolvedTheme,
      themes: THEMES,
    }),
    [theme, handleSetTheme, resolvedTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

/**
 * Safe version of useTheme that provides fallback values when not inside ThemeProvider.
 * Use this for components that may be rendered in isolation (e.g., in tests) without
 * the full provider tree.
 */
export function useThemeSafe(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    return {
      theme: 'system',
      setTheme: () => {},
      resolvedTheme: 'light',
      themes: THEMES,
    }
  }
  return context
}
