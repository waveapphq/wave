/**
 * V-CANVAS-BEHAVIORAL: the toolbar Edit button and the direct re-save of a saved Test
 * Wireframe: none - workbench toolbar and the test form dialog.
 * Design Decisions: canvas toolbar (Edit after Save) and Test Persistence
 *   ("For existing tests, Save performs an update operation without showing the dialog")
 * REQ: REQ-3.2.1.1 (Save workflow as test)
 *
 * Phase: no-data. Builds its Test through the UI (a Halt Block from the palette, saved through the toolbar),
 * reads it back with GET /tests/{id}, and deletes it afterwards. The other toolbar states (Close, Save,
 * Undo / Redo, breadcrumbs, the close dialog) are covered by V-SAVE-01, V-SAVE-02, V-SAVE-BEHAVIORAL and
 * V-CANVAS-BREADCRUMB-MODES.
 *
 * Pass Criteria:
 * 1. On a draft canvas the toolbar Edit button is disabled.
 * 2. The first Save opens the `New Test` dialog; Create Test stores the Test (it holds the Halt Block),
 *    the breadcrumb shows its name, Save goes disabled and Edit becomes enabled.
 * 3. Edit opens the `Edit Test Info` dialog holding the saved name, with Cancel and Save, in both themes.
 * 4. On the saved Test a second change enables Save, and Save stores it directly with no dialog: Save goes
 *    disabled and the stored Test holds both Blocks.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'

const HALT = { term: 'halt', testId: 'palette-item-halt' }

const toolbarButton = (page: Page, name: 'save' | 'edit') => page.locator(`[data-testid="toolbar-${name}-button"]`)
const testDialog = (page: Page) => page.getByRole('dialog')

async function openDraftCanvas(page: Page): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function addHalt(page: Page, at: { x: number; y: number }): Promise<void> {
  const before = await page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
  await dragPaletteItemToCanvas(page, HALT, at)
  await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype]')).toHaveCount(before + 1)
}

async function storedNodeTypes(page: Page, testId: string): Promise<string[]> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const nodes = ((body.data ?? body).workflow?.nodes ?? []) as Array<{ data?: { elementType?: string } }>
  return nodes.map((node) => node.data?.elementType ?? '').filter((type) => type !== '')
}

/** The Edit Test Info dialog shows the saved name, with Cancel and Save; Cancel closes it. */
async function expectEditInfoDialog(page: Page, name: string): Promise<void> {
  await toolbarButton(page, 'edit').click()
  const dialog = testDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Edit Test Info', exact: true })).toBeVisible()
  await expect(dialog.locator('#test-name')).toHaveValue(name)
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('V-CANVAS-BEHAVIORAL: toolbar Edit and the direct re-save', () => {
  test('a draft canvas keeps Edit disabled', async ({ page }) => {
    await openDraftCanvas(page)
    await expect(toolbarButton(page, 'edit')).toBeDisabled()
    await addHalt(page, { x: 400, y: 260 })
    await expect(toolbarButton(page, 'edit'), 'a dirty draft is still not a saved Test').toBeDisabled()
  })

  test('a saved Test enables Edit, opens Edit Test Info, and saves again without a dialog', async ({ page }) => {
    const name = `zz-11541-r2-behavioral-${randomUUID().slice(0, 8)}`
    let testId = ''
    try {
      await openDraftCanvas(page)
      await addHalt(page, { x: 400, y: 220 })

      // The first save asks for the name.
      await expect(toolbarButton(page, 'save')).toBeEnabled()
      await toolbarButton(page, 'save').click()
      const dialog = testDialog(page)
      await expect(dialog.getByRole('heading', { name: 'New Test', exact: true })).toBeVisible()
      await dialog.locator('#test-name').fill(name)
      const created = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && new URL(resp.url()).pathname.endsWith('/tests'),
      )
      await dialog.getByRole('button', { name: 'Create Test', exact: true }).click()
      const body = await (await created).json()
      testId = ((body.data ?? body) as { id: string }).id
      expect(testId, 'the save created a Test').toBeTruthy()
      await expect(dialog).toBeHidden({ timeout: 10_000 })

      await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText(name)
      await expect(toolbarButton(page, 'save')).toBeDisabled()
      await expect(toolbarButton(page, 'edit')).toBeEnabled()
      expect(await storedNodeTypes(page, testId)).toEqual(['halt'])

      // Edit opens the Test's own info, in both themes.
      await expectEditInfoDialog(page, name)
      await toggleTheme(page)
      await expectEditInfoDialog(page, name)

      // A saved Test saves in place: no dialog, and the stored Test holds the change.
      await addHalt(page, { x: 400, y: 380 })
      await expect(toolbarButton(page, 'save')).toBeEnabled()
      await toolbarButton(page, 'save').click()
      await expect(toolbarButton(page, 'save')).toBeDisabled({ timeout: 10_000 })
      await expect(testDialog(page), 'no dialog asks for a saved Test').toHaveCount(0)
      await expect.poll(() => storedNodeTypes(page, testId)).toEqual(['halt', 'halt'])
    } finally {
      if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    }
  })
})
