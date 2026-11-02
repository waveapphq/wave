/**
 * Duplicate node ID is rejected at validate time.
 *
 * The backend's `tests/service._validate_all_nodes` refuses to accept a
 * workflow whose nodes map contains a repeated `id`. The error code is
 * `DUPLICATE_NODE_ID` with fix_action = "Assign unique IDs to every block".
 *
 * This is an API-only check: POST the fixture via /tests, then call
 * /validate and assert the error entry. No page render needed.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

const BASE = `http://localhost:${BACKEND_PORT}`

const DUPLICATE_FIXTURE_ID = 'ad19d000-0001-0001-0001-000000000001'

function buildFixtureWithDuplicateNodeId(): Record<string, unknown> {
  // Two nodes sharing `id: "log-dup"`. The second should be rejected by
  // the validator because the node map collapses both into one slot at
  // runtime, losing engine metadata for one of them.
  const nodeShape = (id: string, yPos: number) => ({
    id,
    type: 'workflowNode',
    position: { x: 400, y: yPos },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: 'Log',
      hasNewerVersion: false,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: {
          message: "'duplicate-id test'",
          level: 'INFO',
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  })

  const now = new Date().toISOString()
  return {
    id: DUPLICATE_FIXTURE_ID,
    name: `DUPLICATE_NODE_ID fixture ${Date.now()}`,
    version: '1.0.0',
    description: 'Two nodes share the same id to exercise the validator.',
    workflow: {
      nodes: [nodeShape('log-dup', 100), nodeShape('log-dup', 260)],
      edges: [],
    },
    variables: {},
    metadata: {},
    created_at: now,
    updated_at: now,
  }
}

/** Import the fixture via the admin bulk endpoint, bypassing the unified
 *  write-path validation pipeline. The pipeline's `_validate_for_persist`
 *  raises SaveValidationError on DUPLICATE_NODE_ID at create time, which
 *  prevents the test from setting up the broken-data scenario it needs to
 *  exercise the read-side `/validate` endpoint. */
async function importTest(request: APIRequestContext): Promise<string> {
  await request.post(`${BASE}/admin/enable`, {
    data: { reason: 'E2E DUPLICATE_NODE_ID validate-time test' },
  })
  const response = await request.post(`${BASE}/admin/bulk/tests`, {
    data: {
      operations: [{ op: 'add', entity: buildFixtureWithDuplicateNodeId() }],
    },
  })
  expect(
    response.ok(),
    `POST /admin/bulk/tests failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  return DUPLICATE_FIXTURE_ID
}

test.describe('DUPLICATE_NODE_ID rejected at validate time', () => {
  test('/validate returns DUPLICATE_NODE_ID with a unique-id fix action', async ({
    request,
  }) => {
    const testId = await importTest(request)

    // `/tests/<id>/validate` returns 422 when validation errors are
    // present (see routes.py:760). The response body's
    // `error.details[0]` carries the full validation result with
    // errors/warnings arrays.
    const response = await request.post(`${BASE}/tests/${testId}/validate`)
    expect(
      response.status(),
      'validate responds 422 when duplicate node IDs are present',
    ).toBe(422)

    const body = (await response.json()) as Record<string, unknown>
    const errorBlock = body.error as Record<string, unknown>
    expect(errorBlock?.code).toBe('VALIDATION_ERRORS')
    const details = (errorBlock?.details ?? []) as Array<Record<string, unknown>>
    const result = details[0] ?? {}
    const errors = (result.errors ?? []) as Array<Record<string, unknown>>

    const dup = errors.find((e) => e.code === 'DUPLICATE_NODE_ID')
    expect(dup, 'validator surfaces DUPLICATE_NODE_ID').toBeTruthy()
    expect(String(dup?.message ?? '')).toMatch(/used by more than one block/i)
    expect(String(dup?.fix_action ?? '')).toMatch(/assign unique id/i)
    expect(dup?.node_id).toBe('log-dup')
  })
})
