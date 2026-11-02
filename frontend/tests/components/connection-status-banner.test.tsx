/**
 * Connection Status Banner Tests
 *
 * Renders only when the global connection monitor reports BE
 * unreachable. The "Retry" action fires an immediate probe.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConnectionStatusBanner } from '@/components/connection-status-banner'
import {
  reportFailure,
  reportSuccess,
  _resetConnectionMonitor,
} from '@/services/connection-monitor'

const mockFetch = vi.fn()

describe('ConnectionStatusBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
    global.fetch = mockFetch as unknown as typeof fetch
    _resetConnectionMonitor()
  })

  afterEach(() => {
    act(() => {
      _resetConnectionMonitor()
    })
    vi.useRealTimers()
  })

  it('renders nothing when online', () => {
    render(<ConnectionStatusBanner />)
    expect(screen.queryByText(/Backend offline/)).not.toBeInTheDocument()
  })

  it('renders the banner when offline', () => {
    render(<ConnectionStatusBanner />)
    act(() => {
      reportFailure()
      reportFailure()
    })
    expect(screen.getByText(/Backend offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('exposes a polite live region for accessibility', () => {
    render(<ConnectionStatusBanner />)
    act(() => {
      reportFailure()
      reportFailure()
    })
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('disappears when the connection recovers', () => {
    render(<ConnectionStatusBanner />)
    act(() => {
      reportFailure()
      reportFailure()
    })
    expect(screen.queryByText(/Backend offline/)).toBeInTheDocument()

    act(() => {
      reportSuccess()
    })
    expect(screen.queryByText(/Backend offline/)).not.toBeInTheDocument()
  })

  it('fires an immediate probe when "Retry" is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ConnectionStatusBanner />)
    act(() => {
      reportFailure()
      reportFailure()
    })
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({ ok: true } as Response)

    await user.click(screen.getByRole('button', { name: /Retry/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })
})
