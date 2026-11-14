/**
 * V-LOG-SAFE-VALUES-FUNCTIONAL: a value a request sends keeps its server log entry on one line
 * Wireframe: none (no page is opened; the test starts its own backend and reads its log)
 * Design Decisions: none (server log behavior)
 * REQ: REQ-6.4.1, REQ-5.2.3.5
 *
 * The test starts its own backend (`helpers/spawn-backend.ts`); what that process writes is the
 * server log. The stack's backend is never used, so admin mode never changes there.
 *
 * Pass Criteria:
 * 1. Step 1: POST `/admin/enable` with a reason that holds a CR LF and then a made-up log line
 *    answers 200 and returns the reason as sent.
 * 2. Step 1: no line of the server log holds the made-up line's text; under the request's short id
 *    the log holds one line `INFO  [{id8}] Admin mode enabled: reason=base64:{Base64 of the
 *    reason's UTF-8 bytes}, timestamp={enabled_at}`.
 * 3. Step 2: a plain reason, with spaces and punctuation, is written as it is:
 *    `INFO  [{id8}] Admin mode enabled: reason={reason}, timestamp={enabled_at}`.
 * 4. Step 3: a GET of a path that holds a terminal escape, a right-to-left override and a line
 *    separator answers 404; no line of the server log holds one of those characters, and the
 *    request line is `WARN  [{id8}] GET base64:{Base64 of the decoded path and its query} → 404
 *    ({n.nn}ms)`.
 * 5. Step 4: a GET of an environment whose identifier holds a line break and then a made-up log
 *    line answers 400 with the message `Invalid UUID format for environment_id: '{id}'`; no line
 *    of the server log holds the made-up line's text; under the request's short id the error
 *    handler's line is `ERROR [{id8}] WAVE exception for request {request id}: base64:{Base64 of
 *    that message}` and the request line is `WARN  [{id8}] GET base64:{Base64 of the decoded
 *    path} → 400 ({n.nn}ms)`.
 */

import type { APIResponse } from '@playwright/test'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { removeSpawnedBackends, spawnBackend, type SpawnedBackend } from '../../helpers/spawn-backend'

const STAMP = String.raw`\d{2}:\d{2}:\d{2}\.\d{3}`
const FORGED_MARK = 'FORGED-ADMIN-LINE'
const FORGED_REASON = `E2E reason\r\n12:00:00.000 INFO  [deadbeef] ${FORGED_MARK} Admin mode disabled`
const PLAIN_REASON = 'E2E plain reason: restore check (one line, 100%)'
/** U+2192, the arrow between the path and the status in a request line. */
const ARROW = String.fromCharCode(0x2192)
const DURATION = String.raw`\(\d+\.\d{2}ms\)`
const ESC = String.fromCharCode(0x1b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)
const LINE_SEPARATOR = String.fromCharCode(0x2028)
/** A path as sent and as the server decodes it: a color escape, an override, a line separator. */
const CONTROL_URL = '/e2e-log-safe/a%1B%5B31mred%E2%80%AEb%E2%80%A8c?note=one'
const CONTROL_TARGET = `/e2e-log-safe/a${ESC}[31mred${RIGHT_TO_LEFT_OVERRIDE}b${LINE_SEPARATOR}c?note=one`
const FORGED_ERROR_MARK = 'FORGED-ERROR-LINE'
const FORGED_ID = `e2e\n12:00:00.000 ERROR [deadbeef] ${FORGED_ERROR_MARK}`

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function logLines(backend: SpawnedBackend): string[] {
  return backend.output().split('\n')
}

function base64Of(text: string): string {
  return `base64:${Buffer.from(text, 'utf-8').toString('base64')}`
}

/** One whole server log line under a request's short id. */
function logLine(level: 'WARN' | 'ERROR', shortId: string, body: string): RegExp {
  return new RegExp(`^${STAMP} ${level.padEnd(5)} \\[${shortId}\\] ${body}$`)
}

/** Every log line that carries the short id, in the order written. */
function linesOf(backend: SpawnedBackend, shortId: string): string[] {
  return logLines(backend).filter((line) => line.includes(`[${shortId}]`))
}

function shortIdOf(response: APIResponse): string {
  const requestId = response.headers()['x-request-id']
  expect(requestId, 'the response carries a request id').toBeTruthy()
  return requestId.slice(0, 8)
}

interface Enabled {
  shortId: string
  /** The time the log line carries: `enabled_at` with its `Z` written as `+00:00`. */
  loggedAt: string
}

