/**
 * F-WORKBENCH-SESSION-ADMIN-01: Admin workbench-session inspect/teardown (HTTP)
 *
 * Verifies the two admin endpoints used by automated test teardown:
 *   - GET    /admin/workbench/session  -> session identity, or empty envelope.
 *   - DELETE /admin/workbench/session  -> { cleared: true|false }.
 *
 * Coverage:
 *   1. Empty slot: GET returns the empty envelope (all fields null);
 *      DELETE returns { cleared: false }.
 *   2. Active session: start a workbench session via POST /workbench/run,
 *      then GET returns the session identity (session_id, status, test_id,
 *      test_name); DELETE returns { cleared: true }; follow-up GET returns
 *      the empty envelope; follow-up DELETE returns { cleared: false }.
 *
 * Negative gate (404 when WAVE_ADMIN_ALLOWED is absent) is covered by the
 * backend unit tests at
 *   backend/tests/api/test_admin_workbench_session_endpoints.py
 * The E2E stacks always start with WAVE_ADMIN_ALLOWED=true (required for
 * the test seeding and reset machinery), so the env-var-gated path is not
 * reproducible from this functional spec - the unit tests use
 * `patch.dict(os.environ, {"WAVE_ADMIN_ALLOWED": "false"})` for that case.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment, E2E_ENV_NAME } from '../../helpers/config'

interface AdminSessionEnvelope {
  session_id: string | null
  status: string | null
  test_id: string | null
  test_name: string | null
  execution_id: string | null
}

const EMPTY_ENVELOPE: AdminSessionEnvelope = {
  session_id: null,
  status: null,
  test_id: null,
  test_name: null,
  execution_id: null,
}

const WORKBENCH_DELAY_MS = 3000

function buildDelayTestFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Delay-based workflow used to keep a workbench session alive long enough for the admin GET assertion.',
    workflow: {
      nodes: [
        {
          id: 'delay-only',
          type: 'workflowNode',
          position: { x: 400, y: 100 },
          data: {
            label: 'Delay',
            elementType: 'delay',
            nodeType: 'control',
            category: 'timing',
            version: '1.0.0',
            description: 'Admin Workbench Delay',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { duration: WORKBENCH_DELAY_MS },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-node', target: 'delay-only', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
  }
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
): Promise<{ id: string; name: string }> {
  const response = await request.post(`${BACKEND_URL}/tests`, {
    data: buildDelayTestFixture(uniqueName),
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return { id: data.id as string, name: uniqueName }
}

async function startWorkbenchSession(
  request: APIRequestContext,
  testId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/workbench/run`, {
    data: { test_id: testId, environment_id: environmentId },
  })
  expect(
    response.ok(),
    `POST /workbench/run failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.session_id as string
}

async function adminGetSession(
  request: APIRequestContext,
): Promise<AdminSessionEnvelope> {
  const response = await request.get(`${BACKEND_URL}/admin/workbench/session`)
  expect(
    response.ok(),
    `GET /admin/workbench/session must succeed when WAVE_ADMIN_ALLOWED is on`,
  ).toBeTruthy()
  return (await response.json()) as AdminSessionEnvelope
}

async function adminDeleteSession(
  request: APIRequestContext,
): Promise<{ cleared: boolean }> {
  const response = await request.delete(`${BACKEND_URL}/admin/workbench/session`)
  expect(
    response.ok(),
    `DELETE /admin/workbench/session must succeed when WAVE_ADMIN_ALLOWED is on`,
  ).toBeTruthy()
  return (await response.json()) as { cleared: boolean }
}

test.describe('F-WORKBENCH-SESSION-ADMIN-01: admin workbench session endpoints', () => {
  test.beforeEach(async ({ request }) => {
    // Make sure no prior test left a session lingering on this worker's
    // backend - the admin endpoints operate on shared in-memory state.
    await adminDeleteSession(request).catch(() => undefined)
  })

  test('empty slot: GET returns empty envelope; DELETE returns cleared:false', async ({
    request,
  }) => {
    const envelope = await adminGetSession(request)
    expect(
      envelope,
      'GET on an empty slot must return all-null envelope fields',
    ).toEqual(EMPTY_ENVELOPE)

    const deleteResult = await adminDeleteSession(request)
    expect(
      deleteResult.cleared,
      'DELETE on an empty slot must report cleared:false',
    ).toBe(false)
  })

  test('active session: GET returns identity; DELETE clears; follow-up GET empty; follow-up DELETE cleared:false', async ({
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { id: testId, name: testName } = await importTest(
      request,
      `admin-wb-session-${suffix}`,
    )
    const sessionId = await startWorkbenchSession(request, testId, environmentId)

    await test.step('GET surfaces the active session identity', async () => {
      const envelope = await adminGetSession(request)
      expect(envelope.session_id, 'session_id matches the just-started session').toBe(sessionId)
      expect(envelope.test_id, 'test_id matches the entity backing the session').toBe(testId)
      expect(envelope.test_name, 'test_name matches the entity backing the session').toBe(testName)
      expect(
        typeof envelope.status,
        'status is a non-null string while the workbench is alive',
      ).toBe('string')
      // Ephemeral workbench runs do not produce an execution record.
      expect(envelope.execution_id, 'ephemeral workbench has no execution_id').toBeNull()
    })

    await test.step('DELETE clears the session and reports cleared:true', async () => {
      const result = await adminDeleteSession(request)
      expect(result.cleared, 'DELETE on an active session must report cleared:true').toBe(true)
    })

    await test.step('Follow-up GET returns the empty envelope', async () => {
      const envelope = await adminGetSession(request)
      expect(
        envelope,
        'GET after a successful DELETE must return all-null envelope fields',
      ).toEqual(EMPTY_ENVELOPE)
    })

    await test.step('Follow-up DELETE on the now-empty slot reports cleared:false', async () => {
      const result = await adminDeleteSession(request)
      expect(
        result.cleared,
        'DELETE on an already-empty slot must report cleared:false (idempotent)',
      ).toBe(false)
    })
  })
})
