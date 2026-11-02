/**
 * WebSocket Heartbeat - REQ-5.2.1.4
 *
 * Heartbeat timer management for detecting stale connections.
 */

import type { ClientContext } from './client-context'

/**
 * Resets the heartbeat timer. On timeout, closes the connection
 * to trigger reconnection.
 */
export function resetHeartbeatTimer(ctx: ClientContext): void {
  const heartbeatConfig = ctx.config.heartbeat!

  if (!heartbeatConfig.enabled) return

  if (ctx.heartbeatTimeout) {
    clearTimeout(ctx.heartbeatTimeout)
  }

  const totalTimeout = heartbeatConfig.interval + heartbeatConfig.timeout
  ctx.heartbeatTimeout = setTimeout(() => {
    // Heartbeat timeout - trigger reconnection
    // Use 4000 (application-defined) since 1006 is reserved and cannot be set programmatically
    if (ctx.ws && ctx.state === 'connected') {
      ctx.ws.close(4000, 'Heartbeat timeout')
    }
  }, totalTimeout)
}
