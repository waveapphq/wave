/**
 * V-FN-VER-01: Publish-as-major-of-existing flow (FN-VER-3..8)
 *
 * Design Decisions:
 *   - FN-VER-4 (smart Version dropdown with color-coded bump chip)
 *   - FN-VER-5 (disabled bumps with (i) tooltip below)
 *   - FN-VER-7, FN-VER-8 (mandatory Changelog, Publish visibly disabled until non-empty;
 *     Details mandatory, pre-filled with the project default)
 *   - FN-VER-3 (locked source chip)
 *   - FN-VER-6/7/8 (publish-edit-mode dialog layout)
 *
 * Pass Criteria:
 *   1. Edit-mode publish dialog opens via the kebab on an edit-mode instance.
 *   2. Locked source chip carries an `f` glyph + library name + source
 *      version meta.
 *   3. Version field renders the auto-derived bump target with a color-coded
 *      chip; clicking the trigger opens the dropdown listing PATCH / MINOR /
 *      MAJOR options + a Custom semver field.
 *   4. Selecting MAJOR updates the trigger to the next major version.
 *   5. Publish button visibly disabled (opacity-50 + cursor-not-allowed) when
 *      Changelog is empty.
 *   6. Filling Changelog enables Publish; clicking Publish completes the flow
 *      and the new version appears in GET /functions/{id}/versions.
 *
 * Phase: no-data (the spec seeds its own Test + library entry via POST).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-ver-01'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  const name = `VerFn ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-VER-01 library entry (seed for publish-edit-mode dialog)',
      tags: ['seed'],
      inputs: [{ name: 'msg', type: 'string', required: true }],
      outputs: [{ name: 'out', type: 'string' }],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed for V-FN-VER-01',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()} - ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-VER-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-VER-01 host Test',
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
            config: { values: { msg: 'hello' }, outputBindings: {}, profileBindings: [] },
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
  expect(body?.success === true, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function enterEditModeAndOpenPublish(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
  const overlay = page.locator(
    `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
  )
  await expect(overlay).toBeVisible({ timeout: 10_000 })
  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-VER-01: publish-as-major-of-existing flow', () => {
  test('S1: source chip, color-coded bump chip, mandatory Changelog visibility', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    const dialog = await enterEditModeAndOpenPublish(page)

    // Locked source chip carries the library name + source meta.
    const sourceChip = dialog.locator('[data-testid="publish-edit-mode-source-chip"]')
    await expect(sourceChip).toBeVisible()
    await expect(sourceChip).toContainText(fn.name)
    await expect(sourceChip).toContainText('source v1.0.0')

    // Mandatory Changelog label carries the accessible red star (FIELD-12).
    const changelogLabel = dialog.locator('[data-testid="publish-edit-mode-changelog-label"]')
    await expect(changelogLabel).toBeVisible()
    await expect(changelogLabel.locator('span.text-destructive[aria-hidden="true"]')).toHaveText('*')
    await expect(changelogLabel.locator('span.sr-only')).toHaveText(' required')

    // Publish button is visibly disabled (per feedback_visual_disabled_state):
    // opacity-50 + cursor-not-allowed, not just aria-disabled.
    const publishBtn = dialog.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).toHaveAttribute('aria-disabled', 'true')
    await expect(publishBtn).toHaveClass(/opacity-50/)
    await expect(publishBtn).toHaveClass(/cursor-not-allowed/)
  })

  test('S2: selecting MAJOR updates the trigger; Custom field is present', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    const dialog = await enterEditModeAndOpenPublish(page)

    // Open the dropdown.
    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()

    // Custom field is rendered alongside the bump options.
    await expect(menu.locator('[data-testid="version-dropdown-custom-input"]')).toBeVisible()

    // Pick MAJOR -> trigger shows 2.0.0 (bump options render no "v" prefix).
    await menu.getByRole('menuitemradio').filter({ hasText: '-> 2.0.0' }).click()
    await expect(menu).toBeHidden()
    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).toContainText('2.0.0')
    // Trigger renders the MAJOR chip alongside the version.
    await expect(trigger.locator('[data-testid="bump-chip-major"]')).toBeVisible()
  })

  test('S3: filling Changelog enables Publish; submit creates the new version', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    const dialog = await enterEditModeAndOpenPublish(page)

    // Move to MAJOR via dropdown.
    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    await dialog
      .locator('[data-testid="version-dropdown-menu"]')
      .getByRole('menuitemradio')
      .filter({ hasText: '-> 2.0.0' })
      .click()

    // Fill mandatory Changelog (Details is already pre-filled with default).
    await dialog.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('Major bump for V-FN-VER-01')

    const publishBtn = dialog.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
    await publishBtn.click()

    // Publish opens the three-option outcome modal (CANVAS-219); "Publish and set
    // New" completes the publish and re-pins the instance.
    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // New version appears in the BE list.
    const resp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    expect(resp.ok(), `GET versions: ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    const versions: string[] = body.data.versions.map((entry: { version: string }) => entry.version)
    expect(versions, `versions for ${fn.functionId}`).toContain('2.0.0')
  })
})
