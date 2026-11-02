/**
 * V-CANVAS-FN-ASSERT-IN-TRYCATCH-01: Try/Catch catches a Function whose body was marked failed
 *
 * Pins the composability contract: a Function whose body has a split-mode
 * `Assert(fail_current_scope=True)` evaluating to False reports failed at its
 * caller. That is a failed block, so a Try/Catch wrapping the Function catches
 * it: the catch chain runs, the sibling-after the Try/Catch runs, and the test
 * ends `passed` - the mark stayed inside the Function body.
 *
 * Pass criteria:
 *   1. Log_caught (catch branch) ran (`block_states['log-caught'] == 'passed'`).
 *   2. Log_after (then-egress sibling) ran (`block_states['log-after'] == 'passed'`).
 *   3. Final session status is `passed` (no scope-fail residue).
 */
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-assert-in-trycatch-around-function.json'), 'utf-8'),
  )
  return { ...fixture, name: `V-CANVAS-FN-ASSERT-IN-TRYCATCH-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

test.describe('V-CANVAS-FN-ASSERT-IN-TRYCATCH-01: Try/Catch absorbs Function scope-fail', () => {
  test('catch runs, Log_after runs, test ends passed', async ({ request }) => {
    const testId = await seedFixture(request)
    const envId = await resolveEnvironmentId(request)
    const { sessionId } = await runTestAndDrain(request, testId, envId)

    const statusResp = await request.get(`${BASE}/workbench/${sessionId}/status`)
    expect(statusResp.status()).toBe(200)
    const snapshot = (await statusResp.json()).data
    // Try/Catch absorbed the inner-Function scope-fail; test ends passed.
    expect(snapshot.status).toBe('passed')

    const blockStates = await readBlockStates(request, sessionId)
    expect(blockStates['log-caught']).toBe('passed')
    expect(blockStates['log-after']).toBe('passed')
  })
})
