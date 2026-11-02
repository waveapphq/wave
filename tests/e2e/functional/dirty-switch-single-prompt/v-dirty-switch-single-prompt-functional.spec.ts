/**
 * V-DIRTY-SWITCH-SINGLE-PROMPT (functional): opening a different Test while dirty
 * and choosing Discard prompts EXACTLY ONCE - the Workbench remount's session
 * recovery must not restore the stale draft and re-fire the switch dialog.
 *
 * REQ-5.2.1.23.
 *
 * This drives the exact flow and asserts no re-prompt after the new Test loads.
 *
 * Phase: functional-workflow. Self-seeds two Tests via REST.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { createValidTest, logNode, startEdge, openTest } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

interface SeededTest {
  id: string
  name: string
}

async function seedTestEntity(request: APIRequestContext, label: string): Promise<SeededTest> {
  const name = `Dirty-Switch-${label}-${randomUUID().slice(0, 6)}`
  const id = await createValidTest(request, {
    name,
    nodes: [logNode('t-log', 'TestLog', "'hi'")],
    edges: [startEdge('t-log')],
  })
  return { id, name }
}

/** Drag a node to dirty the in-memory workbench (retrying until the move registers
 *  and Save enables). Mirrors the v-fn-view-switch dirty helper. */
async function dragNode(page: Page, nodeId: string, confirmTestId?: string): Promise<void> {
  const dx = 70
  const dy = 50
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(async () => {
    const box = await node.boundingBox()
    if (!box) throw new Error(`node ${nodeId} not found for drag`)
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8)
    await page.mouse.up()
    const moved = await node.boundingBox()
    if (!moved || Math.abs(moved.x - box.x) < 5) throw new Error('drag did not register; retrying')
    if (confirmTestId) {
      await expect(page.locator(`[data-testid="${confirmTestId}"]`)).toBeEnabled({ timeout: 1500 })
    }
  }).toPass({ timeout: 15_000 })
  await page.waitForTimeout(200)
}

async function openDirtyTest(page: Page, testId: string): Promise<void> {
  await openTest(page, testId)
  await dragNode(page, 't-log', 'toolbar-save-button')
  await expect(page.locator('[data-testid="toolbar-save-button"]')).toBeEnabled()
}

/** Open a Test from the list CLIENT-SIDE (soft nav preserves the dirty store). */
async function openTestFromList(page: Page, target: SeededTest): Promise<void> {
  await page.locator('a[href="/tests"]').first().click()
  await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
  await page.locator('[data-testid="search-input"] input').fill(target.name)
  const cell = page.locator(`[data-testid="test-row"][data-row-id="${target.id}"] [data-testid="test-name"]`)
  await expect(cell).toBeVisible()
  await cell.click()
}

test.describe('V-DIRTY-SWITCH-SINGLE-PROMPT (functional): Discard prompts exactly once', () => {
  test('dirty Test -> open another Test -> Discard fires the switch dialog only once', async ({ page, request }) => {
    const testA = await seedTestEntity(request, 'A')
    const testB = await seedTestEntity(request, 'B')

    await openDirtyTest(page, testA.id)
    await openTestFromList(page, testB)

    const dialog = page.locator('[data-testid="switch-test-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Discard the dirty Test A and open Test B. This navigates to the workbench
    // and remounts it.
    await dialog.getByRole('button', { name: 'Discard & Open New' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/workbench/, { timeout: 10_000 })
    await waitForCanvasLoad(page)

    // The switch dialog fired exactly once - the Workbench remount's session
    // recovery must NOT restore the stale draft and re-prompt.
    await expect(dialog).toHaveCount(0)
    // Allow any async on-remount session recovery to (incorrectly) re-prompt.
    await page.waitForTimeout(1500)
    await expect(dialog).toHaveCount(0)
  })
})
