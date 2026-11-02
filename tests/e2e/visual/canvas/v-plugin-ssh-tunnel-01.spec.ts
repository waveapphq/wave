/**
 * V-PLUGIN-SSHTUNNEL-01: SSH Tunnel Open Plugin Config Sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * Design Decisions: SSHTUN-1..SSHTUN-8
 * REQ: REQ-3.4.1.3, REQ-5.1.5
 *
 * Pass Criteria:
 * 1. The Forwarding group renders expanded by default, its header carries the
 *    bare name "Forwarding", the description "Session to forward through and
 *    the local to remote mapping" renders in group-footer-Forwarding, and its
 *    four rows are visible in order (Session ID, Local Port, Remote Host,
 *    Remote Port).
 * 2. Session ID, Remote Host and Remote Port carry the required asterisk;
 *    Local Port (the auto-assign default) does NOT.
 * 3. Both outputs (Tunnel ID, Local Port) render, each with a leading (i)
 *    info affordance fed by its schema description.
 * 4. The Advanced group follows Forwarding and precedes Secrets, is collapsed
 *    by default (Validate Target hidden, no footer), and on click shows one
 *    row "Validate Target": type Boolean, unchecked, not required, with an
 *    expression toggle and an (i) whose tooltip reads exactly "Connects to the
 *    target once when the tunnel opens and fails if the SSH host refuses or
 *    cannot reach it. That connection is handed to the first block that uses
 *    the tunnel."
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import {
  checkbox,
  exprToggle,
  groupHeader,
  inputLayout,
  paramRow,
  requiredStar,
  rowLabel,
} from '../../helpers/config-sheet'

const FORWARDING_ROWS = ['session_id', 'local_port', 'remote_host', 'remote_port']
const REQUIRED_ROWS = ['session_id', 'remote_host', 'remote_port']
const OUTPUT_ROWS = ['tunnel_id', 'local_port']
const VALIDATE_TARGET_HELP =
  'Connects to the target once when the tunnel opens and fails if the SSH host refuses or cannot reach it. ' +
  'That connection is handed to the first block that uses the tunnel.'
const ACTIVE_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'

async function addTunnelOpenAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'SSH Tunnel Open', testId: 'palette-item-ssh-tunnel-open' },
    { x: canvasBox!.width / 2, y: canvasBox!.height / 2 }
  )

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

/** Hover a row's (i) and read the single accessible copy of its tooltip. */
async function expectInfoTooltip(page: Page, sheet: Locator, name: string, text: string) {
  const badge = paramRow(sheet, name).locator('td:first-child .cursor-help')
  await expect(badge, `${name} info badge`).toHaveCount(1)
  await badge.hover()
  const tooltip = page.locator(ACTIVE_TOOLTIP)
  await expect(tooltip, `${name} tooltip`).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), `${name} tooltip`).toHaveText(text)
}

test.describe('V-PLUGIN-SSHTUNNEL-01: SSH Tunnel Open Config Sheet', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh canvas; do NOT delete /workbench/session (shared with fixture phase).
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-PLUGIN-SSHTUNNEL-01-S1: Forwarding group expanded by default with its four rows + footer note', async ({ page }) => {
    const modal = await addTunnelOpenAndOpenConfig(page)

    // Section card: bare name header, description as the footer note.
    const forwardingHeader = modal.locator('[data-testid="group-header-Forwarding"]')
    await expect(forwardingHeader).toBeVisible()
    await expect(forwardingHeader).toContainText('Forwarding')
    await expect(forwardingHeader).not.toContainText(
      'Session to forward through and the local to remote mapping'
    )
    await expect(modal.locator('[data-testid="group-footer-Forwarding"]')).toContainText(
      'Session to forward through and the local to remote mapping'
    )

    // SSHTUN-2: expanded by default - every Forwarding row visible in order.
    for (const name of FORWARDING_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toBeVisible()
    }
  })

  test('V-PLUGIN-SSHTUNNEL-01-S2: required markers on Session ID / Remote Host / Remote Port only', async ({ page }) => {
    const modal = await addTunnelOpenAndOpenConfig(page)

    // SSHTUN-2: the three required rows carry the asterisk.
    for (const name of REQUIRED_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toContainText('*')
    }
    // Local Port is optional (0 auto-assigns) - no required asterisk.
    await expect(modal.locator('[data-testid="param-row-local_port"]')).not.toContainText('*')
  })

  test('V-PLUGIN-SSHTUNNEL-01-S3: both outputs each render a leading (i) info affordance', async ({ page }) => {
    const modal = await addTunnelOpenAndOpenConfig(page)

    // SSHTUN-3: Tunnel ID + Local Port outputs, each with an (i) fed by
    // its description (the info icon lives in the row's first cell).
    for (const name of OUTPUT_ROWS) {
      const row = modal.locator(`[data-testid="output-row-${name}"]`)
      await expect(row).toBeVisible()
      await expect(row.locator('td').first().locator('svg')).toBeVisible()
    }
  })

  test('V-PLUGIN-SSHTUNNEL-01-S4: Advanced collapsed by default, expands to one unchecked Validate Target row', async ({ page }) => {
    const modal = await addTunnelOpenAndOpenConfig(page)

    // SSHTUN-2: Advanced sits after Forwarding and before Secrets; collapsed, it shows no rows and no footer.
    await expect
      .poll(() => inputLayout(modal), { message: 'section order with Advanced collapsed' })
      .toEqual(['[Forwarding]', ...FORWARDING_ROWS, '[Advanced]', '[Secrets]'])
    const advancedHeader = groupHeader(modal, 'Advanced')
    await expect(advancedHeader).toContainText('Advanced')
    await expect(paramRow(modal, 'validate_target')).not.toBeVisible()
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toHaveCount(0)

    await advancedHeader.click()
    await expect
      .poll(() => inputLayout(modal), { message: 'section order with Advanced expanded' })
      .toEqual(['[Forwarding]', ...FORWARDING_ROWS, '[Advanced]', 'validate_target', '[Secrets]'])

    // SSHTUN-2 / SSHTUN-7: one Boolean row, unchecked by default, optional, with an expression toggle.
    const row = paramRow(modal, 'validate_target')
    await expect(row).toBeVisible()
    expect(await rowLabel(modal, 'validate_target')).toBe('Validate Target')
    await expect(row.locator('td:nth-child(3)')).toHaveText('Boolean', { useInnerText: true })
    await expect(checkbox(modal, 'validate_target')).toHaveAttribute('data-state', 'unchecked')
    await expect(requiredStar(modal, 'validate_target')).toHaveCount(0)
    await expect(exprToggle(modal, 'validate_target')).toHaveCount(1)
    // The approved wireframe draws no footer under Advanced, expanded either.
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toHaveCount(0)

    await expectInfoTooltip(page, modal, 'validate_target', VALIDATE_TARGET_HELP)
  })
})
