/**
 * Proxy error handling shared by the dev and preview servers.
 *
 * http-proxy hands an HTTP ServerResponse for `/api` errors but a raw
 * net.Socket for `/ws` errors, so the target is duck-typed rather than cast.
 */

import { unreachableMessage } from './src/services/connection-monitor/diagnose'

/** Either an HTTP response (writeHead/end) or a websocket socket (destroy). */
export interface ProxyErrorTarget {
  headersSent?: boolean
  writableEnded?: boolean
  writeHead?: (status: number, headers: Record<string, string>) => unknown
  end?: (body?: string) => unknown
  destroy?: () => unknown
}

function offlineBody(backendUrl: string): string {
  return JSON.stringify({
    error: { code: 'be_offline', message: unreachableMessage(backendUrl) },
  })
}

/**
 * Answer a proxy error without ever throwing: an unhandled throw here escapes
 * the emitter and takes the whole vite process down.
 */
export function handleProxyError(
  backendUrl: string,
  res?: ProxyErrorTarget | null,
): void {
  if (!res) return
  if (typeof res.writeHead !== 'function') {
    res.destroy?.()
    return
  }
  if (res.headersSent || res.writableEnded) return
  res.writeHead(502, { 'Content-Type': 'application/json' })
  res.end?.(offlineBody(backendUrl))
}
