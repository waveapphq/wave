/**
 * V-CANVAS-FN-PARAM-PERSIST-01: Input/Output/Variable rows persist through Save + reload
 *
 * Design Decisions: FN-VMGR-1..3, FN-PARAM-1, FN-PARAM-2
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1
 *
 * +Add dialog saves reach localDefinition.inputs/.outputs, and displayVariables
 * re-reads state.nodes, so a row shows at once and survives Save + reload.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. + Add ▾ -> Input parameter (name=`username`, type=string, default=`admin`)
 *      drops a row under PARAMETERS / INPUTS with the IN badge immediately
 *      (not after another render).
 *   2. + Add ▾ -> Output parameter (name=`result`, type=integer, default=0)
 *      drops a row under PARAMETERS / OUTPUTS with the OUT badge.
 *   3. + Add ▾ -> Variable (name=`tmp`, type=string, default=`x`) drops a row
 *      under VARIABLES.
 *   4. After Save + reload + drill back in, all three rows survive in the
 *      right groups (proves PUT /tests/{id} carries localDefinition.inputs/
 *      .outputs/.variables and the load path rehydrates them).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import { createFunctionParam } from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-PARAM-PERSIST-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function drillIn(page: Page) {
  await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
}

test.describe('V-CANVAS-FN-PARAM-PERSIST-01: param + var persistence through reload', () => {
  test('add input/output/variable, save, reload, drill back - all three survive', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    // Add Input parameter `username`; the row must appear immediately.
    await createFunctionParam(page, 'input', 'username', { value: 'admin' })
    await expect(page.locator('[data-testid="in-badge-param:input:username"]')).toBeVisible()

    // Add Output parameter `result`; it must reach localDefinition.outputs.
    await createFunctionParam(page, 'output', 'result', { type: 'integer', value: '0' })
    await expect(page.locator('[data-testid="out-badge-param:output:result"]')).toBeVisible()

    // Add Variable `tmp`.
    await createFunctionParam(page, 'variable', 'tmp', { value: 'x' })
    // Local variables land in the VARIABLES group; their id is a normal uuid
    // (not a `param:` synthetic id). Match by name + presence in the variables
    // group.
    const variablesGroup = page.locator('[data-testid="var-group-variables"]')
    await expect(variablesGroup).toBeVisible()
    await expect(variablesGroup.getByText('tmp', { exact: true })).toBeVisible()

    // Save the Test.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Reload + drill back in. PUT /tests/{id}
    // must carry localDefinition.inputs / .outputs / .variables.
    await openTest(page, testId)
    await drillIn(page)

    await expect(page.locator('[data-testid="in-badge-param:input:username"]')).toBeVisible()
    await expect(page.locator('[data-testid="out-badge-param:output:result"]')).toBeVisible()
    await expect(page.locator('[data-testid="var-group-variables"]').getByText('tmp', { exact: true })).toBeVisible()
  })
})
