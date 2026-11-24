/** The page loading fallback is an <output> with the status role. */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'

// The shell is not under test: render only the matched child route.
vi.mock('../../src/app/layouts/main-layout', () => ({
  MainLayout: () => <Outlet />,
}))

// The login chunk never finishes loading, so the Suspense fallback stays up.
vi.mock('@/features/auth/container/login-container', () => new Promise(() => {}))

import { routeConfig } from '../../src/app/router'

afterEach(() => {
  cleanup()
})

function renderLoadingRoute() {
  const router = createMemoryRouter(routeConfig, { initialEntries: ['/login'] })
  render(<RouterProvider router={router} />)
}

describe('Page loading fallback', () => {
  it('shows Loading… in an output element with the status role', async () => {
    renderLoadingRoute()

    const status = await screen.findByRole('status')
    expect(status.tagName).toBe('OUTPUT')
    expect(status).toHaveTextContent(/^Loading…$/)
  })

  it('drops the explicit role attribute and keeps its classes', async () => {
    renderLoadingRoute()

    const status = await screen.findByRole('status')
    expect(status).not.toHaveAttribute('role')
    expect(status).toHaveClass('text-muted-foreground')
    expect(status.parentElement).toHaveClass('flex', 'h-full', 'items-center', 'justify-center')
  })
})
