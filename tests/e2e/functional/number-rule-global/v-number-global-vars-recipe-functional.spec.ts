/**
 * V-NUMBER-GLOBAL-VARS-RECIPE: a recipe map variable whose element is a nested map keeps `2.50` as written
 * Wireframe: N/A (the variable window and its Edit value sheet keep their look)
 * Design Decisions: VMGR-110, FIELD-13
 * REQ: REQ-3.1.3.14, REQ-3.1.3.19, REQ-5.2.7.16
 *
 * The MCP endpoint is turned on until restart for the recipe and reset afterwards, so this spec runs with the
 * stack-wide Settings specs.
 *
 * Pass Criteria:
 * 1. create_test_from_recipe creates a Test from a map variable `pricing` whose element `plan` is the nested
 *    map `{rate: 2.50}`.
 * 2. The stored Test keeps `2.50` in the nested element (GET /tests/{id}), never `2.5`.
 * 3. The variable window's value field shows the map with `2.50`; its Edit value sheet (Visual) shows the
 *    `plan` entry as `{"rate": 2.50}`.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { deleteTest, runToken } from '../../helpers/element-types'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { rawBody } from '../../helpers/number-entry'
import { resetOwnership } from '../../helpers/ownership'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  closeValueEditor,
  openEditWindow,
  openValueEditor,
  setValueEditorView,
  valueField,
} from '../../helpers/variable-create'

// Its own port, apart from the recipe-authoring specs'.
const MCP_PORT = Number(BACKEND_PORT) + 766

function recipeFor(name: string): string {
  return `test:
  name: ${name}
  description: A nested map element written with a trailing zero
variables:
  pricing:
    type: map
    value: {plan: {rate: 2.50}}
  done: {type: boolean}
flow:
  - set: {done: true}
`
}

test.describe('V-NUMBER-GLOBAL-VARS-RECIPE: a recipe nested map element keeps its digits', () => {
  let testId = ''

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    if (testId) await deleteTest(request, testId)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('{rate: 2.50} is stored and opens as 2.50', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    await test.step('1. the recipe creates the Test', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipeFor(`zz-11541-s9-recipe-map-${runToken()}`),
      })
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      testId = created.payload.test_id as string
    })

    await test.step('2. the stored nested element keeps 2.50', async () => {
      const text = await rawBody(await request.get(`${BACKEND_URL}/tests/${testId}`), `GET /tests/${testId}`)
      expect(text).toMatch(/\\"rate\\": ?2\.50\b/)
      expect(text).not.toMatch(/\\"rate\\": ?2\.5\b/)
    })

    await test.step('3. the window and its Edit value sheet show 2.50', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
      const win = await openEditWindow(page, 'pricing')
      await expect(valueField(win).locator('input:not([data-testid])')).toHaveValue(/"rate": ?2\.50\}/)
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Visual')
      await expect(sheet.locator('[data-testid="map-edit-key-0"]')).toHaveValue('plan')
      await expect(sheet.locator('[data-testid="map-edit-value-0"]')).toHaveValue(/^\{"rate": ?2\.50\}$/)
      await closeValueEditor(page, sheet)
    })
  })
})
