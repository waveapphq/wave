/**
 * V-CANVAS-FN-HALT-01: Halt(scope=test) inside Function propagates outward
 *
 * Pins the halt-propagation contract: a Halt control inside a Function body
 * with scope="test" stops the parent's flow (sibling-after the Function is
 * skipped). Halt is the only signal that drains the parent's queue at the
 * Function boundary; scope-fail and exceptions follow different rules.
 *
 * Pass criteria:
 *   1. Log_before ran.
 *   2. Function block ends `failed` (mapped from halt_status="failed").
 *   3. Log_after did NOT run (parent flow stopped by halt cleanup).
 *   4. Final session status is `failed`.
 */
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-halt-in-function.json'), 'utf-8'),
  )
  return { ...fixture, name: `V-CANVAS-FN-HALT-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

test.describe('V-CANVAS-FN-HALT-01: Halt inside Function propagates', () => {
  test('parent flow stops, Log_after is skipped, test ends failed', async ({ request }) => {
    const testId = await seedFixture(request)
    const envId = await resolveEnvironmentId(request)
    const { sessionId } = await runTestAndDrain(request, testId, envId)

    const statusResp = await request.get(`${BASE}/workbench/${sessionId}/status`)
    expect(statusResp.status()).toBe(200)
    const snapshot = (await statusResp.json()).data
    expect(snapshot.status).toBe('failed')

    const blockStates = await readBlockStates(request, sessionId)
    expect(blockStates['log-before']).toBe('passed')
    expect(blockStates['fn-halt']).toBe('failed')
    expect(blockStates['log-after']).toBe('skipped')
  })
})
