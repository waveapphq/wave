/**
 * SettingsContainer - an action that rejects outright
 *
 * Every settings section reports its own read and write failures in place, so a
 * rejection reaching the container means the section never got the chance. The
 * container names it in a toast rather than letting it disappear.
 *
 * Component: frontend/src/features/settings/container/container.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { SettingsContainer } from '@/features/settings/container/container'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

const REJECTION = 'The roster read crashed'
const ABOUT_REJECTION = 'The system info read crashed'

// The WAVE Server section is the one rendered here; its hook is replaced so the
// retry rejects instead of reporting itself.
vi.mock('@/features/settings/container/use-server-sessions', () => ({
  useServerSessions: () => ({
    status: undefined,
    loading: false,
    error: 'Server unreachable',
    refresh: vi.fn(),
    retry: vi.fn().mockRejectedValue(new Error(REJECTION)),
    disconnect: vi.fn(),
    disconnectOthers: vi.fn(),
    disconnectAll: vi.fn(),
    ownSessionId: 'own-session',
  }),
}))

// The About section's hook is replaced the same way: its read rejects instead of reporting itself.
const { mockLoadSystemInfo } = vi.hoisted(() => ({ mockLoadSystemInfo: vi.fn() }))
vi.mock('@/features/settings/container/use-system-info', () => ({
  useSystemInfo: () => ({
    systemInfo: undefined,
    systemInfoLoading: false,
    systemInfoError: 'System info is unavailable',
    loadSystemInfo: mockLoadSystemInfo,
  }),
}))
vi.mock('@/features/settings/api/system-info', () => ({ fetchSystemInfo: vi.fn() }))

function renderSettingsContainer(route = '/settings/server') {
  const router = createMemoryRouter([{ path: '/settings/*', element: <SettingsContainer /> }], {
    initialEntries: [route],
  })
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
      <ToastContainer />
    </ToastProvider>
  )
}

describe('SettingsContainer - an action that rejects outright', () => {
  beforeEach(() => {
    mockLoadSystemInfo.mockReset()
  })

  it('names the failure in a toast instead of losing it', async () => {
    const user = userEvent.setup()
    renderSettingsContainer()

    const errorState = await screen.findByTestId('wave-server-error')
    await user.click(within(errorState).getByRole('button', { name: /try again/i }))

    expect(await screen.findByText(REJECTION)).toBeInTheDocument()
  })

  it('names a rejected About read from useSystemInfo in a toast', async () => {
    mockLoadSystemInfo.mockRejectedValue(new Error(ABOUT_REJECTION))
    renderSettingsContainer('/settings/about')

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument()
    expect(mockLoadSystemInfo).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(ABOUT_REJECTION)).toBeInTheDocument()
  })

  it('names a rejected About reload from useSystemInfo in a toast', async () => {
    const user = userEvent.setup()
    mockLoadSystemInfo
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(ABOUT_REJECTION))
    renderSettingsContainer('/settings/about')

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument()
    const errorState = screen.getByTestId('about-error')
    expect(screen.queryByText(ABOUT_REJECTION)).not.toBeInTheDocument()
    await user.click(within(errorState).getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText(ABOUT_REJECTION)).toBeInTheDocument()
    expect(mockLoadSystemInfo).toHaveBeenCalledTimes(2)
  })

  it('shows the About state useSystemInfo reports', async () => {
    mockLoadSystemInfo.mockResolvedValue(undefined)
    renderSettingsContainer('/settings/about')

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument()
    const errorState = screen.getByTestId('about-error')
    expect(within(errorState).getByText(/^System info is unavailable$/)).toBeInTheDocument()
  })
})
