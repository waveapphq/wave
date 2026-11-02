/**
 * V-EXEC-DETAIL-REFRESH: a failed poll tick keeps the last known state and
 * says so
 *
 * Phase: functional-workflow. The Execution Detail page refreshes itself on a
 * timer while the run is live. A tick that fails is not a load step: taking
 * the page away over one missed tick would lose the run the user is watching,
 * and saying nothing would leave stale numbers passing as current. The page
 * keeps what it has and names the failure beside it until a clean tick lands.
 *
 * Design Decisions: LIST-26 (a read repeating on a timer reports in place and
 * keeps the last good data on screen).
 *
 * Pass Criteria:
 *  1. A failing tick raises the in-place notice carrying the server's reason.
 *  2. The run stays on screen: the page keeps its name and its panels, no
 *     full-page error state, and nothing is blocked.
 *  3. The next clean tick clears the notice.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { apiPathMatcher, failApiRoute } from '../../helpers/api-route'
import { expectNotBlocked } from '../../helpers/page-block'
import { createValidTest, delayNode, startEdge } from '../../helpers/fn-seed'

const STAMP = `${Date.now()}`
const TEST_NAME = `EXECREFRESH Body ${STAMP}`
const SUITE_NAME = `EXECREFRESH Suite ${STAMP}`
const REFRESH_DETAIL = 'Execution store unavailable'

// The run must outlive the spec, so the poll never stops on a terminal status.
const HOLD_RUN_MS = 120000

let testId = ''
let suiteId = ''
let executionId = ''
let executionName = ''

async function environmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  const environments = Array.isArray(body) ? body : (body.data ?? [])
  const match = environments.find((environment: { name: string }) => environment.name === E2E_ENV_NAME)
  expect(match, `environment ${E2E_ENV_NAME} must exist`).toBeTruthy()
  return match.id
}

/** Hold until the stopped execution has actually settled, so the deletes pass. */
async function waitForTerminal(request: APIRequestContext): Promise<void> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    const body = await response.json().catch(() => null)
    const status = ((body?.data ?? {}) as { status?: string }).status
    if (status && ['passed', 'failed', 'stopped', 'skipped'].includes(status)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

test.describe('V-EXEC-DETAIL-REFRESH: a missed tick never takes the run away', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: TEST_NAME,
      nodes: [delayNode('execrefresh-delay', 'Delay', HOLD_RUN_MS)],
      edges: [startEdge('execrefresh-delay')],
    })

    const suiteResponse = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: SUITE_NAME, description: 'execution detail refresh spec', tests: [testId] },
    })
    expect(
      suiteResponse.ok(),
      `POST /suites failed: ${suiteResponse.status()} ${await suiteResponse.text()}`,
    ).toBeTruthy()
    suiteId = ((await suiteResponse.json()).data as { id: string }).id

    const executionResponse = await request.post(`${BACKEND_URL}/executions`, {
      data: { type: 'suite', id: suiteId, environment_id: await environmentId(request) },
    })
    expect(
      executionResponse.ok(),
      `POST /executions failed: ${executionResponse.status()} ${await executionResponse.text()}`,
    ).toBeTruthy()
    executionId = ((await executionResponse.json()).data as { id: string }).id

    // The name the page renders is the one the detail read carries.
    const detail = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(detail.ok(), 'the seeded execution must be readable').toBeTruthy()
    executionName = ((await detail.json()).data as { name: string }).name
    expect(executionName, 'the execution must carry a name to render').toBeTruthy()
  })

  test.afterAll(async ({ request }) => {
    await request.put(`${BACKEND_URL}/executions/${executionId}/stop`).catch(() => undefined)
    await waitForTerminal(request)
    await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('ER1: a failing tick names itself in place and the run stays on screen', async ({
    page,
  }) => {
    const executionRoute = apiPathMatcher(`/executions/${executionId}`)
    const detailPage = page.getByTestId('execution-detail-page')

    await page.goto(`/executions/${executionId}`)
    await expect(detailPage).toBeVisible({ timeout: 20000 })
    await expect(detailPage).toContainText(executionName)

    // Armed after the load, so only the poll ticks fail.
    let failing = true
    await failApiRoute(page, executionRoute, () => (failing ? { detail: REFRESH_DETAIL } : null))

    // 1. The tick reports where the user is looking.
    const notice = page.getByTestId('execution-detail-refresh-error')
    await expect(notice).toBeVisible({ timeout: 15000 })
    await expect(notice).toHaveAttribute('role', 'alert')
    await expect(notice).toHaveText(`${REFRESH_DETAIL} (showing the last known state)`)

    // 2. The run the user is watching is still on screen.
    await expect(detailPage).toBeVisible()
    await expect(detailPage).toContainText(executionName)
    await expect(page.getByTestId('execution-detail-error')).toHaveCount(0)
    await expectNotBlocked(page)

    // 3. A clean tick clears it.
    failing = false
    await expect(notice).toHaveCount(0, { timeout: 15000 })
    await expect(detailPage).toContainText(executionName)
  })
})
