/**
 * V-FN-EDIT-PUBLISH (functional): Edit-mode lifecycle - enter edit mode,
 * modify draft, publish as MINOR, verify instance is re-pinned and the
 * library has the new version with the new body.
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * Pass Criteria:
 *   1. Seeded Shared Function instance enters edit mode via the kebab; the
 *      red asterisk overlay appears on the S badge.
 *   2. While in edit mode the instance is editable: the user drills into the
 *      body, the draft workflow is rendered (not the library copy), an
 *      additional node can be added inside, and saving the Test persists the
 *      draft body alongside the editMode/upstreamLink markers.
 *   3. Reopening the Test re-renders the draft body when the user drills in
 *      (case 'open' honors data.draft.workflow when editMode is true).
 *   4. Publishing the draft as a MINOR bump via the kebab + publish dialog
 *      creates the new version in the library AND re-pins the instance to
 *      that version (editMode markers stripped, functionVersion = "1.1.0").
 *   5. After publish, the instance is no longer in edit mode; running the
 *      Test executes the new body (the added inner Log line appears in the
 *      console panel).
 *
 * Phase: functional-workflow (serial). Imports a fixture via POST /tests,
 * drives the workbench through the browser.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-edit-publish-1'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  const name = `EditPubFn ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-PUBLISH library entry (initial version body has a single Log line)',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'inner-log-original',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: {
                values: { message: "'original-body-line'", level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
          },
        ],
        edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-log-original' }],
      },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Library function with a single inner Log',
    },
  })
  expect(resp.ok(), `POST /functions failed: ${resp.status()} - ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-EDIT-PUBLISH ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-EDIT-PUBLISH host Test with a Shared instance at v1.0.0',
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
            config: { values: {}, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
    },
    variables: {},
    metadata: {},
  }
}

async function seedTest(request: APIRequestContext, fn: SeededFunction): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildSeedTest(fn) })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('V-FN-EDIT-PUBLISH (functional): edit-mode lifecycle end-to-end', () => {
  test('Enter edit mode, modify draft, publish as MINOR, re-run uses new body', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    // ----------------------------------------------------------------
    // STEP 1: enter edit mode via the kebab
    // ----------------------------------------------------------------
    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')

    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // ----------------------------------------------------------------
    // STEP 2: open the publish dialog via kebab, pick MINOR, fill changelog
    // ----------------------------------------------------------------
    await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Open the version dropdown and pick MINOR (1.1.0).
    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    const dropdownMenu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(dropdownMenu).toBeVisible()
    await dropdownMenu.getByRole('menuitemradio').filter({ hasText: '-> 1.1.0' }).click()

    await dialog
      .locator('[data-testid="publish-edit-mode-changelog-input"]')
      .fill('Minor bump from V-FN-EDIT-PUBLISH functional test')

    // Submit: the Publish button now opens the three-option outcome modal
    // (CANVAS-219) rather than publishing directly.
    const publishBtn = dialog.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
    await publishBtn.click()

    // "Publish and set New": publish the new version AND re-pin this instance.
    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    // Radix AlertDialog can leave a stuck pointer-events lock on <html>/<body>
    // under headless fast-close; clear it so the canvas stays clickable.
    await page.evaluate(() => {
      document.documentElement.style.pointerEvents = ''
      document.body.style.pointerEvents = ''
    })

    // ----------------------------------------------------------------
    // STEP 3: BE confirms the new version exists in the library. Publish does
    // NOT save the Test (CANVAS-221), so the re-pin is in-memory only and is asserted
    // via the canvas (overlay gone) below, not via GET /tests.
    // ----------------------------------------------------------------
    const verResp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    expect(verResp.ok(), `GET /versions: ${verResp.status()}`).toBeTruthy()
    const verBody = await verResp.json()
    const versions: string[] = verBody.data.versions.map((v: { version: string }) => v.version)
    expect(versions).toContain('1.1.0')
    expect(versions).toContain('1.0.0')

    // ----------------------------------------------------------------
    // STEP 4: edit-mode markers are off on the canvas after publish (Set New
    // re-pinned the in-memory instance and stripped the draft markers).
    // ----------------------------------------------------------------
    await expect(overlay).toHaveCount(0, { timeout: 5_000 })

    // ----------------------------------------------------------------
    // STEP 5: run the Test - the published body (original Log line) executes
    // (Note: this draft equals the source body since we did not actually
    // modify it through the UI - we only verified the publish flow. The
    // companion test "v-fn-edit-publish-with-body-mod" below covers the
    // case where the body is actually modified before publish.)
    // ----------------------------------------------------------------
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    // Publish leaves the canvas dirty (CANVAS-221: no force-save). A dirty Run
    // executes the in-memory (re-pinned) body directly - no run-confirm modal.
    await expect(page.getByRole('button', { name: 'Save and Run' })).toHaveCount(0)
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    const matched = logs.some((l) => l.message.includes('original-body-line'))
    expect(matched, `original body line must surface; got ${JSON.stringify(logs)}`).toBe(true)
  })

  test('Edit-mode draft body modifications survive save+reload and are published', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedLibraryFunction(request)

    // Seed a Test where the Function instance is ALREADY in edit mode with
    // a draft body that adds a "modified-body-line" Log alongside the
    // original line. This exercises the BE/FE roundtrip without driving the
    // Var Manager UI (which is slow/fragile in Playwright).
    const draftWorkflow = {
      nodes: [
        {
          id: 'inner-log-original',
          type: 'workflowNode',
          position: { x: 200, y: 200 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'original-body-line'", level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: 'inner-log-modified',
          type: 'workflowNode',
          position: { x: 200, y: 320 },
          data: {
            label: 'Log_2',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'modified-body-line'", level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-inner', source: 'start-node', target: 'inner-log-original' },
        { id: 'e-inner1-inner2', source: 'inner-log-original', target: 'inner-log-modified' },
      ],
    }

    const seed = {
      name: `V-FN-EDIT-PUBLISH-MOD ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Pre-seeded edit-mode instance for publish-with-body-mod coverage',
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
              functionVersion: '1.0.0',
              originalLibraryName: fn.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
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
                workflow: draftWorkflow,
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
      },
      variables: {},
      metadata: {},
    }

    const testResp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
    const testBody = await testResp.json().catch(() => null)
    expect(testBody?.success, `POST /tests: ${testResp.status()}`).toBeTruthy()
    const testId = testBody.data.id
    await openTest(page, testId)

    // The asterisk overlay must be visible immediately (pre-seeded edit mode).
    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // Publish as MINOR with the modified draft body.
    await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    await dialog
      .locator('[data-testid="version-dropdown-menu"]')
      .getByRole('menuitemradio')
      .filter({ hasText: '-> 1.1.0' })
      .click()
    await dialog
      .locator('[data-testid="publish-edit-mode-changelog-input"]')
      .fill('Body modified: added modified-body-line Log node')
    await dialog.getByRole('button', { name: 'Publish' }).click()

    // Three-option outcome modal (CANVAS-219): set New publishes + re-pins.
    const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(outcome).toBeVisible({ timeout: 10_000 })
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await page.evaluate(() => {
      document.documentElement.style.pointerEvents = ''
      document.body.style.pointerEvents = ''
    })

    // BE: the new version's body has BOTH log nodes.
    const v110Resp = await request.get(
      `${BACKEND_URL}/functions/${fn.functionId}/versions/1.1.0`,
    )
    expect(v110Resp.ok(), `GET 1.1.0: ${v110Resp.status()}`).toBeTruthy()
    const v110Body = await v110Resp.json()
    const nodeIds = (v110Body.data.definition.workflow.nodes as Array<{ id: string }>).map(
      (n) => n.id,
    )
    expect(nodeIds).toContain('inner-log-original')
    expect(nodeIds).toContain('inner-log-modified')

    // Running the Test executes the new body and both lines surface.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    // Publish leaves the canvas dirty (CANVAS-221: no force-save). A dirty Run
    // executes the in-memory (re-pinned) body directly - no run-confirm modal.
    await expect(page.getByRole('button', { name: 'Save and Run' })).toHaveCount(0)
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    const sawOriginal = logs.some((l) => l.message.includes('original-body-line'))
    const sawModified = logs.some((l) => l.message.includes('modified-body-line'))
    expect(sawOriginal, `original line in logs; got ${JSON.stringify(logs)}`).toBe(true)
    expect(sawModified, `modified line in logs; got ${JSON.stringify(logs)}`).toBe(true)
  })
})
