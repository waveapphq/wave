/**
 * V-FN-VERSION-CAP: version strings are hard-capped at 32 characters everywhere a
 * user types one, with the threshold N/32 counter on the Publish field (same
 * contract as Name).
 *
 *   - Publish dialog Version field: maxLength 32 + N/32 counter.
 *   - Edit-mode bump dropdown Custom version input: maxLength 32 (hard cap, not
 *     just a validation message).
 *
 * REQ-3.1.2.2.
 *
 * Runs in the no-data light + dark projects (seeds via REST).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { publishLibraryFunction, localFunctionNode, startEdge } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const OVERLONG = '1.0.0-rc.0123456789.0123456789.0123456789' // 41 chars

async function seedTest(page: Page, node: Record<string, unknown>): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-VERSION-CAP ${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      description: 'V-FN-VERSION-CAP seed',
      workflow: { nodes: [node], edges: [startEdge(node.id as string)] },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function open(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-VERSION-CAP: 32-char version caps', () => {
  test('Publish dialog Version field hard-caps at 32 and shows the N/32 counter', async ({ page }) => {
    const node = localFunctionNode('fn-local', 'Function_1', { nodes: [], edges: [] })
    const testId = await seedTest(page, node)
    await open(page, testId)

    // Open the Publish to Library dialog.
    const canvasNode = page.locator(`[data-testid="workflow-node-fn-local"]`)
    await canvasNode.locator('button').first().dispatchEvent('click')
    await canvasNode.locator('[data-testid="node-kebab"]').click()
    await page.locator('[role="menu"]').getByRole('menuitem', { name: 'Publish to Library' }).click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const versionInput = dialog.locator('[data-testid="publish-version-input"]')
    await expect(versionInput).toHaveAttribute('maxlength', '32')

    // Past 32 is hard-capped. Fill exactly to the cap, then one more keystroke is
    // rejected by maxlength - deterministic (a typed overlong string drops
    // keystrokes under CI CPU contention).
    // Re-established each attempt: under shard contention the field can reset between
    // the fill and the keystroke, which would read as a cap failure.
    await expect(async () => {
      await versionInput.fill(OVERLONG.slice(0, 32))
      await expect(versionInput).toHaveValue(OVERLONG.slice(0, 32))
      await versionInput.press('9')
      await expect(versionInput, 'version input caps at 32 chars').toHaveValue(OVERLONG.slice(0, 32))
    }).toPass({ timeout: 20_000 })
    await expect(dialog.locator('[data-testid="publish-version-input-counter"]')).toHaveText('32/32')
  })

  test('Edit-mode bump Custom version input hard-caps at 32', async ({ page, request }) => {
    const lib = await publishLibraryFunction(request, { name: `CapFn-${randomUUID().slice(0, 6)}` })
    const editModeNode = {
      id: 'fn-edit',
      type: 'workflowNode',
      position: { x: 320, y: 200 },
      data: {
        label: lib.name,
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: lib.functionId,
        functionVersion: '1.0.0',
        originalLibraryName: lib.name,
        category: 'function',
        version: '1.0.0',
        hasNewerVersion: false,
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        config: { values: {}, outputBindings: {}, profileBindings: [] },
        editMode: true,
        upstreamLink: { functionId: lib.functionId, sourceVersion: '1.0.0' },
        draft: {
          name: lib.name,
          description: '',
          tags: [],
          inputs: [],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
      },
      measured: { width: 120, height: 62 },
    }
    const testId = await seedTest(page, editModeNode)
    await open(page, testId)

    // Open the edit-mode publish dialog and its bump-mode version dropdown.
    await clickNodeKebabItem(page, 'fn-edit', 'Publish')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    await expect(dialog.locator('[data-testid="version-dropdown-menu"]')).toBeVisible()

    const customInput = dialog.locator('[data-testid="version-dropdown-custom-input"]')
    await expect(customInput).toHaveAttribute('maxlength', '32')
    // Fill exactly to the cap, then one more keystroke is rejected by maxlength -
    // deterministic (a typed overlong string drops keystrokes under CI contention).
    // Re-established each attempt, as above.
    await expect(async () => {
      await customInput.fill(OVERLONG.slice(0, 32))
      await expect(customInput).toHaveValue(OVERLONG.slice(0, 32))
      await customInput.press('9')
      await expect(customInput, 'custom version input caps at 32 chars').toHaveValue(
        OVERLONG.slice(0, 32),
      )
    }).toPass({ timeout: 20_000 })
  })
})
