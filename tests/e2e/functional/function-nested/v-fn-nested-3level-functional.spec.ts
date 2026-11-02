/**
 * V-FN-NESTED-3LEVEL (functional): a local Function nested THREE deep
 * (Level1 > Level2 > Level3) imports clean, validates with zero errors, runs
 * end-to-end, and every level's Log surfaces in the console.
 *
 * This is the fixture-import counterpart to the programmatic 2-level
 * `v-fn-nested-functional.spec.ts`: it proves arbitrary-depth nested
 * composition (REQ-3.1.1.4) executes and that the deepest line propagates
 * up through two enclosing Function boundaries.
 *
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * Pass Criteria:
 *   1. POST /tests imports the 3-level fixture (success).
 *   2. POST /tests/{id}/validate returns zero errors (no false circular /
 *      missing-reference flags on a 3-deep local nest).
 *   3. Run reaches the `passed` terminal state.
 *   4. Console contains fn3-lvl1, fn3-lvl2, AND fn3-lvl3-deepest - all three
 *      Function bodies executed and the deepest line propagated to the root.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-3level.json'), 'utf-8'))
  return { ...fixture, name: `V-FN-NESTED-3LEVEL ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function importAndValidate(request: APIRequestContext): Promise<string> {
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
  const createBody = await createResp.json().catch(() => null)
  expect(
    createBody?.success,
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
  ).toBeTruthy()
  const testId = createBody.data.id

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? validateBody?.errors ?? []
  expect(errors.length, `3-level nest must validate clean. Errors: ${JSON.stringify(errors)}`).toBe(0)
  return testId
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-FN-NESTED-3LEVEL (functional): three-deep local nesting runs end-to-end', () => {
  test('imports + validates clean, runs passed, and every level logs', async ({ page, request }) => {
    await ensureEnvironment(request)
    const testId = await importAndValidate(request)
    await openTest(page, testId)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogTexts(page)
    for (const marker of ['fn3-lvl1', 'fn3-lvl2', 'fn3-lvl3-deepest']) {
      expect(
        logs.some((l) => l.includes(marker)),
        `"${marker}" must surface - all 3 nested levels execute and the deepest line propagates. Got ${JSON.stringify(logs)}`,
      ).toBe(true)
    }
  })
})
