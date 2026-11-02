/**
 * V-PLUGIN-SSHSCRIPT-01: SSH Session Script Plugin Config Sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * Design Decisions: none (schema-only, rides the element-config sheet; script
 * multiline; interpreter/working_dir single-line; reused session_id).
 * REQ: REQ-3.4.1.3, REQ-5.1.5
 *
 * No wireframe (schema-only): the config renders through the
 * pre-existing schema-driven element-config sheet, flat like SSH Session
 * Execute (no parameter groups).
 *
 * Pass Criteria:
 * 1. All five input rows render (flat, no group headers to expand): Session ID,
 *    Script, Interpreter, Working Directory, Timeout.
 * 2. Session ID and Script carry the required asterisk; Interpreter, Working
 *    Directory and Timeout do NOT.
 * 3. All three outputs (Stdout, Stderr, Exit Code) render, each with a leading
 *    (i) info affordance fed by its schema description.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const INPUT_ROWS = ['session_id', 'script', 'interpreter', 'working_dir', 'timeout']
const REQUIRED_ROWS = ['session_id', 'script']
const OPTIONAL_ROWS = ['interpreter', 'working_dir', 'timeout']
const OUTPUT_ROWS = ['stdout', 'stderr', 'exit_code']

async function addScriptAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'SSH Session Script', testId: 'palette-item-ssh-session-script' },
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

test.describe('V-PLUGIN-SSHSCRIPT-01: SSH Session Script Config Sheet', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh canvas; do NOT delete /workbench/session (shared with fixture phase).
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
  })

  test('V-PLUGIN-SSHSCRIPT-01-S1: all five input rows render flat (no group to expand)', async ({ page }) => {
    const modal = await addScriptAndOpenConfig(page)

    // Schema-only, no parameter groups - every input row is visible
    // immediately (nothing collapsed behind a group header).
    for (const name of INPUT_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toBeVisible()
    }
    await expect(modal.locator('[data-testid^="group-header-"]')).toHaveCount(0)
  })

  test('V-PLUGIN-SSHSCRIPT-01-S2: required markers on Session ID / Script only', async ({ page }) => {
    const modal = await addScriptAndOpenConfig(page)

    for (const name of REQUIRED_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toContainText('*')
    }
    for (const name of OPTIONAL_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).not.toContainText('*')
    }
  })

  test('V-PLUGIN-SSHSCRIPT-01-S3: three outputs each render a leading (i) info affordance', async ({ page }) => {
    const modal = await addScriptAndOpenConfig(page)

    // Stdout / Stderr / Exit Code, each with an (i) fed by its description
    // (the info icon lives in the row's first cell).
    for (const name of OUTPUT_ROWS) {
      const row = modal.locator(`[data-testid="output-row-${name}"]`)
      await expect(row).toBeVisible()
      await expect(row.locator('td').first().locator('svg')).toBeVisible()
    }
  })
})
