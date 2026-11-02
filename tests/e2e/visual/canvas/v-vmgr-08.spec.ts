/**
 * V-VMGR-08: Variable Inspect Modal - Template watcher, source metrics and Format re-detection
 *
 * Design Decisions: VMGR-72 (Template value kind, cyan {{ }} kind badge in the row and the
 * header), VMGR-73 (Rendered / Template views), VMGR-74, VMGR-75, VMGR-106 (edits happen in the
 * variable's window).
 * REQ: REQ-3.1.3.11 (variable watching UI panel), REQ-3.1.3.15 (template variables)
 *
 * Phase: fixture (serial) - self-imports one Test via POST /tests carrying a
 * template / literal-JSON / expression variable, then drives the static inspect
 * surface (no run; the interaction IS the proof - the live realization is the
 * functional spec in functional/template-variable).
 *
 * Pass Criteria:
 * 1. A template variable carries the cyan {{ }} kind badge in the manager row and
 *    the modal header (no {x} expression badge); the type pill reads STRING.
 * 2. The View dropdown offers exactly Rendered / Template (default Rendered); the
 *    Rendered view with no runtime value shows the centered "Not rendered yet."
 *    empty line and the Template view shows the cyan {{ }} source.
 * 3. A Template (source) view and an expression Expression view carry NO
 *    footer metric.
 * 4. A template in Compare is two-pane source-vs-source with the View
 *    dropdown locked (disabled) on Template.
 * 5. The never-run template watcher centers "Not rendered yet." and opens
 *    compact (not source-sized).
 * 6. A literal-string watcher's Format Auto re-detects after a Save in the
 *    variable's Edit window changes the value (JSON -> YAML; VMGR-106).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { openEditWindow, saveWindow, setWindowValue } from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-vmgr-template/fixture.json',
)
const GREETING_SOURCE = 'Hello {{user}}!'
const NOTE_YAML = 'env: staging'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
  fixture.name = `V-VMGR-08 ${Date.now()}`
  return fixture
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')
const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)
const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

async function importAndOpen(page: Page): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  const create = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(),
  })
  const body = await create.json().catch(() => null)
  expect(create.ok(), `POST /tests failed: ${create.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  const validate = await page.request.post(`http://localhost:${BACKEND_PORT}/tests/${testId}/validate`)
  const validateBody = await validate.json().catch(() => null)
  const errors = validateBody?.data?.errors ?? validateBody?.errors ?? []
  expect(errors, `fixture must validate with zero errors: ${JSON.stringify(errors)}`).toHaveLength(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const panel = page.locator('[data-testid="variable-manager"]')
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function openRead(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function closeInspector(page: Page, name: string): Promise<void> {
  await modalFor(page, name).locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(modalFor(page, name)).toHaveCount(0)
}

test.describe('V-VMGR-08: template watcher, source metrics and Format re-detection', () => {
  test('template badge, views and source; source views carry no metric; Format re-detects after a save', async ({ page }) => {
    test.setTimeout(120_000)
    await importAndOpen(page)

    await test.step('1: {{ }} badge, Rendered/Template menu, centered + compact empty state, cyan source, no source metric', async () => {
      // The manager row carries the cyan {{ }} template kind badge, not {x}.
      const rowBadge = rowFor(page, 'greeting').locator('[data-testid^="template-badge-"]')
      await expect(rowBadge).toHaveText('{{ }}')
      expect((await rowBadge.getAttribute('class')) ?? '').toMatch(/cyan/)
      await expect(
        rowFor(page, 'greeting').locator('[data-testid^="expr-badge-"]'),
      ).toHaveCount(0)

      const modal = await openRead(page, 'greeting')
      // The modal header shows the cyan {{ }} kind badge + STRING type, no {x}.
      const headerBadge = modal.locator('[data-testid="inspect-template-badge"]')
      await expect(headerBadge).toHaveText('{{ }}')
      expect((await headerBadge.getAttribute('class')) ?? '').toMatch(/cyan/)
      await expect(modal.locator('[data-testid="inspect-expr-badge"]')).toHaveCount(0)
      await expect(modal.locator('[data-testid="inspect-type-badge"]')).toHaveText('string')

      // View defaults to Rendered; the menu is exactly Rendered / Template.
      const view = modal.locator('[data-testid="view-dropdown"]')
      await expect(view).toContainText('Rendered')
      await view.click()
      const options = page.getByRole('option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveText('Rendered')
      await expect(options.nth(1)).toHaveText('Template')
      await page.keyboard.press('Escape')

      // The never-run Rendered view centers "Not rendered yet." (h-full +
      // items-center) and the watcher opens compact, not source-sized.
      const emptyLine = modal.locator('text="Not rendered yet."')
      await expect(emptyLine).toBeVisible()
      const emptyParentClass = await emptyLine.evaluate(
        (el) => el.parentElement?.className ?? '',
      )
      expect(emptyParentClass, 'empty line is centered').toMatch(/items-center/)
      expect(emptyParentClass).toMatch(/justify-center/)
      const modalHeight = (await modal.boundingBox())!.height
      expect(modalHeight, 'template watcher opens compact, not source-sized').toBeLessThan(200)
      // The empty Rendered state carries no metric.
      await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

      // The Template view shows the {{ }} source, cyan-highlighted, and carries
      // NO metric (a source is not a value).
      await view.click()
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      // Read .cm-content (the line-numbered editor's gutter would otherwise
      // prefix line numbers to the wrapper's text).
      await expect(
        modal.locator('[data-testid="scalar-body"]').locator('.cm-content'),
      ).toHaveText(GREETING_SOURCE)
      await expect(modal.locator('.cm-expression').first()).toBeVisible({ timeout: 6_000 })
      await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    })

    await test.step('2: template Compare is two-pane source-vs-source, View locked on Template', async () => {
      const modal = modalFor(page, 'greeting')
      await modal.locator('[data-testid="mode-dropdown"]').click()
      await page.getByRole('option', { name: 'Compare', exact: true }).click()
      await expect(modal.locator('[data-testid="mode-dropdown"]')).toContainText('Compare')

      // Both panes render the {{ }} source (source-vs-source), not a
      // single source-vs-evaluated pane.
      const initialPane = modal.locator('[data-testid="compare-pane-initial"]')
      const currentPane = modal.locator('[data-testid="compare-pane-current"]')
      await expect(
        initialPane.locator('[data-testid="scalar-body"]').locator('.cm-content'),
      ).toHaveText(GREETING_SOURCE)
      await expect(
        currentPane.locator('[data-testid="scalar-body"]').locator('.cm-content'),
      ).toHaveText(GREETING_SOURCE)
      // The View dropdown pins to a single disabled Template.
      const view = modal.locator('[data-testid="view-dropdown"]')
      await expect(view).toContainText('Template')
      await expect(view).toBeDisabled()
      // Source-vs-source Compare carries no metric.
      await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

      await closeInspector(page, 'greeting')
    })

    await test.step('3: an expression Expression view carries no metric', async () => {
      const modal = await openRead(page, 'total')
      const view = modal.locator('[data-testid="view-dropdown"]')
      await view.click()
      await page.getByRole('option', { name: 'Expression', exact: true }).click()
      await expect(modal.locator('[data-testid="scalar-body"]')).toHaveText('n * 2')
      // The formula source carries no "expression" metric.
      await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
      await closeInspector(page, 'total')
    })

    await test.step('4: literal Format Auto re-detects after a save changes the value JSON -> YAML', async () => {
      const modal = await openRead(page, 'note')
      const format = modal.locator('[data-testid="format-dropdown"]')
      // The JSON-content literal detects as JSON.
      await expect(format).toContainText('Auto (JSON)')

      // Replace the value with YAML content in the variable's Edit window and Save.
      const win = await openEditWindow(page, 'note')
      await setWindowValue(page, win, NOTE_YAML)
      await saveWindow(page, win)

      // The open watcher shows the saved value and re-detects - the trigger flips to YAML.
      await expect(modal.locator('[data-testid="scalar-body"]').locator('.cm-content')).toHaveText(NOTE_YAML)
      await expect(format).toContainText('Auto (YAML)')
      await closeInspector(page, 'note')
    })
  })
})
