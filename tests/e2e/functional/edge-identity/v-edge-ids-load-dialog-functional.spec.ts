/**
 * V-EDGE-IDS-LOAD-FUNCTIONAL: the canvas load dialog offers no automatic fix for a Test whose wires repeat an id,
 * and its Fix reports a deleted Test the way a Save does
 *
 * REQ: REQ-5.2.4.3 (Error Code Taxonomy: DUPLICATE_EDGE_ID has no automatic fix; the Fix Endpoint refuses a
 *      test whose edges repeat an identifier and repairs nothing), REQ-3.1.2.4 (validation before save)
 * Design: Unified Validation Modal and Load-Time Routing: the load modal lists each issue with its fix
 *         action where one applies, and its Fix All calls the fix endpoint; closing it keeps the Test open.
 *         The open Test gone from the server raises the one "Test not found" dialog on every surface that
 *         meets it, Save included, never a retry toast, because retrying cannot help.
 *
 * Pass Criteria:
 * 1. Opened on the canvas, a stored Test whose two wires carry one id raises the load dialog with the
 *    finding "Edge ID 'e-repeat' is used by more than one edge", no fix action on that row and no Fix All.
 * 2. A stored Test that repeats an id and also holds a cross-scope wire, whose finding carries the fix
 *    action "Remove the cross-scope edge", raises the load dialog with the repeated-id finding and no fix
 *    action on its row; Fix All is not offered for the set, and the headline claims no automatic fix,
 *    because the fix endpoint refuses the Test.
 * 3. Closing the dialog keeps the Test open, and the stored Test keeps every wire as stored.
 * 4. A stored Test whose one finding is the fixable cross-scope wire opens with Fix All. When the Test is
 *    deleted while the dialog is open, Fix All raises the "Test not found" dialog a Save raises on a
 *    clean canvas (one Close button) in place of the load dialog, and no "Please try again" toast shows.
 *    Close leaves an empty draft canvas.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { cleanUp, storedTest } from '../../helpers/fn-block'
import { openTest, rawPersistTest, VALIDATION } from '../../helpers/fn-seed'
import { saveBtn } from '../../helpers/workbench'
import {
  DUPLICATE_EDGE_ID,
  fixture,
  REPEATED_ID,
  repeatedIdMessage,
  uniqueName,
  wireRows,
  type TestDocument,
  type Wire,
} from './edge-ids'

const SHARED_ID = 'e-shared'
const CROSS_SCOPE = 'CROSS_SCOPE_EDGE'
const CROSS_SCOPE_FIX = 'Remove the cross-scope edge'
/** The toast the Fix shows for a failure a retry may clear. */
const FIX_RETRY_TOAST = 'Failed to apply automatic fixes. Please try again.'

interface Finding {
  code: string
  message: string
  fix_action?: string | null
}

/** Store `doc` through the admin bulk route, because the save refuses it. */
async function persist(request: APIRequestContext, doc: TestDocument, tag: string, testIds: string[]): Promise<string> {
  const testId = await rawPersistTest(request, {
    name: uniqueName(tag),
    nodes: doc.workflow.nodes,
    edges: doc.workflow.edges,
    variables: doc.variables,
  })
  testIds.push(testId)
  return testId
}

/** `fixture-fix-cross-scope.json` with the wire from Start on an id of its own: the cross-scope wire is the one finding. */
function crossScopeOnly(): TestDocument {
  const doc = fixture('fixture-fix-cross-scope.json')
  expect(doc.workflow.edges[0].source, 'the first wire of the fixture leaves Start').toBe('start-node')
  doc.workflow.edges[0] = { ...doc.workflow.edges[0], id: 'e-ef-start' }
  return doc
}

/** The load validation's errors for the stored Test. */
async function loadFindings(request: APIRequestContext, testId: string): Promise<Finding[]> {
  const resp = await request.post(`${BACKEND_URL}/tests/${testId}/validate?context=load`)
  const body = await resp.json().catch(() => null)
  expect([200, 422], `POST /tests/${testId}/validate: ${JSON.stringify(body)}`).toContain(resp.status())
  return ((resp.status() === 200 ? body?.data?.errors : body?.error?.details?.[0]?.errors) ?? []) as Finding[]
}

/** The load dialog, open over the canvas. */
async function loadDialog(page: Page, testId: string): Promise<Locator> {
  await openTest(page, testId)
  const dialog = page.locator(VALIDATION.dialog)
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText('Test Issues Found')
  return dialog
}

/** The dialog row that lists `message`, and its Fix cell. */
function issueRow(dialog: Locator, message: string): { row: Locator; fix: Locator } {
  const row = dialog.locator('tbody tr').filter({ hasText: message })
  return { row, fix: row.locator('td:nth-child(2)') }
}

/** Close the dialog: the Test stays open on the canvas and the stored Test keeps every wire. */
async function closeKeepsTest(page: Page, dialog: Locator, request: APIRequestContext, testId: string, doc: TestDocument): Promise<void> {
  await dialog.locator(VALIDATION.closeBtn).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/workbench/)
  for (const node of doc.workflow.nodes) {
    await expect(page.getByTestId(`workflow-node-${String(node.id)}`), `Block ${String(node.id)} stays on the canvas`).toBeVisible()
  }
  const workflow = (await storedTest(request, testId)).workflow as { edges: Wire[] }
  expect(wireRows(workflow.edges), 'the stored Test keeps every wire as stored').toEqual(wireRows(doc.workflow.edges))
}

