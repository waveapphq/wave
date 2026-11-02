import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import App from '../src/app/App'
import { fetchMaskingSettings } from '@/features/settings/api/admin'

// App hydrates the system secret-reveal flags on init; keep the admin API
// mocked so no real fetch fires (test isolation).
vi.mock('@/features/settings/api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/admin')>()),
  fetchMaskingSettings: vi.fn().mockResolvedValue({
    run_output: false,
    test_variables: false,
    shared_variables: false,
  }),
  setMaskingSettings: vi.fn(),
}))

// The dashboard is the start page; its read stays pending so no real fetch fires.
vi.mock('@/features/dashboard/api/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/dashboard/api/dashboard')>()),
  fetchDashboard: vi.fn(() => new Promise(() => {})),
}))

const sshHostPolicy = vi.hoisted(() => ({
  startSshHostPolicyHydration: vi.fn<(report: (reason: string) => void) => void>(),
}))

// App hydrates the SSH host key policy on init; only the start function is replaced.
vi.mock('@/stores/ssh-host-policy-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/ssh-host-policy-store')>()),
  startSshHostPolicyHydration: sshHostPolicy.startSshHostPolicyHydration,
}))

describe('App', () => {
  beforeEach(() => {
    sshHostPolicy.startSshHostPolicyHydration.mockReset()
  })

  it('renders the application with sidebar and breadcrumb navigation', async () => {
    // Breadcrumb is hidden on list pages (dashboard, /tests, etc.)
    // Use detail page where breadcrumb is visible
    const { routeConfig } = await import('../src/app/router')
    const router = createMemoryRouter(routeConfig, {
      initialEntries: ['/tests/test-123'],
    })

    render(<RouterProvider router={router} />)
    await waitFor(() => {
      // Breadcrumb provides navigation role on detail pages
      const navElements = screen.getAllByRole('navigation')
      expect(navElements.length).toBeGreaterThan(0)
    })
  })

  it('renders WAVE branding in sidebar header', async () => {
    render(<App />)
    await waitFor(() => {
      // Multiple WAVE elements may exist (sidebar + mobile header)
      const waveElements = screen.getAllByText('WAVE')
      expect(waveElements.length).toBeGreaterThan(0)
    })
  })

  it('reports a genuine masking hydrate failure in a toast', async () => {
    vi.mocked(fetchMaskingSettings).mockRejectedValueOnce(new Error('Masking store unreachable'))

    render(<App />)

    expect(await screen.findByText('Could Not Load Masking Settings')).toBeInTheDocument()
    expect(screen.getByText('Masking store unreachable')).toBeInTheDocument()
  })

  it('stays silent when the admin API answers that it is not enabled', async () => {
    vi.mocked(fetchMaskingSettings).mockRejectedValueOnce(
      new Error('Admin API is not enabled on this server')
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('WAVE').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Could Not Load Masking Settings')).not.toBeInTheDocument()
  })

  it('starts the SSH host key policy hydration once, beside the masking hydration', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('WAVE').length).toBeGreaterThan(0)
    })
    expect(sshHostPolicy.startSshHostPolicyHydration).toHaveBeenCalledExactlyOnceWith(expect.any(Function))
    expect(fetchMaskingSettings).toHaveBeenCalled()
  })

  it('reports a host key policy hydrate failure in a toast with its reason', async () => {
    sshHostPolicy.startSshHostPolicyHydration.mockImplementationOnce((report) => {
      report('Host key policy store unreachable')
    })

    render(<App />)

    expect(await screen.findByText('Could Not Load Host Key Policy')).toBeInTheDocument()
    expect(screen.getByText('Host key policy store unreachable')).toBeInTheDocument()
  })

  it('shows no host key policy toast while the hydration reports nothing', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('WAVE').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Could Not Load Host Key Policy')).not.toBeInTheDocument()
  })
})
