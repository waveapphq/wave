/**
 * V-CANVAS-FN-SCHEMA-01: Function schema editor (Input parameter creation + namespace rules)
 *
 * Design Decisions: FN-VMGR-1..5, FN-PARAM-1..4, FN-VAR-1
 * REQ: REQ-3.1.1.5 (Function-side schema editor), REQ-3.1.2.1 (typed inputs),
 *      REQ-3.1.2.4 (cheap structural validation - name format + within-section dup)
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Outside a Function the Var Mgr renders the legacy + Add button; drilled
 *      into Function_1 the button morphs into "+ Add" with a chevron dropdown.
 *   2. Dropdown shows three items in order: Input parameter / Output parameter
 *      / Variable.
 *   3. Picking "Input parameter" opens the input window titled
 *      "New input parameter".
 *   4. Saving an Input parameter (name=`user_id`, type=string, default=`admin`)
 *      drops a row under PARAMETERS / INPUTS with the IN badge.
 *   5. Cross-section duplicate is REJECTED: trying to save an Output
 *      parameter that shares a name with an existing Input shows the inline
 *      "A variable with this name already exists" error - inputs and outputs
 *      share one namespace per FN-PARAM-4.
 *   6. Within-section duplicate is also blocked (same error path).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { fillCreateWindow, openFunctionCreateModal } from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-SCHEMA-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function saveAndExpectClean(page: Page) {
  const dialog = page.locator('[data-testid="variable-create-modal"]')
  await dialog.locator('[data-testid="create-submit-button"]').click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

test.describe('V-CANVAS-FN-SCHEMA-01: Function schema editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: + Add dropdown lists Input parameter / Output parameter / Variable', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // At Test root: single-action + Add button.
    await expect(page.locator('[data-testid="add-variable-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="add-variable-dropdown-trigger"]')).toHaveCount(0)

    // Drill in.
    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()

    // Drilled in: + Add ▾ dropdown trigger.
    const trigger = page.locator('[data-testid="add-variable-dropdown-trigger"]')
    await expect(trigger).toBeVisible()
    await trigger.click()

    // All three items in the right order.
    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('Input parameter')
    await expect(items.nth(1)).toContainText('Output parameter')
    await expect(items.nth(2)).toContainText('Variable')
  })

  test('S2: create Input parameter -> row under PARAMETERS/INPUTS with IN badge', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()

    const dialog = await openFunctionCreateModal(page, 'input')
    await expect(dialog).toContainText('New input parameter')

    await fillCreateWindow(page, dialog, 'user_id', { value: 'admin' })
    await saveAndExpectClean(page)

    // Row under PARAMETERS/INPUTS with the IN badge. The synthetic row id
    // for a declared input is `param:input:<name>` per `paramSpecsToVariables`.
    const inBadge = page.locator('[data-testid="in-badge-param:input:user_id"]')
    await expect(inBadge).toBeVisible()
    await expect(inBadge).toHaveText('IN')

    // The PARAMETERS scoped group is open by default and contains the row.
    await expect(page.locator('[data-testid="var-group-parameters"]')).toBeVisible()
    await expect(page.locator('[data-testid="variable-name-param:input:user_id"]')).toHaveText('user_id')
  })

  test('S3: cross-section duplicate (input + output with same name) is rejected inline', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()

    // Create an Input named `payload`.
    await fillCreateWindow(page, await openFunctionCreateModal(page, 'input'), 'payload')
    await saveAndExpectClean(page)
    await expect(page.locator('[data-testid="in-badge-param:input:payload"]')).toBeVisible()

    // Try to create an Output also named `payload` - same namespace, so the
    // form's name field flags it inline and Save is disabled.
    const dialog = await openFunctionCreateModal(page, 'output')
    await dialog.locator('[data-testid="create-variable-name"]').fill('payload')

    await expect(dialog.locator('[data-testid="create-name-error"]')).toBeVisible()
    await expect(dialog.locator('[data-testid="create-name-error"]')).toContainText('already exists')
    await expect(dialog.locator('[data-testid="create-submit-button"]')).toBeDisabled()
  })

  test('S4: within-section duplicate is blocked inline', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()

    await fillCreateWindow(page, await openFunctionCreateModal(page, 'input'), 'token')
    await saveAndExpectClean(page)
    await expect(page.locator('[data-testid="in-badge-param:input:token"]')).toBeVisible()

    const dialog = await openFunctionCreateModal(page, 'input')
    await dialog.locator('[data-testid="create-variable-name"]').fill('token')
    await expect(dialog.locator('[data-testid="create-name-error"]')).toBeVisible()
    await expect(dialog.locator('[data-testid="create-name-error"]')).toContainText('already exists')
    await expect(dialog.locator('[data-testid="create-submit-button"]')).toBeDisabled()
  })
})