test.describe('V-EDGE-IDS-LOAD-FUNCTIONAL: the load dialog offers no automatic fix for a repeated wire id', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('a Test whose wires repeat an id opens with the finding and no fix', async ({ page, request }) => {
    const doc = fixture('fixture-repeated-ids.json')
    const testId = await persist(request, doc, 'load', testIds)
    const dialog = await loadDialog(page, testId)

    await test.step('the dialog lists the repeated id with no fix action', async () => {
      const { row, fix } = issueRow(dialog, repeatedIdMessage(REPEATED_ID))
      await expect(row, 'the repeated id is listed once').toHaveCount(1)
      await expect(fix, 'a repeated id has no automatic fix').toHaveText('-')
      await expect(dialog.locator(VALIDATION.fixAllBtn), 'nothing in the dialog can be fixed automatically').toHaveCount(0)
      await expect(dialog).toContainText('must be resolved manually')
    })

    await test.step('Close keeps the Test open and nothing changed it', async () => {
      await closeKeepsTest(page, dialog, request, testId, doc)
    })
  })

  test('with a fixable cross-scope wire beside the repeated id, Fix All is not offered for the set', async ({
    page,
    request,
  }) => {
    const doc = fixture('fixture-fix-cross-scope.json')
    const testId = await persist(request, doc, 'load-cross', testIds)

    await test.step('the stored Test holds a fixable finding beside the repeated id', async () => {
      const errors = await loadFindings(request, testId)
      expect(
        errors.filter((e) => e.code === DUPLICATE_EDGE_ID).map((e) => [e.message, e.fix_action ?? null]),
        'the load validation names the repeated id with no fix action',
      ).toEqual([[repeatedIdMessage(SHARED_ID), null]])
      expect(
        errors.filter((e) => e.code === CROSS_SCOPE).map((e) => e.fix_action),
        'the cross-scope wire carries a fix action',
      ).toEqual([CROSS_SCOPE_FIX])
    })

    const dialog = await loadDialog(page, testId)

    await test.step('the dialog lists the repeated id with no fix action', async () => {
      const { row, fix } = issueRow(dialog, repeatedIdMessage(SHARED_ID))
      await expect(row, 'the repeated id is listed once').toHaveCount(1)
      await expect(fix, 'a repeated id has no automatic fix').toHaveText('-')
    })

    await test.step('no automatic fix is offered while the repeated id is listed', async () => {
      await expect
        .soft(
          dialog.locator(VALIDATION.fixAllBtn),
          'Fix All calls the fix endpoint, which refuses a Test that repeats a wire id',
        )
        .toHaveCount(0)
      await expect
        .soft(dialog, 'the headline claims no automatic fix the dialog cannot run')
        .not.toContainText('can be automatically fixed')
    })

    await test.step('Close keeps the Test open and nothing changed it', async () => {
      await closeKeepsTest(page, dialog, request, testId, doc)
    })
  })
})

test.describe('V-EDGE-IDS-LOAD-FUNCTIONAL: the load dialog\'s Fix on a Test deleted while the dialog is open', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('Fix All raises the Test not found dialog a Save raises, not the retry toast', async ({ page, request }) => {
    const doc = crossScopeOnly()
    const testId = await persist(request, doc, 'load-fix-deleted', testIds)
    const name = String((await storedTest(request, testId)).name)

    await test.step('the stored Test holds one finding, and it has a fix', async () => {
      const errors = await loadFindings(request, testId)
      expect(
        errors.filter((e) => e.code === DUPLICATE_EDGE_ID),
        'every wire has an id of its own',
      ).toEqual([])
      expect(
        errors.filter((e) => e.code === CROSS_SCOPE).map((e) => e.fix_action),
        'the cross-scope wire carries a fix action',
      ).toEqual([CROSS_SCOPE_FIX])
    })

    const dialog = await loadDialog(page, testId)
    const fixAll = dialog.locator(VALIDATION.fixAllBtn)
    const deleted = page.getByTestId('deleted-test-modal')

    await test.step('the dialog offers Fix All over a canvas with no unsaved change', async () => {
      await expect(fixAll).toBeVisible()
      await expect(fixAll).toBeEnabled()
      await expect(saveBtn(page), 'the opened Test holds no unsaved change').toBeDisabled()
    })

    await test.step('the Test is deleted while the dialog is open', async () => {
      const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `DELETE /tests/${testId}: ${resp.status()}`).toBeTruthy()
      await expect(deleted, 'nothing reports the deletion before the user acts').toHaveCount(0)
    })

    await fixAll.click()

    await test.step('Fix All raises the Test not found dialog in place of the load dialog', async () => {
      await expect(deleted, 'the fix endpoint answered 404 for the open Test').toBeVisible({ timeout: 15_000 })
      await expect(deleted.getByRole('heading', { name: 'Test not found' })).toBeVisible()
      await expect(deleted).toContainText(
        `The test "${name}" is no longer on the server. Close clears the canvas and starts a new draft.`,
      )
      const actions = deleted.getByRole('button')
      await expect(actions, 'a clean canvas offers the one non-destructive answer').toHaveCount(1)
      await expect(actions).toHaveText('Close')
      await expect(
        page.locator('[data-toast]', { hasText: FIX_RETRY_TOAST }),
        'retrying cannot bring a deleted Test back, so no retry toast shows',
      ).toHaveCount(0)
      await expect(dialog, 'the load dialog of the deleted Test is gone').toBeHidden()
    })

    await test.step('Close leaves an empty draft canvas', async () => {
      await deleted.getByRole('button', { name: 'Close' }).click()
      await expect(deleted).toHaveCount(0)
      await expect(dialog).toBeHidden()
      await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()
      await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText('Draft Workflow')
      await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype]')).toHaveCount(0)
    })
  })
})
