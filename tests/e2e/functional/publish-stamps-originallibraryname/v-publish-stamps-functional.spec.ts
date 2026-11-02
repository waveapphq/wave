/**
 * V-PUBLISH-STAMPS (functional): Publishing a Local Function stamps
 * `originalLibraryName` on the now-shared node so the From-library link
 * works on the post-publish instance.
 *
 * Guards the `lastPublishedNameRef` stash in
 * `function-lifecycle-dialogs.tsx::handlePublished`.
 *
 * Pass Criteria:
 *   1. Create a Local Function "Function_3" on the canvas.
 *   2. Open Publish dialog and submit with name "do_stuff".
 *   3. After publish, `node.data.functionLifecycle === "shared"`.
 *   4. `node.data.functionId` is set to the new library id.
 *   5. `node.data.originalLibraryName === "do_stuff"`.
 *   6. The canvas label is UNCHANGED (no auto-rename on publish).
 *   7. Re-opening the config modal shows the From-library link with the
 *      library name.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-publish-stamps-1'

async function seedTestWithLocalFunction(request: APIRequestContext, label: string): Promise<string> {
  const seed = {
    name: `V-PUBLISH-STAMPS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Pre-seeded local Function for publish-stamps coverage',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label,
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
              name: label,
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
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-PUBLISH-STAMPS (functional): publish stamps originalLibraryName', () => {
  test('After publish: lifecycle shared, originalLibraryName set, canvas label preserved', async ({
    page,
    request,
  }) => {
    const label = 'Function_3'
    const libName = `pub_stamps_${randomUUID().slice(0, 6)}`
    const testId = await seedTestWithLocalFunction(request, label)
    await openTest(page, testId)

    // Open Publish via kebab.
    await clickNodeKebabItem(page, FN_NODE_ID, /Publish/i)
    const dialog = page.locator('[role="dialog"]', { hasText: /Publish/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // The TextField primitive places `data-testid` directly on its
    // single <textarea>, so the selector targets the textarea itself.
    const nameField = dialog.locator('[data-testid="publish-name-input"]')
    await nameField.fill(libName)

    // Submit.
    await dialog.getByRole('button', { name: /^Publish$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Save the Test to persist the publish results.
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(500)

    // BE confirms the now-shared node carries the right data.
    const testResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(testResp.ok()).toBeTruthy()
    const testBody = await testResp.json()
    const fnNode = (testBody.data.workflow.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === FN_NODE_ID,
    ) as { data?: Record<string, unknown> } | undefined
    expect(fnNode!.data?.functionLifecycle).toBe('shared')
    expect(fnNode!.data?.functionId).toBeTruthy()
    expect(fnNode!.data?.originalLibraryName).toBe(libName)
    // Label unchanged after publish.
    expect(fnNode!.data?.label).toBe(label)
  })
})
