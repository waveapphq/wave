/**
 * V-FN-PUBLISH-LOCALS (functional): publishing a Function keeps its own variables
 * Wireframe: none (functional)
 * Design Decisions: N/A
 * REQ: REQ-3.1.2.1, REQ-3.1.2.2
 *
 * Seeds (API): blank `zz-` Tests; for the library cases a `zz-` library Function at 1.0.0 whose
 * local variable `fn_kept` = `kept-value` is read by its body Log (`publishLibraryFunction` with
 * `variables`), and for the edit-mode and Make Local cases a Test holding that Function's Block
 * under Start. Everything under test is done through the UI: the publish from Local (the Function
 * dragged from the palette, its local created with the in-Function Add menu, a Log dropped under
 * the body's Start, the kebab Publish to Library), entering edit mode and publishing from the kebab,
 * dragging the library card onto the canvas, and Make Local. Library entries are deleted with
 * cascade=true afterwards.
 *
 * Pass Criteria:
 * 1. Publish to Library is accepted (the published body keeps `fn_kept`, so the library's save
 *    check finds the name the body Log reads) and turns the Local Function into a Shared one.
 * 2. The saved Test runs and the body Log prints INFO `kept-value` from the local `fn_kept`.
 * 3. The library Function's View lists the `fn_kept` row.
 * 4. A new version published from edit mode, after a local `fn_added` was added in the draft,
 *    stores both locals; its View lists both rows; the re-pinned Test runs and prints `kept-value`.
 * 5. A library Function dragged onto the canvas under Start runs and prints `kept-value`.
 * 6. Make Local copies the local into the Test (`localDefinition.variables` holds `fn_kept` =
 *    `kept-value`); the Test runs and prints `kept-value`; drilled in, the `fn_kept` row shows it.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import {
  createValidTest,
  logNode,
  openFunctionView,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import {
  breadcrumbFunctionSegments,
  clearPointerLock,
  digIn,
  dropBelowStart,
  dropLibraryFunctionBelowStart,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { createFunctionParam, expandVariableManager, variableRow } from '../../helpers/variable-create'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

interface LibraryEntry {
  id: string
  name: string
}

const FN_NODE_ID = 'fn-with-locals'
const KEPT_LOCAL = { name: 'fn_kept', type: 'string', value: 'kept-value' }

async function findLibraryFunction(
  request: APIRequestContext,
  name: string,
): Promise<LibraryEntry | undefined> {
  const resp = await request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(name)}`)
  expect(resp.ok(), `GET /functions failed: ${resp.status()}`).toBeTruthy()
  const rows = ((await resp.json()).data ?? []) as LibraryEntry[]
  return rows.find((row) => row.name === name)
}

async function cleanup(request: APIRequestContext, testId: string, libraryName: string): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  if (!libraryName) return
  const entry = await findLibraryFunction(request, libraryName).catch(() => undefined)
  if (entry) await request.delete(`${BACKEND_URL}/functions/${entry.id}?cascade=true`).catch(() => undefined)
}

/** Publish from the kebab; returns the library's answer to the publish request. */
async function publishToLibrary(
  page: Page,
  nodeId: string,
  name: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  await clickNodeKebabItem(page, nodeId, 'Publish to Library')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('[data-testid="publish-name-input"]').fill(name)
  const answer = page.waitForResponse(
    (resp) => resp.request().method() === 'POST' && /\/functions(\/publish)?$/.test(new URL(resp.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Publish' }).click()
  const resp = await answer
  return { ok: resp.ok(), status: resp.status(), body: await resp.text() }
}

/** A library Function whose body Log prints its local `fn_kept`. */
async function seedLibraryWithLocal(request: APIRequestContext, name: string): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name,
    variables: [KEPT_LOCAL],
    workflow: {
      nodes: [logNode('kept-log', 'Print Kept', 'fn_kept', { x: 200, y: 180 })],
      edges: [startEdge('kept-log')],
    },
  })
}

/** A Test holding the library Function's Block under Start. */
async function seedTestWithBlock(
  request: APIRequestContext,
  testName: string,
  fn: SeededLibraryFunction,
): Promise<string> {
  return createValidTest(request, {
    name: testName,
    nodes: [
      sharedNode(FN_NODE_ID, {
        functionId: fn.functionId,
        functionVersion: fn.version,
        label: fn.name,
        originalLibraryName: fn.name,
      }),
    ],
    edges: [startEdge(FN_NODE_ID)],
  })
}

/** Names and values of a library version's local variables. */
async function versionLocals(
  request: APIRequestContext,
  functionId: string,
  version: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}/versions/${version}`)
  expect(resp.ok(), `GET /functions/${functionId}/versions/${version}: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()).data.definition.variables ?? []) as Array<Record<string, unknown>>
}

/** Pick the environment, Run, and expect a passing run that printed `kept-value`. */
async function runPrintsKept(page: Page): Promise<void> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  // Per REQ-3.1.2.1: the Function body still holds its local variable.
  expectConsoleLine(entries, 'INFO', 'kept-value')
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
}

