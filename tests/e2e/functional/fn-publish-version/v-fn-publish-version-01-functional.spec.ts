/**
 * V-FN-PUBLISH-VERSION-01 (functional): the edit-mode publish version
 * dropdown advances bump targets within the source's MAJOR LINE (per-major
 * no-backports, VIEW-9), skipping any taken version, validates a custom entry
 * against the live version list, and anchors / styles the menu correctly.
 *
 * REQ: REQ-3.1.2.2
 * Guards the stale publish-version suggestion; also covers the in-dialog
 * backport rejection.
 *
 * Scenario: a Function has 1.0.0 and 2.0.0 published; an instance is branch-
 * edited from the OLDER 1.0.0. Per-major bumps rebase on the 1.x line head
 * (1.0.0), so patch -> 1.0.1 and minor -> 1.1.0; +major skips the taken 2.0.0
 * and lands on 3.0.0. The custom field still validates against the global
 * latest (the backend is the authority).
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { publishLibraryFunction, addLibraryVersion, type SeededLibraryFunction } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)
const FN_NODE_ID = 'fn-publish-ver-1'

/** Library Function with 1.0.0 and 2.0.0 published (2.0.0 is the taken latest). */
async function seedLibrary(request: APIRequestContext): Promise<SeededLibraryFunction> {
  const fn = await publishLibraryFunction(request, {
    name: `PubVerFn-${RUN}-${randomUUID().slice(0, 6)}`,
    version: '1.0.0',
    changelog: 'Initial',
  })
  await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })
  return fn
}

/** A Test whose Shared instance is in edit mode, branched from the older 1.0.0,
 *  with a non-breaking draft (so every bump level is allowed). */
async function seedEditModeTest(request: APIRequestContext, fn: SeededLibraryFunction): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PUBLISH-VERSION-01 ${RUN}-${randomUUID().slice(0, 6)}`,
      version: '1.0.0',
      description: 'Edit-mode instance branched from 1.0.0',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 320, y: 180 },
            data: {
              label: fn.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: fn.functionId,
              functionVersion: '1.0.0',
              originalLibraryName: fn.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: true,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
              editMode: true,
              upstreamLink: { functionId: fn.functionId, sourceVersion: '1.0.0' },
              draft: {
                name: fn.name,
                description: '',
                tags: [],
                inputs: [],
                outputs: [],
                dependencies: { functions: [], plugins: [] },
                workflow: { nodes: [], edges: [] },
              },
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
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openPublishDialog(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-PUBLISH-VERSION-01: publish version dropdown', () => {
  test('bump targets advance within the source major line, skip the taken version, and style correctly', async ({
    page,
    request,
  }) => {
    // VIEW-9 (per-major): editing from 1.0.0 while
    // 2.0.0 is taken, the options bump within the 1.x line (patch 1.0.1 / minor
    // 1.1.0); +major skips the taken 2.0.0 -> 3.0.0, never offering 2.0.0.
    const fn = await seedLibrary(request)
    const testId = await seedEditModeTest(request, fn)
    await openTest(page, testId)
    const dialog = await openPublishDialog(page)

    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()

    // Options advance within the 1.x line (patch 1.0.1 / minor 1.1.0); +major
    // skips the taken 2.0.0 -> 3.0.0. Wait for the allowed-bumps fetch to resolve
    // (the major option becomes enabled) so the custom-field validation below runs
    // against the loaded set, not the empty one.
    const majorOption = menu.getByRole('menuitemradio').filter({ hasText: '-> 3.0.0' })
    await expect(majorOption).toBeVisible()
    await expect(majorOption).not.toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitemradio').filter({ hasText: '-> 1.0.1' })).toBeVisible()
    await expect(menu.getByRole('menuitemradio').filter({ hasText: '-> 1.1.0' })).toBeVisible()
    await expect(menu.getByRole('menuitemradio').filter({ hasText: '-> 2.0.0' })).toHaveCount(0)

    // Visual: menu anchors left (not offset right); [LATEST] header sits first; no "v" prefix.
    await expect(menu).toHaveClass(/left-0/)
    await expect(menu).not.toHaveClass(/right-0/)
    const latestHeader = menu.locator('[data-testid="version-dropdown-latest"]')
    await expect(latestHeader).toBeVisible()
    await expect(latestHeader).toContainText('2.0.0')
    await expect(menu.locator('> *').first()).toHaveAttribute('data-testid', 'version-dropdown-latest')
    await expect(menu).not.toContainText('-> v')

    // Custom field validates against the live version list.
    const custom = menu.locator('[data-testid="version-dropdown-custom-input"]')
    const apply = menu.locator('[data-testid="version-dropdown-custom-apply"]')
    const error = menu.locator('[data-testid="version-dropdown-custom-error"]')

    await custom.fill('2.0.0') // taken
    await expect(error).toContainText('already exists')
    await expect(apply).toBeDisabled()

    await custom.fill('1.5.0') // backport below latest
    await expect(error).toContainText('Must be newer than the latest version 2.0.0')
    await expect(apply).toBeDisabled()

    await custom.fill('2.5.0') // valid: newer than latest, not taken
    await expect(error).toHaveCount(0)
    await expect(apply).toBeEnabled()
    await apply.click()
    // Apply commits and closes the menu; the trigger reflects the custom target.
    await expect(menu).toBeHidden()
    await expect(dialog.locator('[data-testid="version-dropdown-trigger"]')).toContainText('2.5.0')
  })

  test('publishing the +major target (3.0.0) succeeds with no version-exists error', async ({
    page,
    request,
  }) => {
    // The suggested target skips the taken 2.0.0, so
    // publishing it lands a real new version instead of failing "version exists".
    const fn = await seedLibrary(request)
    const testId = await seedEditModeTest(request, fn)
    await openTest(page, testId)
    const dialog = await openPublishDialog(page)

    // Pick +major -> 3.0.0. Wait for the allowed-bumps fetch to resolve (the
    // option becomes enabled) so the select commits instead of no-opping.
    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    const majorOption = dialog
      .locator('[data-testid="version-dropdown-menu"]')
      .getByRole('menuitemradio')
      .filter({ hasText: '-> 3.0.0' })
    await expect(majorOption).not.toHaveAttribute('aria-disabled', 'true')
    await majorOption.click()
    await expect(dialog.locator('[data-testid="version-dropdown-trigger"]')).toContainText('3.0.0')

    // Changelog + Details are both mandatory (the seeded source carries no details).
    await dialog.locator('[data-testid="publish-edit-mode-details-input"]').fill('Edit-mode publish details')
    await dialog.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('Major bump skipping the taken 2.0.0')
    const publishBtn = dialog.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
    await publishBtn.click()

    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })

    // The library gains 3.0.0 (the skipped-taken target), proving no "version exists" failure.
    const versions = (await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)).json())
      .data.versions.map((v: { version: string }) => v.version)
    expect(versions).toContain('3.0.0')
    expect(versions).toContain('2.0.0')
  })
})
