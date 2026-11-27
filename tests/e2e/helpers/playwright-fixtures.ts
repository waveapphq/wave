/** Test fixtures: retried API reads and a free workbench slot before every test. */

import { test as base, expect, type APIRequestContext } from '@playwright/test'
import { BACKEND_URL } from './config'

// Retry only dropped connections on reads: a retried write could duplicate an entity.
const RETRYABLE_NETWORK_ERROR =
  /ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|socket hang up|ENETUNREACH/i
const RETRY_METHODS = new Set(['get', 'head'])
const MAX_NETWORK_RETRIES = 4

function withConnectionRetry(ctx: APIRequestContext): APIRequestContext {
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (typeof prop !== 'string' || !RETRY_METHODS.has(prop)) {
        return (value as (...a: unknown[]) => unknown).bind(target)
      }
      return async (...args: unknown[]) => {
        let lastError: unknown
        for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
          try {
            return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)
          } catch (error) {
            lastError = error
            const message = error instanceof Error ? error.message : String(error)
            if (!RETRYABLE_NETWORK_ERROR.test(message) || attempt === MAX_NETWORK_RETRIES) {
              throw error
            }
            await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
          }
        }
        throw lastError
      }
    },
  })
}

const OWNERSHIP_RESET_ID = 'e2e-fixture-reset'

/** Force the single global workbench editing slot free (force, then release). */
async function freeWorkbenchSlot(ctx: APIRequestContext, backend: string): Promise<void> {
  await ctx
    .post(`${backend}/workbench/ownership/takeover/force`, {
      data: { requester_id: OWNERSHIP_RESET_ID, requester_label: 'E2E Fixture Reset' },
    })
    .catch(() => undefined)
  await ctx
    .post(`${backend}/workbench/ownership/release`, {
      data: { holder_id: OWNERSHIP_RESET_ID },
    })
    .catch(() => undefined)
}

export const test = base.extend<{ freeWorkbenchSession: void }>({
  request: async ({ request }, use) => {
    await use(withConnectionRetry(request))
  },
  // Auto fixture, so no spec has to claim a free slot itself.
  freeWorkbenchSession: [
    async ({ request }, use) => {
      await freeWorkbenchSlot(request, BACKEND_URL)
      await use(undefined)
    },
    { auto: true },
  ],
})

export { expect }

// Re-exported so specs need no direct @playwright/test import.
export type { Page, Locator, APIRequestContext, TestInfo, Route } from '@playwright/test'
