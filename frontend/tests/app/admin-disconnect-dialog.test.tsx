/**
 * Admin Disconnect Dialog Tests
 *
 * When the WebSocket client enters the terminal 'terminated' state after an
 * administrator ends the session, the Workbench closes (redirect to the
 * dashboard) and a modal announces the disconnect. "Reconnect" reloads to a
 * fresh session.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

import { AdminDisconnectDialog } from '@/app/admin-disconnect-dialog'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'

function setState(state: string): void {
  act(() => {
    useWebSocketStore.setState({ state: state as never })
  })
}

describe('AdminDisconnectDialog', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    setState('disconnected')
  })

  afterEach(() => {
    setState('disconnected')
    vi.unstubAllGlobals()
  })

  it('renders nothing and does not redirect until the session is terminated', () => {
    render(<AdminDisconnectDialog />)

    expect(screen.queryByTestId('admin-disconnect-dialog')).not.toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('redirects to the dashboard and announces the disconnect when terminated', () => {
    render(<AdminDisconnectDialog />)
    setState('terminated')

    expect(navigateMock).toHaveBeenCalledWith('/dashboard')
    expect(screen.getByTestId('admin-disconnect-dialog')).toBeInTheDocument()
    expect(screen.getByText(/administrator disconnected this session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument()
  })

  it('reloads the page when Reconnect is clicked', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const user = userEvent.setup()

    render(<AdminDisconnectDialog />)
    setState('terminated')

    await user.click(screen.getByRole('button', { name: /Reconnect/ }))

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
