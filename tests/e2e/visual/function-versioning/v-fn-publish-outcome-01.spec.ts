/**
 * V-FN-PUBLISH-OUTCOME-01 (visual): the three-option PublishOutcomeDialog
 * renders with its full layout in both themes and enforces the
 * AlertDialog no-ESC / no-backdrop dismiss policy.
 *
 * Design Decisions: CANVAS-219..222.
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * The modal carries the upload-icon title
 * "Publish a new version?", the mono version-transition line, the body
 * paragraph, the Set New / Keep Old note box, and the single-row footer
 * (Cancel / Publish and keep Old / Publish and set New) with NO save-status
 * line. ESC and a backdrop click must NOT dismiss it.
 *
 * Phase: no-data (the spec seeds its own library entry + Test via POST). The
 * spec runs under both the dark and light visual projects (colorScheme set
 * per project), so the structural assertions hold in each theme - this is the
 * same DOM-assertion pattern v-fn-lifecycle-dialogs uses (no pixel baseline).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-publish-outcome-1'

interface SeededFn {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `outcome_dlg_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-PUBLISH-OUTCOME-01 seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'seed details',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, version: '1.0.0', name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PUBLISH-OUTCOME-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance at v1.0.0 for the outcome-modal visual',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: shared.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: shared.functionId,
              functionVersion: shared.version,
              originalLibraryName: shared.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  return (await resp.json()).data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

/** Enter edit mode, open the publish-edit-mode dialog, fill the mandatory
 *  Changelog, and click Publish to surface the three-option outcome modal. */
async function openOutcomeModal(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
  const overlay = page.locator(
    `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
  )
  await expect(overlay).toBeVisible({ timeout: 10_000 })

  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const editDialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(editDialog).toBeVisible({ timeout: 10_000 })

  await editDialog
    .locator('[data-testid="publish-edit-mode-changelog-input"]')
    .fill('Outcome-modal visual regression guard')

  const publishBtn = editDialog.getByRole('button', { name: 'Publish' })
  // Wait for the allowed-bumps call to resolve so the target is an allowed bump
  // and Publish enables; only then does it open the outcome modal.
  await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
  await publishBtn.click()

  const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
  await expect(outcome).toBeVisible({ timeout: 10_000 })
  return outcome
}

test.describe('V-FN-PUBLISH-OUTCOME-01 (visual): three-option publish confirmation', () => {
  test('renders the full outcome-modal layout (CANVAS-219..222)', async ({ page, request }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    const outcome = await openOutcomeModal(page)

    // Title (the AlertDialogTitle leaf carries exactly this text).
    await expect(outcome.getByText('Publish a new version?', { exact: true })).toBeVisible()

    // Mono version-transition line: source v1.0.0 -> the lowest allowed bump
    // (PATCH = v1.0.1 for an unchanged body) joined by the ASCII arrow. The
    // v-prefixed versions live ONLY on this line (the body/note use prose).
    const transition = outcome.locator('p.font-mono')
    await expect(transition).toContainText('v1.0.0')
    await expect(transition).toContainText('v1.0.1')
    await expect(transition).toContainText('->')

    // Body paragraph references the version in prose.
    await expect(outcome).toContainText('permanently records version 1.0.1 in the library')
    await expect(outcome).toContainText('Choose what happens to this instance')

    // The Set New / Keep Old note box (the two emphasized <strong> labels).
    await expect(outcome.locator('strong', { hasText: 'Set New' })).toBeVisible()
    await expect(outcome.locator('strong', { hasText: 'Keep Old' })).toBeVisible()

    // Single-row footer: three actions.
    await expect(outcome.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(outcome.getByRole('button', { name: 'Publish and keep Old' })).toBeVisible()
    await expect(outcome.getByRole('button', { name: 'Publish and set New' })).toBeVisible()
    // No save-status line (the Test is never saved by publish - CANVAS-221).
    await expect(outcome.getByText(/save/i)).toHaveCount(0)
  })

  test('AlertDialog policy: ESC and backdrop do NOT dismiss', async ({ page, request }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    const outcome = await openOutcomeModal(page)

    // ESC must not dismiss - an explicit choice is required.
    await page.keyboard.press('Escape')
    await expect(outcome).toBeVisible()

    // A click on the backdrop (top-left corner, well outside the modal) must
    // not dismiss either.
    await page.mouse.click(5, 5)
    await expect(outcome).toBeVisible()
  })
})
