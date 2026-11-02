/**
 * V-VAR-UNUSED-BADGE-02: the Unused badge is amber on every kind of Variable Manager row
 * Wireframe: none (color only)
 * Design Decisions: VMGR-105
 * REQ: REQ-3.1.3.11
 *
 * Phase: no-data (parallel). No API seed: the spec clears the workbench session, opens the empty
 * draft at /workbench and builds everything in the browser through the UI (a variable, a Log it
 * Skips for the reference tone, a Local Function with an input, an output and a local).
 *
 * Pass Criteria:
 * 1. The reference tone is the amber run-state badge a Skipped block shows (`data-state="skip"`,
 *    the warn tone of the block status bar).
 * 2. The Unused badge on a Test variable reads "Unused"; its computed text color and its tinted
 *    background equal the reference badge's.
 * 3. The same holds on a Function input, a Function output and a Function local.
 * 4. Every one of the four badges keeps its tooltip, exactly "Not referenced by any block or other
 *    variable.", shown through the shared tooltip, never a browser `title`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, dragSourceToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { elementBackground, elementColor } from '../../helpers/config-sheet'
import { createFunctionParam, createSimpleVariable, expandVariableManager, variableRow } from '../../helpers/variable-create'
import { canvasBlockIds, clickNodeContextMenuItem, digIn } from '../../helpers/workbench'

const TOOLTIP = 'Not referenced by any block or other variable.'

interface Tone {
  color: string
  background: string
}

function unusedBadge(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="unused-badge-"]')
}

async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(box, 'canvas box').toBeTruthy()
  return { x: Math.round(box!.width * fx), y: Math.round(box!.height * fy) }
}

async function onlyNewBlock(page: Page, before: readonly string[]): Promise<string> {
  const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one Block was added').toHaveLength(1)
  return added[0]
}

/** The amber tone of a Skipped block's run-state badge, read from a Log the spec drops and Skips. */
async function referenceTone(page: Page): Promise<Tone> {
  const before = await canvasBlockIds(page)
  await dragPaletteItemToCanvas(page, 'log', await canvasPoint(page, 0.3, 0.3))
  const logId = await onlyNewBlock(page, before)
  await clickNodeContextMenuItem(page, logId, 'Skip')
  const badge = page.locator(`[data-testid="workflow-node-${logId}"] [data-testid="node-run-state-badge"]`)
  await expect(badge).toHaveAttribute('data-state', 'skip')
  await expect(badge).toHaveText('SKIP')
  const tone = { color: await elementColor(badge, 'color'), background: await elementBackground(badge) }
  // The warn tone is a translucent tint: a solid or empty fill would not be it.
  expect(tone.background.slice(7), 'the reference background is a tint').not.toMatch(/^(00|ff)$/)
  return tone
}

/** The badge's own tone equals the reference; the text and the tooltip stay as they were (VMGR-105). */
async function expectAmberBadge(page: Page, name: string, reference: Tone): Promise<void> {
  const badge = unusedBadge(page, name)
  await expect(badge, `${name} is Unused`).toBeVisible()
  await expect(badge).toHaveText('Unused')
  // Per VMGR-105: the warn tone of the block status bar.
  expect(await elementColor(badge, 'color'), `${name} badge text color`).toBe(reference.color)
  expect(await elementBackground(badge), `${name} badge background`).toBe(reference.background)

  await expect(badge).not.toHaveAttribute('title', /.*/)
  await badge.hover()
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  // The tooltip's accessible copy holds its text once, so the match is exact.
  await expect(page.getByRole('tooltip')).toHaveText(TOOLTIP)
  await page.mouse.move(2, 2)
  await expect(tooltip).toHaveCount(0)
}

test.describe('V-VAR-UNUSED-BADGE-02: the Unused badge is amber', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandVariableManager(page)
  })

  test('a Test variable nothing reads shows the amber Unused badge', async ({ page }) => {
    const reference = await referenceTone(page)
    await createSimpleVariable(page, 'plain_var', { value: 'x' })
    await expectAmberBadge(page, 'plain_var', reference)
  })

  test('a Function input, output and local nothing reads show the amber Unused badge', async ({ page }) => {
    const reference = await referenceTone(page)

    await expandPalette(page)
    const before = await canvasBlockIds(page)
    await dragSourceToCanvas(
      page,
      page.locator('[data-testid="palette-new-block-button"]'),
      await canvasPoint(page, 0.6, 0.5),
    )
    const fnId = await onlyNewBlock(page, before)
    await digIn(page, fnId)

    await createFunctionParam(page, 'input', 'in_p')
    await createFunctionParam(page, 'output', 'out_p')
    await createFunctionParam(page, 'variable', 'loc_v', { value: 'v' })

    for (const name of ['in_p', 'out_p', 'loc_v']) {
      await test.step(`${name}: amber Unused badge`, async () => {
        await expectAmberBadge(page, name, reference)
      })
    }
  })
})
