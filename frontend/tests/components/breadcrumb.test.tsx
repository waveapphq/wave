/**
 * Breadcrumb Component Tests
 *
 * REQ-5.2.1.25: Breadcrumb navigation
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Breadcrumb component following design system specifications.
 *
 * Breadcrumb specifications:
 * - Container: Vertical padding space-2 (8px)
 * - Link text: text-sm (14px), font-medium (500), --color-text-secondary
 * - Link hover: --color-text-primary + underline
 * - Current text: font-normal (400), --color-text-muted
 * - Separator icon: icon-sm (16px), --color-text-muted
 * - Item gap: space-1 (4px)
 * - Separator margins: space-2 (8px) each side
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { useRef } from 'react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from '@/components/ui/breadcrumb'

// Basic route config for testing navigation
const testRouteConfig = [
  { path: '*', element: <div data-testid="route-content">Content</div> },
]

describe('Breadcrumb Component', () => {
  describe('Rendering', () => {
    it('renders breadcrumb navigation container', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('renders ordered list for path sequence', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('list')).toBeInTheDocument()
    })

    it('renders list items for each breadcrumb segment', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current Test</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('renders links for navigable items', () => {
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/tests/test-1'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )
      expect(screen.getAllByRole('link')).toHaveLength(2)
    })

    it('renders current page as non-interactive text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current Page</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const currentPage = screen.getByText('Current Page')
      expect(currentPage).toBeInTheDocument()
      expect(currentPage.tagName).not.toBe('A')
    })

    it('renders separator between items', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toBeInTheDocument()
    })

    it('renders chevron icon as separator by default', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const separator = screen.getByTestId('separator')
      // Separator should contain a chevron icon
      expect(separator.querySelector('svg')).toBeInTheDocument()
    })

    it('supports custom separator content', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <span data-testid="custom-separator">/</span>
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('custom-separator')).toHaveTextContent('/')
    })
  })

  describe('Component Anatomy', () => {
    it('root item represents application home', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const homeLink = screen.getByRole('link', { name: 'Home' })
      expect(homeLink).toHaveAttribute('href', '/')
    })

    it('path items are intermediate navigation levels as clickable links', () => {
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/regressions/reg-1/suites/suite-1'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/regressions">Regressions</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/regressions/reg-1">Regression 1</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Suite 1</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )
      expect(screen.getByRole('link', { name: 'Regressions' })).toHaveAttribute('href', '/regressions')
      expect(screen.getByRole('link', { name: 'Regression 1' })).toHaveAttribute('href', '/regressions/reg-1')
    })

    it('current item shows active page as non-interactive', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Active Page</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const currentPage = screen.getByText('Active Page')
      // Should not be a link
      expect(currentPage.closest('a')).toBeNull()
    })

    it('separators use chevron icons to indicate directional flow', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="sep" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const separator = screen.getByTestId('sep')
      // Should be hidden from screen readers (decorative)
      expect(separator).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Visual Integration - Design System Compliance', () => {
    it('applies vertical padding space-2 (8px) to container', () => {
      render(
        <Breadcrumb data-testid="breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('breadcrumb')).toHaveClass('py-2')
    })

    it('applies text-sm (14px) to link text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('text-sm')
    })

    it('applies font-medium (500) to link text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('font-medium')
    })

    it('applies text-secondary color to link text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('text-secondary')
    })

    it('applies hover:text-primary to link', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('hover:text-primary')
    })

    it('applies hover:underline to link', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('hover:underline')
    })

    it('applies font-normal (400) to current page text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="current">Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('current')).toHaveClass('font-normal')
    })

    it('applies text-muted color to current page', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="current">Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('current')).toHaveClass('text-muted')
    })

    it('applies text-muted color to separator icon', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toHaveClass('text-muted')
    })

    it('applies icon-sm size (16px) to separator icon via h-4 w-4', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const separator = screen.getByTestId('separator')
      const icon = separator.querySelector('svg')
      expect(icon).toHaveClass('h-4')
      expect(icon).toHaveClass('w-4')
    })

    it('applies gap-1 (4px) between items', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('gap-1')
    })

    it('applies mx-2 (8px margins) to separator', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toHaveClass('mx-2')
    })

    it('applies flex layout to list', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('flex')
    })

    it('applies items-center to list for vertical alignment', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('items-center')
    })

    it('applies flex-wrap to allow wrapping on narrow screens', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('flex-wrap')
    })

    it('applies inline-flex to BreadcrumbItem for proper inline flow', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem data-testid="item">
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('item')).toHaveClass('inline-flex')
    })

    it('applies items-center to BreadcrumbItem for vertical alignment', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem data-testid="item">
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('item')).toHaveClass('items-center')
    })
  })

  describe('Interaction Behavior', () => {
    it('link transitions to primary color on hover', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('hover:text-primary')
    })

    it('link gains underline on hover', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('hover:underline')
    })

    it('link shows focus ring for keyboard navigation', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('focus-visible:ring-2')
    })

    it('link applies transition for smooth state changes', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('transition-colors')
    })

    it('current page is visually static (no hover effects)', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="current">Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const current = screen.getByTestId('current')
      // Should not have hover classes
      expect(current).not.toHaveClass('hover:text-primary')
      expect(current).not.toHaveClass('hover:underline')
    })

    it('navigates to target when link is clicked', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/tests/test-1'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      await user.click(screen.getByRole('link', { name: 'Tests' }))
      expect(router.state.location.pathname).toBe('/tests')
    })
  })

  describe('Hierarchy Representation', () => {
    it('maps WAVE hierarchy: Home → entity type → entity → detail', () => {
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/tests/test-123/blocks/block-1'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/tests/test-123">Login Test</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Setup Block</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Tests' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Login Test' })).toBeInTheDocument()
      expect(screen.getByText('Setup Block')).toBeInTheDocument()
    })

    it('supports Regressions hierarchy', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/regressions">Regressions</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Sprint 42 Regression</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      expect(screen.getByRole('link', { name: 'Regressions' })).toHaveAttribute('href', '/regressions')
    })

    it('supports Suites hierarchy', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/suites">Suites</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Authentication Suite</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      expect(screen.getByRole('link', { name: 'Suites' })).toHaveAttribute('href', '/suites')
    })

    it('supports Blocks hierarchy', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/tests/test-1">Test 1</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Block Details</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      expect(screen.getAllByRole('link')).toHaveLength(3)
    })
  })

  describe('Overflow Handling', () => {
    it('renders ellipsis element for collapsed items', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/parent">Parent</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('ellipsis')).toBeInTheDocument()
    })

    it('ellipsis is a clickable button', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const ellipsis = screen.getByTestId('ellipsis')
      expect(ellipsis.tagName).toBe('BUTTON')
    })

    it('ellipsis has appropriate aria-label', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('ellipsis')).toHaveAttribute('aria-label', 'Show more breadcrumbs')
    })

    it('ellipsis displays three dots icon', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const ellipsis = screen.getByTestId('ellipsis')
      // Should contain an icon representing ellipsis (MoreHorizontal)
      expect(ellipsis.querySelector('svg')).toBeInTheDocument()
    })

    it('ellipsis has hover styling', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('ellipsis')).toHaveClass('hover:bg-subtle')
    })

    it('ellipsis is keyboard focusable', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.tab()
      expect(screen.getByTestId('ellipsis')).toHaveFocus()
    })

    it('ellipsis shows focus ring', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('ellipsis')).toHaveClass('focus-visible:ring-2')
    })

    it('preserves root when collapsing deep hierarchy', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/parent">Parent</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    })

    it('preserves immediate parent when collapsing', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/parent">Parent</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('link', { name: 'Parent' })).toBeInTheDocument()
    })

    it('preserves current item when collapsing', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/parent">Parent</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByText('Current')).toBeInTheDocument()
    })

    it('pressing Enter on ellipsis opens dropdown menu', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                ]}
              />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      const ellipsis = screen.getByTestId('ellipsis')
      ellipsis.focus()
      await user.keyboard('{Enter}')

      // Dropdown menu should appear
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('pressing Space on ellipsis opens dropdown menu', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                ]}
              />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      const ellipsis = screen.getByTestId('ellipsis')
      ellipsis.focus()
      await user.keyboard(' ')

      // Dropdown menu should appear
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('clicking ellipsis opens dropdown menu', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      const ellipsis = screen.getByTestId('ellipsis')
      await user.click(ellipsis)

      // Dropdown menu should appear
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('dropdown contains hidden path segments as navigation links', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                  { href: '/regressions/reg-1', label: 'Regression 1' },
                ]}
              />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/parent">Parent</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.click(screen.getByTestId('ellipsis'))

      // Hidden items should appear as links in the dropdown
      const menu = screen.getByRole('menu')
      expect(within(menu).getByRole('menuitem', { name: 'Regressions' })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: 'Regression 1' })).toBeInTheDocument()
    })

    it('clicking hidden item in dropdown navigates to that path', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/current'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis
                  data-testid="ellipsis"
                  hiddenItems={[
                    { href: '/regressions', label: 'Regressions' },
                  ]}
                />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Current</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      await user.click(screen.getByTestId('ellipsis'))
      await user.click(screen.getByRole('menuitem', { name: 'Regressions' }))

      expect(router.state.location.pathname).toBe('/regressions')
    })

    it('dropdown closes after selecting an item', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                ]}
              />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.click(screen.getByTestId('ellipsis'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(screen.getByRole('menuitem', { name: 'Regressions' }))

      // Menu should close after selection
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('dropdown can be closed by pressing Escape', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                ]}
              />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.click(screen.getByTestId('ellipsis'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('pressing Escape on menu item closes dropdown', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis
                data-testid="ellipsis"
                hiddenItems={[
                  { href: '/regressions', label: 'Regressions' },
                ]}
              />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.click(screen.getByTestId('ellipsis'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      // Focus a menu item and press Escape - tests handleMenuKeyDown
      const menuItem = screen.getByRole('menuitem', { name: 'Regressions' })
      menuItem.focus()
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('pressing Enter on dropdown menu item navigates to that path', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/current'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis
                  data-testid="ellipsis"
                  hiddenItems={[
                    { href: '/regressions', label: 'Regressions' },
                  ]}
                />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Current</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      await user.click(screen.getByTestId('ellipsis'))
      const menuItem = screen.getByRole('menuitem', { name: 'Regressions' })
      menuItem.focus()
      await user.keyboard('{Enter}')

      expect(router.state.location.pathname).toBe('/regressions')
    })

    it('pressing Space on dropdown menu item navigates to that path', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/current'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis
                  data-testid="ellipsis"
                  hiddenItems={[
                    { href: '/tests', label: 'Tests' },
                  ]}
                />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Current</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      await user.click(screen.getByTestId('ellipsis'))
      const menuItem = screen.getByRole('menuitem', { name: 'Tests' })
      menuItem.focus()
      await user.keyboard(' ')

      expect(router.state.location.pathname).toBe('/tests')
    })

    it('dropdown can be closed by clicking outside', async () => {
      const user = userEvent.setup()

      render(
        <div>
          <div data-testid="outside">Outside area</div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbEllipsis
                  data-testid="ellipsis"
                  hiddenItems={[
                    { href: '/regressions', label: 'Regressions' },
                  ]}
                />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      )

      await user.click(screen.getByTestId('ellipsis'))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(screen.getByTestId('outside'))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Responsive Adaptation', () => {
    it('applies responsive classes for complete trail on desktop', () => {
      render(
        <Breadcrumb data-testid="breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      // Component should be visible by default (desktop)
      expect(screen.getByTestId('breadcrumb')).toBeVisible()
    })

    it('applies flex-wrap to handle narrow screens gracefully', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('flex-wrap')
    })

    it('items can be conditionally hidden on mobile via className', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:inline-flex" data-testid="home-item">
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      // The home item has responsive class
      expect(screen.getByTestId('home-item')).toHaveClass('hidden')
      expect(screen.getByTestId('home-item')).toHaveClass('md:inline-flex')
    })
  })

  describe('Accessibility Compliance', () => {
    it('wraps breadcrumb in nav element', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    })

    it('nav has aria-label="Breadcrumb"', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'Breadcrumb')
    })

    it('supports custom aria-label', () => {
      render(
        <Breadcrumb aria-label="Custom Navigation">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'Custom Navigation')
    })

    it('uses ordered list (ol) for path sequence', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const list = screen.getByRole('list')
      expect(list.tagName).toBe('OL')
    })

    it('current page has aria-current="page"', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Current Page</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByText('Current Page')).toHaveAttribute('aria-current', 'page')
    })

    it('links are keyboard navigable', async () => {
      const user = userEvent.setup()

      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/tests">Tests</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )

      await user.tab()
      expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()

      await user.tab()
      expect(screen.getByRole('link', { name: 'Tests' })).toHaveFocus()
    })

    it('separator is hidden from screen readers', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toHaveAttribute('aria-hidden', 'true')
    })

    it('separator has aria-hidden="true"', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toHaveAttribute('aria-hidden', 'true')
    })

    it('Enter key activates focused link', async () => {
      const user = userEvent.setup()
      const router = createMemoryRouter(testRouteConfig, {
        initialEntries: ['/current'],
      })

      render(
        // @ts-expect-error - RouterProvider with children is valid for testing in react-router v7
        <RouterProvider router={router}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Current</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </RouterProvider>
      )

      await user.tab()
      expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()

      await user.keyboard('{Enter}')
      expect(router.state.location.pathname).toBe('/')
    })

    it('focus indicators meet visibility requirements', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      const link = screen.getByTestId('link')
      expect(link).toHaveClass('focus-visible:ring-2')
      expect(link).toHaveClass('focus-visible:outline-none')
    })

    it('link touch targets meet minimum size requirements (min-h-[44px])', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      // WCAG 2.1 requires 44x44px minimum touch target
      expect(screen.getByTestId('link')).toHaveClass('min-h-[44px]')
    })

    it('ellipsis touch target meets minimum size requirements', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      // WCAG 2.1 requires 44x44px minimum touch target
      expect(screen.getByTestId('ellipsis')).toHaveClass('min-h-[44px]')
      expect(screen.getByTestId('ellipsis')).toHaveClass('min-w-[44px]')
    })
  })

  describe('Custom Styling', () => {
    it('accepts custom className on Breadcrumb', () => {
      render(
        <Breadcrumb className="custom-breadcrumb" data-testid="breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('breadcrumb')).toHaveClass('custom-breadcrumb')
    })

    it('accepts custom className on BreadcrumbList', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList className="custom-list" data-testid="list">
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('list')).toHaveClass('custom-list')
    })

    it('accepts custom className on BreadcrumbItem', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="custom-item" data-testid="item">
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('item')).toHaveClass('custom-item')
    })

    it('accepts custom className on BreadcrumbLink', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" className="custom-link" data-testid="link">
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('custom-link')
    })

    it('accepts custom className on BreadcrumbPage', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="custom-page" data-testid="page">
                Current
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('page')).toHaveClass('custom-page')
    })

    it('accepts custom className on BreadcrumbSeparator', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="custom-separator" data-testid="separator" />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('separator')).toHaveClass('custom-separator')
    })

    it('accepts custom className on BreadcrumbEllipsis', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis className="custom-ellipsis" data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('ellipsis')).toHaveClass('custom-ellipsis')
    })

    it('passes through additional HTML attributes', () => {
      render(
        <Breadcrumb data-custom="value" data-testid="breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('breadcrumb')).toHaveAttribute('data-custom', 'value')
    })
  })

  describe('Ref Handling', () => {
    it('forwards ref to Breadcrumb nav element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb ref={ref}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLElement)
    })

    it('forwards ref to BreadcrumbList ol element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList ref={ref}>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('OL')
    })

    it('forwards ref to BreadcrumbItem li element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem ref={ref}>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('LI')
    })

    it('forwards ref to BreadcrumbLink anchor element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" ref={ref}>Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('A')
    })

    it('forwards ref to BreadcrumbPage span element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage ref={ref}>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('SPAN')
    })

    it('forwards ref to BreadcrumbSeparator li element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator ref={ref} />
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('LI')
    })

    it('forwards ref to BreadcrumbEllipsis button element', () => {
      const ref = vi.fn()
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis ref={ref} />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0].tagName).toBe('BUTTON')
    })

    it('forwards object ref to BreadcrumbEllipsis span element', () => {
      // Test component that uses useRef (object ref)
      function TestComponent() {
        const ellipsisRef = useRef<HTMLButtonElement>(null)
        return (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbEllipsis ref={ellipsisRef} data-testid="ellipsis" />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )
      }

      render(<TestComponent />)
      const ellipsis = screen.getByTestId('ellipsis')
      expect(ellipsis.tagName).toBe('BUTTON')
    })
  })

  describe('Icon Support', () => {
    it('supports home icon in root link', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">
                <span data-testid="home-icon">🏠</span>
                <span className="sr-only">Home</span>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('home-icon')).toBeInTheDocument()
    })

    it('supports icons alongside text in links', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">
                <span data-testid="icon">📁</span>
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('icon')).toBeInTheDocument()
      expect(screen.getByRole('link')).toHaveTextContent('Home')
    })
  })

  describe('Animation and Transitions', () => {
    it('applies transition-colors for smooth hover effects', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('link')).toHaveClass('transition-colors')
    })

    it('respects reduced motion preference', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" data-testid="link">Home</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      // Component should have motion-reduce classes
      expect(screen.getByTestId('link')).toHaveClass('motion-reduce:transition-none')
    })
  })

  describe('Edge Cases', () => {
    it('handles single item breadcrumb (just current page)', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      expect(screen.queryAllByRole('link')).toHaveLength(0)
    })

    it('handles empty list gracefully', () => {
      render(
        <Breadcrumb data-testid="breadcrumb">
          <BreadcrumbList data-testid="list">
            {/* Empty */}
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('breadcrumb')).toBeInTheDocument()
      expect(screen.getByTestId('list')).toBeInTheDocument()
    })

    it('handles long text with truncation', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate max-w-[200px]" data-testid="long-text">
                This is a very long breadcrumb title that should be truncated
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByTestId('long-text')).toHaveClass('truncate')
    })

    it('handles special characters in text', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Test &amp; Suite &lt;1&gt;</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByText('Test & Suite <1>')).toBeInTheDocument()
    })

    it('handles unicode characters', () => {
      render(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>测试用例 🧪</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )
      expect(screen.getByText('测试用例 🧪')).toBeInTheDocument()
    })
  })
})
