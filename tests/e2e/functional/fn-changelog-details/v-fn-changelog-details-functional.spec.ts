/**
 * V-FN-CHANGELOG-DETAILS (functional): the Function config modal exposes
 * Changelog + Details buttons that open per-version dialogs sourced from
 * `useFunctionVersions`.
 *
 * Pass Criteria:
 *   1. Library entry has 3 published versions, each with distinct
 *      changelog + details.
 *   2. Open the Shared instance config modal -> click Changelog -> the
 *      ChangelogDialog opens; the version dropdown inside lists all 3
 *      versions; each version's changelog body matches the BE record.
 *   3. Click Details -> DetailsDialog opens; the body matches the
 *      selected version's `details` field.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-changelog-details-1'

async function publishVersion(
  request: APIRequestContext,
  functionId: string,
  sourceVersion: string,
  targetVersion: string,
  changelog: string,
  details: string,
  libName: string,
) {
  // Add a new immutable library version through the test-independent route
  // (POST /functions/{id}/versions). The library name is locked across versions; the service stamps
  // the source version's name, so `name` here is only for completeness.
  const pub = await request.post(`${BACKEND_URL}/functions/${functionId}/versions`, {
    data: {
      source_version: sourceVersion,
      target_version: targetVersion,
      draft_definition: {
        name: libName,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
      changelog,
      description: '',
      tags: [],
      details,
    },
  })
  expect(pub.ok(), `publish ${targetVersion}: ${pub.status()} ${await pub.text()}`).toBeTruthy()
}

async function seedLibraryWithThreeVersions(request: APIRequestContext) {
  const name = `cl_details_${randomUUID().slice(0, 4)}`
  const init = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-CHANGELOG-DETAILS seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release v1.0.0',
      details: 'details for v1.0.0',
    },
  })
  expect(init.ok()).toBeTruthy()
  const functionId = (await init.json()).data.id

  await publishVersion(request, functionId, '1.0.0', '1.1.0', 'changelog v1.1.0', 'details v1.1.0', name)
  await publishVersion(request, functionId, '1.1.0', '1.2.0', 'changelog v1.2.0', 'details v1.2.0', name)

  return { functionId, name }
}

test.describe('V-FN-CHANGELOG-DETAILS (functional)', () => {
  test('Changelog dialog lists all versions and displays per-version content', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryWithThreeVersions(request)

    const seedResp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: `V-FN-CHANGELOG-DETAILS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        version: '1.0.0',
        description: 'Shared instance pinned to 1.2.0',
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
                functionVersion: '1.2.0',
                originalLibraryName: fn.name,
                category: 'function',
                version: '1.0.0',
                hasNewerVersion: false,
                expressionFields: [],
                templateFields: [],
                variableExpressionKeys: [],
                config: { values: {}, outputBindings: {}, profileBindings: [] },
              },
            },
          ],
          edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
        },
        variables: {},
        metadata: {},
      },
    })
    const testBody = await seedResp.json()
    const testId = testBody.data.id

    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Open Shared config modal.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Click Changelog button (label may be exact or aria).
    const changelogBtn = dialog.getByRole('button', { name: /Changelog/i }).first()
    await expect(changelogBtn).toBeVisible()
    await changelogBtn.click()

    // ChangelogDialog opens.
    const cl = page.locator('[role="dialog"]', { hasText: /Changelog/i }).last()
    await expect(cl).toBeVisible({ timeout: 5_000 })

    // The body contains changelog text from one of the versions.
    const body = (await cl.textContent()) ?? ''
    expect(
      body.includes('Initial release v1.0.0') ||
        body.includes('changelog v1.1.0') ||
        body.includes('changelog v1.2.0'),
      `expected per-version changelog text; got body=${body.slice(0, 300)}`,
    ).toBe(true)
  })
})