test.describe('V-FN-PUBLISH-LOCALS (functional): publish keeps Function-local variables', () => {
  let testId = ''
  let libraryName = ''

  test.afterEach(async ({ request }) => {
    await cleanup(request, testId, libraryName)
    testId = ''
    libraryName = ''
  })

  test('a Function published from Local keeps its local variables and runs with them', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const testName = `zz-fn-publish-locals-${tag}`
    libraryName = `zz-pub-locals-${tag}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fnId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
    await digIn(page, fnId)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
    await createFunctionParam(page, 'variable', 'fn_kept', { value: 'kept-value' })
    const logId = await dropBelowStart(page, 'log')
    await setBlockExpression(page, logId, 'message', 'fn_kept')
    await popToBreadcrumbSegment(page, testName)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)

    const published = await publishToLibrary(page, fnId, libraryName)
    // Per REQ-3.1.2.1: publish carries the local variables, so the library accepts a body that reads them.
    expect(published.ok, `publish answered ${published.status}: ${published.body}`).toBe(true)
    await expect(page.locator('[role="dialog"]', { hasText: 'Publish Function' })).toBeHidden({
      timeout: 10_000,
    })
    await expect(
      page.locator(`[data-testid="workflow-node-${fnId}"] [data-testid="node-function-lifecycle-badge"]`),
    ).toHaveAttribute('data-state', 'shared')
    const entry = await findLibraryFunction(request, libraryName)
    expect(entry, `library entry ${libraryName} exists after publish`).toBeTruthy()

    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    // Per REQ-3.1.2.1: the published body still holds its local variable.
    expectConsoleLine(entries, 'INFO', 'kept-value')
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')

    await openFunctionView(page, entry!.id, '1.0.0')
    await expandVariableManager(page)
    await expect(variableRow(page, 'fn_kept')).toBeVisible()
  })

  test('a new version published from edit mode keeps the Function local variables', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    libraryName = `zz-pub-locals-edit-${tag}`
    const fn = await seedLibraryWithLocal(request, libraryName)
    const testName = `zz-fn-publish-locals-edit-${tag}`
    testId = await seedTestWithBlock(request, testName, fn)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
    await expect(
      page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`),
    ).toBeVisible({ timeout: 10_000 })
    await digIn(page, FN_NODE_ID)
    await expect(page.locator('[data-testid="workflow-node-kept-log"]')).toBeVisible({ timeout: 15_000 })
    await expandVariableManager(page)
    await expect(variableRow(page, 'fn_kept'), 'the draft carries the library local').toBeVisible()
    await createFunctionParam(page, 'variable', 'fn_added', { value: 'added-value' })
    await popToBreadcrumbSegment(page, testName)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('adds fn_added')
    await dialog.locator('[data-testid="publish-edit-mode-details-input"]').fill('a second local')
    const publishButton = dialog.getByRole('button', { name: 'Publish' })
    await expect(publishButton).not.toHaveAttribute('aria-disabled', 'true')
    await publishButton.click()
    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)

    const listed = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    expect(listed.ok(), `GET /functions/${fn.functionId}/versions: ${listed.status()}`).toBeTruthy()
    const latest = (await listed.json()).data.latest as string
    expect(latest, 'a new version was published').not.toBe(fn.version)
    // Per REQ-3.1.2.2: the new version keeps the library local and adds the draft's one.
    const locals = await versionLocals(request, fn.functionId, latest)
    expect(
      locals.map((local) => [local.name, local.value]),
      JSON.stringify(locals),
    ).toEqual([
      ['fn_kept', 'kept-value'],
      ['fn_added', 'added-value'],
    ])

    await saveTest(page)
    await runPrintsKept(page)

    await openFunctionView(page, fn.functionId, latest)
    await expandVariableManager(page)
    await expect(variableRow(page, 'fn_kept')).toBeVisible()
    await expect(variableRow(page, 'fn_added')).toBeVisible()
  })

  test('a library Function dragged onto the canvas runs with its local variables', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    libraryName = `zz-pub-locals-drag-${tag}`
    await seedLibraryWithLocal(request, libraryName)
    testId = await createValidTest(request, { name: `zz-fn-publish-locals-drag-${tag}`, nodes: [] })
    await openTest(page, testId)

    const blockId = await dropLibraryFunctionBelowStart(page, libraryName)
    await expect(
      page.locator(`[data-testid="workflow-node-${blockId}"] [data-testid="node-function-lifecycle-badge"]`),
    ).toHaveAttribute('data-state', 'shared')
    await saveTest(page)
    await runPrintsKept(page)
  })

  test('Make Local keeps the library Function local variables', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    libraryName = `zz-pub-locals-detach-${tag}`
    const fn = await seedLibraryWithLocal(request, libraryName)
    testId = await seedTestWithBlock(request, `zz-fn-publish-locals-detach-${tag}`, fn)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, /^Make Local/)
    const dialog = page.locator('[role="alertdialog"]', { hasText: 'Make Local' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Make Local' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(
      page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-function-lifecycle-badge"]`),
    ).toHaveAttribute('data-state', 'local')
    await saveTest(page)

    const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
    const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
    const local = nodes.find((node) => node.id === FN_NODE_ID)
    // Per REQ-3.1.2.1: Make Local copies the library body with its local variables.
    expect(local?.data.localDefinition?.variables ?? [], JSON.stringify(local?.data)).toEqual([
      expect.objectContaining({ name: 'fn_kept', value: 'kept-value' }),
    ])

    await runPrintsKept(page)
    await digIn(page, FN_NODE_ID)
    await expandVariableManager(page)
    await expect(variableRow(page, 'fn_kept').locator('[data-testid^="variable-value-"]')).toHaveText('kept-value')
  })
})
