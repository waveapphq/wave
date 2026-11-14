/**
 * V-MCP-LIST-EXECUTIONS-FUNCTIONAL: list_executions answers past runs newest first, filtered and attributed
 * Design Decisions: MCP-9
 * REQ: REQ-5.2.7.8, REQ-5.2.7.10, REQ-5.2.7.2
 *
 * Pass Criteria:
 * 1. After a passed and a failed run of seeded Tests, a run of a seeded Suite and an MCP-started run,
 *    the rows are newest first: the four runs read MCP run, Suite run, failed run, passed run, and the
 *    whole answer is ordered by start time, latest first.
 * 2. Each row holds the name, entity type, status, triggered_by, start time and duration that
 *    GET /executions/{id} answers.
 * 3. `status: failed` answers only failed runs, and of the seeded runs only the failed one.
 * 4. `entity_type` answers only runs of that type: `suite` holds the Suite run, `test` the three Test runs.
 * 5. `limit` caps the answer at the newest rows; with no limit the answer is the newest 20.
 * 6. The MCP-started run is attributed `mcp:<client name>`; the runs started through the API are not.
 * 7. An unknown status, an unknown entity type and a limit of 0 are refused with their exact texts.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  MCP_PORT,
  callMcp,
  expectRaised,
  failingTest,
  getExecution,
  objectOf,
  own,
  passingTest,
  purgeTests,
  rowsOf,
  seedTest,
  startTracked,
  waitForStatus,
} from './list-client'

const PREFIX = 'zz-mcp-list_executions-'
const CLIENT = 'zz-mcp-list_executions-client'

async function purgeSuites(request: APIRequestContext): Promise<void> {
  const body = await (await request.get(`${BACKEND_URL}/suites?search=${PREFIX}&per_page=100`)).json().catch(() => null)
  const suites = (body?.data ?? []) as Array<{ id: string; name: string }>
  for (const suite of own(suites, PREFIX)) await request.delete(`${BACKEND_URL}/suites/${suite.id}`).catch(() => undefined)
}

test.describe('V-MCP-LIST-EXECUTIONS-FUNCTIONAL: list_executions against the stored runs', () => {
  const tests: string[] = []
  const suites: string[] = []
  const executions: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await purgeSuites(request)
    await purgeTests(request, PREFIX)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of executions.splice(0)) await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    for (const id of suites.splice(0)) await request.delete(`${BACKEND_URL}/suites/${id}`).catch(() => undefined)
    for (const id of tests.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('rows are newest first, filter by status, entity type and limit, and name the MCP client', async ({ request }) => {
    test.setTimeout(300_000)
    const run: Record<'passed' | 'failed' | 'suite' | 'mcp', string> = { passed: '', failed: '', suite: '', mcp: '' }

    await test.step('seed two Tests and a Suite through the API and run each, then one Test over MCP', async () => {
      const passing = await seedTest(request, {
        name: `${PREFIX}1`,
        description: 'Listing probe that passes',
        workflow: passingTest('le1'),
      })
      const failing = await seedTest(request, {
        name: `${PREFIX}2`,
        description: 'Listing probe that fails',
        workflow: failingTest('le2'),
      })
      tests.push(passing, failing)
      const suiteResp = await request.post(`${BACKEND_URL}/suites`, {
        data: { name: `${PREFIX}3`, description: 'Listing probe suite', tests: [passing] },
      })
      expect(suiteResp.ok(), `POST /suites failed: ${await suiteResp.text()}`).toBeTruthy()
      const suiteId = String((await suiteResp.json()).data.id)
      suites.push(suiteId)

      const environmentId = await resolveEnvironmentId(request)
      const ordered: Array<[keyof typeof run, 'test' | 'suite', string, string]> = [
        ['passed', 'test', passing, 'passed'],
        ['failed', 'test', failing, 'failed'],
        ['suite', 'suite', suiteId, 'passed'],
      ]
      for (const [key, type, id, verdict] of ordered) {
        run[key] = await startTracked(request, type, id, environmentId)
        executions.push(run[key])
        expect(await waitForStatus(request, run[key]), `the ${key} run ends ${verdict}`).toBe(verdict)
      }

      const started = objectOf(
        callMcp('start_execution', { entity_type: 'test', ref: passing, environment: E2E_ENV_NAME }, CLIENT),
        'start_execution',
      )
      run.mcp = String(started.execution_id)
      executions.push(run.mcp)
      expect(await waitForStatus(request, run.mcp)).toBe('passed')
    })

    const all = rowsOf(callMcp('list_executions', { limit: 100 }), 'list_executions')
    const newestFirst = [run.mcp, run.suite, run.failed, run.passed]

    await test.step('rows are newest first', () => {
      expect(own(all, PREFIX).map((row) => row.id)).toEqual(newestFirst)
      const starts = all.map((row) => String(row.started_at ?? ''))
      expect(starts, 'the whole answer is ordered by start time, latest first').toEqual([...starts].sort().reverse())
    })

    await test.step('each row holds what GET /executions/{id} answers', async () => {
      for (const id of newestFirst) {
        const row = all.find((entry) => entry.id === id)
        const stored = await getExecution(request, id)
        expect(row).toEqual({
          id,
          name: stored.name,
          entity_type: stored.entity_type,
          status: stored.status,
          triggered_by: stored.triggered_by,
          started_at: stored.started_at,
          duration: stored.duration,
        })
      }
      const byId = new Map(all.map((row) => [row.id, row]))
      expect(byId.get(run.suite)).toMatchObject({ name: `${PREFIX}3`, entity_type: 'suite', status: 'passed' })
      expect(byId.get(run.failed)).toMatchObject({ name: `${PREFIX}2`, entity_type: 'test', status: 'failed' })
      expect(byId.get(run.passed)).toMatchObject({ name: `${PREFIX}1`, entity_type: 'test', status: 'passed' })
    })

    await test.step('the MCP-started run names its client; the API runs do not', () => {
      const byId = new Map(all.map((row) => [row.id, row]))
      expect(byId.get(run.mcp)?.triggered_by).toBe(`mcp:${CLIENT}`)
      for (const id of [run.passed, run.failed, run.suite]) {
        expect(String(byId.get(id)?.triggered_by), `${id} was started through the API`).not.toMatch(/^mcp:/)
      }
    })

    await test.step('status failed answers only failed runs', () => {
      const failed = rowsOf(callMcp('list_executions', { status: 'failed', limit: 100 }), 'list_executions')
      for (const row of failed) expect(row.status, `${row.name} is failed`).toBe('failed')
      expect(own(failed, PREFIX).map((row) => row.id)).toEqual([run.failed])
    })

    await test.step('entity_type answers only runs of that type', () => {
      const suiteRows = rowsOf(callMcp('list_executions', { entity_type: 'suite', limit: 100 }), 'list_executions')
      for (const row of suiteRows) expect(row.entity_type).toBe('suite')
      expect(own(suiteRows, PREFIX).map((row) => row.id)).toEqual([run.suite])

      const testRows = rowsOf(callMcp('list_executions', { entity_type: 'test', limit: 100 }), 'list_executions')
      for (const row of testRows) expect(row.entity_type).toBe('test')
      expect(own(testRows, PREFIX).map((row) => row.id)).toEqual([run.mcp, run.failed, run.passed])
    })

    await test.step('limit caps the answer at the newest rows; the default is 20', () => {
      const two = rowsOf(callMcp('list_executions', { limit: 2 }), 'list_executions')
      expect(two).toEqual(all.slice(0, 2))
      expect(two.map((row) => row.id)).toEqual([run.mcp, run.suite])
      const byDefault = rowsOf(callMcp('list_executions'), 'list_executions')
      expect(byDefault).toEqual(all.slice(0, 20))
    })

    await test.step('an unknown status, an unknown entity type and a limit of 0 are refused', () => {
      expectRaised(
        callMcp('list_executions', { status: 'done' }),
        'list_executions',
        "Invalid status 'done': valid statuses are pending, running, passed, failed, stopped",
      )
      expectRaised(
        callMcp('list_executions', { entity_type: 'workflow' }),
        'list_executions',
        "Invalid entity_type 'workflow': valid types are test, suite, regression",
      )
      expectRaised(callMcp('list_executions', { limit: 0 }), 'list_executions', 'limit must be a positive integer')
    })
  })
})
