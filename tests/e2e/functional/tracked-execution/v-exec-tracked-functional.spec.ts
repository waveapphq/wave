/**
 * Tracked Execution E2E Functional Test
 *
 * Verifies the tracked-execution lifecycle end-to-end:
 *   POST /tests (import fixture) ->
 *   POST /executions (start tracked execution) ->
 *   workbench engine actually runs the workflow ->
 *   execution record transitions to a terminal status with ended_at + duration.
 *
 * Two permutations chained to keep the test single-fixture:
 *   1. Default flow runs to completion and asserts status=passed + duration>=0.
 *   2. A second tracked execution is started and stopped via PUT /stop, asserting
 *      terminal status=stopped, ended_at present, duration recorded.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

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

async function importTest(request: APIRequestContext, suffix: string): Promise<string> {
  const fixture = loadFixture()
  fixture.name = `${fixture.name as string} ${suffix} ${Date.now()}`
  const response = await request.post(`${BASE}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  // Poll every 200ms until status is terminal or timeout fires.
  // Using polling instead of WebSocket subscriptions keeps the test
  // independent of the live-stream channel.
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
    expect(response.ok(), `GET /executions/${executionId} failed: ${response.status()}`).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

test.describe('Tracked Execution lifecycle', () => {
  test('Tracked execution runs to completion and records duration', async ({ request }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, 'passed')

    let executionId = ''

    await test.step('POST /executions starts a tracked execution', async () => {
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

    await test.step('Execution reaches terminal status passed with duration recorded', async () => {
      const terminal = await pollUntilTerminal(request, executionId)
      expect(terminal.status).toBe('passed')
      expect(terminal.ended_at, 'terminal record must include ended_at').toBeTruthy()
      expect(typeof terminal.duration, 'duration must be persisted as a number').toBe('number')
      expect(terminal.duration as number).toBeGreaterThanOrEqual(0)
    })
  })

  test('Stopping a tracked execution transitions it to stopped', async ({ request }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, 'stopped')

    const startResponse = await request.post(`${BASE}/executions`, {
      data: { type: 'test', id: testId, environment_id: environmentId },
    })
    expect(startResponse.ok()).toBeTruthy()
    const startBody = await startResponse.json()
    const startData = (startBody.data ?? startBody) as Record<string, unknown>
    const executionId = startData.id as string

    const stopResponse = await request.put(`${BASE}/executions/${executionId}/stop`)
    expect(
      stopResponse.ok(),
      `PUT /executions/${executionId}/stop failed: ${stopResponse.status()}`,
    ).toBeTruthy()

    const terminal = await pollUntilTerminal(request, executionId)
    expect(terminal.status).toBe('stopped')
    expect(terminal.ended_at).toBeTruthy()
    expect(typeof terminal.duration).toBe('number')
    expect(terminal.duration as number).toBeGreaterThanOrEqual(0)
  })
})
