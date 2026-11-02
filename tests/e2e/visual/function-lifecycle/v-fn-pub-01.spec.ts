/**
 * V-FN-PUB-01: Publish dialog (FN-LC-1..5)
 *
 * Design Decisions:
 *   - single-mode publish
 *   - FN-LC-1..3 (fields: Name + Version + Description + Tags + Changelog + Details)
 *   - FN-LC-4 (footer note left of Cancel + Publish)
 *   - FN-LC-5 (silent confirm: toast + node swap L→S)
 *
 * Pass Criteria:
 *   1. Dialog opens on Publish to Library kebab entry of a local Function.
 *   2. Dialog title is "Publish Function" with an sr-only DialogDescription
 *   3. Name field renders as a NameField (textarea-style; shared counter
 *      contract).
 *   4. Version field is editable, accepts semver `1.0.0-dev1`.
 *   5. Invalid version triggers the "Use semver v2" inline error with a
 *      clickable popover listing example versions + semver.org link.
 *   6. Name + Version row uses grid template `1fr_220px` so Version has
 *      visible room (chars must not clip).
 *   7. Tags field is a chip input (`[data-testid="tags-input"]`). Empty-state copy
 *      inside the dropdown reads
 *      "Type a tag name to search or create a new one".
 *   8. Footer note is left-aligned: "A new library Function will be created."
 *   9. Footer has Cancel (left of Publish) + Publish (primary).
 *
 * Phase: fixture (seeds a Test with a local Function via POST /tests).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-pub-1'

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-FN-PUB-01 seed: local Function eligible for Publish to Library',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'PublishMe',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { msg: 'hello' }, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'PublishMe',
              description: 'seed description',
              workflow: { nodes: [], edges: [] },
              inputs: [{ name: 'msg', type: 'string', required: true }],
              outputs: [{ name: 'out', type: 'string' }],
              variables: [],
            },
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

async function seed(page: Page): Promise<string> {
  const name = `V-FN-PUB-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(name) })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openPublishDialog(page: Page) {
  const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  await expect(node).toBeVisible()
  // Select the node so the kebab is interactive, then open it.
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Publish to Library' }).click()
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-PUB-01: Publish dialog', () => {
  test('S1: dialog opens with the documented layout + sr-only description', async ({ page }) => {
    const testId = await seed(page)
    await open(page, testId)
    const dialog = await openPublishDialog(page)

    // (2) Title + sr-only description (a11y).
    await expect(dialog.getByRole('heading', { name: 'Publish Function' })).toBeVisible()
    const description = dialog.locator('[id^="radix-"][id$="-description"], .sr-only')
    await expect(description.first()).toContainText('library entry')

    // (3) Name field uses the shared NameField primitive (textarea-style).
    const nameInput = dialog.locator('[data-testid="publish-name-input"]')
    await expect(nameInput).toBeVisible()
    const nameTag = await nameInput.evaluate((el) => el.tagName)
    expect(['INPUT', 'TEXTAREA']).toContain(nameTag)
    expect(await nameInput.getAttribute('maxlength')).toBe('32')

    // (6) Name + Version row uses grid template `1fr_220px`.
    const nameVersionRow = dialog.locator('.grid.grid-cols-\\[1fr_220px\\]')
    await expect(nameVersionRow).toBeVisible()

    // (8) + (9) Footer note + Cancel + Publish.
    const footerNote = dialog.locator('p', { hasText: 'A new library Function will be created.' })
    await expect(footerNote).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Publish' })).toBeVisible()
  })

  test('S2: Version field accepts semver pre-release (regression guard: version was wrongly readonly)', async ({
    page,
  }) => {
    const testId = await seed(page)
    await open(page, testId)
    const dialog = await openPublishDialog(page)

    const versionInput = dialog.getByLabel('Version')
    await expect(versionInput).toBeVisible()
    // Version must NOT be readonly.
    expect(await versionInput.getAttribute('readonly')).toBeNull()

    await versionInput.fill('')
    await versionInput.fill('1.0.0-dev1')
    await expect(versionInput).toHaveValue('1.0.0-dev1')
    // No "Use semver v2" error should appear for a valid pre-release.
    await expect(dialog.locator('text="Use"')).toHaveCount(0)
  })

  test('S3: invalid semver surfaces the "Use semver v2" popover with examples + semver.org link', async ({
    page,
  }) => {
    const testId = await seed(page)
    await open(page, testId)
    const dialog = await openPublishDialog(page)

    const versionInput = dialog.getByLabel('Version')
    await versionInput.fill('not-a-version')
    // Inline error appears.
    const errorMessage = dialog.locator('p.text-destructive', { hasText: /Use\s+semver v2/ })
    await expect(errorMessage).toBeVisible()

    // Clicking the "semver v2" button opens a popover
    // listing example versions + a semver.org link.
    const semverBtn = errorMessage.locator('button:has-text("semver v2")')
    await expect(semverBtn).toBeVisible()
    await semverBtn.click()
    const popover = page.locator('[role="dialog"] >> text=Semver v2 examples').locator(
      'xpath=ancestor::*[@role="dialog"][1]',
    )
    await expect(popover).toBeVisible()
    await expect(popover.locator('text=1.0.0').first()).toBeVisible()
    await expect(popover.locator('text=1.0.0-alpha').first()).toBeVisible()
    await expect(popover.locator('text=1.0.0+20130313144700').first()).toBeVisible()
    await expect(popover.locator('a[href="https://semver.org/"]')).toBeVisible()
  })

  test('S4: Tags is a chip input with the canonical empty-state copy (regression guard)', async ({
    page,
  }) => {
    const testId = await seed(page)
    await open(page, testId)
    const dialog = await openPublishDialog(page)

    // Tags must be `[data-testid="tags-input"]`, not a
    // free-text Input; this assertion locks the chip-style contract.
    const tagsInput = dialog.locator('[data-testid="tags-input"]')
    await expect(tagsInput).toBeVisible()

    // Open the popover, then type a search that cannot possibly match an
    // existing tag (the shard may have prior tags from other tests, so we
    // can't rely on the "no tags available" branch). Empty-state copy
    // must read the canonical line so users know they can create new tags
    // by typing.
    const searchInput = page.getByPlaceholder('Search tags…')
    const emptyCopy = page.locator(
      'text="Type a tag name to search or create a new one"',
    )
    // The block menu hands focus back to its trigger as it closes, which can close a popover opened right after it.
    await expect(async () => {
      if (!(await searchInput.isVisible())) {
        await tagsInput.locator('[data-testid="tags-trigger"]').click({ timeout: 2_000 })
      }
      await searchInput.fill('ZZZ_NO_MATCH_xyz_pub01', { timeout: 2_000 })
      await expect(emptyCopy.first()).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  })

  test('S5: Description, Changelog, Details fields are present (optional)', async ({ page }) => {
    const testId = await seed(page)
    await open(page, testId)
    const dialog = await openPublishDialog(page)

    await expect(dialog.getByLabel('Description')).toBeVisible()
    await expect(dialog.getByLabel('Changelog')).toBeVisible()
    await expect(dialog.getByLabel('Details')).toBeVisible()
  })
})
