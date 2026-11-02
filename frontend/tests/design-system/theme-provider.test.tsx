/**
 * Theme Provider Tests
 *
 * REQ-5.2.1.8: Light and dark theme support with system preference detection
 *
 * Tests for the ThemeProvider component and useTheme hook that manage
 * theme state and provide theme context to the application.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme, useThemeSafe } from '@/design-system/theme-provider'

// Test component that uses the theme context
function ThemeConsumer() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')} data-testid="set-light">
        Light
      </button>
      <button onClick={() => setTheme('dark')} data-testid="set-dark">
        Dark
      </button>
      <button onClick={() => setTheme('system')} data-testid="set-system">
        System
      </button>
    </div>
  )
}

describe('ThemeProvider', () => {
  let originalMatchMedia: typeof window.matchMedia
  let mediaQueryListeners: ((e: MediaQueryListEvent) => void)[] = []

  const mockMatchMedia = (matches: boolean) => {
    return vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          mediaQueryListeners.push(listener)
        }
      }),
      removeEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          mediaQueryListeners = mediaQueryListeners.filter((l) => l !== listener)
        }
      }),
      dispatchEvent: vi.fn(),
    }))
  }

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    mediaQueryListeners = []
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark', 'light')
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('Initial Theme', () => {
    it('defaults to system theme when no preference is stored', () => {
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('system')
    })

    it('resolves to light when system prefers light mode', () => {
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
    })

    it('resolves to dark when system prefers dark mode', () => {
      window.matchMedia = mockMatchMedia(true)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    })

    it('uses stored theme from localStorage', () => {
      localStorage.setItem('wave-theme', 'dark')
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    })

    it('uses defaultTheme prop when provided and no stored preference', () => {
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
    })

    it('prefers stored theme over defaultTheme prop', () => {
      localStorage.setItem('wave-theme', 'light')
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('light')
    })
  })

  describe('Theme Switching', () => {
    it('switches to light theme when setTheme("light") is called', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-light'))

      expect(screen.getByTestId('current-theme')).toHaveTextContent('light')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
    })

    it('switches to dark theme when setTheme("dark") is called', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    })

    it('switches to system theme when setTheme("system") is called', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(true) // System prefers dark

      render(
        <ThemeProvider defaultTheme="light">
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-system'))

      expect(screen.getByTestId('current-theme')).toHaveTextContent('system')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    })
  })

  describe('DOM Attributes', () => {
    it('sets data-theme attribute on document element for light theme', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-light'))

      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })

    it('sets data-theme attribute on document element for dark theme', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    it('adds dark class to document element for dark theme', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('removes dark class from document element for light theme', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)
      document.documentElement.classList.add('dark')

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-light'))

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('tracks the resolved theme in the theme-color meta tag', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      meta.setAttribute('content', '#ffffff')
      document.head.appendChild(meta)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))
      expect(meta.getAttribute('content')).toBe('#09090b')

      await user.click(screen.getByTestId('set-light'))
      expect(meta.getAttribute('content')).toBe('#ffffff')

      meta.remove()
    })

    it('applies the theme when the document has no theme-color meta tag', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)
      expect(document.querySelector('meta[name="theme-color"]')).toBeNull()

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  describe('Persistence', () => {
    it('persists theme choice to localStorage', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(localStorage.getItem('wave-theme')).toBe('dark')
    })

    it('uses custom storageKey when provided', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider storageKey="custom-theme-key">
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(localStorage.getItem('custom-theme-key')).toBe('dark')
    })

    it('does not persist theme when disableStorage is true', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider disableStorage>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      expect(localStorage.getItem('wave-theme')).toBeNull()
    })
  })

  describe('System Preference Changes', () => {
    it('updates resolved theme when system preference changes', async () => {
      let currentMediaQuery: { matches: boolean } = { matches: false }
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' ? currentMediaQuery.matches : false
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            mediaQueryListeners.push(listener)
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')

      // Simulate system preference change
      currentMediaQuery = { matches: true }
      act(() => {
        mediaQueryListeners.forEach((listener) => {
          listener({ matches: true } as MediaQueryListEvent)
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
      })
    })

    it('updates resolved theme when system preference changes from dark to light', async () => {
      let currentMediaQuery: { matches: boolean } = { matches: true }
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' ? currentMediaQuery.matches : false
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            mediaQueryListeners.push(listener)
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')

      // Simulate system preference change from dark to light
      currentMediaQuery = { matches: false }
      act(() => {
        mediaQueryListeners.forEach((listener) => {
          listener({ matches: false } as MediaQueryListEvent)
        })
      })

      await waitFor(() => {
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
      })
    })

    it('does not change resolved theme when explicit theme is set', async () => {
      const user = userEvent.setup()
      let currentMediaQuery: { matches: boolean } = { matches: false }
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' ? currentMediaQuery.matches : false
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            mediaQueryListeners.push(listener)
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      // Set explicit light theme
      await user.click(screen.getByTestId('set-light'))
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')

      // Simulate system preference change to dark
      currentMediaQuery = { matches: true }
      act(() => {
        mediaQueryListeners.forEach((listener) => {
          listener({ matches: true } as MediaQueryListEvent)
        })
      })

      // Should still be light because explicit theme was set
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
    })
  })

  describe('useTheme Hook', () => {
    it('throws error when used outside ThemeProvider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      function TestComponent() {
        useTheme()
        return null
      }

      expect(() => render(<TestComponent />)).toThrow('useTheme must be used within a ThemeProvider')

      consoleError.mockRestore()
    })

    it('provides themes array with available themes', () => {
      window.matchMedia = mockMatchMedia(false)

      function ThemesConsumer() {
        const { themes } = useTheme()
        return <span data-testid="themes">{themes.join(',')}</span>
      }

      render(
        <ThemeProvider>
          <ThemesConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('themes')).toHaveTextContent('light,dark,system')
    })
  })

  describe('useThemeSafe Hook', () => {
    it('provides fallback values when used outside ThemeProvider', () => {
      function SafeThemeConsumer() {
        const { theme, resolvedTheme, themes, setTheme } = useThemeSafe()
        return (
          <div>
            <span data-testid="safe-theme">{theme}</span>
            <span data-testid="safe-resolved">{resolvedTheme}</span>
            <span data-testid="safe-themes">{themes.join(',')}</span>
            <button onClick={() => setTheme('dark')} data-testid="safe-set">
              Set
            </button>
          </div>
        )
      }

      render(<SafeThemeConsumer />)

      expect(screen.getByTestId('safe-theme')).toHaveTextContent('system')
      expect(screen.getByTestId('safe-resolved')).toHaveTextContent('light')
      expect(screen.getByTestId('safe-themes')).toHaveTextContent('light,dark,system')
    })

    it('calls no-op setTheme without error when outside ThemeProvider', async () => {
      const user = userEvent.setup()

      function SafeThemeConsumer() {
        const { setTheme } = useThemeSafe()
        return (
          <button onClick={() => setTheme('dark')} data-testid="safe-set">
            Set
          </button>
        )
      }

      render(<SafeThemeConsumer />)

      // Should not throw when called
      const button = screen.getByTestId('safe-set')
      await user.click(button)
      expect(button).toBeInTheDocument()
    })

    it('returns actual context values when inside ThemeProvider', () => {
      window.matchMedia = mockMatchMedia(true) // dark mode

      function SafeThemeConsumer() {
        const { theme, resolvedTheme } = useThemeSafe()
        return (
          <div>
            <span data-testid="safe-theme">{theme}</span>
            <span data-testid="safe-resolved">{resolvedTheme}</span>
          </div>
        )
      }

      render(
        <ThemeProvider defaultTheme="dark">
          <SafeThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('safe-theme')).toHaveTextContent('dark')
      expect(screen.getByTestId('safe-resolved')).toHaveTextContent('dark')
    })
  })

  describe('Dark Theme Color Tokens', () => {
    it('applies dark theme color tokens when dark theme is active', async () => {
      const user = userEvent.setup()
      window.matchMedia = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      await user.click(screen.getByTestId('set-dark'))

      // Dark theme should be applied via data-theme attribute
      // The actual color values are tested in design-tokens.test.ts
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  describe('Flash Prevention', () => {
    it('applies theme before first paint by setting attribute synchronously', () => {
      localStorage.setItem('wave-theme', 'dark')
      window.matchMedia = mockMatchMedia(false)

      // The theme should be applied immediately, not after hydration
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      // Theme attribute should be set immediately
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })
})
