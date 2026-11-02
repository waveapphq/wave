/**
 * V-SECRET-NAMESPACE-INJECTION: secret system / suite / regression variables
 * inject RAW into the run while every visible surface masks them.
 *
 * REQ: REQ-3.1.3.5 / REQ-4.5.3
 *
 * The workbench never injects secret system, suite or
 * regression variables through the MASKED getter, so the runtime value is
 * never the literal "********" (a `Bearer ********` header must not reach
 * the wire).
 *
 * Pass Criteria:
 * 1. A Log expression comparing system.api_token to its REAL value prints
 *    SYS-MATCH (the engine received the raw value, not the placeholder)
 * 2. Printing system.api_token yields ******** in the console
 * 3-4. Same contract for a secret-flagged SUITE variable (SUITE-MATCH)
 * 5-6. Same contract for a secret-flagged REGRESSION variable (REGR-MATCH)
 * 7. No planted secret appears in any console line, WS payload, or the
 *    session variables read
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  importFixtureTest,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const SYS_SECRET = 'sys-s3cr3t-t0k3n-9901'
const SUITE_SECRET = 'suite-s3cr3t-t0k3n-9902'
const REGR_SECRET = 'regr-s3cr3t-t0k3n-9903'
const MASK = '********'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

test.describe('V-SECRET-NAMESPACE-INJECTION', () => {
  let suiteId = ''
  let regressionId = ''

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/variables/system`).catch(() => {})
    if (regressionId) await request.delete(`${BACKEND_URL}/regressions/${regressionId}`).catch(() => {})
    if (suiteId) await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => {})
  })

  test('system / suite / regression secrets behave as their real values; all surfaces show ********', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    // ---- Seed the three scopes -------------------------------------------
    const sysResp = await page.request.post(`${BACKEND_URL}/variables/system`, {
      data: {
        variables: {
          api_token: { type: 'string', value: SYS_SECRET, secret: true },
          region: { type: 'string', value: 'us-west-2', secret: false },
        },
      },
    })
    expect(sysResp.ok(), `POST /variables/system failed: ${await sysResp.text()}`).toBeTruthy()

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importFixtureTest(page, loadFixture())

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const suiteResp = await page.request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: `Secret NS Suite ${stamp}`,
        description: 'secret namespace-injection E2E',
        tests: [testId],
        variables: {
          api_token: { type: 'string', value: SUITE_SECRET, secret: true },
        },
      },
    })
    expect(suiteResp.ok(), `POST /suites failed: ${await suiteResp.text()}`).toBeTruthy()
    suiteId = ((await suiteResp.json()).data ?? {}).id as string

    const regrResp = await page.request.post(`${BACKEND_URL}/regressions`, {
      data: {
        name: `Secret NS Regression ${stamp}`,
        suites: [suiteId],
        variables: {
          api_token: { type: 'string', value: REGR_SECRET, secret: true },
        },
      },
    })
    expect(regrResp.ok(), `POST /regressions failed: ${await regrResp.text()}`).toBeTruthy()
    regressionId = ((await regrResp.json()).data ?? {}).id as string

    // ---- Open + run in the workbench -------------------------------------
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // The backend session exists only once the run starts; the fixture's
    // leading Delay node holds the run while we subscribe (no event replay).
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(status).toHaveAttribute('data-status', 'passed')

    // ---- The engine saw the REAL values ------------------------------------
    const logTexts = await getLogTexts(page)
    const all = logTexts.join('\n')
    for (const proof of ['SYS-MATCH', 'SUITE-MATCH', 'REGR-MATCH']) {
      expect(
        logTexts.some((t) => t === proof),
        `Expected "${proof}" (raw injection proof). Got:\n${all}`,
      ).toBeTruthy()
    }
    expect(all, `a MISMATCH line means the engine received the placeholder:\n${all}`).not.toContain(
      'MISMATCH',
    )

    // ---- ...while every visible surface masks them ------------------------
    const leakLines = logTexts.filter((t) => t === MASK)
    expect(
      leakLines.length,
      `Expected >= 3 masked leak lines (system + suite + regression prints). Got:\n${all}`,
    ).toBeGreaterThanOrEqual(3)
    for (const secret of [SYS_SECRET, SUITE_SECRET, REGR_SECRET]) {
      expect(all, `console leaked ${secret}`).not.toContain(secret)
    }
    const events = await collector.harvest()
    expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
    for (const evt of events) {
      const json = JSON.stringify(evt)
      for (const secret of [SYS_SECRET, SUITE_SECRET, REGR_SECRET]) {
        expect(json, `WS payload leaked ${secret}: ${json}`).not.toContain(secret)
      }
    }
    await collector.close()

    const variables = await getSessionVariables(page, sessionId)
    const varsJson = JSON.stringify(variables)
    for (const secret of [SYS_SECRET, SUITE_SECRET, REGR_SECRET]) {
      expect(varsJson, `session variables leaked ${secret}`).not.toContain(secret)
    }
  })
})
