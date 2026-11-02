/**
 * Tracked Termination - YAML-Unsafe Variable
 *
 * A single user plugin returning a YAML-unsafe value must NEVER stall a tracked
 * execution's terminal-status transition.
 *
 *   1. Import a fixture whose single XML Parser node extracts a text-node
 *      result (produces an lxml `str` subclass in the variable store).
 *   2. Start a tracked execution via `POST /executions`.
 *   3. Poll the execution record until it reaches a terminal status.
 *   4. Assert status=passed, ended_at set, duration recorded.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

// An XML Parser plugin finishes fast; the risk is in the persistence phase
// after completion, so the ceiling only needs to cover plugin execution +
// terminal-callback dispatch + one poll.
const TERMINAL_TIMEOUT_MS = 20_000

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BASE}/environments/`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function importTest(
  request: APIRequestContext,
  uniqueName: string,
): Promise<string> {
  const fixture = loadFixture()
  fixture.name = uniqueName
  const response = await request.post(`${BASE}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (['passed', 'failed', 'stopped', 'skipped'].includes(status)) {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`,
  )
}

test.describe('Tracked execution terminal transition', () => {
  test('completes even when a plugin returns a YAML-unsafe variable', async ({
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const entityName = `YAML-Unsafe Regression ${Date.now()}`
    const testId = await importTest(request, entityName)

    let executionId = ''
    await test.step('POST /executions starts the tracked run', async () => {
      const response = await request.post(`${BASE}/executions`, {
        data: { type: 'test', id: testId, environment_id: environmentId },
      })
      expect(
        response.ok(),
        `POST /executions failed: ${response.status()} ${await response.text()}`,
      ).toBeTruthy()
      const body = await response.json()
      const data = (body.data ?? body) as Record<string, unknown>
      executionId = data.id as string
      expect(executionId).toBeTruthy()
      expect(data.status).toBe('running')
    })

    await test.step(
      'Execution reaches terminal status despite the yaml-unsafe variable',
      async () => {
        const terminal = await pollUntilTerminal(
          request,
          executionId,
          TERMINAL_TIMEOUT_MS,
        )
        expect(
          terminal.status,
          'status must transition out of running even if variable persistence fails',
        ).toBe('passed')
        expect(
          terminal.ended_at,
          'ended_at must be stamped on the execution record',
        ).toBeTruthy()
        expect(
          typeof terminal.duration,
          'duration must be persisted as a number',
        ).toBe('number')
      },
    )
  })
})