async function enableAdmin(request: APIRequestContext, backend: SpawnedBackend, reason: string): Promise<Enabled> {
  const response = await request.post(`${backend.baseUrl}/admin/enable`, { data: { reason } })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.enabled).toBe(true)
  expect(body.reason).toBe(reason)
  const requestId = response.headers()['x-request-id']
  expect(requestId, 'the response carries a request id').toBeTruthy()
  return { shortId: requestId.slice(0, 8), loggedAt: (body.enabled_at as string).replace(/Z$/, '+00:00') }
}

/** The one admin line under the request's short id, once the log holds it. */
async function adminLine(backend: SpawnedBackend, shortId: string): Promise<string> {
  const find = (): string[] =>
    logLines(backend).filter((line) => line.includes(`[${shortId}] Admin mode enabled:`))
  await expect.poll(find, { message: `the log holds one admin line under [${shortId}]` }).toHaveLength(1)
  return find()[0]
}

function expectedLine(shortId: string, renderedReason: string, loggedAt: string): RegExp {
  const body = escapeRegExp(`Admin mode enabled: reason=${renderedReason}, timestamp=${loggedAt}`)
  return new RegExp(`^${STAMP} INFO  \\[${shortId}\\] ${body}$`)
}

test.describe('V-LOG-SAFE-VALUES-FUNCTIONAL: a value a request sends keeps its log entry on one line', () => {
  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test('Step 1: a reason with a line break cannot add a line to the server log', async ({ request }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const enabled = await enableAdmin(request, backend, FORGED_REASON)
    const line = await adminLine(backend, enabled.shortId)

    expect(
      logLines(backend).filter((entry) => entry.includes(FORGED_MARK)),
      'no log line holds the made-up text'
    ).toEqual([])
    const encoded = `base64:${Buffer.from(FORGED_REASON, 'utf-8').toString('base64')}`
    expect(line).toMatch(expectedLine(enabled.shortId, encoded, enabled.loggedAt))
  })

  test('Step 2: a plain reason is written as it is', async ({ request }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const enabled = await enableAdmin(request, backend, PLAIN_REASON)
    const line = await adminLine(backend, enabled.shortId)

    expect(line).toMatch(expectedLine(enabled.shortId, PLAIN_REASON, enabled.loggedAt))
  })

  test('Step 3: a path with a terminal escape, an override or a line separator is written as base64', async ({
    request,
  }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const response = await request.get(`${backend.baseUrl}${CONTROL_URL}`)
    expect(response.status()).toBe(404)
    const shortId = shortIdOf(response)
    await expect
      .poll(() => linesOf(backend, shortId), { message: `the log holds one line under [${shortId}]` })
      .toHaveLength(1)

    const raw = [ESC, RIGHT_TO_LEFT_OVERRIDE, LINE_SEPARATOR]
    expect(
      logLines(backend).filter((line) => raw.some((character) => line.includes(character))),
      'no log line holds a raw ESC, U+202E or U+2028'
    ).toEqual([])
    expect(linesOf(backend, shortId)[0]).toMatch(
      logLine('WARN', shortId, `GET ${escapeRegExp(base64Of(CONTROL_TARGET))} ${ARROW} 404 ${DURATION}`)
    )
  })

  test('Step 4: an identifier with a line break cannot add a line through the error it causes', async ({
    request,
  }) => {
    const backend = await spawnBackend()
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

    const response = await request.get(`${backend.baseUrl}/environments/${encodeURIComponent(FORGED_ID)}`)
    expect(response.status()).toBe(400)
    const body = await response.json()
    const message = `Invalid UUID format for environment_id: '${FORGED_ID}'`
    expect(body.error.message).toBe(message)
    const shortId = shortIdOf(response)
    await expect
      .poll(() => linesOf(backend, shortId), { message: `the log holds two lines under [${shortId}]` })
      .toHaveLength(2)

    expect(
      logLines(backend).filter((line) => line.includes(FORGED_ERROR_MARK)),
      'no log line holds the made-up text'
    ).toEqual([])
    const [handlerLine, requestLine] = linesOf(backend, shortId)
    expect(handlerLine).toMatch(
      logLine(
        'ERROR',
        shortId,
        escapeRegExp(`WAVE exception for request ${body.meta.request_id}: ${base64Of(message)}`)
      )
    )
    expect(requestLine).toMatch(
      logLine('WARN', shortId, `GET ${escapeRegExp(base64Of(`/environments/${FORGED_ID}`))} ${ARROW} 400 ${DURATION}`)
    )
  })
})
