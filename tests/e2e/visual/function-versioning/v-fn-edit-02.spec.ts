/**
 * V-FN-EDIT-02: Drop changes reverts an edit-mode instance to the clean source pin
 * (FN-VER-1).
 *
 * Design Decisions:
 *   - Drop changes lives on the kebab when editMode is true
 *   - REQ-5.2.1.23 (destructive-dialog policy: no ESC / no backdrop dismiss)
 *
 * Pass Criteria:
 *   1. Drop changes appears on the kebab only while the instance carries an
 *      active draft.
 *   2. Clicking it opens a Drop Changes confirmation dialog (role=alertdialog)
 *      naming the function + the source version it will revert to.
 *   3. ESC and backdrop click do NOT dismiss the dialog (destructive policy).
 *   4. Confirming Drop changes strips the asterisk overlay and removes Drop
 *      changes / Publish from the kebab; the instance returns to a clean
 *      Published reference.
 *
 * Phase: no-data (the spec seeds its own Test + library entry via POST).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  clickNodeKebabItem,
  expectNodeKebabItem,
  openNodeKebab,
  waitForCanvasLoad,
} from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-edit-02'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  const name = `DropFn ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-02 library entry',
      tags: [],
      inputs: [{ name: 'msg', type: 'string', required: true }],
      outputs: [{ name: 'out', type: 'string' }],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed for drop-changes coverage',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-EDIT-02 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-EDIT-02 host Test',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: fn.name,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: fn.functionId,
            functionVersion: fn.version,
            originalLibraryName: fn.name,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { msg: 'hi' }, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

async function seedTest(request: APIRequestContext, fn: SeededFunction): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildSeedTest(fn) })
  const body = await resp.json()
  expect(body?.success === true, `POST /tests failed: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function enterEditMode(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
  const overlay = page.locator(
    `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
  )
  await expect(overlay).toBeVisible({ timeout: 10_000 })
}

test.describe('V-FN-EDIT-02: Drop changes reverts the draft', () => {
  test('S1: Drop changes appears in the kebab only while in edit mode', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    // Before edit mode: no Drop changes entry.
    let menu = await openNodeKebab(page, FN_NODE_ID)
    await expect(menu.getByRole('menuitem', { name: 'Drop changes' })).toHaveCount(0)
    // Close menu by pressing Escape so the next click on the kebab re-opens it.
    await page.keyboard.press('Escape')

    await enterEditMode(page)

    // After edit mode: Drop changes is present (retry the open against the
    // post-transition re-render that can transiently close the menu).
    await expectNodeKebabItem(page, FN_NODE_ID, 'Drop changes')
  })

  test('S2: confirmation dialog opens with destructive policy + completes the revert', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    await enterEditMode(page)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Drop changes')

    // ConfirmationDialog renders an alertdialog with the title "Drop changes".
    const dialog = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(`v${fn.version}`)

    // REQ-5.2.1.23: ESC and backdrop click MUST NOT dismiss the dialog.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    // Backdrop click - aim well outside the dialog body. The first click
    // could be eaten by Radix focus management, so we click twice to harden
    // the assertion that the dialog still stays open.
    await page.mouse.click(2, 2)
    await page.mouse.click(2, 2)
    await expect(dialog).toBeVisible()

    // Confirm: clicking the destructive Drop changes button completes the revert.
    await dialog.getByRole('button', { name: 'Drop changes' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Asterisk overlay gone; the instance is back to a clean shared reference.
    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toHaveCount(0)

    // Kebab no longer carries Drop changes / Publish edit-mode entries.
    const menuAfter = await openNodeKebab(page, FN_NODE_ID)
    await expect(menuAfter.getByRole('menuitem', { name: 'Drop changes' })).toHaveCount(0)
    await expect(menuAfter.getByRole('menuitem', { name: 'Publish' })).toHaveCount(0)
  })
})
