/** Profiles route through its lazy import, kept out of the other router tests (REQ-5.2.1.2). */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, configure } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routeConfig } from '../../src/app/router'

vi.mock('@/components/ui/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/toast')>(
    '@/components/ui/toast'
  )
  return {
    ...actual,
    useToast: () => ({
      toasts: [],
      toast: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      maxToasts: 3,
    }),
  }
})

// Every apiClient read answers an empty envelope, so no request leaves the test.
vi.mock('@/lib/api', () => {
  const empty = async () => ({ data: null, meta: { requestId: '' }, status: 200 })
  return {
    getApiBaseUrl: () => 'http://localhost:8000',
    apiClient: { get: empty, post: empty, put: empty, patch: empty, delete: empty },
  }
})

// Plain async functions keep the mocks out of vi.restoreAllMocks().
vi.mock('@/features/profiles/api/crud', () => ({
  transformApiProfile: (p: unknown) => p,
  fetchProfiles: async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
  }),
  fetchProfile: async () => null,
  fetchProfileTypes: async () => [],
  fetchProfileTypeSchema: async () => ({ fields: [] }),
  fetchAllTags: async () => [],
  fetchProfileEnvironments: async () => [],
  createProfile: async () => ({}),
  updateProfile: async () => ({}),
  deleteProfile: async () => undefined,
  duplicateProfile: async () => ({}),
}))

vi.mock('@/features/profiles/api/import-export', () => ({
  exportProfile: async () => new Blob(),
  exportProfiles: async () => new Blob(),
  validateProfileImport: async () => ({}),
  importProfiles: async () => ({}),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: async () => [],
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The lazy chunk can take a while to resolve under parallel CI load.
configure((config) => ({ asyncUtilTimeout: Math.max(config.asyncUtilTimeout, 8000) }))

describe('Profiles list route', () => {
  it('renders the Profiles list at /profiles through its lazy import', async () => {
    const router = createMemoryRouter(routeConfig, { initialEntries: ['/profiles'] })

    const { container } = render(<RouterProvider router={router} />)

    await waitFor(
      () => {
        expect(screen.getByTestId('profiles-page')).toBeInTheDocument()
      },
      { timeout: 20000 }
    )
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profiles')
    // A known route renders inside the shell, not the bare 404 outlet.
    expect(container.querySelector('a[href="/tests"]')).toBeInTheDocument()
  }, 30000)
})
