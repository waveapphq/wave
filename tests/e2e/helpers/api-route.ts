/**
 * Forced API failures for pages whose error states only appear when a request
 * fails.
 *
 * Two traps this module exists to close:
 *
 *  1. Several API paths are also SPA routes (`/profiles`, `/environments`).
 *     A matcher that only reads the pathname therefore also catches the page
 *     document itself, the HTML gets replaced by the error JSON, and the page
 *     renders blank. `apiPathMatcher` keeps the backend origin and the
 *     frontend origin's `/api` proxy path, and excludes the frontend origin's
 *     plain page path.
 *  2. The E2E bundle is built with an absolute `VITE_API_BASE_URL`, so API
 *     traffic is cross-origin. A fulfilled response without CORS headers is
 *     rejected by the browser and reaches the client as a network error
 *     instead of the status under test, so the fulfilled body carries the same
 *     headers the real backend sends. Non-matching verbs (the preflight) are
 *     handed back to the backend.
 */

import { FRONTEND_URL } from './config'
import type { Page, Route } from './playwright-fixtures'

const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin

let forcedFailures = 0

/** Stand-in request id; a spec that asserts the id reaches the UI pins its own. */
function nextRequestId(): string {
  forcedFailures += 1
  return `e2e-forced-${Date.now().toString(36)}-${forcedFailures}`
}

/** Mirrors the backend's HTTP-status to error-code map, so a faked failure carries a real code. */
const ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'AUTHENTICATION_ERROR',
  403: 'AUTHORIZATION_ERROR',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
}

export type ApiUrlMatcher = (url: URL) => boolean

/**
 * Match one API path wherever the client reaches it - the backend origin in
 * built mode, the frontend `/api` proxy in dev - but never the SPA document
 * served at the same path.
 */
export function apiPathMatcher(apiPath: string): ApiUrlMatcher {
  const escaped = apiPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^(/api)?${escaped}$`)
  return (url) =>
    pattern.test(url.pathname) &&
    (url.origin !== FRONTEND_ORIGIN || url.pathname.startsWith('/api/'))
}

export interface ApiFailure {
  /** Defaults to 500. */
  status?: number
  /** Becomes `error.message`, which is what the client surfaces as the reason. */
  detail?: string
  /** Defaults to a fresh uuid; set it to assert the id reaches the UI. */
  requestId?: string
  /** Held before answering, so a busy state stays observable. */
  delayMs?: number
}

/** A fixed failure, or a supplier consulted per request where `null` lets the request through. */
export type ApiFailureSource = ApiFailure | (() => ApiFailure | null)

/** Answer one API path with the backend's real error envelope. */
export async function failApiRoute(
  page: Page,
  matcher: ApiUrlMatcher,
  source: ApiFailureSource,
  method = 'GET',
): Promise<void> {
  await page.route(matcher, async (route: Route) => {
    if (route.request().method() !== method) {
      await route.fallback()
      return
    }
    const failure = typeof source === 'function' ? source() : source
    if (!failure) {
      await route.fallback()
      return
    }
    if (failure.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, failure.delayMs))
    }
    const status = failure.status ?? 500
    await route.fulfill({
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': route.request().headers().origin ?? FRONTEND_ORIGIN,
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: ERROR_CODES[status] ?? 'HTTP_ERROR',
          message: failure.detail ?? 'E2E forced failure',
          details: null,
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'e2e',
          request_id: failure.requestId ?? nextRequestId(),
        },
      }),
    })
  })
}

/**
 * Hold one API path's real response back, so a read that succeeds can be made
 * to land after something else has already happened. A supplier is consulted
 * per request; a value <= 0 means no hold.
 */
export async function delayApiRoute(
  page: Page,
  matcher: ApiUrlMatcher,
  delayMs: number | (() => number),
  method = 'GET',
): Promise<void> {
  await page.route(matcher, async (route: Route) => {
    if (route.request().method() === method) {
      const holdMs = typeof delayMs === 'function' ? delayMs() : delayMs
      if (holdMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, holdMs))
      }
    }
    await route.fallback()
  })
}

/**
 * Slow one page's outgoing bytes, so an upload stays in flight long enough to be
 * observed while it is happening. Holding the route instead would keep the
 * request from ever reaching the server, which is the opposite of what a spec
 * about live upload state needs. Chromium only.
 */
export async function throttleUploads(page: Page, bytesPerSecond: number): Promise<void> {
  const session = await page.context().newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: bytesPerSecond,
  })
}

/**
 * Count the API reads the browser issues for one path. The SPA document for the
 * same path is served by the frontend origin, which the matcher already
 * excludes, and the CORS preflight is an OPTIONS, so neither is counted.
 */
export function countApiFetches(
  page: Page,
  matcher: ApiUrlMatcher,
  method = 'GET',
): () => number {
  let count = 0
  page.on('request', (request) => {
    if (request.method() !== method) return
    if (matcher(new URL(request.url()))) count += 1
  })
  return () => count
}
