/**
 * V-CANVAS-FN-INNER-MUTATIONS-01: All kebab mutations inside drilled-in Function
 *
 * Wireframes: none (existing canvas surface).
 * Design Decisions: none (canvas swap, drill-aware store mutations)
 * REQ: REQ-3.1.1.4 (nested block composition)
 *
 * Duplicate / Copy / Cut / Unlink / Disable / Skip all operate on the active subtree,
 * never on root state.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Duplicate on inner-1 creates a sibling-inner copy; root tree (sibling
 *      Shell Script) is untouched.
 *   2. Unlink on inner-1 removes ONLY the inner edge; inner nodes remain.
 *   3. Disable on inner-2 toggles its data-disabled attribute; root not
 *      affected.
 *   4. Skip on inner-2 toggles its data-skipped attribute; root not affected.
 *   5. Cut on a duplicated inner removes it from the inner canvas (the
 *      clipboard holds the cut node; we don't paste in this spec - paste is
 *      verified by the cut-then-paste-still-inside-inner assertion via the
 *      Function-scoped state).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-INNER-MUTATIONS-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function pickKebab(page: Page, nodeTestId: string, menuLabel: string) {
  const node = page.locator(`[data-testid="${nodeTestId}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: menuLabel, exact: true }).click()
}

async function drillIn(page: Page) {
  await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
  await expect(page.locator('[data-testid="workflow-node-inner-1"]')).toBeVisible()
}

test.describe('V-CANVAS-FN-INNER-MUTATIONS-01: kebab mutations inside drilled-in Function', () => {
  test('Duplicate inner-1 creates a sibling-inner copy; root untouched', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    // Duplicate routes to the active subtree.
    const innerNodesBefore = await page.locator('[data-testid^="workflow-node-inner-"]').count()
    await pickKebab(page, 'workflow-node-inner-1', 'Duplicate')
    await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype="plugin"]')).toHaveCount(
      innerNodesBefore + 1,
    )

    // Pop back - root tree still has exactly two nodes (root-shell + fn-1).
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(page.locator('[data-testid="workflow-node-root-shell"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-1"]')).toBeVisible()
    await expect(
      page.locator('[data-testid^="workflow-node-"][data-nodetype]'),
    ).toHaveCount(2)
  })

  test('Unlink inner-1 removes inner edge; inner nodes remain', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    // Unlink is scoped to the active edges list. Seed wires
    // start-node -> inner-1 (NODE_UNREACHABLE guard) AND inner-1 -> inner-2;
    // Unlink on inner-1 removes BOTH edges that touch it.
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await pickKebab(page, 'workflow-node-inner-1', 'Unlink')
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-inner-1"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-inner-2"]')).toBeVisible()
  })

  test('Disable inner-2 toggles data-disabled; root not affected', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    const inner2 = page.locator('[data-testid="workflow-node-inner-2"]')
    await expect(inner2).not.toHaveAttribute('data-disabled', 'true')
    // toggleDisable stays in the active subtree.
    await pickKebab(page, 'workflow-node-inner-2', 'Disable')
    await expect(inner2).toHaveAttribute('data-disabled', 'true')

    // Pop - sibling Shell Script never gained a data-disabled attribute.
    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(page.locator('[data-testid="workflow-node-root-shell"]')).not.toHaveAttribute(
      'data-disabled',
      'true',
    )
  })

  test('Skip inner-2 toggles data-skipped; root not affected', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    const inner2 = page.locator('[data-testid="workflow-node-inner-2"]')
    await expect(inner2).not.toHaveAttribute('data-skipped', 'true')
    // toggleSkip adds the inner id to the skip list.
    await pickKebab(page, 'workflow-node-inner-2', 'Skip')
    await expect(inner2).toHaveAttribute('data-skipped', 'true')

    await page.locator('[data-testid="breadcrumb-back-arrow"]').click()
    await expect(page.locator('[data-testid="workflow-node-root-shell"]')).not.toHaveAttribute(
      'data-skipped',
      'true',
    )
  })

  test('Cut inner-2 removes it from the inner canvas', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    const inner2 = page.locator('[data-testid="workflow-node-inner-2"]')
    await expect(inner2).toBeVisible()
    // cut reads and writes the active subtree.
    await pickKebab(page, 'workflow-node-inner-2', 'Cut')
    await expect(inner2).toHaveCount(0)
    // inner-1 stays; the cut node lives on the clipboard. The paste step is
    // covered by the inner-edge assertion in V-CANVAS-FN-INNER-DELETE-01 plus
    // the drill-aware copy-paste unit tests; we keep this spec scoped to the
    // mutating-action surface.
    await expect(page.locator('[data-testid="workflow-node-inner-1"]')).toBeVisible()
  })
})
