/**
 * V-PROF-VALUE-RUNTIME-FUNCTIONAL: profile value runtime binding is unchanged.
 *
 * The profile value EDITOR lives on the shared sheet, but the stored shape and
 * the runtime binding stay unchanged: a table param resolves to the same { headers, rows }
 * dict, and integer / float params carried as exact digit-strings realize to an exact int /
 * Decimal at the execution edge (`get_profile_config_for_execution` ->
 * `_coerce_declared_value`). Each profile is bound to Log nodes via `profileBindings`, the
 * workflow runs, and the resolved values are read back from the console.
 *
 * Covers the table round-trip at runtime and the runtime half of number
 * precision (exact int + Decimal, exact arithmetic).
 *
 * REQ-4.7.4, REQ-4.7.10, REQ-3.1.3.14 (exact numeric pipeline).
 *
 * Phase: functional-workflow (imports its own profile + test via API, runs in isolation).
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-value-runtime/v-prof-value-runtime-functional.spec.ts
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const BACKEND = `http://localhost:${BACKEND_PORT}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEnvId(request: APIRequestContext): Promise<string> {
  const resp = await request.get(`${BACKEND}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  expect(env, `Environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id
}

async function deleteProfileByName(request: APIRequestContext, name: string) {
  const list = await request.get(`${BACKEND}/profiles?search=${encodeURIComponent(name)}`)
  const lb = await list.json()
  const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
  for (const p of arr) {
    if (p.name === name) await request.delete(`${BACKEND}/profiles/${p.id}`).catch(() => {})
  }
}

async function deleteTestByName(request: APIRequestContext, name: string) {
  const list = await request.get(`${BACKEND}/tests?search=${encodeURIComponent(name)}`)
  const lb = await list.json()
  const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
  for (const t of arr) {
    if (t.name === name) await request.delete(`${BACKEND}/tests/${t.id}`).catch(() => {})
  }
}

async function createProfile(
  request: APIRequestContext,
  name: string,
  envId: string,
  fields: Record<string, { type: string; value: unknown }>,
): Promise<string> {
  await deleteProfileByName(request, name)
  const config: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    config[k] = { type: v.type, secret: false, value: v.value }
  }
  const resp = await request.post(`${BACKEND}/profiles`, {
    data: { name, type: 'custom', tags: [], environment_values: { [envId]: config } },
  })
  expect(resp.ok(), `create profile ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id ?? body.id
}

/** A Log node bound to the profile, logging the given expression message. */
function logNode(id: string, y: number, message: string, profileId: string, profileName: string) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 400, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: id,
      hasNewerVersion: false,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message, level: 'INFO' },
        outputBindings: {},
        profileBindings: [{ profileId, alias: 'prof', profileName, profileType: 'custom' }],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

