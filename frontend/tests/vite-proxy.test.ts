/**
 * Dev/preview proxy error handling.
 *
 * The shared proxy factory serves both `/api` (HTTP) and `/ws` (websocket).
 * http-proxy delivers a net.Socket as the third argument for websocket errors,
 * where `writeHead` does not exist; calling it would kill the whole vite process.
 */

import { describe, it, expect, vi } from 'vitest'
import { handleProxyError } from '../vite-proxy'

const BACKEND_URL = 'http://localhost:8000'

function httpResponse(overrides: Record<string, unknown> = {}) {
  return {
    headersSent: false,
    writableEnded: false,
    writeHead: vi.fn(),
    end: vi.fn(),
    ...overrides,
  }
}

describe('handleProxyError', () => {
  it('names the upstream address it could not reach', () => {
    const res = httpResponse()

    handleProxyError(BACKEND_URL, res)

    expect(res.writeHead).toHaveBeenCalledWith(502, { 'Content-Type': 'application/json' })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        error: {
          code: 'be_offline',
          message: 'Cannot reach the backend at http://localhost:8000',
        },
      }),
    )
  })

  it('names whichever upstream the failing route proxies to', () => {
    const res = httpResponse()

    handleProxyError('ws://localhost:8001', res)

    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('Cannot reach the backend at ws://localhost:8001'),
    )
  })

  it('destroys a websocket socket instead of writing headers to it', () => {
    const socket = { destroy: vi.fn() }

    expect(() => handleProxyError(BACKEND_URL, socket)).not.toThrow()

    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no response object', () => {
    expect(() => handleProxyError(BACKEND_URL, undefined)).not.toThrow()
  })

  it('leaves an already-started response alone', () => {
    const res = httpResponse({ headersSent: true })

    handleProxyError(BACKEND_URL, res)

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('leaves an already-finished response alone', () => {
    const res = httpResponse({ writableEnded: true })

    handleProxyError(BACKEND_URL, res)

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })
})
