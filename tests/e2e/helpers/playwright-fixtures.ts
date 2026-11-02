/**
 * Playwright test fixtures for multi-stack parallel execution.
 *
 * Playwright's `use.baseURL` in the config is evaluated once in the main
 * process, so it cannot vary per worker. To route each worker to its own
 * FE+BE stack in the N-stack CI layout, we override `baseURL` as a
 * worker-scoped fixture that reads `workerInfo.workerIndex`.
 *
 * Stack N layout (synced with playwright.config.ts webServer array):
 *   - Worker i -> Frontend port 3000+i, Backend port 8000+i
 *   - Each backend has its own WAVE_STORAGE_BASE_PATH so DB state is
 *     isolated per worker.
 *
 * Test files import from this module instead of '@playwright/test' so that
 * `page.goto('/path')` resolves to the correct per-worker frontend URL.
 *
 * Every test also starts from a FREE workbench editing slot. That slot is a
 * single global one: a tab that opens the workbench while a previous test's
 * tab still holds it becomes a read-only watcher, and a watcher is never
 * promoted - so the mutation affordances it needs are simply not rendered.
 * The specs that deliberately drive ownership build their holders inside the
 * test, after this has run.
 */

import { test as base, expect, type APIRequestContext } from '@playwright/test'

// Route each worker to its stack via `parallelIndex`, which is the bounded
// concurrent slot (0..workers-1). Using `workerIndex` here is wrong because
// that value keeps incrementing every time Playwright spawns a new worker
// (e.g. for a new project after dependencies complete), and would index
// past N_STACKS. parallelIndex stays within [0, workers-1] for the current
// project's parallel wave.
const N_STACKS = Number(process.env.WAVE_E2E_N_STACKS || '4')
const BASE_FE_PORT = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')

// Under high shard counts the per-container backend can briefly reset a
// connection when CPU-starved. Retry ONLY connection-level errors on
// idempotent reads (GET/HEAD) - never writes (a reset mid-write may have
// already applied, so retrying a POST could duplicate an entity) and never
// HTTP status codes or assertions, so real failures and races still surface
// (the suite keeps retries:0 for test logic).
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

const BASE_BE_PORT = Number(process.env.WAVE_E2E_BACKEND_PORT || '8000')
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
  baseURL: async ({}, use, testInfo) => {
    const stack = testInfo.parallelIndex % N_STACKS
    await use(`http://localhost:${BASE_FE_PORT + stack}`)
  },
  request: async ({ request }, use) => {
    await use(withConnectionRetry(request))
  },
  // Auto fixture: runs for EVERY test, including the many that only take
  // `{ page }`, so no spec has to remember to claim a clean slot.
  freeWorkbenchSession: [
    async ({ request }, use, testInfo) => {
      const stack = testInfo.parallelIndex % N_STACKS
      await freeWorkbenchSlot(request, `http://localhost:${BASE_BE_PORT + stack}`)
      await use(undefined)
    },
    { auto: true },
  ],
})

export { expect }

// Re-export common types so specs can do `import { test, expect, type Page }
// from '.../playwright-fixtures'` without pulling in @playwright/test directly.
export type { Page, Locator, APIRequestContext, TestInfo, Route } from '@playwright/test'
