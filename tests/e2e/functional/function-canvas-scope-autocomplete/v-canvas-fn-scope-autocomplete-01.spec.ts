/**
 * V-CANVAS-FN-SCOPE-AUTOCOMPLETE-01: Expression autocomplete scope filter
 *
 * Wireframes: none (autocomplete dropdown is CodeMirror's tooltip).
 * Design Decisions: FN-VMGR-5 (Var Mgr scope gating), FN-VAR-1 (bare-name access)
 * REQ: REQ-3.1.1.5
 *
 * Inside a Function the Var Manager's autocomplete suggests no Test vars and no
 * system/suite/regression namespaces.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. At the Test root: opening the Log plugin's expression-mode `message`
 *      field and triggering autocomplete (Ctrl+Space) lists `test_var` AND
 *      the seeded system variable.
 *   2. Drilled into Function_1: opening the inner Log plugin's expression-mode
 *      `message` field and triggering autocomplete lists ONLY `fn_input` (no
 *      `test_var`, no system variable).
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openNodeSheet } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`
const SYSTEM_VAR = 'sys_env'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-SCOPE-AUTOCOMPLETE-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedSystemVariable(request: APIRequestContext) {
  // Admin must be enabled for the CI shard (WAVE_ADMIN_ALLOWED=true in
  // run-e2e-shard.sh). Seeding a single named system variable lets the
  // root-level autocomplete assertion verify the system namespace appears.
  await request.post(`${BASE}/admin/enable`, { data: { reason: 'V-CANVAS-FN-SCOPE-AUTOCOMPLETE-01' } }).catch(() => {})
  const resp = await request.post(`${BASE}/variables/system`, {
    data: { variables: { [SYSTEM_VAR]: { type: 'string', value: 'production' } } },
  })
  expect(resp.ok(), `POST /variables/system failed: ${resp.status()}`).toBeTruthy()
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

async function openConfigForNode(page: Page, nodeTestId: string) {
  const node = page.locator(`[data-testid="${nodeTestId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await openNodeSheet(page, node)
}

/**
 * Trigger autocomplete on the `message` expression field of the Log plugin's
 * config modal and return the list of completion labels.
 */
async function autocompleteLabels(page: Page): Promise<string[]> {
  // `message` field is the Log plugin's expression-mode parameter input.
  const messageInput = page.locator('[data-testid="param-input-message"]')
  await expect(messageInput).toBeVisible()
  const cmEditor = messageInput.locator('.cm-content')
  await cmEditor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(50)
  await page.keyboard.press('Control+Space')

  const autocomplete = page.locator('.cm-tooltip-autocomplete')
  await expect(autocomplete).toBeVisible({ timeout: 5_000 })
  return autocomplete.locator('.cm-completionLabel').allTextContents()
}

test.describe('V-CANVAS-FN-SCOPE-AUTOCOMPLETE-01: scope filter on expression autocomplete', () => {
  test('root autocomplete lists test/system vars; drilled-in lists only fn_input', async ({
    page,
    request,
  }) => {
    await seedSystemVariable(request)
    const testId = await seedFixture(request)
    await openTest(page, testId)

    // ----- Test root: open the root Log's config + autocomplete -----
    await openConfigForNode(page, 'workflow-node-root-log')
    let labels = await autocompleteLabels(page)
    expect(labels, 'Test-scope autocomplete includes test_var').toContain('test_var')
    // The autocomplete exposes the system namespace as the bare `system`
    // token; the individual system variable surfaces only after the user
    // types `system.` (dot completion).
    expect(labels, 'Test-scope autocomplete includes the system namespace').toContain('system')
    expect(labels, 'Test-scope autocomplete does NOT yet include fn_input').not.toContain('fn_input')
    await leaveExpressionEditor(configSheet(page))
    // Cancel triggers `tryClose`, which surfaces the unsaved-changes prompt
    // because the expression-mode toggle + autocomplete probe dirties the
    // form. Discard the unsaved edits so the modal actually closes and the
    // next drill click isn't blocked by an open dialog overlay.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const unsavedClose = page.getByTestId('unsaved-close')
    if (await unsavedClose.isVisible().catch(() => false)) {
      await unsavedClose.click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(configSheet(page)).toHaveCount(0)

    // ----- Drill into Function_1; open inner Log's config + autocomplete -----
    await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
    await openConfigForNode(page, 'workflow-node-inner-log')
    labels = await autocompleteLabels(page)

    // External scope must be filtered out
    // entirely inside a Function.
    expect(labels, 'Function-scope autocomplete includes fn_input').toContain('fn_input')
    expect(labels, 'Function-scope autocomplete excludes test_var').not.toContain('test_var')
    expect(labels, 'Function-scope autocomplete excludes the system namespace').not.toContain('system')
  })
})
