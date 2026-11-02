/**
 * V-SECRET-FUNCTION-STRIP: Function secrets stay visible with the strip until their definition is saved
 * Design Decisions: VMGR-106, SECUI-1, SECUI-10
 * REQ: REQ-3.1.3.5, REQ-3.1.2.2
 *
 * Phase: functional-workflow (each test seeds its own library Function and Test; no run).
 *
 * Pass Criteria:
 * 1. In a Local Function inside a Test, a new secret local and a new secret output show the
 *    strip `Secret value stays visible until you save the test.` in the Add window and in
 *    their watchers; a secret input (saved or new) never shows it.
 * 2. The Test save closes their watchers, locks them and masks their rows; the saved Test
 *    holds them secret.
 * 3. In a Shared Function's draft inside a Test the same holds for a new secret local.
 * 4. In the library View of a Function in edit mode, a new secret local at its root and one
 *    in a Local Function two levels deep show `Secret value stays visible until you save the Function.`
 *    in the Add window and in their watchers.
 * 5. Publish closes the open watcher and locks both locals, also two levels deep: their rows
 *    are masked and the published Function holds the root local secret and masked.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  editModeSharedNode,
  localFunctionNode,
  logNode,
  openFunctionView,
  openTest,
  publishLibraryFunction,
  startEdge,
  storedLocalDefinition,
  validateTest,
} from '../../helpers/fn-seed'
import { digIn, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'
import {
  cancelWindow,
  expandVariableManager,
  openEditWindow,
  openFunctionCreateModal,
  setCreateName,
  setWindowCheckbox,
  submitCreate,
  typeStringValue,
  variableRow,
} from '../../helpers/variable-create'

const STRIP_TEST = 'Secret value stays visible until you save the test.'
const STRIP_FUNCTION = 'Secret value stays visible until you save the Function.'
const MASK = '********'

const strip = (scope: Locator): Locator => scope.getByTestId('inspect-secret-notice')
const watcher = (page: Page, name: string): Locator => page.locator(`section[aria-label="Inspect variable ${name}"]`)
const expandButton = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="expand-button-"]')
const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

/** Add a secret through the in-Function Add window; the strip it shows is checked before Create. */
async function addSecret(
  page: Page,
  mode: 'variable' | 'output',
  name: string,
  value: string,
  expectedStrip: string,
): Promise<void> {
  const win = await openFunctionCreateModal(page, mode)
  await setCreateName(page, name, win)
  await typeStringValue(page, value, win)
  await expect(strip(win), 'a plain value shows no strip').toHaveCount(0)
  await setWindowCheckbox(win, 'secret', true)
  await expect(strip(win)).toHaveText(expectedStrip)
  await submitCreate(page, win)
  await expect(win).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

async function openWatcherWithStrip(page: Page, name: string, value: string, expectedStrip: string): Promise<void> {
  await expect(expandButton(page, name), `${name} is unlocked before the save`).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expandButton(page, name).click()
  const seen = watcher(page, name)
  await expect(seen).toBeVisible()
  await expect(seen).toContainText(value)
  await expect(strip(seen)).toHaveText(expectedStrip)
}

/** The version Publish added to a library Function seeded at `seeded`. */
async function publishedVersion(request: APIRequestContext, functionId: string, seeded: string): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}/versions`)
  expect(resp.ok(), `GET /functions/${functionId}/versions: ${resp.status()}`).toBeTruthy()
  const versions = (await resp.json()).data.versions as Array<{ version: string }>
  const added = versions.find((entry) => entry.version !== seeded)
  expect(added, 'Publish made a new version').toBeTruthy()
  return (added as { version: string }).version
}

async function closeWatcher(page: Page, name: string): Promise<void> {
  await watcher(page, name).getByRole('button', { name: `Close inspector for ${name}`, exact: true }).click()
  await expect(watcher(page, name)).toHaveCount(0)
}

async function expectLocked(page: Page, name: string): Promise<void> {
  await expect(watcher(page, name), `${name} watcher closed`).toHaveCount(0)
  await expect(expandButton(page, name), `${name} locks`).toHaveAttribute('aria-disabled', 'true')
  await expect(rowValue(page, name), `${name} row is masked`).toHaveText(MASK)
}

test.describe('V-SECRET-FUNCTION-STRIP', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
  })

  test('Local Function and Shared draft in a Test: the strip until the Test save, never on a secret input', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const body = { nodes: [logNode('body-log', 'Body', "'draft-body'")], edges: [startEdge('body-log')] }
    const fn = await publishLibraryFunction(request, { name: `zz-fn-strip-draft-${tag}`, workflow: body })
    functionIds.push(fn.functionId)
    const testName = `zz-secret-function-strip-${tag}`
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [
        localFunctionNode('fn-loc', 'LocFn', {
          nodes: [logNode('loc-log', 'LocBody', "'loc-body'")],
          edges: [startEdge('loc-log')],
          inputs: [{ name: 'in_s', type: 'string', secret: true, required: false }],
        }),
        editModeSharedNode('fn-draft', {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
          draftWorkflow: body,
          position: { x: 300, y: 320 },
        }),
      ],
      edges: [startEdge('fn-loc'), { id: 'e-loc-draft', source: 'fn-loc', target: 'fn-draft' }],
    })
    testIds.push(testId)
    const validation = await validateTest(request, testId)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    await openTest(page, testId)

    await test.step('Local Function: a new secret local and output show the strip', async () => {
      await digIn(page, 'fn-loc')
      await expandVariableManager(page)
      await addSecret(page, 'variable', 'loc_new', 'loc-new-1', STRIP_TEST)
      await addSecret(page, 'output', 'out_new', 'out-new-1', STRIP_TEST)
    })

    await test.step('Local Function: a secret input never shows the strip', async () => {
      const saved = await openEditWindow(page, 'in_s')
      await expect(strip(saved)).toHaveCount(0)
      await cancelWindow(page, saved)

      const add = await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'in_new', add)
      await setWindowCheckbox(add, 'secret', true)
      await expect(strip(add), 'a new secret input shows no strip').toHaveCount(0)
      await cancelWindow(page, add, 'Close')
    })

    await test.step('Local Function: the watchers show the strip until the Test save, then lock', async () => {
      await openWatcherWithStrip(page, 'loc_new', 'loc-new-1', STRIP_TEST)
      await openWatcherWithStrip(page, 'out_new', 'out-new-1', STRIP_TEST)
      await saveTest(page)
      await expectLocked(page, 'loc_new')
      await expectLocked(page, 'out_new')

      const stored = await storedLocalDefinition(request, testId, 'fn-loc')
      expect(stored.variables.find((entry) => entry.name === 'loc_new')).toMatchObject({ secret: true })
      expect(stored.outputs.find((entry) => entry.name === 'out_new')).toMatchObject({ secret: true })
    })

    await test.step('Shared draft: a new secret local shows the strip until the Test save, then locks', async () => {
      await popToBreadcrumbSegment(page, testName)
      await digIn(page, 'fn-draft')
      await expandVariableManager(page)
      await addSecret(page, 'variable', 'draft_new', 'draft-new-1', STRIP_TEST)
      await openWatcherWithStrip(page, 'draft_new', 'draft-new-1', STRIP_TEST)
      await saveTest(page)
      await expectLocked(page, 'draft_new')
    })
  })

  test('library View: the strip names the Function and Publish locks the values, also two levels deep', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const tag = randomUUID().slice(0, 8)
    const fn = await publishLibraryFunction(request, {
      name: `zz-fn-strip-view-${tag}`,
      workflow: {
        nodes: [
          localFunctionNode('inner-fn', 'Inner', {
            nodes: [logNode('inner-log', 'InnerBody', "'inner-body'")],
            edges: [startEdge('inner-log')],
          }),
        ],
        edges: [startEdge('inner-fn')],
      },
    })
    functionIds.push(fn.functionId)
    await openFunctionView(page, fn.functionId, fn.version)
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    const publish = page.locator('[data-testid="action-bar-publish-button"]')
    await expect(publish).toBeVisible({ timeout: 15_000 })
    await expandVariableManager(page)

    await test.step('a new secret local at the View root and two levels deep shows the Function strip', async () => {
      await addSecret(page, 'variable', 'view_tok', 'view-new-1', STRIP_FUNCTION)
      await openWatcherWithStrip(page, 'view_tok', 'view-new-1', STRIP_FUNCTION)
      await closeWatcher(page, 'view_tok')
      await digIn(page, 'inner-fn')
      await expandVariableManager(page)
      await addSecret(page, 'variable', 'inner_tok', 'inner-new-1', STRIP_FUNCTION)
      await openWatcherWithStrip(page, 'inner_tok', 'inner-new-1', STRIP_FUNCTION)
    })

    await test.step('Publish closes the watcher and locks both locals', async () => {
      await publish.click()
      const meta = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
      await expect(meta).toBeVisible({ timeout: 10_000 })
      await meta.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('secret locals')
      await meta.locator('[data-testid="publish-edit-mode-details-input"]').fill('secret strip guard')
      await meta.getByRole('button', { name: 'Publish', exact: true }).click()
      const confirm = page.locator('[data-testid="publish-outcome-single-confirm"]')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      await confirm.click()
      await expect(confirm).toBeHidden({ timeout: 15_000 })

      // Publish leaves the View drilled where it was: the open watcher two levels deep closes in place.
      await expandVariableManager(page)
      await expectLocked(page, 'inner_tok')

      const resp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}`)
      expect(resp.ok(), `GET /functions/${fn.functionId}: ${resp.status()}`).toBeTruthy()
      const published = (await resp.json()).data as { variables?: Array<Record<string, unknown>> }
      expect(published.variables?.find((entry) => entry.name === 'view_tok'), 'the published root local').toMatchObject({
        secret: true,
        value: MASK,
      })
    })

    await test.step('the published version shows the root local locked and masked', async () => {
      await openFunctionView(page, fn.functionId, await publishedVersion(request, fn.functionId, fn.version))
      await expandVariableManager(page)
      await expectLocked(page, 'view_tok')
    })
  })
})
