/**
 * V-FN-PUBLISH-REQUIRED (functional): publishing a Local Function via the
 * PublishDialog posts a body whose `changelog` matches the
 * `Initial release - YYYY-MM-DD` pattern AND `details` equals the
 * literal `No specific usage or parameter details` (both pre-filled and
 * required).
 *
 * Pass Criteria:
 *   1. Seed a Local Function on a Test.
 *   2. Open Publish from the kebab.
 *   3. Submit without editing Changelog or Details, just enter a unique
 *      library name.
 *   4. GET /functions/{id}/versions returns a version with the
 *      `Initial release - YYYY-MM-DD` changelog and the canonical Details
 *      fallback text.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-publish-required-1'

async function seedLocalFunction(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PUBLISH-REQUIRED ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Local function for publish-required coverage',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: 'Function',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'local',
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
              localDefinition: {
                name: 'Function',
                description: '',
                inputs: [],
                outputs: [],
                variables: [],
                workflow: { nodes: [], edges: [] },
              },
            },
          },
        ],
        edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json()
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-PUBLISH-REQUIRED (functional): pre-fills make Publish work with no edits', () => {
  test('Publishing with default Changelog + Details posts pre-fill content', async ({
    page,
    request,
  }) => {
    const testId = await seedLocalFunction(request)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, /Publish/i)
    const dialog = page.locator('[role="dialog"]', { hasText: /Publish/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Set a unique library name; leave Changelog and Details to defaults.
    const libName = `pub_required_${randomUUID().slice(0, 4)}`
    const nameField = dialog.locator('[data-testid="publish-name-input"]')
    await nameField.fill(libName)

    // Publish.
    await dialog.getByRole('button', { name: /^Publish$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Find the created library entry via SERVER-SIDE search (the library has
    // hundreds of accumulated entries, so a per_page list
    // would page the new one out; ?search= resolves it directly).
    const listResp = await request.get(`${BACKEND_URL}/functions?search=${encodeURIComponent(libName)}`)
    expect(listResp.ok()).toBeTruthy()
    const list = await listResp.json()
    const summaries = (Array.isArray(list.data) ? list.data : list.data?.functions ?? []) as Array<
      Record<string, unknown>
    >
    const fn = summaries.find((f) => (f.name as string) === libName)
    expect(fn, `library must contain newly-published ${libName}`).toBeTruthy()

    const versionsResp = await request.get(
      `${BACKEND_URL}/functions/${fn!.id as string}/versions`,
    )
    expect(versionsResp.ok()).toBeTruthy()
    const versions = (await versionsResp.json()).data.versions as Array<{
      version: string
      changelog?: string
      details?: string
    }>

    const v1 = versions.find((v) => v.version === '1.0.0')
    expect(v1, `1.0.0 must exist`).toBeTruthy()
    expect(
      (v1!.changelog ?? '').match(/^Initial release - \d{4}-\d{2}-\d{2}$/),
      `changelog must match "Initial release - YYYY-MM-DD"; got "${v1!.changelog}"`,
    ).toBeTruthy()
    expect(v1!.details).toBe('No specific usage or parameter details')
  })
})
