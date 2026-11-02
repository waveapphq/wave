/**
 * V-CANVAS-FN-RUN-SCOPED-01: drilled-in Run Scope path for a Local Function
 *
 * REQ: REQ-3.2.1.1 (Function variant of normal execution - drilled-in
 * scoped invocation).
 *
 * Pass Criteria:
 *   1. POST `/workbench/run` with `scope_mode='function'` and no
 *      `scoped_function_node_id` returns 422 with the anchored message
 *      `scoped_function_node_id is required when scope_mode is 'function'`.
 *   2. POST `/workbench/run` with `scope_mode='function'` and an unknown
 *      `scoped_function_node_id` returns 404 with the anchored
 *      `Function block '<id>' not found in Test '<test_id>'` message.
 *   3. POST `/workbench/run` with a valid `scoped_function_node_id` and no
 *      prior Test session state surfaces the `SCOPED_RUN_ADVISORY` entry in
 *      the response's `warnings` array (and in the subsequent `GET
 *      /workbench/{id}/status` response, alongside `scoped_result`).
 *
 * Note: assertion (3) only checks the BE wiring (advisory present, scoped
 * status field present). Asserting that caller-scope variables are NOT
 * mutated by the scoped path is covered by
 * `backend/tests/core/functions/test_executor_scoped.py` because the
 * workbench `/status` route does not return the variable map.
 *
 * Phase: functional (serial). Seeds via API; no UI interaction needed.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-scoped-run.json'), 'utf-8'),
  )
  return { ...fixture, name: `V-CANVAS-FN-RUN-SCOPED-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function seedEnvironment(request: APIRequestContext): Promise<string> {
  // POST /environments ignores any client-supplied id and assigns its own
  // UUID. Always read the id back from the response body so subsequent
  // GET/POST calls hit the env that actually exists.
  const resp = await request.post(`${BASE}/environments`, {
    data: { name: `V-CANVAS-FN-RUN-SCOPED Env ${Date.now()}`, tags: [] },
  })
  expect(resp.ok(), `POST /environments failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function waitForTerminal(request: APIRequestContext, sessionId: string) {
  for (let i = 0; i < 50; i += 1) {
    const s = await request.get(`${BASE}/workbench/${sessionId}/status`)
    if (s.status() === 200) {
      const sb = await s.json()
      const status: string = sb.data?.status
      if (['passed', 'failed', 'skipped'].includes(status)) {
        return sb.data
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`session ${sessionId} never reached terminal status`)
}

test.describe('V-CANVAS-FN-RUN-SCOPED-01: drilled-in scoped Function invocation', () => {
  test('missing scoped_function_node_id is rejected with the anchored error', async ({ request }) => {
    const testId = await seedFixture(request)
    const envId = await seedEnvironment(request)
    await request.delete(`${BASE}/workbench/session`).catch(() => {})

    const resp = await request.post(`${BASE}/workbench/run`, {
      data: { test_id: testId, environment_id: envId, scope_mode: 'function' },
    })
    // The route layer raises ValidationException, which the global handler
    // maps to 4xx; the message is the anchored canonical string.
    expect([400, 422]).toContain(resp.status())
    const body = await resp.json()
    const message: string = body?.error?.message ?? body?.message ?? ''
    expect(message).toContain("scoped_function_node_id is required when scope_mode is 'function'")
  })

  test('unknown scoped_function_node_id is rejected with the anchored not-found', async ({ request }) => {
    const testId = await seedFixture(request)
    const envId = await seedEnvironment(request)
    await request.delete(`${BASE}/workbench/session`).catch(() => {})

    const unknownNodeId = 'fn-nonexistent-12345'
    const resp = await request.post(`${BASE}/workbench/run`, {
      data: {
        test_id: testId,
        environment_id: envId,
        scope_mode: 'function',
        scoped_function_node_id: unknownNodeId,
      },
    })
    expect([400, 404, 422]).toContain(resp.status())
    const body = await resp.json()
    const message: string = body?.error?.message ?? body?.message ?? ''
    expect(message).toContain(`Function block '${unknownNodeId}' not found in Test '${testId}'`)
  })

  test('valid scoped call without prior session state surfaces the SCOPED_RUN_ADVISORY', async ({
    request,
  }) => {
    const testId = await seedFixture(request)
    const envId = await seedEnvironment(request)
    await request.delete(`${BASE}/workbench/session`).catch(() => {})

    const resp = await request.post(`${BASE}/workbench/run`, {
      data: {
        test_id: testId,
        environment_id: envId,
        scope_mode: 'function',
        scoped_function_node_id: 'fn-scoped-1',
      },
    })
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    const initialWarnings: Array<{ type?: string }> = body.data?.warnings ?? []
    expect(
      initialWarnings.some((w) => w.type === 'SCOPED_RUN_ADVISORY'),
      `expected SCOPED_RUN_ADVISORY warning in initial response; got ${JSON.stringify(initialWarnings)}`,
    ).toBe(true)

    // Status endpoint mirrors the advisory + exposes the scoped_result field.
    const sessionId: string = body.data.session_id
    const snapshot = await waitForTerminal(request, sessionId)

    const warnings: Array<{ type?: string }> = snapshot.warnings ?? []
    expect(
      warnings.some((w) => w.type === 'SCOPED_RUN_ADVISORY'),
      `expected SCOPED_RUN_ADVISORY in status warnings; got ${JSON.stringify(warnings)}`,
    ).toBe(true)
    // scoped_result is the per-run result document the scoped path attaches
    // for the drilled-in canvas; the field exists (key present) even when
    // the body executes successfully.
    expect(
      Object.prototype.hasOwnProperty.call(snapshot, 'scoped_result'),
      `expected scoped_result key in snapshot; got ${Object.keys(snapshot).join(',')}`,
    ).toBe(true)
  })
})
