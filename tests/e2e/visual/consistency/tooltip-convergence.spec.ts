/**
 * V-TOOLTIP-CONV-01: every hover hint in WAVE comes from the one tooltip
 *
 * Design Decisions: SHELL-7, SHELL-7a..d
 * REQ: REQ-5.2.1.17
 *
 * Phase: no-data (seeds one long-named Test via POST /tests; no DB reset).
 *
 * Pass Criteria:
 * 1. A collapsed sidebar nav item shows its name.
 * 2. A collapsed palette icon shows its group name.
 * 3. A clipped list name shows the full name (TruncatedName).
 * 4. A Variable Manager row control shows its action.
 * 5. The "Unused" badge shows its explanation and carries no `title` attribute.
 * 6. Every one of those tooltips renders the shared surface with an arrow.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { createSimpleVariable, expandVariableManager } from '../../helpers/variable-create'

const TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'
const LONG_NAME = `conv-${'d'.repeat(200)}`

/** Hover a trigger, assert the shared tooltip appears saying `text`, then leave. */
async function expectSharedTooltip(page: Page, trigger: Locator, text: string | RegExp) {
  const tooltip = page.locator(TOOLTIP)
  await trigger.hover()
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  await expect(tooltip).toContainText(text)
  // The shared component always draws its arrow (SHELL-7d).
  await expect(tooltip.locator('[data-slot="tooltip-arrow"]')).toHaveCount(1)
  // Park on inert page body so the next hover starts from a closed tooltip.
  await page.locator('main').hover({ position: { x: 4, y: 4 } })
  await expect(tooltip).toHaveCount(0)
}

test.describe('V-TOOLTIP-CONV-01: one tooltip across every migrated surface', () => {
  test('S1: a collapsed sidebar item and a collapsed palette icon both use the shared tooltip', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Group: the collapsed sidebar (components/ui/sidebar.tsx).
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.locator('.group.peer[data-state]')).toHaveAttribute('data-state', 'collapsed')
    await expectSharedTooltip(page, sidebar.getByRole('link', { name: /dashboard/i }), 'Dashboard')

    // Group: the collapsed palette (palette-collapsed.tsx).
    const palette = page.locator('[data-testid="block-palette"]')
    if ((await palette.getAttribute('data-state')) === 'expanded') {
      await page.locator('[data-testid="palette-collapse-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'collapsed')
    }
    await expectSharedTooltip(page, page.locator('[data-testid="palette-icon-plugins"]'), 'Plugins')
  })

  test('S2: a clipped list name uses the shared tooltip instead of its own portal popup', async ({
    page,
    request,
  }) => {
    const resp = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: LONG_NAME,
        version: '1.0.0',
        description: 'Tooltip convergence: a name long enough to clip its cell.',
        workflow: { nodes: [], edges: [] },
        variables: {},
        metadata: {},
      },
    })
    const body = await resp.json().catch(() => null)
    expect(body?.success === true, `POST /tests failed: ${resp.status()}`).toBeTruthy()

    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
    const row = page.locator(`[data-row-id="${body.data.id}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })

    // Group: a clipped name (TruncatedName).
    await expectSharedTooltip(page, row.locator('[data-testid="test-name"]'), LONG_NAME)
  })

  test('S3: a variable row control and the Unused badge both use the shared tooltip', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandVariableManager(page)
    await createSimpleVariable(page, 'conv_var', { value: 'hello' })

    const row = page.locator('[data-testid^="variable-row-"][aria-label="Variable conv_var"]')
    await expect(row).toBeVisible()
    const id = ((await row.getAttribute('data-testid')) as string).replace('variable-row-', '')

    // Group: the Variable Manager row action buttons.
    await expectSharedTooltip(page, row.locator(`[data-testid="edit-button-${id}"]`), 'Edit variable')

    // Group: a badge with no `title` attribute, so the browser never shows a second hint.
    const badge = row.locator(`[data-testid="unused-badge-${id}"]`)
    await expect(badge).toBeVisible()
    await expect(badge).not.toHaveAttribute('title', /.*/)
    await expectSharedTooltip(page, badge, 'Not referenced by any block or other variable.')
  })
})
