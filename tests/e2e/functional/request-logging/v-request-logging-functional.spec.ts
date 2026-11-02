/**
 * V-REQUEST-LOGGING-FUNCTIONAL: a failed request is in the server log under the request id its response carries
 * Wireframe: none (no page is opened; the test starts its own backend and reads its log)
 * Design Decisions: none (server log behavior)
 * REQ: REQ-5.2.3.4, REQ-5.2.3.5
 *
 * The test starts its own backend (`helpers/spawn-backend.ts`); what that process writes is the
 * server log. The stack's backend is never used.
 *
 * Pass Criteria:
 * 1. LOG-1: a GET of an environment that does not exist answers 404 with error code `NOT_FOUND`
 *    and the message `Environment with ID '{id}' not found`.
 * 2. LOG-1: the response carries one request id: `meta.request_id` in the body and the
 *    `X-Request-ID` and `X-Correlation-ID` headers hold the same UUID.
 * 3. LOG-1: the server log holds, under the first eight characters of that id, the error
 *    handler's line `ERROR [{id8}] WAVE exception for request {id}: Environment with ID '{env}'
 *    not found` and then the request line `WARN  [{id8}] GET /environments/{env} → 404
 *    ({n.nn}ms)`. A search of the log for `[{id8}]` finds those two lines and no other.
 * 4. LOG-1: a second failed request gets its own id, and its two lines sit under that id.
 * 5. LOG-2: a request that succeeds has its request line too, `INFO  [{id8}] GET /health → 200
 *    ({n.nn}ms)`, under the id of its own response headers.
 */

import { randomUUID } from 'crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { removeSpawnedBackends, spawnBackend, type SpawnedBackend } from '../../helpers/spawn-backend'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const STAMP = String.raw`\d{2}:\d{2}:\d{2}\.\d{3}`
/** U+2192, the arrow between the path and the status in a request line. */
const ARROW = String.fromCharCode(0x2192)
const DURATION = String.raw`\(\d+\.\d{2}ms\)`

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One whole server log line under a request's short id. */
function logLine(level: 'INFO' | 'WARN' | 'ERROR', shortId: string, body: string): RegExp {
  return new RegExp(`^${STAMP} ${level.padEnd(5)} \\[${shortId}\\] ${body}$`)
}

/** Every log line that carries the short id, in the order written. */
function linesOf(backend: SpawnedBackend, shortId: string): string[] {
  return backend
    .output()
    .split('\n')
    .filter((line) => line.includes(`[${shortId}]`))
}

interface Failed {
  environmentId: string
  requestId: string
}

/** GET an environment that does not exist and return the one request id its response carries. */
async function getMissingEnvironment(request: APIRequestContext, backend: SpawnedBackend): Promise<Failed> {
  const environmentId = randomUUID()
  const response = await request.get(`${backend.baseUrl}/environments/${environmentId}`)
  expect(response.status()).toBe(404)

  const body = await response.json()
  expect(body.success).toBe(false)
  expect(body.error.code).toBe('NOT_FOUND')
  expect(body.error.message).toBe(`Environment with ID '${environmentId}' not found`)

  const requestId = body.meta.request_id as string
  expect(requestId, 'the body carries a request id').toMatch(UUID)
  expect(response.headers()['x-request-id'], 'X-Request-ID is the id in the body').toBe(requestId)
  expect(response.headers()['x-correlation-id'], 'X-Correlation-ID is the id in the body').toBe(requestId)
  return { environmentId, requestId }
}

/** The failed request's two log lines sit under its id, the handler's line first, and nothing else does. */
async function expectFailureLogged(backend: SpawnedBackend, failed: Failed): Promise<void> {
  const shortId = failed.requestId.slice(0, 8)
  const message = escapeRegExp(`Environment with ID '${failed.environmentId}' not found`)
  const handlerLine = logLine(
    'ERROR',
    shortId,
    `WAVE exception for request ${failed.requestId}: ${message}`,
  )
  const requestLine = logLine(
    'WARN',
    shortId,
    `GET /environments/${failed.environmentId} ${ARROW} 404 ${DURATION}`,
  )

  await expect
    .poll(() => linesOf(backend, shortId), { message: `the log holds two lines under [${shortId}]` })
    .toHaveLength(2)
  const [first, second] = linesOf(backend, shortId)
  expect(first).toMatch(handlerLine)
  expect(second).toMatch(requestLine)
}

test.describe('V-REQUEST-LOGGING-FUNCTIONAL: a failed request is in the server log under its request id', () => {
  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test('LOG-1: a failed request has its request line and its error line under the id of its response', async ({
    request,
  }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const first = await getMissingEnvironment(request, backend)
    await expectFailureLogged(backend, first)

    const second = await getMissingEnvironment(request, backend)
    expect(second.requestId, 'each request gets its own id').not.toBe(first.requestId)
    expect(second.requestId.slice(0, 8)).not.toBe(first.requestId.slice(0, 8))
    await expectFailureLogged(backend, second)
    expect(linesOf(backend, first.requestId.slice(0, 8)), 'the first id marks its own request only').toHaveLength(2)
  })

  test('LOG-2: a request that succeeds has its request line under the id of its response', async ({ request }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const response = await request.get(`${backend.baseUrl}/health`)
    expect(response.status()).toBe(200)
    const requestId = response.headers()['x-request-id']
    expect(requestId).toMatch(UUID)
    expect(response.headers()['x-correlation-id']).toBe(requestId)

    const shortId = requestId.slice(0, 8)
    await expect.poll(() => linesOf(backend, shortId)).toHaveLength(1)
    expect(linesOf(backend, shortId)[0]).toMatch(logLine('INFO', shortId, `GET /health ${ARROW} 200 ${DURATION}`))
  })
})
