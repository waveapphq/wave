/**
 * F-DELETE-ACTIVE-EXEC-409-01: Entity delete blocked by tracked execution (HTTP)
 *
 * Verifies the 409 ACTIVE_EXECUTIONS guard end-to-end against the running
 * backend for all three entity types (test, suite, regression):
 *
 *   1. Import the delay fixture, wrap as needed (suite/regression).
 *   2. Start a tracked execution against the entity.
 *   3. While the execution is `running`:
 *        - DELETE returns 409 with body.error.code=CONFLICT and
 *          body.error.details.execution_ids matching the in-flight execution.
 *        - GET on the entity still succeeds (entity is not gone).
 *        - GET on the execution still reports status=running.
 *   4. PUT /executions/{id}/stop, wait for terminal status.
 *   5. Retry DELETE -> 204 No Content. GET on the entity -> 404.
 *   6. The execution record persists in the executions list (terminal,
 *      not deleted) - the delete only removes the entity, not its history.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
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
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createSuite(
  request: APIRequestContext,
  name: string,
  testIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, description: 'F-DELETE-ACTIVE-EXEC-409-01', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createRegression(
  request: APIRequestContext,
  name: string,
  suiteIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/regressions`, {
    data: { name, description: 'F-DELETE-ACTIVE-EXEC-409-01', suites: suiteIds },
  })
  expect(
    response.ok(),
    `POST /regressions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function startExecution(
  request: APIRequestContext,
  type: 'test' | 'suite' | 'regression',
  entityId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type, id: entityId, environment_id: environmentId },
  })
  expect(
    response.ok(),
    `POST /executions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  expect(data.status).toBe('running')
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 15_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function expect409Conflict(
  request: APIRequestContext,
  resourcePath: string,
  expectedExecutionId: string,
): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}${resourcePath}`)
  expect(
    response.status(),
    `DELETE ${resourcePath} must return 409 while the entity has a tracked execution running`,
  ).toBe(409)
  const body = await response.json()
  expect(body.success).toBe(false)
  expect(body.error?.code, '409 body must carry error.code=CONFLICT').toBe('CONFLICT')
  const ids = body.error?.details?.execution_ids
  expect(Array.isArray(ids), '409 body must carry error.details.execution_ids array').toBe(true)
  expect(ids, '409 body must list the in-flight execution id').toContain(expectedExecutionId)
}

async function executionStillPersisted(
  request: APIRequestContext,
  executionId: string,
  entityType: 'test' | 'suite' | 'regression',
  entityId: string,
): Promise<boolean> {
  // Two-pronged check: GET /executions/{id} proves the record is still in
  // storage; the entity-scoped list call proves it remains discoverable on
  // the listing surface ("list still includes them"). Filtering keeps the
  // response well under the 100 rows per page the executions endpoint
  // accepts so this stays portable across
  // workers no matter how many other executions piled up earlier in the run.
  const detailResp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
  if (detailResp.status() !== 200) return false
  const listResp = await request.get(
    `${BACKEND_URL}/executions?type=${entityType}&entity_id=${entityId}&per_page=100`,
  )
  if (!listResp.ok()) return false
  const body = await listResp.json()
  const list = (body.data ?? []) as Array<Record<string, unknown>>
  return list.some((e) => e.id === executionId)
}

interface DeleteScenario {
  label: string
  type: 'test' | 'suite' | 'regression'
  resourcePath: (id: string) => string
  setup: (
    request: APIRequestContext,
    nameSuffix: string,
  ) => Promise<{ entityId: string }>
}

const scenarios: DeleteScenario[] = [
  {
    label: 'test',
    type: 'test',
    resourcePath: (id) => `/tests/${id}`,
    setup: async (request, suffix) => {
      const entityId = await importTest(request, `delete-active-test-${suffix}`)
      return { entityId }
    },
  },
  {
    label: 'suite',
    type: 'suite',
    resourcePath: (id) => `/suites/${id}`,
    setup: async (request, suffix) => {
      const testId = await importTest(request, `delete-active-suite-body-${suffix}`)
      const entityId = await createSuite(request, `delete-active-suite-${suffix}`, [testId])
      return { entityId }
    },
  },
  {
    label: 'regression',
    type: 'regression',
    resourcePath: (id) => `/regressions/${id}`,
    setup: async (request, suffix) => {
      const testId = await importTest(request, `delete-active-reg-body-${suffix}`)
      const suiteId = await createSuite(
        request,
        `delete-active-reg-suite-${suffix}`,
        [testId],
      )
      const entityId = await createRegression(
        request,
        `delete-active-reg-${suffix}`,
        [suiteId],
      )
      return { entityId }
    },
  },
]

test.describe('F-DELETE-ACTIVE-EXEC-409-01: entity delete guard (HTTP)', () => {
  for (const scenario of scenarios) {
    test(`${scenario.label}: DELETE returns 409 while running, succeeds after stop, execution persists`, async ({
      request,
    }) => {
      await ensureEnvironment(request)
      const environmentId = await getEnvironmentId(request)
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const { entityId } = await scenario.setup(request, suffix)

      const executionId = await startExecution(
        request,
        scenario.type,
        entityId,
        environmentId,
      )

      await test.step('DELETE while running returns 409 with execution_ids', async () => {
        await expect409Conflict(request, scenario.resourcePath(entityId), executionId)
      })

      await test.step('Entity is still retrievable; execution is still running', async () => {
        const entityResp = await request.get(`${BACKEND_URL}${scenario.resourcePath(entityId)}`)
        expect(
          entityResp.ok(),
          `GET ${scenario.resourcePath(entityId)} must still succeed after the blocked delete`,
        ).toBeTruthy()
        const execResp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        expect(execResp.ok()).toBeTruthy()
        const execBody = await execResp.json()
        const execData = (execBody.data ?? execBody) as Record<string, unknown>
        expect(execData.status, 'execution still in running state').toBe('running')
      })

      await test.step('After stop + terminal, retry DELETE returns 204 and entity is gone', async () => {
        const stopResp = await request.put(
          `${BACKEND_URL}/executions/${executionId}/stop`,
        )
        expect(
          stopResp.ok(),
          `PUT /executions/${executionId}/stop failed: ${stopResp.status()}`,
        ).toBeTruthy()
        await pollUntilTerminal(request, executionId)

        const retryResp = await request.delete(
          `${BACKEND_URL}${scenario.resourcePath(entityId)}`,
        )
        expect(
          retryResp.status(),
          `DELETE ${scenario.resourcePath(entityId)} must return 204 once no execution is in flight`,
        ).toBe(204)

        const followupResp = await request.get(
          `${BACKEND_URL}${scenario.resourcePath(entityId)}`,
        )
        expect(
          followupResp.status(),
          `GET ${scenario.resourcePath(entityId)} must return 404 after delete`,
        ).toBe(404)
      })

      await test.step('Execution record persists after the entity is gone', async () => {
        const stillListed = await executionStillPersisted(
          request,
          executionId,
          scenario.type,
          entityId,
        )
        expect(
          stillListed,
          `Execution ${executionId} must remain retrievable via GET and via the entity-scoped /executions list after entity deletion (history is preserved)`,
        ).toBe(true)
      })
    })
  }
})
