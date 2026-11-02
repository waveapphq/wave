/**
 * WebSocket event collection helper for functional tests.
 *
 * The backend broadcasts workbench events on the `/ws` endpoint after the
 * client sends a `{type:'subscribe', topic:'workbench:<session_id>'}`
 * message. There is NO event replay for late subscribers, so a test that
 * wants to observe run/debug events MUST connect + subscribe BEFORE it
 * starts the run.
 *
 * Usage:
 *   const collector = await openSessionEventCollector(page, sessionId)
 *   // ... start the run ...
 *   const events = await collector.waitForType('execution_completed', 30_000)
 *   const all = await collector.harvest()
 *   await collector.close()
 *
 * The collector runs entirely in the browser page context (so it shares the
 * page's origin and needs no node-side WebSocket dependency). The page must
 * already be navigated to the app (any route) before calling this.
 */

import type { Page } from '@playwright/test'
import { BACKEND_PORT } from './config'

export interface WsEvent {
  type?: string
  node_id?: string
  reason?: string
  status?: string
  error?: string
  [key: string]: unknown
}

export interface SessionEventCollector {
  /** Harvest every event captured so far. */
  harvest: () => Promise<WsEvent[]>
  /** Resolve once an event with the given `type` is seen (or timeout). */
  waitForType: (type: string, timeoutMs?: number) => Promise<WsEvent>
  /** Count events matching a predicate expressed as type + optional node_id. */
  close: () => Promise<void>
}

const BACKEND_WS_BASE = `ws://localhost:${BACKEND_PORT}/ws`

export async function openSessionEventCollector(
  page: Page,
  sessionId: string,
  extraTopics: string[] = [],
): Promise<SessionEventCollector> {
  // Establish the socket and subscribe inside the page. Resolves only after
  // the socket is OPEN and the subscribe frames have been sent, so the caller
  // can safely start the run immediately after awaiting this function.
  // `extraTopics` adds subscriptions beyond the session's workbench topic
  // (e.g. `log:<sid>` to also capture the console log stream).
  await page.evaluate(
    async ([wsBase, sid, topics]) => {
      const w = window as unknown as {
        __wsEvents__: WsEvent[]
        __wsSock__?: WebSocket
      }
      w.__wsEvents__ = []
      await new Promise<void>((resolve, reject) => {
        const sock = new WebSocket(wsBase as string)
        w.__wsSock__ = sock
        const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000)
        sock.addEventListener('open', () => {
          clearTimeout(timer)
          sock.send(JSON.stringify({ type: 'subscribe', topic: `workbench:${sid}` }))
          for (const topic of topics as string[]) {
            sock.send(JSON.stringify({ type: 'subscribe', topic }))
          }
          resolve()
        })
        sock.addEventListener('error', () => {
          clearTimeout(timer)
          reject(new Error('ws error'))
        })
        sock.addEventListener('message', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data)
            // Broadcast events are wrapped: {type:'event', topic, payload:{type,...}}.
            // Control frames (e.g. {type:'subscribed'}) arrive unwrapped. Store
            // the inner payload for broadcasts so callers match on the real
            // event type; store control frames as-is.
            if (data && data.type === 'event' && data.payload) {
              w.__wsEvents__.push(data.payload)
            } else {
              w.__wsEvents__.push(data)
            }
          } catch {
            /* ignore non-JSON frames */
          }
        })
      })
      // expose a type for the inline annotation above
      type WsEvent = Record<string, unknown>
    },
    [BACKEND_WS_BASE, sessionId, extraTopics] as const,
  )

  const harvest = async (): Promise<WsEvent[]> =>
    (await page.evaluate(
      () => (window as unknown as { __wsEvents__: WsEvent[] }).__wsEvents__ ?? [],
    )) as WsEvent[]

  const waitForType = async (type: string, timeoutMs = 30_000): Promise<WsEvent> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const events = await harvest()
      const hit = events.find((e) => e.type === type)
      if (hit) return hit
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for WS event type "${type}". Seen types: ${events
            .map((e) => e.type)
            .join(', ')}`,
        )
      }
      await page.waitForTimeout(150)
    }
  }

  const close = async (): Promise<void> => {
    await page.evaluate(() => {
      const w = window as unknown as { __wsSock__?: WebSocket }
      w.__wsSock__?.close()
    })
  }

  return { harvest, waitForType, close }
}
