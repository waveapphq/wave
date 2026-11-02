/**
 * V-CANVAS-FN-ASSERT-SCOPE-FAIL-01: split Assert(fail_current_scope=True) inside Function
 *
 * Pins the scope-fail propagation contract: an inner split-mode Assert that
 * evaluates to False AND has `fail_current_scope=True` marks the FUNCTION's
 * scope failed. When the body ends the Function reports failed at its caller,
 * which is a failed block there: the parent's flow stops at the Function.
 *
 * Pass criteria:
 *   1. The Function node ends `failed` (red badge).
 *   2. Log_after the Function did NOT run (the parent flow stops at the Function).
 *   3. Final session status is `failed`.
 */
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-assert-scope-fail-in-function.json'), 'utf-8'),
  )
  return { ...fixture, name: `V-CANVAS-FN-ASSERT-SCOPE-FAIL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function runTestAndDrain(
  request: APIRequestContext,
  testId: string,
  envId: string,
): Promise<{ sessionId: string }> {
  await request.delete(`${BASE}/workbench/session`)
  const resp = await request.post(`${BASE}/workbench/run`, {
    data: { test_id: testId, environment_id: envId },
  })
  expect(resp.status(), `POST /workbench/run failed: ${await resp.text()}`).toBe(200)
  const body = await resp.json()
  const sessionId: string = body.data.session_id
  // Poll status until terminal.
  for (let i = 0; i < 300; i += 1) {
    const s = await request.get(`${BASE}/workbench/${sessionId}/status`)
    if (s.status() === 200) {
      const sb = await s.json()
      const status: string = sb.data?.status
      if (['passed', 'failed', 'skipped'].includes(status)) {
        return { sessionId }
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('session never reached terminal status')
}

// The per-session status route carries no block states; the active-session payload does.
async function readBlockStates(request: APIRequestContext, sessionId: string): Promise<Record<string, string>> {
  const resp = await request.get(`${BASE}/workbench/session`)
  expect(resp.status()).toBe(200)
  const session = (await resp.json()).data
  expect(session?.session_id).toBe(sessionId)
  return session.block_states ?? {}
}

test.describe('V-CANVAS-FN-ASSERT-SCOPE-FAIL-01: inner Assert scope-fail in Function', () => {
  test('Function with inner split Assert(fail_current_scope=True) fails; Log_after never runs; test ends failed', async ({
    request,
  }) => {
    const testId = await seedFixture(request)
    const envId = await resolveEnvironmentId(request)
    const { sessionId } = await runTestAndDrain(request, testId, envId)

    const statusResp = await request.get(`${BASE}/workbench/${sessionId}/status`)
    expect(statusResp.status()).toBe(200)
    const snapshot = (await statusResp.json()).data
    expect(snapshot.status).toBe('failed')

    // Block-state snapshot: the Function failed and the parent flow stopped there.
    const blockStates = await readBlockStates(request, sessionId)
    expect(blockStates['fn-scope-fail']).toBe('failed')
    expect(blockStates['log-after']).not.toBe('passed')
  })
})
