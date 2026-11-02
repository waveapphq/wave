/**
 * V-REPORT-03: Workbench Session Artifacts (chip + sheet + warn-on-wipe)
 * Design Decisions: ARTIF-14 (chip), ARTIF-15/16 (sheet), ARTIF-17 (Reset
 * Session dialog, warn matrix)
 * REQ: REQ-5.2.1.41, REQ-5.2.1.23
 *
 * Pass Criteria:
 *  1. Fixture (2 File I/O artifact:// writes, one nested) imports and
 *     validates with zero errors; a workbench run reaches `passed`
 *  2. The breadcrumb Artifacts chip shows the count badge (2) after the
 *     run; the sheet lists both files with name / folder subtitle / size /
 *     download + delete, header meta and the temporary-lifecycle footer
 *  3. Per-row delete asks once and then removes the file for good: row gone,
 *     badge decrements, backend listing drops the path (hard delete)
 *  4. count > 0 -> ONE `Reset Session?` alertdialog (title,
 *     description, exact callout copy, Cancel/Reset) from the breadcrumb
 *     AND canvas context-menu entry points; `Reset Workflow?` appears
 *     nowhere; Cancel keeps run state + artifacts; confirm resets (status
 *     idle, badge gone, sheet empty state, backend session cleared)
 *  5. The callout background is not transparent and the dialog icon
 *     is `rotate-ccw` inside a red-tinted circle (semantic tint guard)
 *  6. The workbench close dialog carries the callout when artifacts exist;
 *     Cancel preserves them
 *  7. Zero path: after deleting every artifact, Reset is INSTANT from
 *     the breadcrumb (no dialog of any kind)
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'

const CALLOUT_HINT = 'Download anything you need from the Artifacts panel first.'

function loadFixture(): Record<string, any> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/reports/v-report-03/fixture.json'),
    'utf-8',
  )
  return JSON.parse(raw)
}

async function importFixture(request: APIRequestContext): Promise<string> {
  const fixture = loadFixture()
  fixture.name = `${fixture.name as string} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function runToPassed(page: Page) {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 20_000 })
}

async function listSessionArtifactPaths(page: Page): Promise<string[]> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
  expect(response.ok(), `GET /workbench/session/artifacts failed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items: Array<{ path: string; size_bytes: number }> }
  return body.items.map((item) => item.path)
}

const chip = (page: Page) => page.locator('[data-testid="breadcrumb-artifacts-chip"]')
const sheet = (page: Page) => page.locator('[data-testid="session-artifacts-sheet"]')
const sheetRow = (page: Page, name: string) =>
  sheet(page).locator('[data-testid="file-row"]').filter({ hasText: name })
const resetDialog = (page: Page) => page.getByRole('alertdialog').filter({ hasText: 'Reset Session?' })

async function openContextMenuReset(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await page.mouse.click(box!.x + box!.width - 60, box!.y + 60, { button: 'right' })
  const contextMenu = page.locator('[role="menu"]')
  await expect(contextMenu).toBeVisible()
  await contextMenu.getByText('Reset').click()
}

test.describe('V-REPORT-03: workbench session artifacts', () => {
  test.beforeEach(async ({ page }) => {
    // Session-draft-leak guard: a stale backend session would restore a
    // prior spec's run state into this canvas.
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  })

  test('chip -> sheet -> delete -> reset guard -> close callout -> warn suppression', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    await ensureEnvironment(request)
    const testId = await importFixture(request)

    await test.step('1. Fixture validates with zero errors and runs to passed', async () => {
      const validation = await validateTest(request, testId, 'run')
      expect(validation.errors, 'fixture must pass validation with zero errors').toHaveLength(0)

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)

      // Chip renders on the live canvas without a badge before any run.
      await expect(chip(page)).toBeVisible()
      await expect(chip(page)).toContainText('Artifacts')
      await expect(chip(page)).not.toContainText('2')

      await selectEnvironment(page)
      await runToPassed(page)
    })

    await test.step('2. Chip badge counts the written artifacts; backend agrees', async () => {
      // The terminal transition refreshes the count.
      await expect(chip(page), 'badge shows the artifact count').toContainText('2', {
        timeout: 10_000,
      })
      const paths = await listSessionArtifactPaths(page)
      expect(paths).toContain('report.json')
      expect(paths).toContain('output/data.json')
    })

    await test.step('3. Sheet rows match the run output (ARTIF-15 anatomy)', async () => {
      await chip(page).click()
      await expect(sheet(page)).toBeVisible()

      // Header: title + meta + refresh affordance.
      await expect(sheet(page)).toContainText('Session Artifacts')
      await expect(sheet(page)).toContainText(/2 files - /)
      await expect(sheet(page).getByRole('button', { name: 'Refresh artifacts' })).toBeVisible()

      // Nested row: mono name + folder subtitle; root row has no subtitle.
      const nestedRow = sheetRow(page, 'data.json')
      await expect(nestedRow).toHaveCount(1)
      await expect(nestedRow.locator('[data-testid="artifact-file-subtitle"]')).toHaveText('output')
      await expect(nestedRow.locator('[data-testid="artifact-file-icon"]')).toHaveAttribute(
        'data-file-kind',
        'json',
      )
      const rootRow = sheetRow(page, 'report.json')
      await expect(rootRow).toHaveCount(1)
      await expect(rootRow.locator('[data-testid="artifact-file-subtitle"]')).toHaveCount(0)

      // Non-zero formatted sizes and both actions on an ephemeral session.
      await expect(rootRow).toContainText(/\d+ B/)
      await expect(rootRow.getByRole('button', { name: 'Download report.json' })).toBeVisible()
      await expect(rootRow.getByRole('button', { name: 'Delete report.json' })).toBeVisible()

      // Footer note (temporary lifecycle).
      await expect(sheet(page)).toContainText(
        'Session artifacts are temporary - they are deleted when the session is reset, replaced, or closed.',
      )
    })

    await test.step('4. Per-row delete asks once, then removes the file for good', async () => {
      await sheetRow(page, 'data.json').getByRole('button', { name: 'Delete data.json' }).click()

      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toContainText('Delete "data.json"?')
      await expect(sheetRow(page, 'data.json'), 'nothing goes until it is confirmed').toHaveCount(1)
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

      await expect(sheetRow(page, 'data.json')).toHaveCount(0)
      await expect(page.getByRole('alertdialog')).toHaveCount(0)

      await expect(sheet(page)).toContainText(/1 files - /)
      await expect(chip(page), 'badge decrements after delete').toContainText('1')
      const paths = await listSessionArtifactPaths(page)
      expect(paths, 'hard delete drops the path from the backend listing').not.toContain(
        'output/data.json',
      )
      expect(paths).toContain('report.json')

      // Close the sheet so the canvas is free for the context-menu step.
      await sheet(page).getByRole('button', { name: 'Close' }).click()
      await expect(sheet(page)).toHaveCount(0)
    })

    await test.step('5. Artifact-guarded Reset Session dialog (cancel, then confirm)', async () => {
      // Breadcrumb entry point -> ONE Reset Session? alertdialog.
      await page.locator('[data-testid="breadcrumb-reset-link"]').click()
      const dialog = resetDialog(page)
      await expect(dialog).toBeVisible()
      await expect(page.getByRole('alertdialog')).toHaveCount(1)
      // The legacy Reset Workflow? dialog is gone for good.
      await expect(page.getByText('Reset Workflow?')).toHaveCount(0)

      await expect(dialog).toContainText(
        'Resetting clears the run state from the canvas and empties the console.',
      )
      // Exact singular callout copy.
      await expect(dialog).toContainText('1 session artifact will be permanently deleted.')
      await expect(dialog).toContainText(CALLOUT_HINT)

      // Semantic tint guard - the @theme registration must tint the
      // callout; a fully transparent background means the token is missing.
      const callout = dialog.locator('[class*="bg-warning/10"]')
      await expect(callout).toBeVisible()
      const calloutBg = await callout.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(calloutBg, 'callout bg-warning/10 must not be transparent').not.toBe(
        'rgba(0, 0, 0, 0)',
      )
      // RotateCcw icon inside the red-tinted circle.
      const icon = dialog.locator('[data-confirmation-icon][data-icon="rotate-ccw"]')
      await expect(icon).toBeVisible()
      await expect(icon).toHaveClass(/rounded-full/)
      const iconBg = await icon.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(iconBg, 'icon circle bg-error/10 must not be transparent').not.toBe('rgba(0, 0, 0, 0)')

      // Cancel keeps everything: run state, badge, backend listing.
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
      await expect(chip(page)).toContainText('1')
      expect(await listSessionArtifactPaths(page)).toContain('report.json')

      // Canvas context-menu entry point routes through the SAME guard.
      await openContextMenuReset(page)
      const dialog2 = resetDialog(page)
      await expect(dialog2).toBeVisible()
      await dialog2.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(dialog2).toHaveCount(0)

      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'idle',
        { timeout: 10_000 },
      )
      // Badge gone (count 0 hides it); chip itself stays.
      await expect(chip(page)).toBeVisible()
      await expect(chip(page)).not.toContainText('1')

      // Backend session cleared (reset clears it fire-and-forget).
      await expect(async () => {
        const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
        expect(resp.status()).toBe(200)
        const body = await resp.json()
        expect(body.data).toBeNull()
      }).toPass({ timeout: 10_000 })
      // The session read above is what proves the wipe. With no session the
      // listing answers an empty list rather than a status, so it can only add
      // that nothing survived.
      const artifactsResp = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(artifactsResp.status()).toBe(200)
      expect((await artifactsResp.json()).items, 'nothing survives the wipe').toEqual([])
    })

    await test.step('6. Sheet empty state after the wipe (ARTIF-16)', async () => {
      await chip(page).click()
      await expect(sheet(page)).toBeVisible()
      await expect(sheet(page)).toContainText('No artifacts in this session yet')
      await expect(sheet(page)).toContainText('Files written by plugins during a run appear here.')
      // Meta + footer note are hidden in the empty state.
      await expect(sheet(page)).not.toContainText(/\d+ files - /)
      await expect(sheet(page)).not.toContainText('Session artifacts are temporary')
      await sheet(page).getByRole('button', { name: 'Close' }).click()
      await expect(sheet(page)).toHaveCount(0)
    })

    await test.step('7. Close dialog carries the callout; Cancel preserves artifacts', async () => {
      await selectEnvironment(page)
      await runToPassed(page)
      await expect(chip(page)).toContainText('2', { timeout: 10_000 })

      await page.locator('[data-testid="toolbar-close-button"]').click()
      const closeDialog = page.getByRole('dialog').filter({ hasText: 'Active Execution State' })
      await expect(closeDialog).toBeVisible()
      await expect(closeDialog).toContainText('2 session artifacts will be permanently deleted.')
      await expect(closeDialog).toContainText(CALLOUT_HINT)
      await expect(closeDialog.getByRole('button', { name: 'Reset and Close' })).toBeVisible()

      await closeDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(closeDialog).toHaveCount(0)
      const paths = await listSessionArtifactPaths(page)
      expect(paths, 'cancel keeps every artifact').toContain('report.json')
      expect(paths).toContain('output/data.json')
    })

    await test.step('8. Zero path: reset is instant once every artifact is deleted', async () => {
      await chip(page).click()
      await expect(sheet(page)).toBeVisible()
      await sheetRow(page, 'data.json').getByRole('button', { name: 'Delete data.json' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await sheetRow(page, 'report.json')
        .getByRole('button', { name: 'Delete report.json' })
        .click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(sheet(page)).toContainText('No artifacts in this session yet')
      await sheet(page).getByRole('button', { name: 'Close' }).click()

      // Zero-artifact reset is INSTANT - no dialog of any kind.
      await page.locator('[data-testid="breadcrumb-reset-link"]').click()
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'idle',
        { timeout: 10_000 },
      )
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(page.getByText('Reset Session?')).toHaveCount(0)
      await expect(page.getByText('Reset Workflow?')).toHaveCount(0)
    })
  })
})