async function importValidateRunAndReadLogs(
  page: Page,
  testFixture: Record<string, unknown>,
): Promise<string[]> {
  await page.request.delete(`${BACKEND}/workbench/session/`).catch(() => {})

  const createResp = await page.request.post(`${BACKEND}/tests`, { data: testFixture })
  const createBody = (await createResp.json().catch(() => null)) as Record<string, unknown> | null
  expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
  const created = createBody as Record<string, unknown>
  const testId = ((created.data as Record<string, unknown>)?.id ?? created.id) as string

  // Fixture must validate with zero errors before it is run.
  const validateResp = await page.request.post(`${BACKEND}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(validateResp.ok(), `validate failed: ${validateResp.status()}`).toBeTruthy()
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? validateBody?.errors ?? []
  expect(errors.length, `fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  // Select the shared E2E environment so the profile's env values resolve.
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()

  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
  const statusVal = await status.getAttribute('data-status')
  if (statusVal !== 'passed') {
    const lines = await getLogLines(page)
    console.log('=== WORKFLOW NOT PASSED ===')
    console.log(JSON.stringify(lines.filter((l) => l.startsWith('[ERROR]') || l.startsWith('[WARN]')), null, 2))
  }
  expect(statusVal).toBe('passed')

  return getLogTexts(page)
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe('V-PROF-VALUE-RUNTIME: profile value binding unchanged after the editor migration', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  // -------------------------------------------------------------------------
  // A table param resolves to the SAME { headers, rows } dict at runtime
  // (the editor adapts at the boundary; storage + binding are untouched).
  // -------------------------------------------------------------------------
  test('table binding resolves to the {headers, rows} dict at runtime', async ({ page, request }) => {
    const envId = await getEnvId(request)
    const profileId = await createProfile(request, 'PVR-table', envId, {
      conn: {
        type: 'table',
        value: { headers: ['host', 'port'], rows: [['db.local', '5432'], ['cache.local', '6379']] },
      },
    })

    const fixture = {
      name: 'PVR-table-test',
      tags: [],
      variables: {},
      workflow: {
        nodes: [
          logNode('log-keys', 120, "'tkeys=' + str(sorted(prof.conn.keys()))", profileId, 'PVR-table'),
          logNode('log-hdr', 200, "'thdr=' + str(prof.conn['headers'])", profileId, 'PVR-table'),
          logNode('log-cell', 280, "'tcell=' + str(prof.conn['rows'][1][1])", profileId, 'PVR-table'),
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'log-keys', type: 'default' },
          { id: 'e2', source: 'log-keys', target: 'log-hdr', type: 'default' },
          { id: 'e3', source: 'log-hdr', target: 'log-cell', type: 'default' },
        ],
      },
    }

    const logs = await importValidateRunAndReadLogs(page, fixture)
    const all = logs.join('\n')
    const has = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    // The dict still has exactly the { headers, rows } keys, the header list, and the cell.
    has("tkeys=['headers', 'rows']")
    has("thdr=['host', 'port']")
    has('tcell=6379')

    await deleteTestByName(request, 'PVR-table-test')
    await deleteProfileByName(request, 'PVR-table')
  })

  // -------------------------------------------------------------------------
  // Runtime: precision-exceeding integer + float resolve EXACT (int + Decimal),
  // and integer arithmetic stays exact (no JS Number / float64 rounding).
  // -------------------------------------------------------------------------
  test('number precision binding resolves to exact int + Decimal at runtime', async ({ page, request }) => {
    const envId = await getEnvId(request)
    // A profile integer holds at most 19 digits (REQ-3.1.3.14).
    const BIG_INT = '9223372036854775899'
    const BIG_INT_PLUS_1 = '9223372036854775900'
    const BIG_FLOAT = '3.14159265358979311699'
    const profileId = await createProfile(request, 'PVR-num', envId, {
      bignum: { type: 'integer', value: BIG_INT },
      bigflt: { type: 'float', value: BIG_FLOAT },
    })

    const fixture = {
      name: 'PVR-num-test',
      tags: [],
      variables: {},
      workflow: {
        nodes: [
          logNode('log-int', 120, "'int=' + str(prof.bignum)", profileId, 'PVR-num'),
          logNode('log-sum', 200, "'intsum=' + str(prof.bignum + 1)", profileId, 'PVR-num'),
          logNode('log-flt', 280, "'flt=' + str(prof.bigflt)", profileId, 'PVR-num'),
        ],
        edges: [
          { id: 'e1', source: 'start-node', target: 'log-int', type: 'default' },
          { id: 'e2', source: 'log-int', target: 'log-sum', type: 'default' },
          { id: 'e3', source: 'log-sum', target: 'log-flt', type: 'default' },
        ],
      },
    }

    const logs = await importValidateRunAndReadLogs(page, fixture)
    const all = logs.join('\n')
    const has = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    // Exact arbitrary-precision integer + exact arithmetic + exact Decimal float.
    has(`int=${BIG_INT}`)
    has(`intsum=${BIG_INT_PLUS_1}`)
    has(`flt=${BIG_FLOAT}`)

    await deleteTestByName(request, 'PVR-num-test')
    await deleteProfileByName(request, 'PVR-num')
  })
})
