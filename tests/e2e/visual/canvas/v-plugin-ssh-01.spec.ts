/**
 * V-PLUGIN-SSH-01: SSH Session Open Plugin Config Sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * Design Decisions: SSH-1..SSH-5 (group treatment, output (i)).
 * REQ: REQ-3.4.1.3, REQ-5.1.5
 *
 * Pass Criteria (updated for the shared section-card model, tracking 16 +
 * contract 10b: headers carry the group NAME only; a group description now
 * renders as an in-card footer note while expanded):
 * 1. Connection group renders expanded by default, its header carries the bare
 *    name "Connection", the description "Target host and credentials" renders
 *    in group-footer-Connection, and its six default rows are visible in order
 *    (Host, Port, Username, Password, Private Key, Via parent session).
 *    Parent Session is gated behind the Via-parent checkbox.
 * 2. Advanced group renders collapsed by default (its params hidden), header
 *    carries the bare name; a collapsed card shows NO footer at all.
 * 3. Advanced expands on click, revealing its six rows AND its footer note.
 * 4. All four outputs (Session ID, Connected, Server Banner, Hop Count) render,
 *    each with a leading (i) info affordance fed by its schema description.
 * 5. The "Via parent session" checkbox gates the Parent Session field: hidden
 *    when off, shown + required when on (chaining is opt-in).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const CONNECTION_ROWS = ['host', 'port', 'username', 'password', 'private_key', 'use_parent']
const ADVANCED_ROWS = [
  'passphrase', 'host_key_verification', 'connect_timeout',
  'keep_alive_interval', 'keep_alive_max_count', 'compression',
]
const OUTPUT_ROWS = ['session_id', 'connected', 'server_banner', 'hop_count']

async function addSshOpenAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'SSH Session Open', testId: 'palette-item-ssh-session-open' },
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

test.describe('V-PLUGIN-SSH-01: SSH Session Open Config Sheet', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh canvas; do NOT delete /workbench/session (shared with fixture phase).
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-PLUGIN-SSH-01-S1: Connection group expanded by default with its six rows + footer note', async ({ page }) => {
    const modal = await addSshOpenAndOpenConfig(page)

    // Section cards (tracking 16 / contract 10b): header = bare group NAME.
    const connectionHeader = modal.locator('[data-testid="group-header-Connection"]')
    await expect(connectionHeader).toBeVisible()
    await expect(connectionHeader).toContainText('Connection')
    await expect(connectionHeader).not.toContainText('Target host and credentials')

    // The description moved into the expanded card's footer note.
    await expect(modal.locator('[data-testid="group-footer-Connection"]')).toContainText(
      'Target host and credentials'
    )

    // SSH-1: expanded by default - every Connection row visible in order.
    for (const name of CONNECTION_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toBeVisible()
    }
    // Required markers (SSH-1): Host, Port, Username carry the asterisk.
    for (const name of ['host', 'port', 'username']) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toContainText('*')
    }
  })

  test('V-PLUGIN-SSH-01-S2: Advanced group collapsed by default, name-only header, no footer', async ({ page }) => {
    const modal = await addSshOpenAndOpenConfig(page)

    // Section cards (contract 10b): collapsed card = bare name, NO footer at all.
    const advancedHeader = modal.locator('[data-testid="group-header-Advanced"]')
    await expect(advancedHeader).toBeVisible()
    await expect(advancedHeader).toContainText('Advanced')
    await expect(advancedHeader).not.toContainText('Host-key policy, timeouts, and session tuning')
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toHaveCount(0)

    // SSH-3: collapsed by default - none of its params visible.
    for (const name of ADVANCED_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).not.toBeVisible()
    }
  })

  test('V-PLUGIN-SSH-01-S3: Advanced expands on click, revealing its six rows + footer', async ({ page }) => {
    const modal = await addSshOpenAndOpenConfig(page)

    await modal.locator('[data-testid="group-header-Advanced"]').click()
    for (const name of ADVANCED_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toBeVisible()
    }
    // Guard 18 (SSH footer-mechanism spot-check): the description
    // renders as the expanded card's footer note.
    await expect(modal.locator('[data-testid="group-footer-Advanced"]')).toContainText(
      'Host-key policy, timeouts, and session tuning'
    )
  })

  test('V-PLUGIN-SSH-01-S4: four outputs each render a leading (i) info affordance', async ({ page }) => {
    const modal = await addSshOpenAndOpenConfig(page)

    // SSH-5: every output row visible with an (i) fed by its description.
    for (const name of OUTPUT_ROWS) {
      const row = modal.locator(`[data-testid="output-row-${name}"]`)
      await expect(row).toBeVisible()
      // The (i) lives in the row's first cell (Info icon shown when a
      // description is present - the output-description plumbing).
      await expect(row.locator('td').first().locator('svg')).toBeVisible()
    }
  })

  // A child SSH session chained through a parent must be
  // OPT-IN, so a stale/unresolved parent never silently connects direct
  // (bypassing the jump host). The "Via parent session" checkbox decides:
  // OFF hides the Parent Session field entirely; ON shows + requires it.
  test('V-PLUGIN-SSH-01-S5: Via-parent checkbox gates the Parent Session field', async ({ page }) => {
    const modal = await addSshOpenAndOpenConfig(page)

    // OFF by default: the Parent Session field is not rendered at all.
    const useParent = modal.locator('[data-testid="param-row-use_parent"] button[role="checkbox"]')
    await expect(useParent).toHaveAttribute('data-state', 'unchecked')
    await expect(modal.locator('[data-testid="param-row-parent_session_id"]')).not.toBeVisible()

    // ON: Parent Session appears and carries the required marker.
    await useParent.click()
    await expect(useParent).toHaveAttribute('data-state', 'checked')
    const parentRow = modal.locator('[data-testid="param-row-parent_session_id"]')
    await expect(parentRow).toBeVisible()
    await expect(parentRow).toContainText('*')

    // OFF again: Parent Session is hidden once more.
    await useParent.click()
    await expect(useParent).toHaveAttribute('data-state', 'unchecked')
    await expect(modal.locator('[data-testid="param-row-parent_session_id"]')).not.toBeVisible()
  })
})
